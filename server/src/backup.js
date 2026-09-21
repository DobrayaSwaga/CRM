import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { audit, recalcScore } from './util.js';

const DB_PATH = process.env.CRM_DB_PATH || path.join(process.cwd(), 'crm.db');
export const BACKUPS_DIR = path.join(process.cwd(), 'backups');
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

// Порядок удаления (обратный) и вставки (прямой) с учётом FK
const TABLES = [
  'roles', 'users', 'statuses', 'programs', 'contacts',
  'contact_programs', 'custom_fields', 'contact_field_values',
  'dod_events', 'touchpoints', 'tasks', 'task_templates',
  'scoring_rules', 'settings', 'imports', 'duplicate_candidates', 'audit_log',
];
// sessions намеренно НЕ включаем — не выкидываем пользователей из системы при восстановлении

export function createLogicalBackup(userName = 'система') {
  const tables = {};
  for (const t of TABLES) {
    tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
  }
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
  return {
    app: 'campus-crm',
    version: 1,
    created_at: new Date().toISOString(),
    created_by: userName,
    counts,
    tables,
  };
}

export function restoreLogicalBackup(payload, userId) {
  if (!payload || payload.app !== 'campus-crm' || !payload.tables) {
    throw new Error('Это не файл бэкапа CampusCRM');
  }
  // FK off: иначе DELETE из parents каскадом сносит сессии и дочерние строки вне списка
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN');
  let restored = 0;
  try {
    for (const t of [...TABLES].reverse()) {
      db.exec(`DELETE FROM ${t};`);
    }
    for (const t of TABLES) {
      const rows = payload.tables[t];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const cols = Object.keys(row);
        const placeholders = cols.map(() => '?').join(',');
        db.prepare(`INSERT OR REPLACE INTO ${t} (${cols.join(',')}) VALUES (${placeholders})`)
          .run(...cols.map(c => row[c]));
        restored++;
      }
    }
    audit(userId, 'backup.restore', 'database', null, { restored_rows: restored, backup_from: payload.created_at });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA foreign_keys = ON;');
    throw e;
  }
  db.exec('PRAGMA foreign_keys = ON;');
  // Пересчёт скоринга на всякий случай
  for (const { id } of db.prepare('SELECT id FROM contacts').all()) recalcScore(id);
  return { restored };
}

// ---- Автоматические файловые бэкапы (бинарная копия БД) ----
export function autoBackupNow() {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  const stamp = new Date().toISOString().slice(0, 10);
  const target = path.join(BACKUPS_DIR, `crm-${stamp}.db`);
  fs.copyFileSync(DB_PATH, target);
  // Храним последние 10
  const files = listBackups();
  for (const f of files.slice(10)) {
    fs.unlinkSync(path.join(BACKUPS_DIR, f.name));
  }
  return target;
}

export function listBackups() {
  return fs.readdirSync(BACKUPS_DIR)
    .filter(f => f.endsWith('.db'))
    .map(name => {
      const stat = fs.statSync(path.join(BACKUPS_DIR, name));
      return { name, size: stat.size, created: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.created.localeCompare(a.created));
}

let lastAutoBackup = '';
export function setupAutoBackup() {
  const tick = () => {
    const today = new Date().toISOString().slice(0, 10);
    if (lastAutoBackup !== today) {
      try {
        autoBackupNow();
        lastAutoBackup = today;
        console.log(`💾 Автобэкап создан: crm-${today}.db`);
      } catch (e) {
        console.error('Ошибка автобэкапа:', e.message);
      }
    }
  };
  setTimeout(tick, 10_000); // первый через 10 сек после старта
  setInterval(tick, 30 * 60 * 1000); // дальше проверка каждые 30 минут
}
