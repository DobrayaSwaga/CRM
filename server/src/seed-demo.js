/**
 * Демо-наполнение базы: node src/seed-demo.js
 * Создаёт реалистичные данные, чтобы посмотреть систему в действии.
 */
import { db } from './db.js';
import { recalcScore } from './util.js';

const count = db.prepare('SELECT COUNT(*) c FROM contacts').get().c;
if (count > 0) {
  console.log('⚠️  База не пустая — демо-данные не добавлены (сейчас контактов:', count + ')');
  process.exit(0);
}

const admin = db.prepare('SELECT id FROM users WHERE login = ?').get('admin');
const statuses = db.prepare('SELECT * FROM statuses ORDER BY sort_order').all();
const [stNew, stWork, stInterested, stDocs, stEnrolled] = statuses;
const programs = db.prepare('SELECT * FROM programs').all();

const manager = db.prepare('INSERT INTO users (login, password_hash, name, role_id) VALUES (?, ?, ?, ?)')
  .run('manager', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Смирнова Елена (менеджер)', 2);
const managerId = Number(manager.lastInsertRowid); // пароль: password

const people = [
  { last: 'Морозова', first: 'Екатерина', middle: 'Дмитриевна', phone: '+7 903 241-58-16', email: 'morozova.ek@gmail.com', city: 'Москва', school: 'Школа №57', source: 'ДОД', ege: 264, progs: [0], dods: 3, app: true, docs: true, status: stEnrolled.id },
  { last: 'Ковалёв', first: 'Дмитрий', middle: '', phone: '+7 925 114-77-03', email: 'dkovalev@mail.ru', city: 'Химки', school: 'Лицей «Вектор»', source: 'Сайт', ege: 231, progs: [0, 2], dods: 2, app: true, docs: false, status: stInterested.id },
  { last: 'Ахметова', first: 'Алина', middle: 'Равилевна', phone: '+7 916 830-22-45', email: '', city: 'Москва', school: 'Гимназия №1514', source: 'Соцсети', ege: 198, progs: [1], dods: 1, app: false, docs: false, status: stWork.id },
  { last: 'Громов', first: 'Никита', middle: 'Олегович', phone: '+7 903 556-91-20', email: 'n.gromov@yandex.ru', city: 'Долгопрудный', school: 'ФМШ №5', source: 'Рекомендация учителя', ege: 287, progs: [0], dods: 3, app: true, docs: true, status: stDocs.id },
  { last: 'Васильева', first: 'София', middle: '', phone: '+7 977 201-34-85', email: 'sofia.v@bk.ru', city: 'Москва', school: 'Школа №179', source: 'Ярмарка профессий', ege: 176, progs: [2, 1], dods: 0, app: false, docs: false, status: stNew.id },
  { last: 'Тарасов', first: 'Артём', middle: 'Игоревич', phone: '+7 909 677-40-12', email: '', city: 'Одинцово', school: 'Школа №1', source: 'ДОД', ege: 245, progs: [2], dods: 2, app: false, docs: false, status: stWork.id },
  { last: 'Петрова', first: 'Мария', middle: 'Александровна', phone: '+7 985 330-18-69', email: 'masha.petrova@gmail.com', city: 'Москва', school: 'СУНЦ МГУ', source: 'Сайт', ege: 292, progs: [0], dods: 3, app: true, docs: true, status: stEnrolled.id },
  { last: 'Зайцев', first: 'Кирилл', middle: '', phone: '+7 926 445-07-31', email: 'kzaytsev@outlook.com', city: 'Видное', school: 'Школа №23', source: 'Соцсети', ege: 154, progs: [1], dods: 0, app: false, docs: false, status: stNew.id },
  { last: 'Романова', first: 'Виктория', middle: 'Сергеевна', phone: '+7 903 781-26-94', email: '', city: 'Москва', school: 'Лицей №1535', source: 'ДОД', ege: 233, progs: [1, 0], dods: 1, app: true, docs: false, status: stInterested.id },
  { last: 'Белов', first: 'Матвей', middle: 'Павлович', phone: '+7 977 902-66-15', email: 'belov.matvey@rambler.ru', city: 'Люберцы', school: 'Технический лицей', source: 'Родители на ДОД', ege: 268, progs: [2], dods: 3, app: false, docs: false, status: stWork.id },
  { last: 'Кузнецова', first: 'Полина', middle: '', phone: '+7 916 118-53-90', email: 'polina.kuz@gmail.com', city: 'Москва', school: 'Школа №2009', source: 'Сайт', ege: 207, progs: [1], dods: 0, app: false, docs: false, status: stNew.id },
  { last: 'Орлов', first: 'Иван', middle: 'Максимович', phone: '+7 925 664-29-08', email: '', city: 'Реутов', school: 'Школа №4', source: 'Ярмарка профессий', ege: 189, progs: [2, 0], dods: 1, app: false, docs: false, status: stWork.id },
];

// ДОД прошедшие и будущий
const dod1 = db.prepare("INSERT INTO dod_events (name, event_date, location, created_by) VALUES (?,?,?,?)")
  .run('ДОД: день информационных технологий', '2026-08-20T12:00', 'Главный корпус, ауд. 205', admin.id);
const dod2 = db.prepare("INSERT INTO dod_events (name, event_date, location, created_by) VALUES (?,?,?,?)")
  .run('ДОД: день дизайна и медиа', '2026-09-05T15:00', 'Студия ArtSpace', admin.id);
const dod3 = db.prepare("INSERT INTO dod_events (name, event_date, location, created_by) VALUES (?,?,?,?)")
  .run('Большой осенний ДОД', '2026-09-14T11:00', 'Актовый зал', admin.id);
db.prepare("INSERT INTO dod_events (name, event_date, location, created_by) VALUES (?,?,?,?)")
  .run('ДОД онлайн: вопросы о поступлении', '2026-09-28T17:00', 'Zoom', admin.id);

const dodIds = [Number(dod1.lastInsertRowid), Number(dod2.lastInsertRowid), Number(dod3.lastInsertRowid)];
const dodDates = ['2026-08-20T12:00', '2026-09-05T15:00', '2026-09-14T11:00'];

const notes = [
  'Спросил про общежитие — рассказал про условия',
  'Интересуется бюджетными местами',
  'Родители просили презентацию на почту',
  'Выбирает между нами и МИРЭА',
  'Просила перезвонить ближе к вечеру',
];

for (const [i, p] of people.entries()) {
  const phoneNorm = p.phone.replace(/\D/g, '').replace(/^8/, '7');
  const info = db.prepare(`
    INSERT INTO contacts (last_name, first_name, middle_name, phone, phone_normalized, email, city, school, source, ege_score, status_id, owner_id, created_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now', '-' || ? || ' days'))
  `).run(p.last, p.first, p.middle, p.phone, phoneNorm, p.email, p.city, p.school, p.source, p.ege, p.status, i % 2 === 0 ? managerId : admin.id, admin.id, 40 - i * 3);
  const cid = Number(info.lastInsertRowid);

  for (const pi of p.progs) {
    if (programs[pi]) db.prepare('INSERT OR IGNORE INTO contact_programs (contact_id, program_id) VALUES (?,?)').run(cid, programs[pi].id);
  }

  for (let d = 0; d < p.dods; d++) {
    db.prepare("INSERT INTO touchpoints (contact_id, type, title, event_date, dod_event_id, created_by) VALUES (?,?,?,?,?,?)")
      .run(cid, 'dod', `Посещение ДОД`, dodDates[d % 3], dodIds[d % 3], admin.id);
  }
  if (p.app) db.prepare("INSERT INTO touchpoints (contact_id, type, title, event_date, created_by) VALUES (?,?,?,?,?)")
    .run(cid, 'application', 'Оставил заявку на поступление', '2026-09-10T14:30', admin.id);
  if (p.docs) db.prepare("INSERT INTO touchpoints (contact_id, type, title, event_date, created_by) VALUES (?,?,?,?,?)")
    .run(cid, 'document', 'Принёс оригиналы документов', '2026-09-15T13:00', admin.id);
  if (i % 3 === 0) db.prepare("INSERT INTO touchpoints (contact_id, type, title, description, event_date, created_by) VALUES (?,?,?,?,?,?)")
    .run(cid, 'call', 'Исходящий звонок', notes[i % notes.length], '2026-09-12T11:20', managerId);
  if (i % 4 === 0) db.prepare("INSERT INTO touchpoints (contact_id, type, title, description, event_date, created_by) VALUES (?,?,?,?,?,?)")
    .run(cid, 'email', 'Отправлена презентация направления', 'Программа обучения + условия приёма', '2026-09-08T16:00', managerId);

  recalcScore(cid);
}

// Задачи: актуальные + пара просроченных
const taskData = [
  ['Перезвонить Ковалёву — ответить про бюджет', 2, '+2 hours', managerId, 'open', 'high'],
  ['Отправить приглашение на осенний ДОД группе «Дизайн»', 6, '+1 day', managerId, 'open', 'normal'],
  ['Проверить оригиналы у Громова', 4, '+4 hours', admin.id, 'open', 'high'],
  ['Уточнить у Тарасова интерес к экономике', 6, '-1 day', managerId, 'open', 'normal'],
  ['Напомнить Беляву про заявку', 10, '-2 days', admin.id, 'open', 'high'],
  ['Поздравить Морозову с поступлением 🎉', 1, '+3 days', managerId, 'open', 'low'],
  ['Обзвонить новые лиды с ярмарки', 5, '+1 day', admin.id, 'open', 'normal'],
  ['Внести посетителей августовского ДОД', null, '-3 days', managerId, 'done', 'normal'],
];
for (const [title, cidOffset, due, assignee, status, prio] of taskData) {
  const cid = cidOffset ? cidOffset : null;
  const info = db.prepare(`
    INSERT INTO tasks (title, contact_id, assignee_id, created_by, due_date, status, priority, completed_at)
    VALUES (?,?,?,?, datetime('now', ?), ?, ?, ?)
  `).run(title, cid, assignee, admin.id, due, status, prio, status === 'done' ? '2026-09-15T10:00' : null);
}

// Шаблоны задач
db.prepare('INSERT INTO task_templates (title, description, priority, created_by) VALUES (?,?,?,?)')
  .run('Пригласить на ДОД', 'Позвонить, рассказать о ближайшем мероприятии, зафиксировать ответ', 'normal', admin.id);
db.prepare('INSERT INTO task_templates (title, description, priority, created_by) VALUES (?,?,?,?)')
  .run('Прогрев: презентация направления', 'Отправить на почту презентацию интересующего направления', 'normal', admin.id);
db.prepare('INSERT INTO task_templates (title, description, priority, created_by) VALUES (?,?,?,?)')
  .run('Контроль заявки', 'Проверить, подал ли абитуриент заявку после ДОД', 'high', admin.id);

const d = db.prepare("SELECT temperature, COUNT(*) c FROM contacts GROUP BY temperature").all();
console.log('✅ Демо-данные загружены:', db.prepare('SELECT COUNT(*) c FROM contacts').get().c, 'контактов');
console.log('   Распределение:', d.map(r => `${r.temperature}: ${r.c}`).join(', '));
console.log('   Менеджер: manager / password');
