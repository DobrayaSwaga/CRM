import { Router } from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import { db } from '../db.js';
import { requirePerm } from '../auth.js';
import { audit, normalizePhone, recalcScore } from '../util.js';

export const importRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Временное хранилище загруженных файлов (в памяти процесса, TTL 30 мин)
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
  { key: 'source', label: 'Источник' },
  { key: 'ege_score', label: 'Балл ЕГЭ' },
  { key: 'programs', label: 'Направления (через запятую)' },
  { key: 'note', label: 'Заметка (в историю)' },
];

const AUTO_GUESS = {
  'фамилия': 'last_name', 'имя': 'first_name', 'отчество': 'middle_name',
  'фио': 'fio', 'fio': 'fio', 'полное имя': 'fio',
  'телефон': 'phone', 'phone': 'phone', 'номер телефона': 'phone', 'мобильный': 'phone', 'тел': 'phone',
  'email': 'email', 'e-mail': 'email', 'почта': 'email', 'эл. почта': 'email',
  'дата рождения': 'birth_date', 'др': 'birth_date',
  'город': 'city', 'населенный пункт': 'city', 'населённый пункт': 'city',
  'школа': 'school', 'учебное заведение': 'school', 'соо': 'school',
  'источник': 'source',
  'егэ': 'ege_score', 'балл': 'ege_score', 'баллы': 'ege_score', 'сумма баллов': 'ege_score',
  'направление': 'programs', 'направления': 'programs', 'специальность': 'programs', 'программа': 'programs',
  'заметка': 'note', 'комментарий': 'note',
};

