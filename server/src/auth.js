// © 2026 DobrayaSwaga · NexusCRM — авторский проект. Лицензия: см. файл LICENSE.
import { db } from './db.js';

export function attachUser(req, _res, next) {
  const token = req.cookies?.session;
  if (token) {
    const row = db.prepare(`
      SELECT u.id, u.login, u.name, u.active, r.name AS role_name, r.permissions, r.id AS role_id
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN roles r ON r.id = u.role_id
      WHERE s.token = ? AND s.expires_at > datetime('now')
    `).get(token);
    if (row && row.active) {
      let perms = [];
      try { perms = JSON.parse(row.permissions || '[]'); } catch { /* ignore */ }
      req.user = { id: row.id, login: row.login, name: row.name, roleId: row.role_id, roleName: row.role_name, permissions: perms };
    }
  }
  next();
}

export function hasPerm(user, perm) {
  if (!user) return false;
  return user.permissions.includes('*') || user.permissions.includes(perm);
}

// «Наблюдатель»: может смотреть общую статистику и списки, но НЕ личные данные карточек.
// Признак — есть право просмотра, но нет ни создания, ни редактирования контактов.
export function isLimitedViewer(req) {
  const u = req.user;
  if (!u || u.permissions.includes('*')) return false;
  const has = (p) => u.permissions.includes(p);
  return has('contacts.view') && !has('contacts.create') && !has('contacts.edit');
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Требуется вход в систему' });
  next();
}

export function requirePerm(perm) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Требуется вход в систему' });
    if (!hasPerm(req.user, perm)) return res.status(403).json({ error: 'Недостаточно прав' });
    next();
  };
}
