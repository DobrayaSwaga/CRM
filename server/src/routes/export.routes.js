// © 2026 DobrayaSwaga · NexusCRM — авторский проект. Лицензия: см. файл LICENSE.
import { taskVisibility } from '../calendar-access.js';
import { Router } from 'express';
import xlsx from 'xlsx';
import { db } from '../db.js';
import { requirePerm } from '../auth.js';
import { eventFlags } from './contacts.routes.js';

export const exportRouter = Router();

function sendXlsx(res, filename, sheets) {
  const wb = xlsx.utils.book_new();
  for (const { name, rows } of sheets) {
    const ws = xlsx.utils.json_to_sheet(rows.length ? rows : [{ 'Нет данных': '' }]);
    xlsx.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buffer);
}

const TEMP_LABEL = { hot: 'Горячий', warm: 'Тёплый', cold: 'Холодный' };

function fetchContacts(q) {
  const where = [];
  const params = [];
  if (q.ids) {
    const ids = String(q.ids).split(',').map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 2000);
    if (ids.length === 0) return [];
    where.push(`c.id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  if (q.status_id) { where.push('c.status_id = ?'); params.push(Number(q.status_id)); }
  if (q.temperature) { where.push('c.temperature = ?'); params.push(String(q.temperature)); }
  if (q.owner_id) { where.push('c.owner_id = ?'); params.push(Number(q.owner_id)); }
  if (q.program_id) {
    where.push('EXISTS (SELECT 1 FROM contact_programs cp WHERE cp.contact_id = c.id AND cp.program_id = ?)');
    params.push(Number(q.program_id));
  }
  if (q.search) {
    const s = `%${String(q.search).toLowerCase()}%`;
    where.push(`(LOWER(c.last_name || ' ' || c.first_name || ' ' || c.middle_name) LIKE ? OR c.phone LIKE ? OR LOWER(c.email) LIKE ?)`);
    params.push(s, s, s);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return db.prepare(`
    SELECT c.*, s.name AS status_name, u.name AS owner_name
    FROM contacts c
    LEFT JOIN statuses s ON s.id = c.status_id
    LEFT JOIN users u ON u.id = c.owner_id
    ${whereSql} ORDER BY c.last_name LIMIT 20000
  `).all(...params);
}

exportRouter.get('/contacts', requirePerm('export.run'), (req, res) => {
  const rows = fetchContacts(req.query);
  const customFields = db.prepare('SELECT * FROM custom_fields WHERE active = 1 ORDER BY sort_order').all();
  const data = rows.map(c => {
    const programs = db.prepare('SELECT p.name FROM programs p JOIN contact_programs cp ON cp.program_id = p.id WHERE cp.contact_id = ?').all(c.id).map(p => p.name).join(', ');
    const flags = eventFlags(c.id);
    const base = {
      'Фамилия': c.last_name, 'Имя': c.first_name, 'Отчество': c.middle_name,
      'Телефон': c.phone, 'Email': c.email, 'Дата рождения': c.birth_date,
      'Город': c.city, 'Школа': c.school, 'Источник': c.source, 'Балл ЕГЭ': c.ege_score ?? '',
      'Направления': programs, 'Статус': c.status_name || '', 'Температура': TEMP_LABEL[c.temperature] || c.temperature,
      'Баллы': c.score, 'Посещений ДОД': flags.dod, 'Выездов в школу': flags.school,
      'Внешних мероприятий': flags.external, 'ДОД и школа': flags.cross ? 'Да' : '',
      'Ответственный': c.owner_name || '',
      'Добавлен': c.created_at?.slice(0, 10),
    };
    for (const f of customFields) {
      base[f.name] = db.prepare('SELECT value FROM contact_field_values WHERE contact_id = ? AND field_id = ?').get(c.id, f.id)?.value || '';
    }
    return base;
  });
  sendXlsx(res, `contacts-${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: 'Контакты', rows: data }]);
});

exportRouter.get('/tasks', requirePerm('export.run'), (req, res) => {
  const where = [taskVisibility(req.user)];
  const params = [];
  if (req.query.status) { where.push('t.status = ?'); params.push(String(req.query.status)); }
  if (req.query.assignee_id) { where.push('t.assignee_id = ?'); params.push(Number(req.query.assignee_id)); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT t.*, u.name AS assignee_name, cb.name AS created_by_name,
           (c.last_name || ' ' || c.first_name) AS contact_name, c.phone AS contact_phone
    FROM tasks t
    LEFT JOIN users u ON u.id = t.assignee_id
    LEFT JOIN users cb ON cb.id = t.created_by
    LEFT JOIN contacts c ON c.id = t.contact_id
    ${whereSql} ORDER BY t.due_date LIMIT 20000
  `).all(...params);
  const STATUS_LABEL = { open: 'Открыта', done: 'Выполнена', cancelled: 'Отменена' };
  const PRIO_LABEL = { low: 'Низкий', normal: 'Обычный', high: 'Высокий' };
  const data = rows.map(t => ({
    'Задача': t.title, 'Описание': t.description, 'Контакт': t.contact_name || '', 'Телефон контакта': t.contact_phone || '',
    'Ответственный': t.assignee_name || '', 'Постановщик': t.created_by_name || '',
    'Дедлайн': t.due_date ? t.due_date.slice(0, 16).replace('T', ' ') : '',
    'Статус': STATUS_LABEL[t.status] || t.status, 'Приоритет': PRIO_LABEL[t.priority] || t.priority,
    'Выполнена': t.completed_at ? t.completed_at.slice(0, 16).replace('T', ' ') : '',
    'Создана': t.created_at?.slice(0, 10),
  }));
  sendXlsx(res, `tasks-${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: 'Задачи', rows: data }]);
});

