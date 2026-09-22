import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const DB_PATH = process.env.CRM_DB_PATH || path.join(process.cwd(), 'crm.db');
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  permissions TEXT NOT NULL DEFAULT '[]',
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS statuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_final INTEGER NOT NULL DEFAULT 0,
  is_success INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#8b5cf6'
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  last_name TEXT DEFAULT '',
  first_name TEXT NOT NULL,
  middle_name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  phone_normalized TEXT DEFAULT '',
  email TEXT DEFAULT '',
  birth_date TEXT DEFAULT '',
  city TEXT DEFAULT '',
  school TEXT DEFAULT '',
  source TEXT DEFAULT '',
  ege_score INTEGER,
  status_id INTEGER REFERENCES statuses(id),
  owner_id INTEGER REFERENCES users(id),
  score INTEGER NOT NULL DEFAULT 0,
  temperature TEXT NOT NULL DEFAULT 'cold',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_phone_norm ON contacts(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status_id);

CREATE TABLE IF NOT EXISTS contact_programs (
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  PRIMARY KEY (contact_id, program_id)
);

CREATE TABLE IF NOT EXISTS custom_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text', -- text | number | date | select
  options TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS contact_field_values (
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  field_id INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value TEXT DEFAULT '',
  PRIMARY KEY (contact_id, field_id)
);

CREATE TABLE IF NOT EXISTS dod_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  event_date TEXT NOT NULL,
  location TEXT DEFAULT '',
  description TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS touchpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- dod | call | email | application | document | note | other
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  event_date TEXT NOT NULL,
  dod_event_id INTEGER REFERENCES dod_events(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_touchpoints_contact ON touchpoints(contact_id);
CREATE INDEX IF NOT EXISTS idx_touchpoints_type ON touchpoints(contact_id, type);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  assignee_id INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open | done | cancelled
  priority TEXT NOT NULL DEFAULT 'normal', -- low | normal | high
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id, status);

