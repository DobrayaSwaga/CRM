import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { audit } from '../util.js';

export const authRouter = Router();

// ---------- Антибрутфорс: лимит попыток входа ----------
// Правила: не более 10 неудачных по паре «IP+логин» за 10 минут → блок 15 минут;
// не более 30 неудачных по IP за 10 минут → блок 15 минут (защита от перебора логинов).
const WINDOW_MS = 10 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const attempts = new Map(); // key -> { count, first, lockedUntil }

function attemptKey(req, scope, login) {
  return `${scope}|${req.ip || req.socket?.remoteAddress || '?'}|${login || ''}`;
}
function checkLocked(key) {
  const rec = attempts.get(key);
  if (!rec) return 0;
  if (rec.lockedUntil && rec.lockedUntil > Date.now()) return Math.ceil((rec.lockedUntil - Date.now()) / 60000);
  return 0;
}
function registerFail(key) {
  const now = Date.now();
  let rec = attempts.get(key);
  if (!rec || now - rec.first > WINDOW_MS) rec = { count: 0, first: now, lockedUntil: 0 };
  rec.count++;
  if (rec.count >= (key.startsWith('ip') ? 30 : 10)) rec.lockedUntil = now + LOCK_MS;
  attempts.set(key, rec);
  // Периодическая чистка, чтобы карта не разрасталась
  if (attempts.size > 5000) {
    for (const [k, v] of attempts) if (now - v.first > WINDOW_MS && (!v.lockedUntil || v.lockedUntil < now)) attempts.delete(k);
  }
}
const clearFails = (...keys) => keys.forEach(k => attempts.delete(k));

function sessionDays() {
  const d = Number(process.env.SESSION_DAYS || 7);
  return Number.isFinite(d) && d >= 1 && d <= 90 ? Math.floor(d) : 7;
}
function cookieOptions(req, maxAge) {
  const sameSite = ['lax', 'strict', 'none'].includes(process.env.COOKIE_SAMESITE) ? process.env.COOKIE_SAMESITE : 'lax';
  // Secure: явно из окружения, иначе автоматически — только для HTTPS-соединения
  const envSecure = process.env.COOKIE_SECURE;
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const secure = envSecure === '1' ? true : envSecure === '0' ? false : isHttps;
  return { httpOnly: true, sameSite, secure, path: '/', ...(maxAge ? { maxAge } : {}) };
}

authRouter.post('/login', (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: 'Введите логин и пароль' });

  const kUser = attemptKey(req, 'user', String(login).trim().toLowerCase());
  const kIp = attemptKey(req, 'ip', '');
  const lockedFor = Math.max(checkLocked(kUser), checkLocked(kIp));
  if (lockedFor > 0) {
    return res.status(429).json({ error: `Слишком много неудачных попыток входа. Повторите через ${lockedFor} мин.` });
  }

  const user = db.prepare('SELECT * FROM users WHERE login = ? AND active = 1').get(String(login).trim());
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    registerFail(kUser);
    registerFail(kIp);
    console.warn(`⚠️ Неудачный вход: логин «${String(login).slice(0, 40)}», IP ${req.ip}`);
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  clearFails(kUser, kIp);

  const token = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?, datetime('now', ?))")
    .run(token, user.id, `+${sessionDays()} days`);
  res.cookie('session', token, cookieOptions(req, sessionDays() * 24 * 3600 * 1000));
  audit(user.id, 'login', 'users', user.id);
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  const token = req.cookies?.session;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie('session', cookieOptions(req, 0));
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

authRouter.post('/change-password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: 'Новый пароль — минимум 8 символов' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(oldPassword || ''), user.password_hash)) {
    return res.status(400).json({ error: 'Неверный текущий пароль' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(newPassword), 10), req.user.id);
  // Меняем пароль — завершаем все прочие сессии пользователя, кроме текущей
  const token = req.cookies?.session;
  if (token) db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, token);
  audit(req.user.id, 'change_password', 'users', req.user.id);
  res.json({ ok: true });
});
