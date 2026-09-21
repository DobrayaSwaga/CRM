import { db, refreshSearchText } from './db.js';

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
  const rules = db.prepare('SELECT * FROM scoring_rules WHERE active = 1').all();
  const contact = db.prepare('SELECT id, status_id FROM contacts WHERE id = ?').get(contactId);
  if (!contact) return;
  let score = 0;
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
      if (c >= minCount) {
        // Прогрессивное начисление: за каждый кратный шаг min_count
        score += rule.points * Math.max(1, Math.floor(c / minCount) >= 1 ? 1 : 1);
      }
    } else if (rule.rule_type === 'status') {
      if (cond.status_id && contact.status_id === cond.status_id) score += rule.points;
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
