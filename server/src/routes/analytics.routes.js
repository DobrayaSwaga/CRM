import { Router } from 'express';
import { db } from '../db.js';
import { requirePerm } from '../auth.js';

export const analyticsRouter = Router();

analyticsRouter.get('/dashboard', requirePerm('analytics.view'), (_req, res) => {
  const total = db.prepare('SELECT COUNT(*) c FROM contacts').get().c;
  const byTemperature = db.prepare('SELECT temperature, COUNT(*) c FROM contacts GROUP BY temperature').all();
  const byStatus = db.prepare(`
    SELECT s.id, s.name, s.color, s.sort_order, s.is_final, s.is_success, COUNT(c.id) AS c
    FROM statuses s LEFT JOIN contacts c ON c.status_id = s.id
    GROUP BY s.id ORDER BY s.sort_order
  `).all();
  const newLast30 = db.prepare("SELECT COUNT(*) c FROM contacts WHERE created_at >= datetime('now', '-30 days')").get().c;
  const overdueTasks = db.prepare("SELECT COUNT(*) c FROM tasks WHERE status = 'open' AND due_date < datetime('now')").get().c;
  const openTasks = db.prepare("SELECT COUNT(*) c FROM tasks WHERE status = 'open'").get().c;
  const upcomingDod = db.prepare(`
    SELECT d.*, (SELECT COUNT(DISTINCT t.contact_id) FROM touchpoints t WHERE t.dod_event_id = d.id) AS attendees
    FROM dod_events d WHERE d.event_date >= datetime('now', '-1 day') ORDER BY d.event_date LIMIT 5
  `).all();
  const recentContacts = db.prepare(`
    SELECT c.id, c.last_name, c.first_name, c.score, c.temperature, c.created_at, s.name AS status_name, s.color AS status_color
    FROM contacts c LEFT JOIN statuses s ON s.id = c.status_id ORDER BY c.id DESC LIMIT 8
  `).all();
  const dodStats = db.prepare(`
    SELECT COUNT(DISTINCT t.contact_id) AS visitors, COUNT(*) AS visits
    FROM touchpoints t WHERE t.type = 'dod'
  `).get();
  const hot = byTemperature.find(t => t.temperature === 'hot')?.c || 0;
  const warm = byTemperature.find(t => t.temperature === 'warm')?.c || 0;
  const cold = byTemperature.find(t => t.temperature === 'cold')?.c || 0;

  res.json({
    totals: { contacts: total, new30: newLast30, hot, warm, cold },
    byStatus, openTasks, overdueTasks, upcomingDod, recentContacts,
    dod: { visitors: dodStats.visitors, visits: dodStats.visits },
  });
});

analyticsRouter.get('/funnel', requirePerm('analytics.view'), (req, res) => {
  const conditions = [];
  const params = [];
  if (req.query.from && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)) {
    conditions.push('c.created_at >= ?');
    params.push(String(req.query.from).slice(0, 10));
  }
  if (req.query.to && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)) {
    conditions.push('c.created_at <= ?');
    params.push(String(req.query.to).slice(0, 10) + ' 23:59:59');
  }
  const whereSql = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const joinWhere = conditions.length ? 'AND ' + conditions.join(' AND ') : '';

  const byStatus = db.prepare(`
    SELECT s.id, s.name, s.color, s.sort_order, s.is_success, s.is_final,
           (SELECT COUNT(*) FROM contacts c WHERE c.status_id = s.id ${conditions.length ? 'AND ' + conditions.join(' AND ') : ''}) c
    FROM statuses s ORDER BY s.sort_order
  `).all(...params);

  const total = db.prepare(`SELECT COUNT(*) c FROM contacts c ${whereSql}`).get(...params).c;
  const joinParams = [...params];
  const withDod = db.prepare(`SELECT COUNT(DISTINCT t.contact_id) c FROM touchpoints t JOIN contacts c ON c.id = t.contact_id WHERE t.type = 'dod' ${joinWhere}`).get(...joinParams).c;
  const withApp = db.prepare(`SELECT COUNT(DISTINCT t.contact_id) c FROM touchpoints t JOIN contacts c ON c.id = t.contact_id WHERE t.type = 'application' ${joinWhere}`).get(...joinParams).c;
  const withDocs = db.prepare(`SELECT COUNT(DISTINCT t.contact_id) c FROM touchpoints t JOIN contacts c ON c.id = t.contact_id WHERE t.type = 'document' ${joinWhere}`).get(...joinParams).c;
  const enrolled = db.prepare(`SELECT COUNT(*) c FROM contacts c JOIN statuses s ON s.id = c.status_id WHERE s.is_success = 1 ${joinWhere.replace(/c\.created_at/g, 'c.created_at')}`).get(...joinParams).c;

  const pct = (n) => total ? Math.round((n / total) * 100) : 0;
  res.json({
    byStatus,
    stages: [
      { key: 'all', name: 'Всего в базе', count: total, pct: 100 },
      { key: 'dod', name: 'Посетили ДОД', count: withDod, pct: pct(withDod) },
      { key: 'application', name: 'Оставили заявку', count: withApp, pct: pct(withApp) },
      { key: 'document', name: 'Подали документы', count: withDocs, pct: pct(withDocs) },
      { key: 'enrolled', name: 'Поступили', count: enrolled, pct: pct(enrolled) },
    ],
  });
});

