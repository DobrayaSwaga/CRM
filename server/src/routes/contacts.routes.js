import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { db } from '../db.js';
import { hasPerm, requirePerm } from '../auth.js';
import { audit, normalizePhone, recalcScore, rowToContact, UPLOADS_DIR } from '../util.js';

export const contactsRouter = Router();

const TOUCHPOINT_TYPES = ['dod', 'dod_registration', 'call', 'email', 'application', 'document', 'note', 'other'];

const EDITABLE_FIELDS = ['last_name', 'first_name', 'middle_name', 'phone', 'email', 'birth_date', 'city', 'school', 'grade', 'source', 'ege_score', 'status_id', 'owner_id'];

function applyCustomValues(contactId, custom) {
  if (!custom || typeof custom !== 'object') return;
  const stmt = db.prepare('INSERT OR REPLACE INTO contact_field_values (contact_id, field_id, value) VALUES (?,?,?)');
  for (const [fieldId, value] of Object.entries(custom)) {
    const field = db.prepare('SELECT id FROM custom_fields WHERE id = ?').get(Number(fieldId));
    if (field) stmt.run(contactId, Number(fieldId), String(value ?? ''));
  }
}

function setPrograms(contactId, programIds) {
  if (!Array.isArray(programIds)) return;
  db.prepare('DELETE FROM contact_programs WHERE contact_id = ?').run(contactId);
  const ins = db.prepare('INSERT OR IGNORE INTO contact_programs (contact_id, program_id) VALUES (?,?)');
  for (const pid of programIds) {
    if (db.prepare('SELECT id FROM programs WHERE id = ?').get(pid)) ins.run(contactId, pid);
  }
}

// ---------- Список с поиском и фильтрами ----------
contactsRouter.get('/', requirePerm('contacts.view'), (req, res) => {
  const q = req.query;
  const where = [];
  const params = [];

  if (q.search) {
    const s = `%${String(q.search).trim().toLowerCase()}%`;
    // search_text уже в нижнем регистре (считается в JS, кириллица работает)
    where.push('(c.search_text LIKE ?)');
    params.push(s);
  }
  if (q.status_id) { where.push('c.status_id = ?'); params.push(Number(q.status_id)); }
  if (q.temperature) { where.push('c.temperature = ?'); params.push(String(q.temperature)); }
  if (q.owner_id) { where.push('c.owner_id = ?'); params.push(Number(q.owner_id)); }
  if (q.source) { where.push('c.source = ?'); params.push(String(q.source)); }
  if (q.city) { where.push('c.city LIKE ?'); params.push(`%${q.city}%`); }
  if (q.program_id) {
    where.push('EXISTS (SELECT 1 FROM contact_programs cp WHERE cp.contact_id = c.id AND cp.program_id = ?)');
    params.push(Number(q.program_id));
  }
  if (q.min_score) { where.push('c.score >= ?'); params.push(Number(q.min_score)); }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const page = Math.max(1, Number(q.page) || 1);
  const perPage = Math.min(100, Math.max(5, Number(q.per_page) || 25));

  const allowedSort = { fio: "c.last_name, c.first_name", created: 'c.created_at DESC', score: 'c.score DESC', updated: 'c.updated_at DESC' };
  const orderBy = allowedSort[q.sort] || allowedSort.created;

  const total = db.prepare(`SELECT COUNT(*) c FROM contacts c ${whereSql}`).get(...params).c;
  const rows = db.prepare(`
    SELECT c.*, s.name AS status_name, s.color AS status_color, u.name AS owner_name
    FROM contacts c
    LEFT JOIN statuses s ON s.id = c.status_id
    LEFT JOIN users u ON u.id = c.owner_id
    ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?
  `).all(...params, perPage, (page - 1) * perPage);

  const contacts = rows.map(r => ({ ...r, programs: db.prepare(
    'SELECT p.id, p.name, p.color FROM programs p JOIN contact_programs cp ON cp.program_id = p.id WHERE cp.contact_id = ?'
  ).all(r.id) }));

  res.json({ contacts, total, page, per_page: perPage, pages: Math.ceil(total / perPage) });
});

