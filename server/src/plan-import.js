import xlsx from 'xlsx';
import { db } from './db.js';
import { isoDate } from './util.js';

/**
 * Импорт плана мероприятий из Excel-буфера.
 * Ожидает колонки «Дата» и «Название» (+ необязательные «Время», «Формат», «Этап»,
 * «Период», «Программа», «Направление», «Специальность», «Место») — определяются автоматически.
 * Возвращает { created, skipped, errors, total } или бросает Error с понятным текстом.
 */
export function importEventPlanFromBuffer(buffer, userId = null) {
  let rows;
  try {
    const wb = xlsx.read(buffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd' })
      .filter(r => r.some(c => String(c).trim() !== ''));
  } catch {
    throw new Error('Файл не читается — сохраните его как .xlsx');
  }
  if (rows.length < 2) throw new Error('Файл пустой — только заголовок');

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
    throw new Error('Нужны колонки «Дата» и «Название» — проверьте заголовки файла');
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
        const tm = cell(row, timeIdx).match(/(\d{1,2}):(\d{2})/);
        const eventDate = tm ? `${date}T${tm[1].padStart(2, '0')}:${tm[2]}` : date;

        const dup = db.prepare('SELECT id FROM dod_events WHERE substr(event_date,1,10) = ? AND name = ? LIMIT 1').get(date, name);
        if (dup) { skipped++; continue; }

        const meta = [cell(row, formatIdx), cell(row, stageIdx), cell(row, periodIdx)].filter(Boolean).join(' · ');
        const spec = [cell(row, directionIdx), cell(row, specialtyIdx)].filter(Boolean).join(' — ');
        const description = [meta, cell(row, programIdx), spec ? `Направление: ${spec}` : ''].filter(Boolean).join('\n');

        db.prepare('INSERT INTO dod_events (name, event_date, location, description, created_by) VALUES (?,?,?,?,?)')
          .run(name, eventDate, cell(row, locationIdx), description, userId);
        created++;
      } catch {
        errors++;
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { created, skipped, errors, total: rows.length - 1 };
}
