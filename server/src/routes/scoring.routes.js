import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requirePerm } from '../auth.js';
import { audit, getThresholds, recalcScore, scoreToTemperature } from '../util.js';

export const scoringRouter = Router();

scoringRouter.get('/rules', requireAuth, (_req, res) => {
  const rules = db.prepare('SELECT * FROM scoring_rules ORDER BY points DESC').all()
    .map(r => ({ ...r, condition: JSON.parse(r.condition || '{}') }));
  res.json({ rules, thresholds: getThresholds() });
});

function validateCondition(rule_type, cond) {
  if (rule_type === 'touchpoint') {
    if (!cond.touchpoint_type || !['dod', 'call', 'email', 'application', 'document', 'note', 'other'].includes(cond.touchpoint_type)) {
      return 'Выберите тип касания';
    }
    if (!cond.min_count || Number(cond.min_count) < 1) return 'Минимальное количество — от 1';
  } else if (rule_type === 'status') {
    if (!cond.status_id || !db.prepare('SELECT id FROM statuses WHERE id = ?').get(Number(cond.status_id))) return 'Выберите статус';
  } else return 'Неизвестный тип правила';
  return null;
}

scoringRouter.post('/rules', requirePerm('admin.scoring'), (req, res) => {
  const { name, rule_type, condition, points, active } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Укажите название правила' });
  const err = validateCondition(rule_type, condition || {});
  if (err) return res.status(400).json({ error: err });
  const info = db.prepare('INSERT INTO scoring_rules (name, rule_type, condition, points, active) VALUES (?,?,?,?,?)')
    .run(name.trim(), rule_type, JSON.stringify(condition), Number(points) || 0, active === undefined ? 1 : (active ? 1 : 0));
  audit(req.user.id, 'scoring_rule.create', 'scoring_rules', Number(info.lastInsertRowid));
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

scoringRouter.patch('/rules/:id', requirePerm('admin.scoring'), (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM scoring_rules WHERE id = ?').get(id)) return res.status(404).json({ error: 'Правило не найдено' });
  const b = req.body || {};
  if (b.name !== undefined) db.prepare('UPDATE scoring_rules SET name = ? WHERE id = ?').run(String(b.name).trim(), id);
  if (b.points !== undefined) db.prepare('UPDATE scoring_rules SET points = ? WHERE id = ?').run(Number(b.points), id);
  if (b.active !== undefined) db.prepare('UPDATE scoring_rules SET active = ? WHERE id = ?').run(b.active ? 1 : 0, id);
  if (b.condition !== undefined) {
    const err = validateCondition(b.rule_type || 'touchpoint', b.condition);
    if (err) return res.status(400).json({ error: err });
    db.prepare('UPDATE scoring_rules SET condition = ? WHERE id = ?').run(JSON.stringify(b.condition), id);
  }
  audit(req.user.id, 'scoring_rule.update', 'scoring_rules', id);
  res.json({ ok: true });
});

scoringRouter.delete('/rules/:id', requirePerm('admin.scoring'), (req, res) => {
  db.prepare('DELETE FROM scoring_rules WHERE id = ?').run(Number(req.params.id));
  audit(req.user.id, 'scoring_rule.delete', 'scoring_rules', Number(req.params.id));
  res.json({ ok: true });
});

// Пороги температуры
scoringRouter.patch('/thresholds', requirePerm('admin.scoring'), (req, res) => {
  const { hot, warm } = req.body || {};
  if (hot === undefined || warm === undefined || Number(hot) <= Number(warm)) {
    return res.status(400).json({ error: 'Порог «горячий» должен быть больше «тёплого»' });
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('temperature_thresholds', ?)")
    .run(JSON.stringify({ hot: Number(hot), warm: Number(warm) }));
  audit(req.user.id, 'scoring_thresholds.update', 'settings', null, { hot, warm });
  res.json({ ok: true });
});

// Полный пересчёт всех баллов
scoringRouter.post('/recalculate', requirePerm('admin.scoring'), (req, res) => {
  const ids = db.prepare('SELECT id FROM contacts').all();
  for (const { id } of ids) recalcScore(id);
  audit(req.user.id, 'scoring.recalculate', 'contacts', null, { count: ids.length });
  // Распределение после пересчёта
  const dist = db.prepare('SELECT temperature, COUNT(*) c FROM contacts GROUP BY temperature').all();
  res.json({ recalculated: ids.length, distribution: dist });
});

// ML-готовность: статистика для будущей модели
scoringRouter.get('/ml-readiness', requirePerm('admin.scoring'), (_req, res) => {
  const total = db.prepare('SELECT COUNT(*) c FROM contacts').get().c;
  const outcomes = db.prepare(`
    SELECT s.is_success, COUNT(*) c FROM contacts c JOIN statuses s ON s.id = c.status_id
    WHERE s.is_final = 1 GROUP BY s.is_success
  `).all();
  const success = outcomes.find(o => o.is_success === 1)?.c || 0;
  const fail = outcomes.find(o => o.is_success === 0)?.c || 0;
  res.json({
    total_contacts: total,
    known_outcomes: success + fail,
    success, fail,
    ready: success >= 50 && fail >= 50,
    recommendation: success >= 50 && fail >= 50
      ? 'Данных достаточно для обучения первой ML-модели'
      : `Для ML-модели нужно минимум по 50 завершённых кейсов каждого типа. Сейчас: поступило ${success}, отказов ${fail}.`,
  });
});