// ---------- Поиск возможных дублей (по всей базе) ----------
contactsRouter.get('/duplicates', requirePerm('import.merge'), (_req, res) => {
  const groups = db.prepare(`
    SELECT phone_normalized, COUNT(*) c FROM contacts
    WHERE phone_normalized != '' GROUP BY phone_normalized HAVING c > 1
  `).all();
  const result = [];
  for (const g of groups.slice(0, 50)) {
    const members = db.prepare(`
      SELECT c.id, c.last_name, c.first_name, c.middle_name, c.phone, c.email, c.score, c.temperature,
             s.name AS status_name, c.created_at,
             (SELECT COUNT(*) FROM touchpoints t WHERE t.contact_id = c.id) AS touchpoints_count
      FROM contacts c LEFT JOIN statuses s ON s.id = c.status_id
      WHERE c.phone_normalized = ? ORDER BY c.id
    `).all(g.phone_normalized);
    result.push({ key: g.phone_normalized, members });
  }
  res.json({ duplicates: result });
});

// ---------- Ручное слияние двух контактов ----------
contactsRouter.post('/merge', requirePerm('import.merge'), (req, res) => {
  const { keep_id, remove_id } = req.body || {};
  const keep = db.prepare('SELECT * FROM contacts WHERE id = ?').get(Number(keep_id));
  const remove = db.prepare('SELECT * FROM contacts WHERE id = ?').get(Number(remove_id));
  if (!keep || !remove) return res.status(404).json({ error: 'Контакт не найден' });
  if (keep.id === remove.id) return res.status(400).json({ error: 'Нельзя слить контакт сам с собой' });

  db.exec('BEGIN');
  try {
    // Переносим историю, задачи, поля, программы
    db.prepare('UPDATE touchpoints SET contact_id = ? WHERE contact_id = ?').run(keep.id, remove.id);
    db.prepare('UPDATE tasks SET contact_id = ? WHERE contact_id = ?').run(keep.id, remove.id);
    db.prepare('INSERT OR IGNORE INTO contact_programs (contact_id, program_id) SELECT ?, program_id FROM contact_programs WHERE contact_id = ?').run(keep.id, remove.id);
    db.prepare('INSERT OR IGNORE INTO contact_field_values (contact_id, field_id, value) SELECT ?, field_id, value FROM contact_field_values WHERE contact_id = ?').run(keep.id, remove.id);
    // Пустые поля keep заполняем из remove
    for (const f of EDITABLE_FIELDS) {
      if ((keep[f] === '' || keep[f] === null) && remove[f] !== '' && remove[f] !== null && f !== 'phone') {
        db.prepare(`UPDATE contacts SET ${f} = ? WHERE id = ?`).run(remove[f], keep.id);
      }
    }
    db.prepare('DELETE FROM contacts WHERE id = ?').run(remove.id);
    recalcScore(keep.id);
    audit(req.user.id, 'contact.merge', 'contacts', keep.id, { removed: remove.id });
    db.exec('COMMIT');
    res.json({ ok: true, keep_id: keep.id });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: String(e.message) });
  }
});

