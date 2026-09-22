import { Router } from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import { db } from '../db.js';
import { requireAuth, requirePerm } from '../auth.js';
import { audit, recalcScore, isoDate } from '../util.js';

export const dodRouter = Router();
const planUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

dodRouter.get('/', requireAuth, (_req, res) => {
  const events = db.prepare(`
    SELECT d.*, u.name AS created_by_name,
      (SELECT COUNT(DISTINCT t.contact_id) FROM touchpoints t WHERE t.dod_event_id = d.id AND t.type = 'dod') AS attendees_count
    FROM dod_events d LEFT JOIN users u ON u.id = d.created_by
    ORDER BY d.event_date DESC
  `).all();
  res.json({ events });
});

dodRouter.get('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const event = db.prepare('SELECT * FROM dod_events WHERE id = ?').get(id);
  if (!event) return res.status(404).json({ error: 'Мероприятие не найдено' });
  event.attendees = db.prepare(`
    SELECT c.id, c.last_name, c.first_name, c.middle_name, c.phone, c.email, c.score, c.temperature, s.name AS status_name
    FROM touchpoints t
    JOIN contacts c ON c.id = t.contact_id
    LEFT JOIN statuses s ON s.id = c.status_id
    WHERE t.dod_event_id = ? AND t.type = 'dod'
    ORDER BY c.last_name
  `).all(id);
  // Зарегистрировались, но не дошли — тоже лиды для дожима
  event.registrations = db.prepare(`
    SELECT c.id, c.last_name, c.first_name, c.middle_name, c.phone, c.email, c.score, c.temperature, s.name AS status_name
    FROM touchpoints t
    JOIN contacts c ON c.id = t.contact_id
    LEFT JOIN statuses s ON s.id = c.status_id
    WHERE t.dod_event_id = ? AND t.type = 'dod_registration'
      AND c.id NOT IN (SELECT contact_id FROM touchpoints WHERE dod_event_id = ? AND type = 'dod')
    ORDER BY c.last_name
  `).all(id, id);
  res.json({ event });
});

