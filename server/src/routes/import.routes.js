import { Router } from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import { db } from '../db.js';
import { requirePerm } from '../auth.js';
import { audit, normalizePhone, recalcScore, isoDate, parseEventDateTime } from '../util.js';

export const importRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Временное хранилище загруженных файлов (в памяти процесса)
const fileCache = new Map();
function cacheFile(buffer, originalname) {
  fileCache.set(originalname, { buffer, at: Date.now() });
  if (fileCache.size > 50) {
    const oldest = [...fileCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    fileCache.delete(oldest[0]);
  }
}

const IMPORTABLE_FIELDS = [
  { key: 'last_name', label: 'Фамилия' },
  { key: 'first_name', label: 'Имя' },
  { key: 'middle_name', label: 'Отчество' },
  { key: 'fio', label: 'ФИО одной колонкой (распарсится автоматически)' },
  { key: 'phone', label: 'Телефон' },
  { key: 'email', label: 'Email' },
  { key: 'birth_date', label: 'Дата рождения' },
  { key: 'city', label: 'Город' },
  { key: 'school', label: 'Школа / учебное заведение' },
  { key: 'grade', label: 'Класс / курс' },
  { key: 'source', label: 'Источник' },
  { key: 'ege_score', label: 'Балл ЕГЭ' },
  { key: 'programs', label: 'Направления (через запятую)' },
  { key: 'note', label: 'Заметка (в историю)' },
];

// ---------- Автоопределение колонок ----------
// Нормализуем заголовок: нижний регистр, ё→е, срезаем приставки «Анкета — ...», лишняя пунктуация
export function normalizeHeader(h) {
  let s = String(h ?? '').toLowerCase().replace(/ё/g, 'е');
  s = s.replace(/^анкета\s*[—–\-:]\s*/u, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// Порядок важен: первое совпадение выигрывает, на одно поле — одна колонка (левая)
const HEADER_RULES = [
  [/^фамилия$/, 'last_name'],
  [/^имя$/, 'first_name'],
  [/^отчество/, 'middle_name'],
  [/^(фио|fio|полное имя|ф\.?\s?и\.?\s?о\.?)$/, 'fio'],
  [/^статус/, '__ticket_status'],          // служебная: статус билета/записи
  [/^мероприятие$/, '__event_name'],       // служебная: название мероприятия из выгрузки
  [/^дата и время проведения/, '__event_datetime'],
  [/^организатор мероприятия$/, '__event_org'],
  [/^адрес мероприятия$/, '__event_address'],
  [/телефон|мобильн|^номер$|^тел\.?$|^phone/, 'phone'],
  [/e-?mail|почт/, 'email'],
  [/дата рождения|день рождения|^др$/, 'birth_date'],
  [/город|населенный пункт/, 'city'],
  [/образовательная организация|школа|учебное заведение|^соо$|учреждение/, 'school'],
  [/^класс$|^курс$|параллель/, 'grade'],
  [/^источник/, 'source'],
  [/егэ|^[а-я ]*балл/, 'ege_score'],
  [/^направлен|^специальн|^программ/, 'programs'],
  [/заметк|комментар/, 'note'],
];

// Возвращает { mapping: {colIdx: field}, special: {colIdx: kind} }
export function guessMapping(headers) {
  const mapping = {};
  const special = {};
  const usedFields = new Set();
  headers.forEach((raw, idx) => {
    if (!raw || !String(raw).trim()) return;
    const h = normalizeHeader(raw);
    for (const [re, field] of HEADER_RULES) {
      if (!re.test(h)) continue;
      if (field.startsWith('__')) {
        if (!Object.values(special).includes(field)) special[idx] = field;
        return; // служебные колонки в обычный маппинг не идут
      }
      if (usedFields.has(field)) return; // дублирующая колонка (напр. «Анкета — Телефон») — пропускаем
      mapping[idx] = field;
      usedFields.add(field);
      return;
    }
  });
  return { mapping, special };
}

function parseSheet(buffer) {
  const wb = xlsx.read(buffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
  return rows.filter(r => r.some(cell => String(cell).trim() !== ''));
}

function parseFio(fio) {
  const parts = String(fio).trim().split(/\s+/);
  return { last: parts[0] || '', first: parts[1] || '', middle: parts.slice(2).join(' ') || '' };
}

// Красивое имя списка из имени файла: «Экспорт заявок — ДОД - 18.09.2026 13-05-01.xlsx» → «ДОД · 18.09.2026»
function prettySourceFromFilename(filename) {
  let base = String(filename || '').replace(/\.(xlsx|xls|csv)$/i, '').trim();
  const m = base.match(/^экспорт заявок\s*[—–-]\s*(.+?)\s*-\s*(\d{2}[./]\d{2}[./]\d{4})(?:\s+\d{1,2}[-:]\d{2}(?:[-:]\d{2})?)?$/u);
  if (m) return `${m[1].trim()} · ${m[2].replace(/\//g, '.')}`;
  return base.replace(/[—–_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

// Определяем тип файла: обычный список контактов | выгрузка участников мероприятия | план мероприятий
function detectFile(headers, rows, special) {
  const specialVals = Object.values(special);
  const normHeaders = headers.map(normalizeHeader);
  const hasCol = (kind) => specialVals.includes(kind);
  const colOf = (kind) => Number(Object.keys(special).find(k => special[k] === kind));

  // Выгрузка посетителей мероприятия (есть статус билета или связка «мероприятие + дата проведения»)
  if (hasCol('__ticket_status') || (hasCol('__event_name') && hasCol('__event_datetime'))) {
    let eventName = '', eventDateRaw = '', visited = 0, registered = 0;
    const nameIdx = colOf('__event_name');
    const dtIdx = colOf('__event_datetime');
    const stIdx = colOf('__ticket_status');
    for (const row of rows) {
      if (!eventName && nameIdx >= 0 && row[nameIdx]) eventName = String(row[nameIdx]).trim();
      if (!eventDateRaw && dtIdx >= 0 && row[dtIdx]) eventDateRaw = String(row[dtIdx]).trim();
      if (stIdx >= 0) {
        const st = String(row[stIdx] ?? '').toLowerCase();
        if (st.includes('посетил') || st.includes('пришел') || st.includes('пришёл')) visited++;
        else if (st.includes('зарегистр')) registered++;
      }
      if (eventName && eventDateRaw) {
        if (stIdx < 0) break;
      }
    }
    const dt = parseEventDateTime(eventDateRaw);
    return {
      kind: 'event_attendance',
      eventName, eventDate: dt.date, eventTime: dt.time,
      visited, registered,
      summary: `${eventName || 'Мероприятие'}${dt.date ? ` · ${dt.date.split('-').reverse().join('.')}` : ''}`,
    };
  }

  // План мероприятий: колонки «Название» + «Дата» (+ «Время» или «Формат»)
  if (normHeaders.includes('название') && normHeaders.includes('дата') &&
      (normHeaders.includes('время') || normHeaders.includes('формат'))) {
    return { kind: 'event_plan', totalEvents: rows.length };
  }
  return { kind: 'contacts' };
}

// Шаг 1: загрузка и предпросмотр
importRouter.post('/preview', requirePerm('import.run'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  let rows;
  try {
    rows = parseSheet(req.file.buffer);
  } catch {
    return res.status(400).json({ error: 'Файл не читается — сохраните его как .xlsx' });
  }
  if (rows.length < 1) return res.status(400).json({ error: 'Файл пустой или не читается' });
  const headers = rows[0].map(h => String(h).trim());
  const dataRows = rows.slice(1);
  const sample = dataRows.slice(0, 5);
  const { mapping: guessedMapping, special } = guessMapping(headers);
  const detected = detectFile(headers, dataRows, special);

  let suggestedSource = '';
  if (detected.kind === 'event_attendance' && detected.summary) suggestedSource = detected.summary;
  else suggestedSource = prettySourceFromFilename(req.file.originalname);

  const fileKey = `${req.user.id}-${Date.now()}-${req.file.originalname}`;
  cacheFile(req.file.buffer, fileKey);
  res.json({
    fileKey,
    filename: req.file.originalname,
    headers,
    sample,
    totalRows: dataRows.length,
    guessedMapping,
    suggestedSource,
    detected,
    fields: [...IMPORTABLE_FIELDS, { key: 'ignore', label: '— не импортировать —' }],
    customFields: db.prepare('SELECT id, name FROM custom_fields WHERE active = 1').all(),
  });
});

// Шаг 2: выполнение импорта
importRouter.post('/execute', requirePerm('import.run'), (req, res) => {
  const { fileKey, mapping, defaultSource, sourceLabel } = req.body || {};
  const cached = fileCache.get(fileKey);
  if (!cached) return res.status(400).json({ error: 'Файл не найден — загрузите заново' });
  const rows = parseSheet(cached.buffer).slice(1); // без заголовка
  const colMap = Object.entries(mapping || {})
    .map(([idx, field]) => [Number(idx), field])
    .filter(([, f]) => f && f !== 'ignore');
  if (!colMap.some(([, f]) => f === 'phone') && !colMap.some(([, f]) => f === 'fio') && !colMap.some(([, f]) => f === 'first_name')) {
    return res.status(400).json({ error: 'Сопоставьте хотя бы колонку с телефоном или ФИО/именем' });
  }

  const label = String(sourceLabel || defaultSource || '').trim();
  const importInfo = db.prepare('INSERT INTO imports (filename, user_id, total_rows, mapping) VALUES (?,?,?,?)')
    .run(fileKey.split('-').slice(2).join('-'), req.user.id, rows.length, JSON.stringify({ mapping, sourceLabel: label }));
  const importId = Number(importInfo.lastInsertRowid);

  const statuses = db.prepare('SELECT id FROM statuses ORDER BY sort_order LIMIT 1').get();
  let imported = 0, duplicates = 0, errors = 0;
  const isCustomField = (f) => String(f).startsWith('cf_');

  db.exec('BEGIN');
  try {
    for (const row of rows) {
      try {
        const data = {};
        const custom = {};
        for (const [idx, field] of colMap) {
          const value = String(row[idx] ?? '').trim();
          if (value === '') continue;
          if (isCustomField(field)) custom[Number(field.slice(3))] = value;
          else data[field] = value;
        }

        let { last_name = '', first_name = '', middle_name = '' } = data;
        if (data.fio) {
          const parsed = parseFio(data.fio);
          last_name = last_name || parsed.last;
          first_name = first_name || parsed.first;
          middle_name = middle_name || parsed.middle;
        }
        const phoneNorm = normalizePhone(data.phone);
        const birthDate = isoDate(data.birth_date) || String(data.birth_date || '').trim();

        // Дедупликация: телефон совпал — отправляем в кандидаты на слияние
        let existing = null;
        if (phoneNorm) {
          existing = db.prepare('SELECT id FROM contacts WHERE phone_normalized = ? LIMIT 1').get(phoneNorm);
        }
        if (existing) {
          db.prepare('INSERT INTO duplicate_candidates (import_id, incoming, existing_contact_id) VALUES (?,?,?)')
            .run(importId, JSON.stringify({ last_name, first_name, middle_name, ...data, birth_date: birthDate, custom }), existing.id);
          if (data.programs) linkPrograms(existing.id, data.programs);
          recalcScore(existing.id);
          duplicates++;
          continue;
        }

        if (!first_name && !last_name && !phoneNorm) { errors++; continue; }

        const info = db.prepare(`
          INSERT INTO contacts (last_name, first_name, middle_name, phone, phone_normalized, email, birth_date, city, school, grade, source, ege_score, status_id, owner_id, created_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          last_name, first_name, middle_name, data.phone || '', phoneNorm,
          data.email || '', birthDate, data.city || '', data.school || '', data.grade || '',
          data.source || label, data.ege_score ? parseInt(data.ege_score) || null : null,
          statuses?.id || null, req.user.id, req.user.id
        );
        const contactId = Number(info.lastInsertRowid);

        if (data.programs) linkPrograms(contactId, data.programs);
        for (const [fieldId, value] of Object.entries(custom)) {
          db.prepare('INSERT OR REPLACE INTO contact_field_values (contact_id, field_id, value) VALUES (?,?,?)')
            .run(contactId, fieldId, value);
        }
        if (data.note) {
          db.prepare("INSERT INTO touchpoints (contact_id, type, title, description, event_date, created_by) VALUES (?,?,?,?,datetime('now'),?)")
            .run(contactId, 'note', 'Из импорта', data.note, req.user.id);
        }
        recalcScore(contactId);
        imported++;
      } catch {
        errors++;
      }
    }
    db.prepare('UPDATE imports SET imported = ?, duplicates = ?, errors = ? WHERE id = ?')
      .run(imported, duplicates, errors, importId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: String(e.message) });
  }
  fileCache.delete(fileKey);
  audit(req.user.id, 'import.execute', 'imports', importId, { imported, duplicates, errors });
  res.json({ importId, imported, duplicates, errors, total: rows.length });
});

function linkPrograms(contactId, programsStr) {
  const names = String(programsStr).split(/[;,]/).map(s => s.trim()).filter(Boolean);
  for (const name of names) {
    let prog = db.prepare('SELECT id FROM programs WHERE name = ? COLLATE NOCASE').get(name);
    if (!prog) {
      const info = db.prepare('INSERT INTO programs (name) VALUES (?)').run(name);
      prog = { id: Number(info.lastInsertRowid) };
    }
    db.prepare('INSERT OR IGNORE INTO contact_programs (contact_id, program_id) VALUES (?,?)').run(contactId, prog.id);
  }
}

// История импортов
importRouter.get('/history', requirePerm('import.run'), (_req, res) => {
  const rows = db.prepare(`
    SELECT i.*, u.name AS user_name,
      (SELECT COUNT(*) FROM duplicate_candidates d WHERE d.import_id = i.id AND d.status = 'pending') AS pending_duplicates
    FROM imports i LEFT JOIN users u ON u.id = i.user_id ORDER BY i.id DESC LIMIT 50
  `).all();
  res.json({ imports: rows });
});

// Кандидаты на слияние
importRouter.get('/duplicates', requirePerm('import.merge'), (req, res) => {
  const importId = req.query.import_id ? Number(req.query.import_id) : null;
  const where = importId ? 'WHERE d.import_id = ? AND' : 'WHERE';
  const params = importId ? [importId] : [];
  const rows = db.prepare(`
    SELECT d.*, i.filename,
           c.last_name, c.first_name, c.middle_name, c.phone, c.email, c.city, c.score, c.temperature,
           s.name AS status_name
    FROM duplicate_candidates d
    JOIN imports i ON i.id = d.import_id
    JOIN contacts c ON c.id = d.existing_contact_id
    LEFT JOIN statuses s ON s.id = c.status_id
    ${where} d.status = 'pending'
    ORDER BY d.id DESC LIMIT 200
  `).all(...params);
  res.json({ candidates: rows.map(r => ({ ...r, incoming: JSON.parse(r.incoming) })) });
});

// Решение по дублю: merge (применить данные в существующего) или skip
importRouter.post('/duplicates/:id/resolve', requirePerm('import.merge'), (req, res) => {
  const id = Number(req.params.id);
  const cand = db.prepare('SELECT * FROM duplicate_candidates WHERE id = ?').get(id);
  if (!cand) return res.status(404).json({ error: 'Не найдено' });
  const { action } = req.body || {};
  if (!['merge', 'skip'].includes(action)) return res.status(400).json({ error: 'action: merge | skip' });

  if (action === 'merge') {
    const inc = JSON.parse(cand.incoming);
    const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(cand.existing_contact_id);
    const fields = ['last_name', 'first_name', 'middle_name', 'email', 'birth_date', 'city', 'school', 'grade', 'source', 'ege_score'];
    db.exec('BEGIN');
    try {
      for (const f of fields) {
        if (inc[f] && (c[f] === '' || c[f] === null)) {
          db.prepare(`UPDATE contacts SET ${f} = ? WHERE id = ?`).run(f === 'ege_score' ? parseInt(inc[f]) || null : inc[f], c.id);
        }
      }
      if (inc.programs) linkPrograms(c.id, inc.programs);
      if (inc.custom) {
        for (const [fieldId, value] of Object.entries(inc.custom)) {
          db.prepare('INSERT OR IGNORE INTO contact_field_values (contact_id, field_id, value) VALUES (?,?,?)').run(c.id, Number(fieldId), value);
        }
      }
      db.prepare("INSERT INTO touchpoints (contact_id, type, title, description, event_date, created_by) VALUES (?,?,?,?,datetime('now'),?)")
        .run(c.id, 'note', 'Повторная загрузка данных', 'Информация из повторного импорта объединена с карточкой', req.user.id);
      db.prepare("UPDATE duplicate_candidates SET status = 'merged' WHERE id = ?").run(id);
      recalcScore(c.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      return res.status(500).json({ error: String(e.message) });
    }
  } else {
    db.prepare("UPDATE duplicate_candidates SET status = 'skipped' WHERE id = ?").run(id);
  }
  audit(req.user.id, `import.duplicate.${action}`, 'duplicate_candidates', id);
  res.json({ ok: true });
});

// ---------- Импорт посетителей мероприятия ----------
// Читает выгрузки «Экспорт заявок»: сам определяет событие, статус билета (Посетил/Зарегистрирован),
// находит людей по телефону, создаёт новых, проставляет посещения и регистрации.
function findCol(headersNorm, re) {
  return headersNorm.findIndex(h => re.test(h));
}

function importAttendance(req, res, dodIdParam) {
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  let rows;
  try {
    rows = parseSheet(req.file.buffer);
  } catch {
    return res.status(400).json({ error: 'Файл не читается — сохраните его как .xlsx' });
  }
  if (rows.length < 2) return res.status(400).json({ error: 'Файл пустой — только заголовок' });

  const headers = rows[0].map(h => String(h).trim());
  const norm = headers.map(normalizeHeader);
  const { mapping, special } = guessMapping(headers);
  const colOf = (kind) => { const k = Object.keys(special).find(k => special[k] === kind); return k === undefined ? -1 : Number(k); };
  // Обычные поля берём из авто-маппинга; служебные — из special + запасной поиск по шаблонам
  const fieldIdx = (f) => { const k = Object.keys(mapping).find(k => mapping[k] === f); return k === undefined ? -1 : Number(k); };
  const phoneIdx = fieldIdx('phone');
  const fioIdx = fieldIdx('fio');
  const lastIdx = fieldIdx('last_name');
  const firstIdx = fieldIdx('first_name');
  const middleIdx = fieldIdx('middle_name');
  const emailIdx = fieldIdx('email');
  const schoolIdx = fieldIdx('school');
  const gradeIdx = fieldIdx('grade');
  const birthIdx = fieldIdx('birth_date');
  let statusIdx = colOf('__ticket_status');
  if (statusIdx < 0) statusIdx = findCol(norm, /статус/);
  let eventNameIdx = colOf('__event_name');
  let eventDtIdx = colOf('__event_datetime');
  if (eventDtIdx < 0) eventDtIdx = findCol(norm, /дата.*провед|проведения/);
  const addressIdx = colOf('__event_address');

  if (phoneIdx === -1 && fioIdx === -1 && lastIdx === -1) {
    return res.status(400).json({ error: 'Не нашлась колонка «Телефон» и/или «ФИО» — проверьте файл' });
  }

  const dataRows = rows.slice(1);

  // --- Событие: явно указанное, найденное по дате в файле, либо новое ---
  let dod = null;
  let eventCreated = false;
  if (dodIdParam) {
    dod = db.prepare('SELECT * FROM dod_events WHERE id = ?').get(Number(dodIdParam));
    if (!dod) return res.status(404).json({ error: 'Мероприятие не найдено' });
  } else {
    let eventName = '';
    let dt = { date: '', time: '', iso: '' };
    for (const row of dataRows) {
      if (!eventName && eventNameIdx >= 0 && row[eventNameIdx]) eventName = String(row[eventNameIdx]).trim();
      if (!dt.date && eventDtIdx >= 0 && row[eventDtIdx]) dt = parseEventDateTime(row[eventDtIdx]);
      if (eventName && dt.date) break;
    }
    if (!eventName) {
      eventName = prettySourceFromFilename(req.file.originalname).replace(/^(.*) · \d{2}\.\d{2}\.\d{4}$/u, '$1');
    }
    if (dt.date) {
      dod = db.prepare('SELECT * FROM dod_events WHERE substr(event_date, 1, 10) = ? ORDER BY id LIMIT 1').get(dt.date);
    }
    if (!dod) {
      const iso = dt.iso || dt.date || new Date().toISOString().slice(0, 10);
      const location = addressIdx >= 0 ? String(dataRows[0]?.[addressIdx] || '').trim() : '';
      const info = db.prepare('INSERT INTO dod_events (name, event_date, location, description, created_by) VALUES (?,?,?,?,?)')
        .run(eventName || 'Мероприятие', iso, location, `Импортировано из файла «${req.file.originalname}»`, req.user.id);
      dod = db.prepare('SELECT * FROM dod_events WHERE id = ?').get(Number(info.lastInsertRowid));
      eventCreated = true;
    }
  }

  const dmy = dod.event_date.slice(0, 10).split('-').reverse().join('.');
  const sourceLabel = `${dod.name} · ${dmy}`;
  const statuses = db.prepare('SELECT id FROM statuses ORDER BY sort_order LIMIT 1').get();
  let matched = 0, created = 0, visited = 0, registered = 0, already = 0, skipped = 0;

  db.exec('BEGIN');
  try {
    for (const row of dataRows) {
      // Статус билета: посетил → посещение; зарегистрирован → регистрация; прочее → пропуск
      let mode = 'visit'; // если колонки статуса нет — старое поведение: все посетившие
      if (statusIdx >= 0) {
        const st = String(row[statusIdx] ?? '').toLowerCase().replace(/ё/g, 'е');
        if (st.includes('посетил') || st.includes('пришел') || st.includes('участвовал')) mode = 'visit';
        else if (st.includes('зарегистр')) mode = 'registration';
        else { skipped++; continue; }
      }

      const phoneNorm = phoneIdx >= 0 ? normalizePhone(row[phoneIdx]) : '';
      let contact = phoneNorm ? db.prepare('SELECT id FROM contacts WHERE phone_normalized = ?').get(phoneNorm) : null;
      if (!contact && phoneNorm === '' && fioIdx >= 0) {
        // крайний случай: искать по полному ФИО
        const f = parseFio(row[fioIdx]);
        if (f.last && f.first) {
          contact = db.prepare('SELECT id FROM contacts WHERE lower(last_name)=lower(?) AND lower(first_name)=lower(?) AND (middle_name = "" OR lower(middle_name)=lower(?)) LIMIT 1')
            .get(f.last, f.first, f.middle || '');
        }
      }
      if (!contact) {
        let fio = { last: '', first: '', middle: '' };
        if (fioIdx >= 0) fio = parseFio(row[fioIdx]);
        if (!fio.last && lastIdx >= 0) fio.last = String(row[lastIdx] || '').trim();
        if (!fio.first && firstIdx >= 0) fio.first = String(row[firstIdx] || '').trim();
        if (!fio.middle && middleIdx >= 0) fio.middle = String(row[middleIdx] || '').trim();
        if (!fio.first && !fio.last && !phoneNorm) { skipped++; continue; }
        const birthDate = birthIdx >= 0 ? (isoDate(row[birthIdx]) || String(row[birthIdx] || '').trim()) : '';
        const info = db.prepare(`
          INSERT INTO contacts (last_name, first_name, middle_name, phone, phone_normalized, email, birth_date, school, grade, status_id, source, owner_id, created_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          fio.last, fio.first || 'Неизвестно', fio.middle,
          phoneIdx >= 0 ? String(row[phoneIdx]).trim() : '', phoneNorm,
          emailIdx >= 0 ? String(row[emailIdx] || '').trim() : '',
          birthDate,
          schoolIdx >= 0 ? String(row[schoolIdx] || '').trim() : '',
          gradeIdx >= 0 ? String(row[gradeIdx] || '').trim() : '',
          statuses?.id || null, sourceLabel, req.user.id, req.user.id
        );
        contact = { id: Number(info.lastInsertRowid) };
        created++;
      } else {
        matched++;
        // Неразрушающе дополняем пустые поля из файла
        const upd = [];
        const params = [];
        const fill = (col, idx) => {
          if (idx >= 0 && String(row[idx] || '').trim()) { upd.push(`${col} = CASE WHEN ${col} = '' THEN ? ELSE ${col} END`); params.push(String(row[idx]).trim()); }
        };
        fill('email', emailIdx); fill('school', schoolIdx); fill('grade', gradeIdx);
        if (upd.length) {
          params.push(contact.id);
          db.prepare(`UPDATE contacts SET ${upd.join(', ')} WHERE id = ?`).run(...params);
        }
      }

      // Касание: посещение или регистрация (с защитой от повторов)
      if (mode === 'visit') {
        const exists = db.prepare("SELECT id FROM touchpoints WHERE dod_event_id = ? AND contact_id = ? AND type = 'dod'").get(dod.id, contact.id);
        if (!exists) {
          db.prepare("INSERT INTO touchpoints (contact_id, type, title, event_date, dod_event_id, created_by) VALUES (?,?,?,?,?,?)")
            .run(contact.id, 'dod', `Посещение: ${dod.name}`, dod.event_date, dod.id, req.user.id);
          visited++;
        } else already++;
      } else {
        const exists = db.prepare("SELECT id FROM touchpoints WHERE dod_event_id = ? AND contact_id = ? AND type = 'dod_registration'").get(dod.id, contact.id);
        if (!exists) {
          db.prepare("INSERT INTO touchpoints (contact_id, type, title, event_date, dod_event_id, created_by) VALUES (?,?,?,?,?,?)")
            .run(contact.id, 'dod_registration', `Регистрация: ${dod.name}`, dod.event_date, dod.id, req.user.id);
          registered++;
        } else already++;
      }
      recalcScore(contact.id);
    }

    db.prepare("INSERT INTO imports (filename, kind, user_id, total_rows, imported, duplicates, errors, mapping) VALUES (?,?,?,?,?,?,?,?)")
      .run(req.file.originalname, 'attendance', req.user.id, dataRows.length, visited + registered, matched, skipped, JSON.stringify({ event: dod.name }));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: String(e.message) });
  }
  audit(req.user.id, 'import.attendance', 'dod_events', dod.id, { matched, created, visited, registered, skipped });
  res.json({
    event: { id: dod.id, name: dod.name, event_date: dod.event_date, created: eventCreated },
    total: dataRows.length, matched, created, visited, registered, already, skipped,
  });
}

// Автоопределение мероприятия из файла (для страницы «Импорт»)
importRouter.post('/attendance', requirePerm('import.run'), upload.single('file'), (req, res) => importAttendance(req, res, null));
// Явно указанное мероприятие (со страницы «ДОД»)
importRouter.post('/attendance/:dodId', requirePerm('import.run'), upload.single('file'), (req, res) => importAttendance(req, res, Number(req.params.dodId)));
