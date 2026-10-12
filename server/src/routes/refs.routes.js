import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requirePerm } from '../auth.js';
import { audit } from '../util.js';

export const refsRouter = Router();

// ---------- Статусы воронки ----------
refsRouter.get('/statuses', requireAuth, (_req, res) => {
  res.json({ statuses: db.prepare('SELECT * FROM statuses ORDER BY sort_order').all() });
});

refsRouter.post('/statuses', requirePerm('admin.fields'), (req, res) => {
  const { name, color, sort_order, is_final, is_success } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Укажите название' });
  const info = db.prepare('INSERT INTO statuses (name, color, sort_order, is_final, is_success) VALUES (?,?,?,?,?)')
    .run(name.trim(), color || '#6366f1', sort_order ?? 99, is_final ? 1 : 0, is_success ? 1 : 0);
  audit(req.user.id, 'status.create', 'statuses', Number(info.lastInsertRowid));
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

refsRouter.patch('/statuses/:id', requirePerm('admin.fields'), (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  if (!db.prepare('SELECT id FROM statuses WHERE id = ?').get(id)) return res.status(404).json({ error: 'Не найдено' });
  if (b.name !== undefined) db.prepare('UPDATE statuses SET name = ? WHERE id = ?').run(String(b.name).trim(), id);
  if (b.color !== undefined) db.prepare('UPDATE statuses SET color = ? WHERE id = ?').run(String(b.color), id);
  if (b.sort_order !== undefined) db.prepare('UPDATE statuses SET sort_order = ? WHERE id = ?').run(Number(b.sort_order), id);
  if (b.is_final !== undefined) db.prepare('UPDATE statuses SET is_final = ? WHERE id = ?').run(b.is_final ? 1 : 0, id);
  if (b.is_success !== undefined) db.prepare('UPDATE statuses SET is_success = ? WHERE id = ?').run(b.is_success ? 1 : 0, id);
  audit(req.user.id, 'status.update', 'statuses', id);
  res.json({ ok: true });
});

refsRouter.delete('/statuses/:id', requirePerm('admin.fields'), (req, res) => {
  const id = Number(req.params.id);
  const used = db.prepare('SELECT COUNT(*) c FROM contacts WHERE status_id = ?').get(id).c;
  if (used > 0) return res.status(400).json({ error: `В этом статусе ${used} контактов. Сначала переведите их в другой.` });
  db.prepare('DELETE FROM statuses WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- Направления ----------
refsRouter.get('/programs', requireAuth, (_req, res) => {
  res.json({ programs: db.prepare('SELECT p.*, (SELECT COUNT(*) FROM contact_programs cp WHERE cp.program_id = p.id) AS contacts_count FROM programs p ORDER BY p.name').all() });
});

refsRouter.post('/programs', requirePerm('admin.fields'), (req, res) => {
  const { name, color } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Укажите название' });
  const exists = db.prepare('SELECT id FROM programs WHERE name = ?').get(name.trim());
  if (exists) return res.status(409).json({ error: 'Такое направление уже есть', id: exists.id });
  const info = db.prepare('INSERT INTO programs (name, color) VALUES (?,?)').run(name.trim(), color || '#8b5cf6');
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

refsRouter.patch('/programs/:id', requirePerm('admin.fields'), (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  if (b.name !== undefined) db.prepare('UPDATE programs SET name = ? WHERE id = ?').run(String(b.name).trim(), id);
  if (b.color !== undefined) db.prepare('UPDATE programs SET color = ? WHERE id = ?').run(String(b.color), id);
  res.json({ ok: true });
});

refsRouter.delete('/programs/:id', requirePerm('admin.fields'), (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM contact_programs WHERE program_id = ?').run(id);
  db.prepare('DELETE FROM programs WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- Кастомные поля ----------
refsRouter.get('/custom-fields', requireAuth, (_req, res) => {
  const fields = db.prepare('SELECT * FROM custom_fields WHERE active = 1 ORDER BY sort_order, id').all()
    .map(f => ({ ...f, options: JSON.parse(f.options || '[]') }));
  res.json({ fields });
});

refsRouter.post('/custom-fields', requirePerm('admin.fields'), (req, res) => {
  const { name, field_type, options, sort_order } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Укажите название' });
  if (!['text', 'number', 'date', 'select'].includes(field_type)) return res.status(400).json({ error: 'Неверный тип поля' });
  const info = db.prepare('INSERT INTO custom_fields (name, field_type, options, sort_order) VALUES (?,?,?,?)')
    .run(name.trim(), field_type, JSON.stringify(options || []), sort_order ?? 99);
  audit(req.user.id, 'field.create', 'custom_fields', Number(info.lastInsertRowid));
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

refsRouter.patch('/custom-fields/:id', requirePerm('admin.fields'), (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  if (b.name !== undefined) db.prepare('UPDATE custom_fields SET name = ? WHERE id = ?').run(String(b.name).trim(), id);
  if (b.options !== undefined) db.prepare('UPDATE custom_fields SET options = ? WHERE id = ?').run(JSON.stringify(b.options), id);
  if (b.sort_order !== undefined) db.prepare('UPDATE custom_fields SET sort_order = ? WHERE id = ?').run(Number(b.sort_order), id);
  if (b.active !== undefined) db.prepare('UPDATE custom_fields SET active = ? WHERE id = ?').run(b.active ? 1 : 0, id);
  res.json({ ok: true });
});

refsRouter.delete('/custom-fields/:id', requirePerm('admin.fields'), (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM contact_field_values WHERE field_id = ?').run(id);
  db.prepare('DELETE FROM custom_fields WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- Пользователи (для выбора ответственных — доступно всем авторизованным) ----------
refsRouter.get('/assignees', requireAuth, (_req, res) => {
  res.json({ users: db.prepare('SELECT id, name FROM users WHERE active = 1 ORDER BY name').all() });
});