analyticsRouter.get('/sources', requirePerm('analytics.view'), (_req, res) => {
  const rows = db.prepare(`
    SELECT COALESCE(NULLIF(source, ''), 'Не указан') AS source, COUNT(*) c,
           SUM(CASE WHEN temperature = 'hot' THEN 1 ELSE 0 END) AS hot
    FROM contacts GROUP BY source ORDER BY c DESC LIMIT 20
  `).all();
  res.json({ sources: rows });
});

analyticsRouter.get('/managers', requirePerm('analytics.view'), (_req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.name,
      (SELECT COUNT(*) FROM contacts c WHERE c.owner_id = u.id) AS contacts,
      (SELECT COUNT(*) FROM contacts c WHERE c.owner_id = u.id AND c.temperature = 'hot') AS hot_contacts,
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status = 'done') AS tasks_done,
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status = 'open') AS tasks_open,
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status = 'open' AND t.due_date < datetime('now')) AS tasks_overdue,
      (SELECT COUNT(*) FROM contacts c JOIN statuses s ON s.id = c.status_id WHERE c.owner_id = u.id AND s.is_success = 1) AS enrolled
    FROM users u WHERE u.active = 1 ORDER BY contacts DESC
  `).all();
  res.json({ managers: rows });
});

// Напоминания для колокольчика в шапке
analyticsRouter.get('/notifications', requirePerm('analytics.view'), (req, res) => {
  const overdue = db.prepare(`
    SELECT t.id, t.title, t.due_date, t.contact_id, (c.last_name || ' ' || c.first_name) AS contact_name
    FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id
    WHERE t.status = 'open' AND t.due_date < datetime('now') AND (t.assignee_id = ? OR t.assignee_id IS NULL)
    ORDER BY t.due_date LIMIT 10
  `).all(req.user.id);
  const today = db.prepare(`
    SELECT t.id, t.title, t.due_date, t.contact_id, (c.last_name || ' ' || c.first_name) AS contact_name
    FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id
    WHERE t.status = 'open' AND date(t.due_date) = date('now') AND (t.assignee_id = ? OR t.assignee_id IS NULL)
    ORDER BY t.due_date LIMIT 10
  `).all(req.user.id);
  const upcomingDod = db.prepare(`
    SELECT d.id, d.name, d.event_date,
      (SELECT COUNT(DISTINCT t.contact_id) FROM touchpoints t WHERE t.dod_event_id = d.id) AS attendees
    FROM dod_events d
    WHERE d.event_date BETWEEN datetime('now') AND datetime('now', '+7 days')
    ORDER BY d.event_date LIMIT 5
  `).all();
  // Горячие лиды без открытых задач — на них не работаем!
  const idleHot = db.prepare(`
    SELECT c.id, (c.last_name || ' ' || c.first_name) AS name, c.score FROM contacts c
    WHERE c.temperature = 'hot' AND NOT EXISTS (
      SELECT 1 FROM tasks t WHERE t.contact_id = c.id AND t.status = 'open'
    ) ORDER BY c.score DESC LIMIT 5
  `).all();
  res.json({
    overdue, today, upcomingDod, idleHot,
    count: overdue.length + today.length + upcomingDod.length + idleHot.length,
  });
});

// Динамика по месяцам: новые лиды + посещения ДОД
analyticsRouter.get('/dynamics', requirePerm('analytics.view'), (_req, res) => {
  const contactsByMonth = db.prepare(`
    SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) c FROM contacts
    GROUP BY month ORDER BY month DESC LIMIT 12
  `).all().reverse();
  const dodByMonth = db.prepare(`
    SELECT strftime('%Y-%m', event_date) AS month, COUNT(*) c FROM touchpoints
    WHERE type = 'dod' GROUP BY month ORDER BY month DESC LIMIT 12
  `).all().reverse();
  res.json({ contacts: contactsByMonth, dod: dodByMonth });
});
