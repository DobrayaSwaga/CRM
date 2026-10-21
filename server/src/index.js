// © 2026 DobrayaSwaga · NexusCRM — авторский проект. Лицензия: см. файл LICENSE.
// Первой строкой подключаем загрузку .env — остальные модули уже увидят переменные окружения
import './env.js';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';

import { db } from './db.js';
import { attachUser, requireAuth } from './auth.js';
import { setupAutoBackup } from './backup.js';
import { authRouter } from './routes/auth.routes.js';
import { contactsRouter } from './routes/contacts.routes.js';
import { refsRouter } from './routes/refs.routes.js';
import { calendarRouter } from './routes/calendar.routes.js';
import { tasksRouter } from './routes/tasks.routes.js';
import { dodRouter } from './routes/dod.routes.js';
import { scoringRouter } from './routes/scoring.routes.js';
import { analyticsRouter } from './routes/analytics.routes.js';
import { importRouter } from './routes/import.routes.js';
import { exportRouter } from './routes/export.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { backupRouter } from './routes/backup.routes.js';
import { chatRouter } from './routes/chat.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const VITE_PORT = Number(process.env.VITE_PORT) || 5173;

app.disable('x-powered-by');
// За reverse-proxy (nginx) включать TRUST_PROXY=1 — корректные IP в лимитах входа и журнале
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

// ---------- CORS ----------
// Приложение монолитное: фронтенд обслуживается тем же сервером, CORS для него не нужен.
// Разрешаем кросс-доменные запросы с cookie ТОЛЬКО для явно перечисленных origin (CORS_ORIGINS).
const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
if (corsOrigins.length) {
  app.use(cors({ origin: corsOrigins, credentials: true }));
  console.warn(`⚠️ CORS разрешён для: ${corsOrigins.join(', ')}`);
}

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// ---------- Заголовки безопасности ----------
// CSP собирается с учётом встроенных скриптов index.html (считаем их хэши при старте)
function inlineScriptHashes(htmlPath) {
  try {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const hashes = [];
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      hashes.push(`'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
    }
    return hashes;
  } catch {
    return [];
  }
}
const clientDist = path.resolve(__dirname, '../public');
const scriptHashes = inlineScriptHashes(path.join(clientDist, 'index.html'));
// ALLOW_EMBED=1 разрешает показ во внешнем iframe (режим превью Arena)
const allowEmbed = process.env.ALLOW_EMBED === '1';

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (!allowEmbed) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(' ')}`.trim(),
    // style-src unsafe-inline нужен: React-инлайн-стили (style-атрибуты) и Tailwind
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    'upgrade-insecure-requests',
  ];
  // На чистом HTTP upgrade-insecure-requests не нужен, на HTTPS полезен
  const cspValue = csp.filter(d => allowEmbed && d.startsWith('frame-ancestors') ? false : true)
    .filter(d => d !== 'upgrade-insecure-requests' || (req.secure || req.headers['x-forwarded-proto'] === 'https'))
    .join('; ');
  res.setHeader('Content-Security-Policy', cspValue);
  next();
});

app.use(attachUser);

// Публичные точки (без входа): здоровье и вход/выход
app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'NexusCRM', time: new Date().toISOString() }));
app.use('/api/auth', authRouter);

// Всё остальное API — только после входа, без исключений
app.use('/api', requireAuth);