CREATE TABLE IF NOT EXISTS task_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal',
  created_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS scoring_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL DEFAULT 'touchpoint', -- touchpoint | status
  condition TEXT NOT NULL DEFAULT '{}', -- { touchpoint_type, min_count, period_days } | { status_id }
  points INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'contacts', -- contacts | attendance
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  total_rows INTEGER DEFAULT 0,
  imported INTEGER DEFAULT 0,
  duplicates INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  mapping TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS duplicate_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  incoming TEXT NOT NULL, -- JSON данных строки
  existing_contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | merged | skipped
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contact_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT DEFAULT '',
  size INTEGER DEFAULT 0,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contact_documents ON contact_documents(contact_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT DEFAULT '',
  entity_id INTEGER,
  details TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- Seeds ----------
const ALL_PERMS = [
  'contacts.view', 'contacts.create', 'contacts.edit', 'contacts.delete',
  'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
  'dod.manage', 'import.run', 'import.merge', 'export.run', 'analytics.view',
  'admin.users', 'admin.roles', 'admin.fields', 'admin.scoring', 'admin.audit', 'admin.backup',
];

db.exec(`INSERT OR IGNORE INTO roles (id, name, permissions, is_system) VALUES
  (1, 'Администратор', '["*"]', 1),
  (2, 'Менеджер', '["contacts.view","contacts.create","contacts.edit","tasks.view","tasks.create","tasks.edit","dod.manage","import.run","import.merge","export.run","analytics.view"]', 1),
  (3, 'Наблюдатель', '["contacts.view","tasks.view","analytics.view"]', 1)
`);

const adminExists = db.prepare('SELECT id FROM users WHERE login = ?').get('admin');
if (!adminExists) {
  db.prepare('INSERT INTO users (login, password_hash, name, role_id) VALUES (?,?,?,?)')
    .run('admin', bcrypt.hashSync('admin123', 10), 'Администратор', 1);
}

const statusCount = db.prepare('SELECT COUNT(*) c FROM statuses').get().c;
if (statusCount === 0) {
  const ins = db.prepare('INSERT INTO statuses (name, color, sort_order, is_final, is_success) VALUES (?,?,?,?,?)');
  ins.run('Новый', '#64748b', 1, 0, 0);
  ins.run('В работе', '#3b82f6', 2, 0, 0);
  ins.run('Заинтересован', '#f59e0b', 3, 0, 0);
  ins.run('Подал документы', '#8b5cf6', 4, 0, 0);
  ins.run('Поступил', '#10b981', 5, 1, 1);
  ins.run('Отказ', '#ef4444', 6, 1, 0);
}

const ruleCount = db.prepare('SELECT COUNT(*) c FROM scoring_rules').get().c;
if (ruleCount === 0) {
  const ins = db.prepare('INSERT INTO scoring_rules (name, rule_type, condition, points) VALUES (?,?,?,?)');
  ins.run('3 и более посещений ДОД — горячий лид', 'touchpoint', JSON.stringify({ touchpoint_type: 'dod', min_count: 3 }), 100);
  ins.run('Посетил 1–2 ДОД', 'touchpoint', JSON.stringify({ touchpoint_type: 'dod', min_count: 1 }), 30);
  ins.run('Зарегистрировался на ДОД', 'touchpoint', JSON.stringify({ touchpoint_type: 'dod_registration', min_count: 1 }), 30);
  ins.run('Подал заявку', 'touchpoint', JSON.stringify({ touchpoint_type: 'application', min_count: 1 }), 40);
  ins.run('Принёс документы', 'touchpoint', JSON.stringify({ touchpoint_type: 'document', min_count: 1 }), 50);
}

db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES
  ('temperature_thresholds', '{"hot":80,"warm":30}'),
  ('app_name', '"NexusCRM"')
`);

if (!db.prepare('SELECT id FROM programs LIMIT 1').get()) {
  const ins = db.prepare('INSERT INTO programs (name, color) VALUES (?,?)');
  ins.run('Прикладная информатика', '#6366f1');
  ins.run('Дизайн', '#ec4899');
  ins.run('Экономика', '#10b981');
}

export const PERMISSIONS = ALL_PERMS;

// Правило «остывания»: тёплый лид становится холодным после 10 дней без касаний
if (!db.prepare("SELECT id FROM scoring_rules WHERE rule_type = 'inactivity' LIMIT 1").get()) {
  db.prepare('INSERT INTO scoring_rules (name, rule_type, condition, points) VALUES (?,?,?,?)')
    .run('Нет касаний 10+ дней — лид остывает', 'inactivity', JSON.stringify({ days: 10 }), -20);
} else {
  // Обновляем заводское значение 14 → 10, если правило не правили вручную
  const def = db.prepare("SELECT id, condition FROM scoring_rules WHERE rule_type = 'inactivity' AND name = 'Нет касаний 14+ дней — лид остывает' AND points = -20 LIMIT 1").get();
  if (def) {
    try {
      if ((JSON.parse(def.condition || '{}').days ?? 14) === 14) {
        db.prepare('UPDATE scoring_rules SET name = ?, condition = ? WHERE id = ?')
          .run('Нет касаний 10+ дней — лид остывает', JSON.stringify({ days: 10 }), def.id);
      }
    } catch { /* не трогаем пользовательскую настройку */ }
  }
}

// Правило «зарегистрировался на мероприятие» — участники выгрузки сразу тёплые
if (!db.prepare("SELECT id FROM scoring_rules WHERE rule_type = 'touchpoint' AND condition LIKE '%dod_registration%' LIMIT 1").get()) {
  db.prepare('INSERT INTO scoring_rules (name, rule_type, condition, points) VALUES (?,?,?,?)')
    .run('Зарегистрировался на ДОД', 'touchpoint', JSON.stringify({ touchpoint_type: 'dod_registration', min_count: 1 }), 30);
}

// ---------- Миграции ----------
const cols = db.prepare('PRAGMA table_info(contacts)').all().map(c => c.name);
if (!cols.includes('search_text')) {
  db.exec("ALTER TABLE contacts ADD COLUMN search_text TEXT NOT NULL DEFAULT '';");
}
if (!cols.includes('grade')) {
  db.exec("ALTER TABLE contacts ADD COLUMN grade TEXT NOT NULL DEFAULT '';");
}
// Ручное переопределение роли ('' = авто по дате рождения; child | adult | parent)
if (!cols.includes('contact_role')) {
  db.exec("ALTER TABLE contacts ADD COLUMN contact_role TEXT NOT NULL DEFAULT '';");
}

// Быстрый регистронезависимый поиск, включая кириллицу (LIKE в SQLite — только ASCII)
export function refreshSearchText(contactId) {
  const c = db.prepare('SELECT last_name, first_name, middle_name, phone, phone_normalized, email, city, school, grade FROM contacts WHERE id = ?').get(contactId);
  if (!c) return;
  const text = [c.last_name, c.first_name, c.middle_name, c.phone, c.phone_normalized, c.email, c.city, c.school, c.grade]
    .filter(Boolean).join(' ').toLowerCase();
  db.prepare('UPDATE contacts SET search_text = ? WHERE id = ?').run(text, contactId);
}

// Разовое заполнение для существующих баз
const empty = db.prepare("SELECT id FROM contacts WHERE search_text = ''").all();
for (const { id } of empty) refreshSearchText(id);