// ---------- Карточка ----------
contactsRouter.get('/:id', requirePerm('contacts.view'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`
    SELECT c.*, s.name AS status_name, s.color AS status_color, u.name AS owner_name, cu.name AS created_by_name
    FROM contacts c
    LEFT JOIN statuses s ON s.id = c.status_id
    LEFT JOIN users u ON u.id = c.owner_id
    LEFT JOIN users cu ON cu.id = c.created_by
    WHERE c.id = ?
  `).get(id);
  if (!row) return res.status(404).json({ error: 'Контакт не найден' });

  const contact = rowToContact(row, { withPrograms: true });
  contact.custom_values = db.prepare(`
    SELECT cf.id AS field_id, cf.name, cf.field_type, cf.options, COALESCE(cfv.value, '') AS value
    FROM custom_fields cf
    LEFT JOIN contact_field_values cfv ON cfv.contact_id = ? AND cfv.field_id = cf.id
    WHERE cf.active = 1 ORDER BY cf.sort_order, cf.id
  `).all(id);
  contact.touchpoints = db.prepare(`
    SELECT t.*, u.name AS created_by_name, d.name AS dod_name
    FROM touchpoints t
    LEFT JOIN users u ON u.id = t.created_by
    LEFT JOIN dod_events d ON d.id = t.dod_event_id
    WHERE t.contact_id = ? ORDER BY t.event_date DESC, t.id DESC
  `).all(id);
  contact.tasks = db.prepare(`
    SELECT t.*, u.name AS assignee_name FROM tasks t
    LEFT JOIN users u ON u.id = t.assignee_id
    WHERE t.contact_id = ? ORDER BY t.status = 'open' DESC, t.due_date
  `).all(id);
  res.json({ contact });
});

// ---------- Массовые операции ----------
contactsRouter.post('/bulk/patch', requirePerm('contacts.edit'), (req, res) => {
  const { ids, patch } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Нет выбранных контактов' });
  if (ids.length > 2000) return res.status(400).json({ error: 'За раз не больше 2000' });
  const allowed = ['status_id', 'owner_id'];
  const updates = Object.entries(patch || {}).filter(([k]) => allowed.includes(k));
  if (updates.length === 0) return res.status(400).json({ error: 'Передайте patch.status_id и/или patch.owner_id' });

  db.exec('BEGIN');
  try {
    for (const [field, value] of updates) {
      db.prepare(`UPDATE contacts SET ${field} = ?, updated_at = datetime('now') WHERE id IN (${ids.map(() => '?').join(',')})`)
        .run(value || null, ...ids);
    }
    for (const id of ids) recalcScore(Number(id));
    audit(req.user.id, 'contact.bulk_patch', 'contacts', null, { count: ids.length, patch });
    db.exec('COMMIT');
    res.json({ ok: true, updated: ids.length });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: String(e.message) });
  }
});

