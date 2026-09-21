import { Router } from 'express';
import { db } from '../db.js';
import { hasPerm, requirePerm } from '../auth.js';
import { audit, normalizePhone, recalcScore, rowToContact } from '../util.js';

export const contactsRouter = Router();

const TOUCHPOINT_TYPES = ['dod', 'call', 'email', 'application', 'document', 'note', 'other'];

const EDITABLE_FIELDS = ['last_name', 'first_name', 'middle_name', 'phone', 'email', 'birth_date', 'city', 'school', 'source', 'ege_score', 'status_id', 'owner_id'];

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
    INSERT INTO contacts (last_name, first_name, middle_name, phone, phone_normalized, email, birth_date, city, school, source, ege_score, status_id, owner_id, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    b.last_name?.trim() || '', b.first_name?.trim() || '', b.middle_name?.trim() || '',
    b.phone?.trim() || '', phoneNorm, b.email?.trim() || '', b.birth_date || '', b.city?.trim() || '',
    b.school?.trim() || '', b.source?.trim() || '', b.ege_score ? Number(b.ege_score) : null,
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
  db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
  audit(req.user.id, 'contact.delete', 'contacts', id);
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
