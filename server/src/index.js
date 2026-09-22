import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import { db } from './db.js';
import { attachUser } from './auth.js';
import { setupAutoBackup } from './backup.js';
import { authRouter } from './routes/auth.routes.js';
import { contactsRouter } from './routes/contacts.routes.js';
import { refsRouter } from './routes/refs.routes.js';
import { tasksRouter } from './routes/tasks.routes.js';
import { dodRouter } from './routes/dod.routes.js';
import { scoringRouter } from './routes/scoring.routes.js';
import { analyticsRouter } from './routes/analytics.routes.js';
import { importRouter } from './routes/import.routes.js';
import { exportRouter } from './routes/export.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { backupRouter } from './routes/backup.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3001;
const VITE_PORT = Number(process.env.VITE_PORT) || 5173;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(attachUser);

app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'NexusCRM', time: new Date().toISOString() }));

app.use('/api/auth', authRouter);
app.use('/api/contacts', contactsRouter);
app.use('/api/refs', refsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/dod-events', dodRouter);
app.use('/api/scoring', scoringRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/import', importRouter);
app.use('/api/export', exportRouter);
app.use('/api/admin', adminRouter);
app.use('/api/backup', backupRouter);

// 404 для API
app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint не найден' }));

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
const clientDist = path.resolve(__dirname, '../public');
const hasDist = fs.existsSync(path.join(clientDist, 'index.html'));

if (hasDist) {
  // Продакшн-режим: отдаём собранный фронтенд
  app.use(express.static(clientDist));
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ NexusCRM API запущен: http://0.0.0.0:${PORT}`);
  setupAutoBackup();
  // Джанитор: чистим просроченные сессии раз в час
  setInterval(() => {
    try {
      db.exec("DELETE FROM sessions WHERE expires_at <= datetime('now');");
    } catch { /* игнор */ }
  }, 3600_000);
});