contactsRouter.post('/bulk/delete', requirePerm('contacts.delete'), (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Нет выбранных контактов' });
  db.prepare(`DELETE FROM contacts WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  audit(req.user.id, 'contact.bulk_delete', 'contacts', null, { count: ids.length });
  res.json({ ok: true, deleted: ids.length });
});

// ---------- Умная подсказка «следующее действие» ----------
contactsRouter.get('/:id/next-action', requirePerm('contacts.view'), (req, res) => {
  const id = Number(req.params.id);
  const c = db.prepare(`
    SELECT c.*, s.is_final, s.is_success, s.name AS status_name
    FROM contacts c LEFT JOIN statuses s ON s.id = c.status_id WHERE c.id = ?
  `).get(id);
  if (!c) return res.status(404).json({ error: 'Контакт не найден' });

  const tpCount = db.prepare('SELECT COUNT(*) c FROM touchpoints WHERE contact_id = ?').get(id).c;
  const dodCount = db.prepare("SELECT COUNT(*) c FROM touchpoints WHERE contact_id = ? AND type = 'dod'").get(id).c;
  const hasApp = db.prepare("SELECT id FROM touchpoints WHERE contact_id = ? AND type = 'application' LIMIT 1").get(id);
  const lastTp = db.prepare('SELECT event_date FROM touchpoints WHERE contact_id = ? ORDER BY event_date DESC LIMIT 1').get(id)?.event_date;
  const openTasks = db.prepare("SELECT COUNT(*) c FROM tasks WHERE contact_id = ? AND status = 'open'").get(id).c;
  const futureDod = db.prepare("SELECT * FROM dod_events WHERE event_date >= datetime('now') ORDER BY event_date LIMIT 1").get();
  const ref = lastTp || c.created_at;
  const daysSilent = ref ? Math.floor((Date.now() - new Date(String(ref).replace(' ', 'T') + 'Z').getTime()) / 86400000) : 999;

  let s = null; // suggestion

  if (c.is_final) {
    if (c.is_success) s = { icon: 'award', tone: 'emerald', title: 'Кейс закрыт успехом', reason: `${c.first_name} уже студент. Отметьте в истории — есть ли обратная связь о приёме.`, action: null };
    else s = { icon: 'archive', tone: 'slate', title: 'Кейс закрыт (отказ)', reason: 'Можно добавить заметку о причине отказа — это обучит будущую модель.', action: null };
  }

  if (!s && tpCount === 0) {
    s = {
      icon: 'phone', tone: 'blue',
      title: 'Сделайте первый контакт',
      reason: 'У человека нет ни одного касания. Первый звонок решает, попадёт ли он в работу.',
      action: { type: 'task', title: 'Первый звонок: представиться и выяснить интерес' },
    };
  }

  if (!s && c.temperature === 'hot' && openTasks === 0) {
    s = {
      icon: 'flame', tone: 'red',
      title: 'Горячий лид без активной задачи!',
      reason: `Баллы высокие (${c.score}), но никто не назначил следующий шаг. Такие лиды теряются быстрее всего.`,
      action: { type: 'task', title: 'Позвонить: обсудить поступление (горячий лид)', due_hours: 4, priority: 'high' },
    };
  }

  if (!s && dodCount >= 1 && !hasApp && futureDod) {
    s = {
      icon: 'graduation', tone: 'violet',
      title: 'Пригласите на следующий ДОД',
      reason: `${dodCount} посещений, но заявки нет. Ближайшее мероприятие: «${futureDod.name}» (${futureDod.event_date.slice(0, 10)}).`,
      action: { type: 'task', title: `Пригласить на ДОД «${futureDod.name}»`, due_hours: 24 },
    };
  }

  if (!s && daysSilent >= 14) {
    s = {
      icon: 'snowflake', tone: 'cyan',
      title: 'Лид остывает',
      reason: `Тишина уже ${daysSilent} дн. — баллы только что начали угасать.`,
      action: { type: 'task', title: 'Прогрев: короткий звонок или письмо', due_hours: 48 },
    };
  }

  if (!s && openTasks === 0 && daysSilent >= 5) {
    s = {
      icon: 'clock', tone: 'amber',
      title: 'Назначьте следующий шаг',
      reason: `Контакт в статусе «${c.status_name || '—'}», касания редки. Поставьте задачу, чтобы не выпал из работы.`,
      action: { type: 'task', title: 'Связаться: уточнить планы по поступлению', due_hours: 24 },
    };
  }

  res.json({ suggestion: s, stats: { tpCount, dodCount, daysSilent, openTasks } });
});

// ---------- Создание ----------
contactsRouter.post('/', requirePerm('contacts.create'), (req, res) => {
  const b = req.body || {};
  if (!b.first_name?.trim() && !b.last_name?.trim()) return res.status(400).json({ error: 'Укажите хотя бы имя или фамилию' });
  const phoneNorm = normalizePhone(b.phone);
  if (phoneNorm) {
    const dup = db.prepare('SELECT id FROM contacts WHERE phone_normalized = ? LIMIT 1').get(phoneNorm);
    if (dup) return res.status(409).json({ error: 'Контакт с таким телефоном уже существует', existing_id: dup.id });
  }
  const info = db.prepare(`
    INSERT INTO contacts (last_name, first_name, middle_name, phone, phone_normalized, email, birth_date, city, school, grade, source, ege_score, status_id, owner_id, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    b.last_name?.trim() || '', b.first_name?.trim() || '', b.middle_name?.trim() || '',
    b.phone?.trim() || '', phoneNorm, b.email?.trim() || '', b.birth_date || '', b.city?.trim() || '',
    b.school?.trim() || '', b.grade?.trim() || '', b.source?.trim() || '', b.ege_score ? Number(b.ege_score) : null,
    b.status_id || db.prepare('SELECT id FROM statuses ORDER BY sort_order LIMIT 1').get()?.id,
    b.owner_id || req.user.id, req.user.id
  );
  const id = Number(info.lastInsertRowid);
  setPrograms(id, b.program_ids);
  applyCustomValues(id, b.custom);
  if (b.note) {
    db.prepare("INSERT INTO touchpoints (contact_id, type, title, description, event_date, created_by) VALUES (?,?,?,?,datetime('now'),?)")
      .run(id, 'note', 'Заметка при создании', String(b.note), req.user.id);
  }
  recalcScore(id);
  audit(req.user.id, 'contact.create', 'contacts', id, {} );
  res.status(201).json({ id });
});

// ---------- Обновление ----------
contactsRouter.patch('/:id', requirePerm('contacts.edit'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Контакт не найден' });
  const b = req.body || {};
  for (const f of EDITABLE_FIELDS) {
    if (b[f] !== undefined) {
      if (f === 'phone') {
        const norm = normalizePhone(b.phone);
        db.prepare('UPDATE contacts SET phone = ?, phone_normalized = ? WHERE id = ?').run(String(b.phone || '').trim(), norm, id);
      } else if (f === 'ege_score') {
        db.prepare('UPDATE contacts SET ege_score = ? WHERE id = ?').run(b[f] ? Number(b[f]) : null, id);
      } else {
        db.prepare(`UPDATE contacts SET ${f} = ? WHERE id = ?`).run(typeof b[f] === 'string' ? b[f].trim() : b[f], id);
      }
    }
  }
  if (b.program_ids !== undefined) setPrograms(id, b.program_ids);
  applyCustomValues(id, b.custom);
  db.prepare("UPDATE contacts SET updated_at = datetime('now') WHERE id = ?").run(id);
  recalcScore(id);
  audit(req.user.id, 'contact.update', 'contacts', id, b);
  res.json({ ok: true });
});

// ---------- Удаление ----------
contactsRouter.delete('/:id', requirePerm('contacts.delete'), (req, res) => {
  const id = Number(req.params.id);
  const docs = db.prepare('SELECT filename FROM contact_documents WHERE contact_id = ?').all(id);
  db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
  for (const d of docs) {
    try { fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(d.filename))); } catch { /* файла может не быть */ }
  }
  audit(req.user.id, 'contact.delete', 'contacts', id);
  res.json({ ok: true });
});

