import path from 'node:path';
import fs from 'node:fs';
import { db, refreshSearchText } from './db.js';

// Каталог загруженных документов (рядом с базой данных)
export const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'documents');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export function normalizePhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = '7' + digits.slice(1);
  if (digits.length === 11 && digits.startsWith('7')) return digits;
  if (digits.length === 10) return '7' + digits;
  return digits;
}

export function audit(userId, action, entity = '', entityId = null, details = {}) {
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES (?,?,?,?,?)')
    .run(userId ?? null, action, entity, entityId, JSON.stringify(details));
}

export function getThresholds() {
  const row = db.prepare("SELECT value FROM settings WHERE key='temperature_thresholds'").get();
  try { return JSON.parse(row?.value || '{}'); } catch { return { hot: 80, warm: 30 }; }
}

export function scoreToTemperature(score) {
  const t = getThresholds();
  const hot = t.hot ?? 80, warm = t.warm ?? 30;
  if (score >= hot) return 'hot';
  if (score >= warm) return 'warm';
  return 'cold';
}

/**
 * Пересчёт баллов контакта по активным правилам.
 * touchpoint: { touchpoint_type, min_count, period_days? } — если касаний такого типа >= min_count, начисляем points.
 * status: { status_id } — если контакт в статусе, начисляем points.
 */
export function recalcScore(contactId) {
  refreshSearchText(contactId); // держим поисковый индекс актуальным
  const contact = db.prepare('SELECT id, status_id, created_at, birth_date, contact_role FROM contacts WHERE id = ?').get(contactId);
  if (!contact) return;
  // Родителям скоринг не начисляем — решение фиксируем на детях
  if (resolveRole(contact).role === 'parent') {
    db.prepare("UPDATE contacts SET score = 0, temperature = 'cold', updated_at = datetime('now') WHERE id = ?").run(contactId);
    return { score: 0, temperature: 'cold' };
  }
  let score = 0;
  const rules = db.prepare('SELECT * FROM scoring_rules WHERE active = 1').all();
  for (const rule of rules) {
    let cond = {};
    try { cond = JSON.parse(rule.condition || '{}'); } catch { /* ignore */ }
    if (rule.rule_type === 'touchpoint') {
      const type = cond.touchpoint_type;
      if (!type) continue;
      let sql = 'SELECT COUNT(*) c FROM touchpoints WHERE contact_id = ? AND type = ?';
      const params = [contactId, type];
      if (cond.period_days) {
        sql += " AND event_date >= datetime('now', ?)";
        params.push(`-${Number(cond.period_days)} days`);
      }
      const c = db.prepare(sql).get(...params).c;
      const minCount = cond.min_count || 1;
      if (c >= minCount) score += rule.points;
    } else if (rule.rule_type === 'status') {
      if (cond.status_id && contact.status_id === cond.status_id) score += rule.points;
    } else if (rule.rule_type === 'inactivity') {
      // Штраф/бонус по свежести последнего касания (points обычно отрицательные)
      const days = Number(cond.days) || 14;
      const lastTp = db.prepare('SELECT MAX(event_date) m FROM touchpoints WHERE contact_id = ?').get(contactId)?.m;
      const ref = lastTp || contact.created_at;
      if (ref) {
        const diffDays = (Date.now() - new Date(String(ref).replace(' ', 'T') + 'Z').getTime()) / 86400000;
        if (diffDays >= days) score += rule.points;
      }
    }
  }
  const temperature = scoreToTemperature(score);
  db.prepare("UPDATE contacts SET score = ?, temperature = ?, updated_at = datetime('now') WHERE id = ?")
    .run(score, temperature, contactId);
  return { score, temperature };
}

export function contactFio(c) {
  return [c.last_name, c.first_name, c.middle_name].filter(Boolean).join(' ').trim();
}

// Возраст из даты рождения («yyyy-mm-dd» или «dd.mm.yyyy»); null, если не распарсить
export function ageFrom(birth, ref = new Date()) {
  if (!birth) return null;
  const s = String(birth).trim();
  let y, m, d;
  let mt = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (mt) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else {
    mt = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (!mt) return null;
    d = +mt[1]; m = +mt[2]; y = +mt[3];
  }
  let age = ref.getFullYear() - y;
  const md = ref.getMonth() + 1 - m;
  if (md < 0 || (md === 0 && ref.getDate() < d)) age--;
  return age;
}

/**
 * Роль контакта. Рамка (логика приёмной комиссии):
 *  младше 18      — школьник (потенциальный абитуриент);
 *  18–31          — взрослый (может быть и старшим абитуриентом, и молодым родителем — не гадаем);
 *  32 и старше    — родитель: ребёнку 14+ лет ⇒ родителю при его рождении было минимум 18.
 *  Младше 5 и старше 90 — дата рождения, скорее всего, ошибочна.
 * Поле contacts.contact_role позволяет переопределить вручную ('' = авто).
 */
export function resolveRole(contact) {
  const manual = String(contact.contact_role || '');
  const age = ageFrom(contact.birth_date);
  if (manual === 'child' || manual === 'adult' || manual === 'parent') {
    return { role: manual, age, suspicious: false, manual: true };
  }
  if (age === null) return { role: 'unknown', age: null, suspicious: false, manual: false };
  if (age < 5 || age > 90) return { role: 'unknown', age, suspicious: true, manual: false };
  if (age < 18) return { role: 'child', age, suspicious: false, manual: false };
  if (age >= 32) return { role: 'parent', age, suspicious: false, manual: false };
  return { role: 'adult', age, suspicious: false, manual: false };
}

// «18.09.2026» | «2026-09-18» | Date → «2026-09-18» (или '' если не распарсилось)
export function isoDate(value) {
  if (!value && value !== 0) return '';
  if (value instanceof Date && !isNaN(value)) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

// «18.09.2026 09:00–13:30» → { date: '2026-09-18', time: '09:00', iso: '2026-09-18T09:00' }
export function parseEventDateTime(value) {
  const s = String(value ?? '').trim();
  const date = isoDate(s);
  const tm = s.match(/(\d{1,2}):(\d{2})/);
  const time = tm ? `${tm[1].padStart(2, '0')}:${tm[2]}` : '';
  return { date, time, iso: date ? (time ? `${date}T${time}` : date) : '' };
}

export function rowToContact(row, { withPrograms = false } = {}) {
  if (!row) return null;
  const contact = { ...row };
  if (withPrograms) {
    contact.programs = db.prepare(
      `SELECT p.id, p.name, p.color FROM programs p
       JOIN contact_programs cp ON cp.program_id = p.id WHERE cp.contact_id = ?`
    ).all(row.id);
  }
  return contact;
}