dodRouter.post('/', requirePerm('dod.manage'), (req, res) => {
  const { name, event_date, location, description } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Укажите название' });
  if (!event_date) return res.status(400).json({ error: 'Укажите дату' });
  const info = db.prepare('INSERT INTO dod_events (name, event_date, location, description, created_by) VALUES (?,?,?,?,?)')
    .run(name.trim(), event_date, location || '', description || '', req.user.id);
  audit(req.user.id, 'dod.create', 'dod_events', Number(info.lastInsertRowid));
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

dodRouter.patch('/:id', requirePerm('dod.manage'), (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  if (b.name !== undefined) db.prepare('UPDATE dod_events SET name = ? WHERE id = ?').run(String(b.name).trim(), id);
  if (b.event_date !== undefined) db.prepare('UPDATE dod_events SET event_date = ? WHERE id = ?').run(b.event_date, id);
  if (b.location !== undefined) db.prepare('UPDATE dod_events SET location = ? WHERE id = ?').run(String(b.location), id);
  if (b.description !== undefined) db.prepare('UPDATE dod_events SET description = ? WHERE id = ?').run(String(b.description), id);
  res.json({ ok: true });
});

dodRouter.delete('/:id', requirePerm('dod.manage'), (req, res) => {
  const id = Number(req.params.id);
  const affected = db.prepare("SELECT DISTINCT contact_id FROM touchpoints WHERE dod_event_id = ?").all(id);
  db.prepare('DELETE FROM touchpoints WHERE dod_event_id = ?').run(id);
  db.prepare('DELETE FROM dod_events WHERE id = ?').run(id);
  for (const { contact_id } of affected) recalcScore(contact_id);
  audit(req.user.id, 'dod.delete', 'dod_events', id);
  res.json({ ok: true });
});

// Отметить посещение (создаёт касание типа dod)
dodRouter.post('/:id/attend', requirePerm('dod.manage'), (req, res) => {
  const dodId = Number(req.params.id);
  const dod = db.prepare('SELECT * FROM dod_events WHERE id = ?').get(dodId);
  if (!dod) return res.status(404).json({ error: 'Мероприятие не найдено' });
  const { contact_id } = req.body || {};
  const contact = db.prepare('SELECT id FROM contacts WHERE id = ?').get(Number(contact_id));
  if (!contact) return res.status(404).json({ error: 'Контакт не найден' });
  const exists = db.prepare("SELECT id FROM touchpoints WHERE dod_event_id = ? AND contact_id = ? AND type = 'dod'").get(dodId, contact.id);
  if (exists) return res.status(409).json({ error: 'Посещение уже отмечено' });
  db.prepare("INSERT INTO touchpoints (contact_id, type, title, event_date, dod_event_id, created_by) VALUES (?,?,?,?,?,?)")
    .run(contact.id, 'dod', `Посещение: ${dod.name}`, dod.event_date, dodId, req.user.id);
  recalcScore(contact.id);
  res.status(201).json({ ok: true });
});

dodRouter.delete('/:id/attend/:contactId', requirePerm('dod.manage'), (req, res) => {
  const dodId = Number(req.params.id);
  const contactId = Number(req.params.contactId);
  db.prepare("DELETE FROM touchpoints WHERE dod_event_id = ? AND contact_id = ? AND type = 'dod'").run(dodId, contactId);
  recalcScore(contactId);
  res.json({ ok: true });
});

// ---------- Импорт плана мероприятий из Excel в календарь ----------
// Ожидает таблицу вида: Дата | Время | Название | Формат | Этап | Период | Программа | Направление | Специальность
// Колонки определяются автоматически по заголовкам, лишние игнорируются.
dodRouter.post('/import-plan', requirePerm('dod.manage'), planUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  let rows;
  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd' })
      .filter(r => r.some(c => String(c).trim() !== ''));
  } catch {
    return res.status(400).json({ error: 'Файл не читается — сохраните его как .xlsx' });
  }
  if (rows.length < 2) return res.status(400).json({ error: 'Файл пустой — только заголовок' });

  const norm = rows[0].map(h => String(h ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim());
  const findCol = (re) => norm.findIndex(h => re.test(h));
  const dateIdx = findCol(/^дата/);
  const timeIdx = findCol(/^время/);
  const nameIdx = findCol(/^название|^наименование|^тема/);
  const formatIdx = findCol(/^формат/);
  const stageIdx = findCol(/^этап/);
  const periodIdx = findCol(/^период/);
  const programIdx = findCol(/^программа|^описание/);
  const directionIdx = findCol(/^направление/);
  const specialtyIdx = findCol(/^специальность/);
  const locationIdx = findCol(/^место|^адрес|^локац|^площадка/);

  if (dateIdx === -1 || nameIdx === -1) {
    return res.status(400).json({ error: 'Нужны колонки «Дата» и «Название» — проверьте заголовки файла' });
  }

  const cell = (row, idx) => (idx >= 0 ? String(row[idx] ?? '').trim() : '');
  let created = 0, skipped = 0, errors = 0;
  db.exec('BEGIN');
  try {
    for (const row of rows.slice(1)) {
      try {
        const name = cell(row, nameIdx);
        const date = isoDate(cell(row, dateIdx));
        if (!name || !date) { skipped++; continue; }
        const timeRaw = cell(row, timeIdx);
        const tm = timeRaw.match(/(\d{1,2}):(\d{2})/);
        const eventDate = tm ? `${date}T${tm[1].padStart(2, '0')}:${tm[2]}` : date;

        const dup = db.prepare('SELECT id FROM dod_events WHERE substr(event_date,1,10) = ? AND name = ? LIMIT 1').get(date, name);
        if (dup) { skipped++; continue; }

        const meta = [cell(row, formatIdx), cell(row, stageIdx), cell(row, periodIdx)].filter(Boolean).join(' · ');
        const spec = [cell(row, directionIdx), cell(row, specialtyIdx)].filter(Boolean).join(' — ');
        const description = [meta, cell(row, programIdx), spec ? `Направление: ${spec}` : ''].filter(Boolean).join('\n');

        db.prepare('INSERT INTO dod_events (name, event_date, location, description, created_by) VALUES (?,?,?,?,?)')
          .run(name, eventDate, cell(row, locationIdx), description, req.user.id);
        created++;
      } catch {
        errors++;
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: String(e.message) });
  }
  audit(req.user.id, 'dod.import_plan', 'dod_events', null, { created, skipped, errors, file: req.file.originalname });
  res.json({ created, skipped, errors, total: rows.length - 1 });
});