// ---------- Документы карточки ----------
const docStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').replace(/[^\w.а-яё-]/gi, '').slice(0, 12);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const docUpload = multer({ storage: docStorage, limits: { fileSize: 25 * 1024 * 1024 } });

// multer отдаёт имя файла в latin1 — возвращаем кириллицу
function decodeFileName(name) {
  try { return Buffer.from(String(name), 'latin1').toString('utf8'); } catch { return String(name); }
}

contactsRouter.get('/:id/documents', requirePerm('contacts.view'), (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM contacts WHERE id = ?').get(id)) return res.status(404).json({ error: 'Контакт не найден' });
  const documents = db.prepare(`
    SELECT d.id, d.original_name, d.mime, d.size, d.created_at, u.name AS uploaded_by_name
    FROM contact_documents d LEFT JOIN users u ON u.id = d.uploaded_by
    WHERE d.contact_id = ? ORDER BY d.id DESC
  `).all(id);
  res.json({ documents });
});

contactsRouter.post('/:id/documents', requirePerm('contacts.edit'), docUpload.single('file'), (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM contacts WHERE id = ?').get(id)) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch { /* ignore */ } }
    return res.status(404).json({ error: 'Контакт не найден' });
  }
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  const originalName = decodeFileName(req.file.originalname);
  const info = db.prepare(`
    INSERT INTO contact_documents (contact_id, filename, original_name, mime, size, uploaded_by)
    VALUES (?,?,?,?,?,?)
  `).run(id, path.basename(req.file.path), originalName, req.file.mimetype || '', req.file.size, req.user.id);
  // Загрузка документа — сигнал для скоринга («Принёс документы»)
  db.prepare("INSERT INTO touchpoints (contact_id, type, title, description, event_date, created_by) VALUES (?,?,?,?,datetime('now'),?)")
    .run(id, 'document', `Документ: ${originalName}`, `Загружен файл (${Math.round(req.file.size / 1024)} КБ)`, req.user.id);
  recalcScore(id);
  audit(req.user.id, 'contact.document.upload', 'contacts', id, { name: originalName, size: req.file.size });
  res.status(201).json({ id: Number(info.lastInsertRowid), original_name: originalName });
});