app.use('/api/contacts', contactsRouter);
app.use('/api/refs', refsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/dod-events', dodRouter);
app.use('/api/scoring', scoringRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/import', importRouter);
app.use('/api/export', exportRouter);
app.use('/api/admin', adminRouter);
app.use('/api/backup', backupRouter);
app.use('/api/chat', chatRouter);

// 404 для API
app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint не найден' }));

// ---------- Разовый пересчёт ролей (ребёнок/родитель) для уже живых баз ----------
try {
  const done = db.prepare("SELECT value FROM settings WHERE key = 'roles_recalc_done'").get();
  if (done?.value !== '1') {
    const { recalcScore } = await import('./util.js');
    const ids = db.prepare('SELECT id FROM contacts').all();
    for (const { id } of ids) recalcScore(id);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('roles_recalc_done', '1')").run();
    if (ids.length) console.log(`👨‍👩‍👧 Роли учтены — баллы пересчитаны для ${ids.length} контактов`);
  }
} catch (e) {
  console.log('⚠️ Пересчёт ролей не удался:', e.message);
}

// ---------- Первый запуск: заполняем календарь из плана мероприятий ----------
// Если рядом с проектом лежит KAIT20_100_DOD.xlsx и событий ещё нет — загружаем его автоматически.
try {
  const eventsExist = db.prepare('SELECT id FROM dod_events LIMIT 1').get();
  if (!eventsExist) {
    const planCandidates = [
      path.join(process.cwd(), 'KAIT20_100_DOD.xlsx'),
      path.resolve(__dirname, '../../KAIT20_100_DOD.xlsx'),
    ];
    const planPath = planCandidates.find(p => fs.existsSync(p));
    if (planPath) {
      const { importEventPlanFromBuffer } = await import('./plan-import.js');
      const res = importEventPlanFromBuffer(fs.readFileSync(planPath), null);
      console.log(`📅 Календарь заполнен автоматически: ${res.created} мероприятий из ${path.basename(planPath)}`);
    }
  }
} catch (e) {
  console.log('⚠️ Автозаполнение календаря не удалось:', e.message);
}

// ---------- Раздача интерфейса ----------
// Сборка лежит в server/public — папка переживает снапшоты (dist — нет)
const hasDist = fs.existsSync(path.join(clientDist, 'index.html'));

if (hasDist) {
  // Продакшн-режим: отдаём собранный фронтенд
  app.use(express.static(clientDist, {
    dotfiles: 'deny',
    index: 'index.html',
    setHeaders: (res, filePath) => {
      // Хэшированные ассеты кэшируем навсегда, документы — всегда перепроверяем
      if (/[\\/]assets[\\/]/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  console.log('📦 Режим: статика из server/public');
} else {
  // Дев-режим: проксируем интерфейс на Vite dev-сервер.
  // Это гарантирует, что превью работает на ЛЮБОМ порту (3001 или 5173).
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const proxy = http.request({
      host: '127.0.0.1',
      port: VITE_PORT,
      path: req.originalUrl,
      method: req.method,
      headers: { ...req.headers, host: `localhost:${VITE_PORT}` },
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxy.on('error', () => {
      res.status(503).send(FALLBACK_PAGE);
    });
    proxy.end();
  });
  console.log(`🔀 Режим: прокси интерфейса → Vite :${VITE_PORT}`);
}

const FALLBACK_PAGE = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>NexusCRM</title>
<style>body{background:#0b0f1c;color:#e2e8f0;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.c{text-align:center;max-width:420px}.g{color:#818cf8}code{background:#1a2138;padding:2px 8px;border-radius:6px}</style></head>
<body><div class="c"><h1 class="g">NexusCRM</h1><p>API работает ✅, а интерфейс ещё не запущен.</p>
<p>Запустите из корня проекта:<br><code>npm run dev</code></p>
<p style="color:#64748b;font-size:13px">или откройте порт 5173, если Vite уже стартовал</p></div></body></html>`;

// ---------- Предупреждения безопасности при старте ----------
function securityWarnings() {
  try {
    const admin = db.prepare("SELECT password_hash FROM users WHERE login = 'admin'").get();
    if (admin && bcrypt.compareSync('admin123', admin.password_hash)) {
      console.warn('');
      console.warn('═══════════════════════════════════════════════════════════════');
      console.warn(' ⚠️  БЕЗОПАСНОСТЬ: у admin всё ещё заводской пароль «admin123»!');
      console.warn('     Смените его: Настройки → Профиль → Смена пароля.');
      console.warn('═══════════════════════════════════════════════════════════════');
      console.warn('');
    }
  } catch { /* база ещё не готова — пропускаем */ }
  if (!process.env.COOKIE_SECURE && !process.env.COOKIE_SAMESITE) {
    console.log('🔒 Куки сессии: режим auto (COOKIE_SAMESITE/COOKIE_SECURE не заданы — подробнее в docs/SYSADMIN.md)');
  }
}

app.listen(PORT, HOST, () => {
  console.log(`✅ NexusCRM API запущен: http://${HOST}:${PORT}`);
  setupAutoBackup();
  securityWarnings();
  // Джанитор: чистим просроченные сессии раз в час
  setInterval(() => {
    try {
      db.exec("DELETE FROM sessions WHERE expires_at <= datetime('now');");
    } catch { /* игнор */ }
  }, 3600_000);
});
