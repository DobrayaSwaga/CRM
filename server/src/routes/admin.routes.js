import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, PERMISSIONS } from '../db.js';
import { requirePerm } from '../auth.js';
import { audit } from '../util.js';

export const adminRouter = Router();

// ---------- Пользователи ----------
adminRouter.get('/users', requirePerm('admin.users'), (_req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.login, u.name, u.active, u.created_at, r.id AS role_id, r.name AS role_name
    FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.id
  `).all();
  res.json({ users });
});

adminRouter.post('/users', requirePerm('admin.users'), (req, res) => {
  const { login, password, name, role_id } = req.body || {};
  if (!login || !password || !name || !role_id) return res.status(400).json({ error: 'Заполните все поля' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Пароль — минимум 6 символов' });
  const exists = db.prepare('SELECT id FROM users WHERE login = ?').get(String(login).trim());
  if (exists) return res.status(409).json({ error: 'Логин уже занят' });
  const role = db.prepare('SELECT id FROM roles WHERE id = ?').get(role_id);
  if (!role) return res.status(400).json({ error: 'Роль не найдена' });
  const info = db.prepare('INSERT INTO users (login, password_hash, name, role_id) VALUES (?,?,?,?)')
    .run(String(login).trim(), bcrypt.hashSync(String(password), 10), String(name).trim(), role_id);
  audit(req.user.id, 'user.create', 'users', Number(info.lastInsertRowid), { login });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

adminRouter.patch('/users/:id', requirePerm('admin.users'), (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const { name, role_id, active, password } = req.body || {};
  if (id === req.user.id && active === 0) return res.status(400).json({ error: 'Нельзя деактивировать себя' });
  if (name !== undefined) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name), id);
  if (role_id !== undefined) {
    if (id === req.user.id && role_id !== user.role_id) return res.status(400).json({ error: 'Нельзя менять свою роль' });
    db.prepare('UPDATE users SET role_id = ? WHERE id = ?').run(role_id, id);
  }
  if (active !== undefined) db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  if (password) {
    if (String(password).length < 6) return res.status(400).json({ error: 'Пароль — минимум 6 символов' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(password), 10), id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  audit(req.user.id, 'user.update', 'users', id, req.body);
  res.json({ ok: true });
});

adminRouter.delete('/users/:id', requirePerm('admin.users'), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Нельзя удалить себя' });
  const hasContacts = db.prepare('SELECT COUNT(*) c FROM contacts WHERE owner_id = ?').get(id).c;
  if (hasContacts > 0) return res.status(400).json({ error: `За пользователем закреплено ${hasContacts} контактов. Деактивируйте его вместо удаления.` });
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  db.prepare('UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  audit(req.user.id, 'user.delete', 'users', id);
  res.json({ ok: true });
});

// ---------- Роли ----------
adminRouter.get('/roles', (_req, res) => {
  const roles = db.prepare('SELECT * FROM roles ORDER BY id').all()
    .map(r => ({ ...r, permissions: JSON.parse(r.permissions || '[]') }));
  res.json({ roles, allPermissions: PERMISSIONS });
});

adminRouter.post('/roles', requirePerm('admin.roles'), (req, res) => {
  const { name, permissions } = req.body || {};
  if (!name || !Array.isArray(permissions)) return res.status(400).json({ error: 'Укажите имя и права' });
  const exists = db.prepare('SELECT id FROM roles WHERE name = ?').get(String(name).trim());
  if (exists) return res.status(409).json({ error: 'Роль с таким именем уже есть' });
  const info = db.prepare('INSERT INTO roles (name, permissions) VALUES (?,?)')
    .run(String(name).trim(), JSON.stringify(permissions.filter(p => PERMISSIONS.includes(p) || p === '*')));
  audit(req.user.id, 'role.create', 'roles', Number(info.lastInsertRowid));
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

adminRouter.patch('/roles/:id', requirePerm('admin.roles'), (req, res) => {
  const id = Number(req.params.id);
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
  if (!role) return res.status(404).json({ error: 'Роль не найдена' });
  const { name, permissions } = req.body || {};
  if (role.is_system && role.id === 1) return res.status(400).json({ error: 'Роль администратора нельзя изменить' });
  if (name !== undefined) db.prepare('UPDATE roles SET name = ? WHERE id = ?').run(String(name).trim(), id);
  if (permissions !== undefined) {
    db.prepare('UPDATE roles SET permissions = ? WHERE id = ?')
      .run(JSON.stringify(permissions.filter(p => PERMISSIONS.includes(p) || p === '*')), id);
  }
  audit(req.user.id, 'role.update', 'roles', id);
  res.json({ ok: true });
});

adminRouter.delete('/roles/:id', requirePerm('admin.roles'), (req, res) => {
  const id = Number(req.params.id);
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
  if (!role) return res.status(404).json({ error: 'Роль не найдена' });
  if (role.is_system) return res.status(400).json({ error: 'Системную роль нельзя удалить' });
  const used = db.prepare('SELECT COUNT(*) c FROM users WHERE role_id = ?').get(id).c;
  if (used > 0) return res.status(400).json({ error: 'Есть пользователи с этой ролью' });
  db.prepare('DELETE FROM roles WHERE id = ?').run(id);
  audit(req.user.id, 'role.delete', 'roles', id);
  res.json({ ok: true });
});

// ---------- Аудит ----------
adminRouter.get('/audit', requirePerm('admin.audit'), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = db.prepare(`
    SELECT a.*, u.name AS user_name FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?
  `).all(limit);
  res.json({ audit: rows });
});