exportRouter.get('/analytics', requirePerm('export.run'), (req, res) => {
  const byStatus = db.prepare(`
    SELECT s.name AS 'Статус', COUNT(c.id) AS 'Количество'
    FROM statuses s LEFT JOIN contacts c ON c.status_id = s.id
    GROUP BY s.id ORDER BY s.sort_order
  `).all();
  const byTemp = db.prepare('SELECT temperature, COUNT(*) c FROM contacts GROUP BY temperature').all()
    .map(r => ({ 'Температура': TEMP_LABEL[r.temperature] || r.temperature, 'Количество': r.c }));
  const bySource = db.prepare(`
    SELECT COALESCE(NULLIF(source, ''), 'Не указан') AS 'Источник', COUNT(*) AS 'Всего',
           SUM(CASE WHEN temperature = 'hot' THEN 1 ELSE 0 END) AS 'Горячих'
    FROM contacts GROUP BY source ORDER BY COUNT(*) DESC
  `).all();
  const managers = db.prepare(`
    SELECT u.name AS 'Менеджер',
      (SELECT COUNT(*) FROM contacts c WHERE c.owner_id = u.id) AS 'Контактов',
      (SELECT COUNT(*) FROM tasks t WHERE ${taskVisibility(req.user)} AND t.assignee_id = u.id AND t.status = 'done') AS 'Выполнено задач',
      (SELECT COUNT(*) FROM tasks t WHERE ${taskVisibility(req.user)} AND t.assignee_id = u.id AND t.status = 'open' AND t.due_date < datetime('now')) AS 'Просрочено',
      (SELECT COUNT(*) FROM contacts c JOIN statuses s ON s.id = c.status_id WHERE c.owner_id = u.id AND s.is_success = 1) AS 'Поступило'
    FROM users u WHERE u.active = 1
  `).all();
  const dod = db.prepare(`
    SELECT d.name AS 'Мероприятие', d.event_date AS 'Дата',
           COUNT(DISTINCT t.contact_id) AS 'Посетителей'
    FROM dod_events d LEFT JOIN touchpoints t ON t.dod_event_id = d.id AND t.type = 'dod'
    GROUP BY d.id ORDER BY d.event_date DESC
  `).all();
  sendXlsx(res, `analytics-${new Date().toISOString().slice(0, 10)}.xlsx`, [
    { name: 'Воронка по статусам', rows: byStatus },
    { name: 'Температура', rows: byTemp },
    { name: 'Источники', rows: bySource },
    { name: 'Менеджеры', rows: managers },
    { name: 'ДОД', rows: dod },
  ]);
});

// Administrative, unfiltered data extract. Never include password hashes or sessions.
exportRouter.get('/database', (req, res) => {
  if (!req.user?.permissions.includes('*')) return res.status(403).json({ error: 'Полная выгрузка доступна только администратору' });
  const tables = ['contacts', 'contact_programs', 'custom_fields', 'contact_field_values', 'contact_relations', 'contact_documents', 'statuses', 'programs', 'dod_events', 'calendar_events', 'touchpoints', 'tasks', 'task_templates', 'scoring_rules', 'imports', 'duplicate_candidates', 'audit_log', 'messages', 'chat_read_state', 'college_people', 'college_import_rows'];
  const sheets = [{ name: 'О выгрузке', rows: [
    { Параметр: 'Создано UTC', Значение: new Date().toISOString() },
    { Параметр: 'Состав', Значение: 'Все строки рабочих таблиц без фильтров; личные события/задачи включены. Только для администратора.' },
    { Параметр: 'Исключено', Значение: 'Пароли, хэши, сессии, настройки и разрешения ролей. Файлы вложений не включены — только их метаданные.' },
    { Параметр: 'Назначение', Значение: 'Excel для анализа, не резервная копия для восстановления. Сохраняйте также SQLite и uploads.' },
  ] }];
  try {
    db.exec('BEGIN');
    for (const table of tables) {
      const columns = db.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name);
      const rows = db.prepare(`SELECT * FROM "${table}"`).all();
      sheets.push({ name: table, rows, columns });
    }
    sheets.push({ name: 'users', rows: db.prepare('SELECT id,login,name,role_id,active,created_at FROM users').all() });
    sheets.push({ name: 'roles', rows: db.prepare('SELECT id,name,is_system,created_at FROM roles').all() });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); return res.status(500).json({ error: 'Не удалось подготовить выгрузку' }); }
  // json_to_sheet writes strings as strings, not as formula cells.
  const wb = xlsx.utils.book_new();
  for (const { name, rows, columns } of sheets) {
    const pageSize = 1000000;
    for (let offset = 0; offset < Math.max(rows.length, 1); offset += pageSize) {
      const suffix = offset ? `_${offset / pageSize + 1}` : '';
      const ws = xlsx.utils.json_to_sheet(rows.slice(offset, offset + pageSize), columns ? { header: columns } : {});
      xlsx.utils.book_append_sheet(wb, ws, name.slice(0, 31 - suffix.length) + suffix);
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="nexuscrm-database-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.send(buffer);
});
