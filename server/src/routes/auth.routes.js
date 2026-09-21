import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { audit } from '../util.js';

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: 'Введите логин и пароль' });
  const user = db.prepare('SELECT * FROM users WHERE login = ? AND active = 1').get(String(login).trim());
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?, datetime('now', '+7 days'))").run(token, user.id);
  // SameSite=None + Secure: превью работает в iframe на чужом домене,
  // Lax-куки браузер туда не отправляет → логин не сохранялся
  res.cookie('session', token, { httpOnly: true, sameSite: 'none', secure: true, maxAge: 7 * 24 * 3600 * 1000 });
  audit(user.id, 'login', 'users', user.id);
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  const token = req.cookies?.session;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie('session');
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

authRouter.post('/change-password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: 'Новый пароль — минимум 6 символов' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(oldPassword || ''), user.password_hash)) {
    return res.status(400).json({ error: 'Неверный текущий пароль' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(newPassword), 10), req.user.id);
  audit(req.user.id, 'change_password', 'users', req.user.id);
  res.json({ ok: true });
});
