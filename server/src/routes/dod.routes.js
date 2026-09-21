import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requirePerm } from '../auth.js';
import { audit, recalcScore } from '../util.js';

export const dodRouter = Router();

dodRouter.get('/', requireAuth, (_req, res) => {
  const events = db.prepare(`
    SELECT d.*, u.name AS created_by_name,
      (SELECT COUNT(DISTINCT t.contact_id) FROM touchpoints t WHERE t.dod_event_id = d.id) AS attendees_count
    FROM dod_events d LEFT JOIN users u ON u.id = d.created_by
    ORDER BY d.event_date DESC
  `).all();
  res.json({ events });
});

dodRouter.get('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const event = db.prepare('SELECT * FROM dod_events WHERE id = ?').get(id);
  if (!event) return res.status(404).json({ error: 'Мероприятие не найдено' });
  event.attendees = db.prepare(`
    SELECT c.id, c.last_name, c.first_name, c.middle_name, c.phone, c.score, c.temperature, s.name AS status_name
    FROM touchpoints t
    JOIN contacts c ON c.id = t.contact_id
    LEFT JOIN statuses s ON s.id = c.status_id
    WHERE t.dod_event_id = ? AND t.type = 'dod'
    ORDER BY c.last_name
  `).all(id);
  res.json({ event });
});

dodRouter.post('/', requirePerm('dod.manage'), (req, res) => {
  const { name, event_date, location, description } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Укажите название' });
  if (!event_date) return res.status(400).json({ error: 'Укажите дату' });
  const info = db.prepare('INSERT INTO dod_events (name, event_date, location, description, created_by) VALUES (?,?,?,?,?)')
    .run(name.trim(), event_date, location || '', description || '', req.user.id);
  audit(req.user.id, 'dod.create', 'dod_events', Number(info.lastInsertRowid));
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

dodRouter.patch('/:id', requirePerm('dod.manage'), (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  if (b.name !== undefined) db.prepare('UPDATE dod_events SET name = ? WHERE id = ?').run(String(b.name).trim(), id);
  if (b.event_date !== undefined) db.prepare('UPDATE dod_events SET event_date = ? WHERE id = ?').run(b.event_date, id);
  if (b.location !== undefined) db.prepare('UPDATE dod_events SET location = ? WHERE id = ?').run(String(b.location), id);
  if (b.description !== undefined) db.prepare('UPDATE dod_events SET description = ? WHERE id = ?').run(String(b.description), id);
  res.json({ ok: true });
});

dodRouter.delete('/:id', requirePerm('dod.manage'), (req, res) => {
  const id = Number(req.params.id);
  const affected = db.prepare("SELECT DISTINCT contact_id FROM touchpoints WHERE dod_event_id = ?").all(id);
  db.prepare('DELETE FROM touchpoints WHERE dod_event_id = ?').run(id);
  db.prepare('DELETE FROM dod_events WHERE id = ?').run(id);
  for (const { contact_id } of affected) recalcScore(contact_id);
  audit(req.user.id, 'dod.delete', 'dod_events', id);
  res.json({ ok: true });
});

// Отметить посещение (создаёт касание типа dod)
dodRouter.post('/:id/attend', requirePerm('dod.manage'), (req, res) => {
  const dodId = Number(req.params.id);
  const dod = db.prepare('SELECT * FROM dod_events WHERE id = ?').get(dodId);
  if (!dod) return res.status(404).json({ error: 'Мероприятие не найдено' });
  const { contact_id } = req.body || {};
  const contact = db.prepare('SELECT id FROM contacts WHERE id = ?').get(Number(contact_id));
  if (!contact) return res.status(404).json({ error: 'Контакт не найден' });
  const exists = db.prepare("SELECT id FROM touchpoints WHERE dod_event_id = ? AND contact_id = ? AND type = 'dod'").get(dodId, contact.id);
  if (exists) return res.status(409).json({ error: 'Посещение уже отмечено' });
  db.prepare("INSERT INTO touchpoints (contact_id, type, title, event_date, dod_event_id, created_by) VALUES (?,?,?,?,?,?)")
    .run(contact.id, 'dod', `Посещение: ${dod.name}`, dod.event_date, dodId, req.user.id);
  recalcScore(contact.id);
  res.status(201).json({ ok: true });
});

dodRouter.delete('/:id/attend/:contactId', requirePerm('dod.manage'), (req, res) => {
  const dodId = Number(req.params.id);
  const contactId = Number(req.params.contactId);
  db.prepare("DELETE FROM touchpoints WHERE dod_event_id = ? AND contact_id = ? AND type = 'dod'").run(dodId, contactId);
  recalcScore(contactId);
  res.json({ ok: true });
});