contactsRouter.get('/documents/:docId/download', requirePerm('contacts.view'), (req, res) => {
  const doc = db.prepare('SELECT * FROM contact_documents WHERE id = ?').get(Number(req.params.docId));
  if (!doc) return res.status(404).json({ error: 'Документ не найден' });
  const filePath = path.join(UPLOADS_DIR, path.basename(doc.filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Файл утерян на диске' });
  res.download(filePath, doc.original_name);
});

contactsRouter.delete('/documents/:docId', requirePerm('contacts.edit'), (req, res) => {
  const doc = db.prepare('SELECT * FROM contact_documents WHERE id = ?').get(Number(req.params.docId));
  if (!doc) return res.status(404).json({ error: 'Документ не найден' });
  db.prepare('DELETE FROM contact_documents WHERE id = ?').run(doc.id);
  // Убираем и автоматическую запись в истории — иначе бонус скоринга останется у удалённого файла
  db.prepare("DELETE FROM touchpoints WHERE contact_id = ? AND type = 'document' AND title = ?")
    .run(doc.contact_id, `Документ: ${doc.original_name}`);
  try { fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(doc.filename))); } catch { /* ignore */ }
  recalcScore(doc.contact_id);
  audit(req.user.id, 'contact.document.delete', 'contacts', doc.contact_id, { name: doc.original_name });
  res.json({ ok: true });
});

// ---------- Касания (timeline) ----------
contactsRouter.post('/:id/touchpoints', requirePerm('contacts.edit'), (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM contacts WHERE id = ?').get(id)) return res.status(404).json({ error: 'Контакт не найден' });
  const { type, title, description, event_date, dod_event_id } = req.body || {};
  if (!TOUCHPOINT_TYPES.includes(type)) return res.status(400).json({ error: 'Неизвестный тип касания' });
  if (!title?.trim()) return res.status(400).json({ error: 'Укажите заголовок' });
  const info = db.prepare(`
    INSERT INTO touchpoints (contact_id, type, title, description, event_date, dod_event_id, created_by)
    VALUES (?,?,?,?,?,?,?)
  `).run(id, type, title.trim(), description || '', event_date || new Date().toISOString(), dod_event_id || null, req.user.id);
  recalcScore(id);
  audit(req.user.id, 'touchpoint.create', 'contacts', id, { type });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

contactsRouter.delete('/touchpoints/:tpId', requirePerm('contacts.edit'), (req, res) => {
  const tp = db.prepare('SELECT * FROM touchpoints WHERE id = ?').get(Number(req.params.tpId));
  if (!tp) return res.status(404).json({ error: 'Запись не найдена' });
  const isAuthor = tp.created_by === req.user.id;
  if (!isAuthor && !hasPerm(req.user, 'contacts.delete')) return res.status(403).json({ error: 'Можно удалять только свои записи' });
  db.prepare('DELETE FROM touchpoints WHERE id = ?').run(tp.id);
  recalcScore(tp.contact_id);
  res.json({ ok: true });
});

// Источники (для фильтра-списка)
contactsRouter.get('/meta/sources', requirePerm('contacts.view'), (_req, res) => {
  const rows = db.prepare("SELECT DISTINCT source FROM contacts WHERE source != '' ORDER BY source").all();
  res.json({ sources: rows.map(r => r.source) });
});