function parseSheet(buffer) {
  const wb = xlsx.read(buffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
  return rows.filter(r => r.some(cell => String(cell).trim() !== ''));
}

// Шаг 1: загрузка и предпросмотр
importRouter.post('/preview', requirePerm('import.run'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  const rows = parseSheet(req.file.buffer);
  if (rows.length < 1) return res.status(400).json({ error: 'Файл пустой или не читается' });
  const headers = rows[0].map(h => String(h).trim());
  const sample = rows.slice(1, 6);
  const guessedMapping = {};
  headers.forEach((h, idx) => {
    const guess = AUTO_GUESS[h.toLowerCase()];
    if (guess) guessedMapping[idx] = guess;
  });
  const fileKey = `${req.user.id}-${Date.now()}-${req.file.originalname}`;
  cacheFile(req.file.buffer, fileKey);
  res.json({
    fileKey,
    filename: req.file.originalname,
    headers,
    sample,
    totalRows: rows.length - 1,
    guessedMapping,
    fields: [...IMPORTABLE_FIELDS, { key: 'ignore', label: '— не импортировать —' }],
    customFields: db.prepare('SELECT id, name FROM custom_fields WHERE active = 1').all(),
  });
});

function parseFio(fio) {
  const parts = String(fio).trim().split(/\s+/);
  return { last: parts[0] || '', first: parts[1] || '', middle: parts.slice(2).join(' ') || '' };
}

// Шаг 2: выполнение импорта
importRouter.post('/execute', requirePerm('import.run'), (req, res) => {
  const { fileKey, mapping, defaultSource } = req.body || {};
  const cached = fileCache.get(fileKey);
  if (!cached) return res.status(400).json({ error: 'Файл не найден — загрузите заново' });
  const rows = parseSheet(cached.buffer).slice(1); // без заголовка
  const colMap = Object.entries(mapping || {})
    .map(([idx, field]) => [Number(idx), field])
    .filter(([, f]) => f && f !== 'ignore');
  if (!colMap.some(([, f]) => f === 'phone') && !colMap.some(([, f]) => f === 'fio') && !colMap.some(([, f]) => f === 'first_name')) {
    return res.status(400).json({ error: 'Сопоставьте хотя бы колонку с телефоном или ФИО/именем' });
  }

  const importInfo = db.prepare('INSERT INTO imports (filename, user_id, total_rows, mapping) VALUES (?,?,?,?)')
    .run(fileKey.split('-').slice(2).join('-'), req.user.id, rows.length, JSON.stringify(mapping));
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

        // Дедупликация: телефон совпал — отправляем в кандидаты на слияние
        let existing = null;
        if (phoneNorm) {
          existing = db.prepare('SELECT id FROM contacts WHERE phone_normalized = ? LIMIT 1').get(phoneNorm);
        }
        if (existing) {
          db.prepare('INSERT INTO duplicate_candidates (import_id, incoming, existing_contact_id) VALUES (?,?,?)')
            .run(importId, JSON.stringify({ last_name, first_name, middle_name, ...data, custom }), existing.id);
          // Дополнительно: если у существующего нет программы из файла — дописываем (неразрушающее слияние)
          if (data.programs) linkPrograms(existing.id, data.programs);
          recalcScore(existing.id);
          duplicates++;
          continue;
        }

        if (!first_name && !last_name && !phoneNorm) { errors++; continue; }

        const info = db.prepare(`
          INSERT INTO contacts (last_name, first_name, middle_name, phone, phone_normalized, email, birth_date, city, school, source, ege_score, status_id, owner_id, created_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          last_name, first_name, middle_name, data.phone || '', phoneNorm,
          data.email || '', data.birth_date || '', data.city || '', data.school || '',
          data.source || defaultSource || '', data.ege_score ? parseInt(data.ege_score) || null : null,
          statuses?.id || null, req.user.id, req.user.id
        );
        const contactId = Number(info.lastInsertRowid);

        if (data.programs) linkPrograms(contactId, data.programs);
        for (const [fieldId, value] of Object.entries(custom)) {
          db.prepare('INSERT OR REPLACE INTO contact_field_values (contact_id, field_id, value) VALUES (?,?,?)')
            .run(contactId, fieldId, value);
        }
        if (data.note) {
          db.prepare("INSERT INTO touchpoints (contact_id, type, title, description, event_date, created_by) VALUES (?,?,?,? ,datetime('now'),?)")
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
    ${where} d.status = 'pending' ${importId ? '' : ''}
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
    const fields = ['last_name', 'first_name', 'middle_name', 'email', 'birth_date', 'city', 'school', 'source', 'ege_score'];
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

// ---- Импорт посетителей ДОД (отдельный режим) ----
importRouter.post('/attendance/:dodId', requirePerm('import.run'), upload.single('file'), (req, res) => {
  const dodId = Number(req.params.dodId);
  const dod = db.prepare('SELECT * FROM dod_events WHERE id = ?').get(dodId);
  if (!dod) return res.status(404).json({ error: 'Мероприятие не найдено' });
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });

  const rows = parseSheet(req.file.buffer);
  if (rows.length < 2) return res.status(400).json({ error: 'Файл пустой' });
  const headers = rows[0].map(h => String(h).toLowerCase().trim());
  const phoneIdx = headers.findIndex(h => ['телефон', 'phone', 'номер телефона', 'мобильный', 'тел'].includes(h));
  const fioIdx = headers.findIndex(h => ['фио', 'fio', 'полное имя', 'имя'].includes(h));
  if (phoneIdx === -1 && fioIdx === -1) {
    return res.status(400).json({ error: 'Нужна колонка «Телефон» и/или «ФИО»' });
  }

  const statuses = db.prepare('SELECT id FROM statuses ORDER BY sort_order LIMIT 1').get();
  let matched = 0, created = 0, already = 0;
  db.exec('BEGIN');
  try {
    for (const row of rows.slice(1)) {
      const phoneNorm = normalizePhone(row[phoneIdx]);
      let contact = phoneNorm ? db.prepare('SELECT id FROM contacts WHERE phone_normalized = ?').get(phoneNorm) : null;
      if (!contact) {
        const fio = fioIdx !== -1 ? parseFio(row[fioIdx]) : { last: '', first: 'Неизвестно', middle: '' };
        if (!fio.first && !fio.last && !phoneNorm) continue;
        const info = db.prepare(`
          INSERT INTO contacts (last_name, first_name, middle_name, phone, phone_normalized, status_id, source, owner_id, created_by)
          VALUES (?,?,?,?,?,?,?,?,?)
        `).run(fio.last, fio.first || 'Неизвестно', fio.middle, phoneIdx !== -1 ? String(row[phoneIdx]).trim() : '', phoneNorm, statuses?.id || null, `ДОД: ${dod.name}`, req.user.id, req.user.id);
        contact = { id: Number(info.lastInsertRowid) };
        created++;
      } else matched++;
      const exists = db.prepare("SELECT id FROM touchpoints WHERE dod_event_id = ? AND contact_id = ? AND type = 'dod'").get(dodId, contact.id);
      if (!exists) {
        db.prepare("INSERT INTO touchpoints (contact_id, type, title, event_date, dod_event_id, created_by) VALUES (?,?,?,?,?,?)")
          .run(contact.id, 'dod', `Посещение: ${dod.name}`, dod.event_date, dodId, req.user.id);
      } else already++;
      recalcScore(contact.id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: String(e.message) });
  }
  audit(req.user.id, 'import.attendance', 'dod_events', dodId, { matched, created, already });
  res.json({ matched, created, already });
});
