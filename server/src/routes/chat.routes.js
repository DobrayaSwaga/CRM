// © 2026 DobrayaSwaga · NexusCRM — авторский проект. Лицензия: см. файл LICENSE.
import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, hasPerm } from '../auth.js';
import { audit } from '../util.js';

export const chatRouter = Router();
chatRouter.use(requireAuth);

const MAX_LEN = 2000;

const SELECT_MSG = `
  SELECT m.*, u.name AS author_name,
         t.title AS task_title, t.status AS task_status, t.due_date AS task_due, t.priority AS task_priority,
         ta.name AS task_assignee_name
  FROM messages m
  JOIN users u ON u.id = m.user_id
  LEFT JOIN tasks t ON t.id = m.task_id
  LEFT JOIN users ta ON ta.id = t.assignee_id
`;

// Лента сообщений: целиком последние 100 или инкрементально (after_id)
chatRouter.get('/messages', (req, res) => {
  const afterId = Number(req.query.after_id) || 0;
  let rows;
  if (afterId > 0) {
    rows = db.prepare(`${SELECT_MSG} WHERE m.id > ? ORDER BY m.id LIMIT 300`).all(afterId);
  } else {
    rows = db.prepare(`
      SELECT * FROM (${SELECT_MSG} ORDER BY m.id DESC LIMIT 100) ORDER BY id ASC
    `).all();
  }
  res.json({ messages: rows });
});

// Обычное сообщение или объявление (объявление — только тем, кто может ставить задачи: менеджерам и админам)
chatRouter.post('/messages', (req, res) => {
  const { body, announcement } = req.body || {};
  const text = String(body || '').trim();
  if (!text) return res.status(400).json({ error: 'Пустое сообщение' });
  if (text.length > MAX_LEN) return res.status(400).json({ error: `Сообщение длиннее ${MAX_LEN} символов` });
  const kind = announcement ? 'announcement' : 'chat';
  if (kind === 'announcement' && !hasPerm(req.user, 'tasks.create')) {
    return res.status(403).json({ error: 'Объявления могут отправлять менеджеры и администраторы' });
  }
  const info = db.prepare('INSERT INTO messages (user_id, kind, body) VALUES (?,?,?)').run(req.user.id, kind, text);
  const id = Number(info.lastInsertRowid);
  if (kind === 'announcement') audit(req.user.id, 'chat.announcement', 'messages', id);
  const msg = db.prepare(`${SELECT_MSG} WHERE m.id = ?`).get(id);
  res.status(201).json({ message: msg });
});

// Сообщение-задача: текст + исполнитель (+ дедлайн) → создаётся настоящая задача
chatRouter.post('/task', (req, res) => {
  if (!hasPerm(req.user, 'tasks.create')) return res.status(403).json({ error: 'Нет права ставить задачи' });
  const { body, assignee_id, due_date } = req.body || {};
  const title = String(body || '').trim();
  if (!title) return res.status(400).json({ error: 'Укажите текст задачи' });
  if (title.length > 500) return res.status(400).json({ error: 'Текст задачи длиннее 500 символов' });
  let assignee = Number(assignee_id) || req.user.id;
  if (assignee !== req.user.id) {
    const u = db.prepare('SELECT id FROM users WHERE id = ? AND active = 1').get(assignee);
    if (!u) return res.status(400).json({ error: 'Исполнитель не найден' });
  }
  const due = due_date ? String(due_date) : null;
  const tInfo = db.prepare('INSERT INTO tasks (title, assignee_id, created_by, due_date, priority) VALUES (?,?,?,?,?)')
    .run(title, assignee, req.user.id, due, 'normal');
  const taskId = Number(tInfo.lastInsertRowid);
  const mInfo = db.prepare("INSERT INTO messages (user_id, kind, body, task_id) VALUES (?, 'task', ?, ?)")
    .run(req.user.id, title, taskId);
  audit(req.user.id, 'task.create', 'tasks', taskId, { via: 'chat', assignee });
  const msg = db.prepare(`${SELECT_MSG} WHERE m.id = ?`).get(Number(mInfo.lastInsertRowid));
  res.status(201).json({ message: msg, task_id: taskId });
});

// Счётчик непрочитанного (для бейджа в меню)
chatRouter.get('/unread', (req, res) => {
  const lastRead = db.prepare('SELECT last_read_id FROM chat_read_state WHERE user_id = ?').get(req.user.id)?.last_read_id || 0;
  const unread = db.prepare('SELECT COUNT(*) c FROM messages WHERE id > ? AND user_id != ?').get(lastRead, req.user.id).c;
  res.json({ unread });
});

// Отметить прочитанным
chatRouter.post('/read', (req, res) => {
  const lastId = Number(req.body?.last_id) || 0;
  db.prepare('INSERT OR REPLACE INTO chat_read_state (user_id, last_read_id) VALUES (?, ?)').run(req.user.id, lastId);
  res.json({ ok: true });
});
