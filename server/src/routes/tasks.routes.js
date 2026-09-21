import { Router } from 'express';
import { db } from '../db.js';
import { hasPerm, requirePerm } from '../auth.js';
import { audit } from '../util.js';

export const tasksRouter = Router();

tasksRouter.get('/', requirePerm('tasks.view'), (req, res) => {
  const q = req.query;
  const where = [];
  const params = [];
  if (q.status) { where.push('t.status = ?'); params.push(String(q.status)); }
  if (q.assignee_id) { where.push('t.assignee_id = ?'); params.push(Number(q.assignee_id)); }
  if (q.contact_id) { where.push('t.contact_id = ?'); params.push(Number(q.contact_id)); }
  if (q.mine === '1') { where.push('t.assignee_id = ?'); params.push(req.user.id); }
  if (q.overdue === '1') { where.push("t.status = 'open' AND t.due_date < datetime('now')"); }
  if (q.due_from) { where.push('t.due_date >= ?'); params.push(String(q.due_from)); }
  if (q.due_to) { where.push('t.due_date <= ?'); params.push(String(q.due_to)); }
  if (q.search) { where.push('LOWER(t.title) LIKE ?'); params.push(`%${String(q.search).toLowerCase()}%`); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const tasks = db.prepare(`
    SELECT t.*, u.name AS assignee_name, cb.name AS created_by_name,
           c.last_name, c.first_name, c.middle_name, c.id AS contact_id_ref
    FROM tasks t
    LEFT JOIN users u ON u.id = t.assignee_id
    LEFT JOIN users cb ON cb.id = t.created_by
    LEFT JOIN contacts c ON c.id = t.contact_id
    ${whereSql}
    ORDER BY t.status = 'done', t.status = 'cancelled', t.due_date IS NULL, t.due_date
    LIMIT 500
  `).all(...params);
  res.json({ tasks });
});

tasksRouter.post('/', requirePerm('tasks.create'), (req, res) => {
  const { title, description, contact_id, assignee_id, due_date, priority } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'Укажите название задачи' });
  const info = db.prepare(`
    INSERT INTO tasks (title, description, contact_id, assignee_id, created_by, due_date, priority)
    VALUES (?,?,?,?,?,?,?)
  `).run(title.trim(), description || '', contact_id || null, assignee_id || req.user.id, req.user.id, due_date || null,
    ['low', 'normal', 'high'].includes(priority) ? priority : 'normal');
  audit(req.user.id, 'task.create', 'tasks', Number(info.lastInsertRowid));
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

// Массовая постановка: по шаблону + фильтрам контактов
tasksRouter.post('/bulk', requirePerm('tasks.create'), (req, res) => {
  const { title, description, assignee_id, due_date, priority, filters } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'Укажите название задачи' });
  const where = [];
  const params = [];
  if (filters?.status_id) { where.push('status_id = ?'); params.push(Number(filters.status_id)); }
  if (filters?.temperature) { where.push('temperature = ?'); params.push(String(filters.temperature)); }
  if (filters?.program_id) {
    where.push('EXISTS (SELECT 1 FROM contact_programs cp WHERE cp.contact_id = contacts.id AND cp.program_id = ?)');
    params.push(Number(filters.program_id));
  }
  if (filters?.owner_id) { where.push('owner_id = ?'); params.push(Number(filters.owner_id)); }
  const contacts = db.prepare(`SELECT id FROM contacts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} LIMIT 1000`).all(...params);
  if (contacts.length === 0) return res.status(400).json({ error: 'По фильтрам не найдено ни одного контакта' });
  const ins = db.prepare('INSERT INTO tasks (title, description, contact_id, assignee_id, created_by, due_date, priority) VALUES (?,?,?,?,?,?,?)');
  db.exec('BEGIN');
  try {
    for (const c of contacts) {
      ins.run(title.trim(), description || '', c.id, assignee_id || req.user.id, req.user.id, due_date || null,
        ['low', 'normal', 'high'].includes(priority) ? priority : 'normal');
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: String(e.message) });
  }
  audit(req.user.id, 'task.bulk_create', 'tasks', null, { count: contacts.length, title });
  res.status(201).json({ created: contacts.length });
});

tasksRouter.patch('/:id', requirePerm('tasks.edit'), (req, res) => {
  const id = Number(req.params.id);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) return res.status(404).json({ error: 'Задача не найдена' });
  const b = req.body || {};
  const canManage = hasPerm(req.user, 'tasks.delete') || task.assignee_id === req.user.id || task.created_by === req.user.id;
  if (!canManage) return res.status(403).json({ error: 'Нет прав на эту задачу' });

  if (b.title !== undefined) db.prepare('UPDATE tasks SET title = ? WHERE id = ?').run(String(b.title).trim(), id);
  if (b.description !== undefined) db.prepare('UPDATE tasks SET description = ? WHERE id = ?').run(String(b.description), id);
  if (b.assignee_id !== undefined) db.prepare('UPDATE tasks SET assignee_id = ? WHERE id = ?').run(b.assignee_id || null, id);
  if (b.due_date !== undefined) db.prepare('UPDATE tasks SET due_date = ? WHERE id = ?').run(b.due_date || null, id);
  if (b.priority !== undefined && ['low', 'normal', 'high'].includes(b.priority)) {
    db.prepare('UPDATE tasks SET priority = ? WHERE id = ?').run(b.priority, id);
  }
  if (b.status !== undefined && ['open', 'done', 'cancelled'].includes(b.status)) {
    db.prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?')
      .run(b.status, b.status === 'done' ? new Date().toISOString() : null, id);
  }
  res.json({ ok: true });
});

tasksRouter.delete('/:id', requirePerm('tasks.delete'), (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(Number(req.params.id));
  audit(req.user.id, 'task.delete', 'tasks', Number(req.params.id));
  res.json({ ok: true });
});

// ---------- Шаблоны задач ----------
tasksRouter.get('/templates', requirePerm('tasks.view'), (_req, res) => {
  res.json({ templates: db.prepare('SELECT * FROM task_templates ORDER BY id').all() });
});

tasksRouter.post('/templates', requirePerm('tasks.create'), (req, res) => {
  const { title, description, priority } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'Укажите название' });
  const info = db.prepare('INSERT INTO task_templates (title, description, priority, created_by) VALUES (?,?,?,?)')
    .run(title.trim(), description || '', ['low', 'normal', 'high'].includes(priority) ? priority : 'normal', req.user.id);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

tasksRouter.delete('/templates/:id', requirePerm('tasks.create'), (req, res) => {
  db.prepare('DELETE FROM task_templates WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});
