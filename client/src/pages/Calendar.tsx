// © 2026 DobrayaSwaga · NexusCRM — авторский проект. Лицензия: см. файл LICENSE.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, GraduationCap, CheckSquare, Plus, CalendarDays,
  Clock, MapPin, Trash2, Check, X, LayoutGrid, ListTodo, Pencil
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Card, Spinner, Modal, Field, Input, Select, Textarea, Button, Badge } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { EVENT_TYPES, PRIORITY } from '../constants';

// ---------- утилиты дат ----------
const pad = (n: number) => String(n).padStart(2, '0');
const dateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// «2026-10-05» | «2026-10-05T16:00» | «2026-10-05 16:00:00» → { date, time }
const splitDT = (v?: string) => {
  if (!v) return { date: '', time: '' };
  const date = v.slice(0, 10);
  const m = v.slice(10).match(/(\d{1,2}):(\d{2})/);
  return { date, time: m ? `${pad(Number(m[1]))}:${m[2]}` : '' };
};
const joinDT = (date: string, time: string) => (time ? `${date}T${time}` : date);
const fmtDayLong = (d: Date) => d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeNum = (t: string) => Number(t.slice(0, 2) + t.slice(3, 5)); // «11:30» → 1130 для сортировки

type CalItem = { kind: 'event' | 'task'; id: number; date: string; time: string; title: string; raw: any };

export default function CalendarPage() {
  const { hasPerm } = useAuth();
  const [view, setView] = useState<'month' | 'day'>('month');
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [dayCursor, setDayCursor] = useState(() => new Date());
  const [tasks, setTasks] = useState<any[]>([]);
  const [dodEvents, setDodEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignees, setAssignees] = useState<any[]>([]);

  // Модалки
  const [editEvent, setEditEvent] = useState<any | null>(null);
  const [editTask, setEditTask] = useState<any | null>(null);
  const [createFor, setCreateFor] = useState<{ kind: 'event' | 'task' } | null>(null);
  const [err, setErr] = useState('');

  const canDod = hasPerm('dod.manage');
  const canTasks = hasPerm('tasks.create');

  // Загружаем «окно» вокруг видимого месяца (и для дневного вида — того же месяца)
  const activeMonth = view === 'month' ? cursor : new Date(dayCursor.getFullYear(), dayCursor.getMonth(), 1);
  const load = useCallback(() => {
    setLoading(true);
    const y = activeMonth.getFullYear(), m = activeMonth.getMonth();
    const from = dateStr(new Date(y, m - 1, 1));
    const to = dateStr(new Date(y, m + 2, 0));
    Promise.all([
      api.get(`/api/tasks?due_from=${encodeURIComponent(from)}&due_to=${encodeURIComponent(to)}`),
      api.get('/api/dod-events'),
    ]).then(([t, d]) => {
      setTasks(t.tasks);
      setDodEvents(d.events);
      setLoading(false);
    });
  }, [activeMonth]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/api/refs/assignees').then(d => setAssignees(d.users)).catch(() => {}); }, []);

  // Все элементы одной даты
  const itemsOf = useMemo(() => {
    return (date: string): CalItem[] => {
      const items: CalItem[] = [];
      for (const d of dodEvents) {
        const { date: dd, time } = splitDT(d.event_date);
        if (dd === date) items.push({ kind: 'event', id: d.id, date, time, title: d.name, raw: d });
      }
      for (const t of tasks) {
        const { date: td, time } = splitDT(t.due_date);
        if (td === date) items.push({ kind: 'task', id: t.id, date, time, title: t.title, raw: t });
      }
      return items.sort((a, b) => (timeNum(a.time || '99:99') - timeNum(b.time || '99:99')) || (a.kind > b.kind ? 1 : -1));
    };
  }, [dodEvents, tasks]);

  const today = dateStr(new Date());

  // ---------- действия ----------
  const saveEvent = async (form: any, isNew: boolean) => {
    try {
      const payload = {
        name: form.name, event_type: form.event_type, location: form.location || '',
        event_date: joinDT(form.date, form.time), description: form.description || '',
      };
      if (isNew) await api.post('/api/dod-events', payload);
      else await api.patch(`/api/dod-events/${form.id}`, payload);
      setEditEvent(null);
      setCreateFor(null);
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const saveTask = async (form: any, isNew: boolean) => {
    try {
      const payload: any = {
        title: form.title, description: form.description || '', priority: form.priority || 'normal',
        due_date: form.date ? joinDT(form.date, form.time) : null,
        assignee_id: form.assignee_id ? Number(form.assignee_id) : undefined,
      };
      if (isNew) await api.post('/api/tasks', payload);
      else await api.patch(`/api/tasks/${form.id}`, payload);
      setEditTask(null);
      setCreateFor(null);
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const toggleTask = async (t: any) => {
    await api.patch(`/api/tasks/${t.id}`, { status: t.status === 'done' ? 'open' : 'done' }).catch(() => {});
    load();
  };

  const deleteEvent = async (id: number) => {
    if (!confirm('Удалить мероприятие и все отметки о посещении?')) return;
    await api.del(`/api/dod-events/${id}`).catch(e => setErr(e.message));
    setEditEvent(null);
    load();
  };

  const deleteTask = async (id: number) => {
    if (!confirm('Удалить задачу?')) return;
    await api.del(`/api/tasks/${id}`).catch(e => setErr(e.message));
    setEditTask(null);
    load();
  };

  // ---------- модалка события ----------
  const EventModal = ({ initial, onClose, onDelete }: { initial: any; onClose: () => void; onDelete?: (id: number) => void }) => {
    const [form, setForm] = useState<any>(() => ({
      id: initial.id, name: initial.name || '', event_type: initial.event_type || 'dod',
      date: initial.date || splitDT(initial.event_date).date || dateStr(dayCursor),
      time: initial.time !== undefined ? initial.time : splitDT(initial.event_date).time,
      location: initial.location || '', description: initial.description || '',
    }));
    return (
      <Modal open onClose={onClose} title={form.id ? 'Мероприятие' : 'Новое мероприятие'}>
        <div className="space-y-3">
          {err && <div className="text-red-300 text-xs bg-red-500/10 border border-red-400/25 rounded-xl px-3 py-2">{err}</div>}
          <Field label="Тип">
            <div className="flex gap-1.5 flex-wrap">
              {Object.entries(EVENT_TYPES).map(([key, meta]) => (
                <button key={key} type="button" onClick={() => setForm((f: any) => ({ ...f, event_type: key }))}
                  className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
                  style={form.event_type === key
                    ? { background: `${meta.color}22`, borderColor: `${meta.color}70`, color: meta.color }
                    : { borderColor: 'rgba(255,255,255,0.1)', color: '#64748b' }}>
                  {meta.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Название"><Input autoFocus value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Дата"><Input type="date" value={form.date} onChange={e => setForm((f: any) => ({ ...f, date: e.target.value }))} /></Field>
            <Field label="Время"><Input type="time" value={form.time} onChange={e => setForm((f: any) => ({ ...f, time: e.target.value }))} /></Field>
          </div>
          <Field label="Место"><Input value={form.location} onChange={e => setForm((f: any) => ({ ...f, location: e.target.value }))} /></Field>
          <div className="flex justify-between gap-2 pt-1">
            <div>
              {onDelete && form.id && (
                <Button variant="danger" size="sm" onClick={() => onDelete(form.id)}><Trash2 size={13} /> Удалить</Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>Отмена</Button>
              <Button variant="primary" disabled={!form.name.trim() || !form.date} onClick={() => saveEvent(form, !form.id)}>Сохранить</Button>
            </div>
          </div>
        </div>
      </Modal>
    );
  };

  // ---------- модалка задачи ----------
  const TaskModal = ({ initial, onClose, onDelete }: { initial: any; onClose: () => void; onDelete?: (id: number) => void }) => {
    const [form, setForm] = useState<any>(() => ({
      id: initial.id, title: initial.title || '', description: initial.description || '',
      priority: initial.priority || 'normal', assignee_id: initial.assignee_id ? String(initial.assignee_id) : '',
      date: initial.date || splitDT(initial.due_date).date || dateStr(dayCursor),
      time: initial.time !== undefined ? initial.time : splitDT(initial.due_date).time,
    }));
    return (
      <Modal open onClose={onClose} title={form.id ? 'Задача' : 'Новая задача'}>
        <div className="space-y-3">
          {err && <div className="text-red-300 text-xs bg-red-500/10 border border-red-400/25 rounded-xl px-3 py-2">{err}</div>}
          <Field label="Задача"><Input autoFocus value={form.title} onChange={e => setForm((f: any) => ({ ...f, title: e.target.value }))} placeholder="Что нужно сделать" /></Field>
          <Field label="Описание"><Textarea rows={2} value={form.description} onChange={e => setForm((f: any) => ({ ...f, description: e.target.value }))} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Дата"><Input type="date" value={form.date} onChange={e => setForm((f: any) => ({ ...f, date: e.target.value }))} /></Field>
            <Field label="Время"><Input type="time" value={form.time} onChange={e => setForm((f: any) => ({ ...f, time: e.target.value }))} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Исполнитель">
              <Select value={form.assignee_id} onChange={e => setForm((f: any) => ({ ...f, assignee_id: e.target.value }))}>
                <option value="">Я сам</option>
                {assignees.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
            <Field label="Приоритет">
              <Select value={form.priority} onChange={e => setForm((f: any) => ({ ...f, priority: e.target.value }))}>
                <option value="low">Низкий</option>
                <option value="normal">Обычный</option>
                <option value="high">Высокий</option>
              </Select>
            </Field>
          </div>
          <div className="flex justify-between gap-2 pt-1">
            <div>
              {onDelete && form.id && hasPerm('tasks.delete') && (
                <Button variant="danger" size="sm" onClick={() => onDelete(form.id)}><Trash2 size={13} /> Удалить</Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>Отмена</Button>
              <Button variant="primary" disabled={!form.title.trim()} onClick={() => saveTask(form, !form.id)}>Сохранить</Button>
            </div>
          </div>
        </div>
      </Modal>
    );
  };

  // ---------- чипы месяца ----------
  const monthChip = (item: CalItem) => {
    const isEvent = item.kind === 'event';
    const color = isEvent ? (EVENT_TYPES[item.raw.event_type]?.color || '#8b5cf6') : '#34d399';
    const doneTask = !isEvent && item.raw.status === 'done';
    const clickable = isEvent ? canDod : hasPerm('tasks.edit');
    return (
      <button
        key={`${item.kind[0]}${item.id}`}
        onClick={e => {
          e.stopPropagation();
          if (!clickable) return;
          if (isEvent) setEditEvent(item.raw); else setEditTask(item.raw);
        }}
        title={`${item.time ? item.time + ' ' : ''}${item.title}${clickable ? ' — нажмите, чтобы изменить' : ''}`}
        className={`block w-full text-left text-[10px] px-1.5 py-1 rounded-md border truncate transition-all ${doneTask ? 'opacity-50 line-through' : ''} ${clickable ? 'hover:brightness-125 cursor-pointer' : 'cursor-default'}`}
        style={{ background: `${color}1a`, borderColor: `${color}45`, color }}
      >
        {isEvent ? <GraduationCap size={9} className="inline mr-1" /> : <CheckSquare size={9} className="inline mr-1" />}
        {item.time && <span className="font-semibold">{item.time} </span>}
        {item.title}
      </button>
    );
  };

  // ---------- дневной вид: карточка элемента ----------
  const dayCard = (item: CalItem) => {
    const isEvent = item.kind === 'event';
    const color = isEvent ? (EVENT_TYPES[item.raw.event_type]?.color || '#8b5cf6') : '#34d399';
    const t = item.raw;
    return (
      <div
        key={`${item.kind[0]}${item.id}`}
        className="glass rounded-xl px-3 py-2 flex items-center gap-3 group"
        style={{ borderLeft: `3px solid ${color}` }}
      >
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border" style={{ background: `${color}1a`, borderColor: `${color}40` }}>
          {isEvent ? <GraduationCap size={15} style={{ color }} /> : <ListTodo size={15} style={{ color }} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-[13px] font-medium ${!isEvent && t.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{item.title}</div>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500 flex-wrap">
            <span style={{ color }}>{isEvent ? EVENT_TYPES[t.event_type]?.short || 'ДОД' : 'Задача'}</span>
            {item.time && <span className="flex items-center gap-1"><Clock size={10} /> {item.time}</span>}
            {isEvent && t.location && <span className="flex items-center gap-1"><MapPin size={10} /> {t.location}</span>}
            {!isEvent && t.assignee_name && <span>{t.assignee_name}</span>}
            {isEvent && <span>{t.attendees_count} уч.</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {!isEvent && hasPerm('tasks.edit') && (
            <button
              onClick={() => toggleTask(t)}
              title={t.status === 'done' ? 'Вернуть в работу' : 'Выполнить'}
              className={`p-1.5 rounded-lg border transition-all ${t.status === 'done' ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300' : 'border-white/10 text-slate-500 hover:text-emerald-300 hover:border-emerald-400/40'}`}
            ><Check size={13} /></button>
          )}
          {(isEvent ? canDod : hasPerm('tasks.edit')) && (
            <button
              onClick={() => isEvent ? setEditEvent(t) : setEditTask(t)}
              title="Изменить дату/время и детали"
              className="p-1.5 rounded-lg border border-white/10 text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-all"
            ><Pencil size={13} /></button>
          )}
          {isEvent && (
            <Link to="/dod" title="Открыть в разделе «ДОД»" className="p-1.5 rounded-lg border border-white/10 text-slate-500 hover:text-violet-300 hover:bg-white/5 transition-all">
              <GraduationCap size={13} />
            </Link>
          )}
        </div>
      </div>
    );
  };

  // ---------- рендер месяца ----------
  const renderMonth = () => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
    const cells: (number | null)[] = [...Array(startOffset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
    while (cells.length % 7 !== 0) cells.push(null);

    return (
      <Card className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="grid grid-cols-7 border-b border-white/8 shrink-0">
          {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => (
            <div key={d} className="text-center text-[11px] font-medium text-slate-500 py-2.5">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 flex-1 auto-rows-fr overflow-y-auto">
          {cells.map((day, i) => {
            if (day === null) return <div key={i} className="border-b border-r border-white/4 bg-white/[0.015]" />;
            const ds = `${year}-${pad(month + 1)}-${pad(day)}`;
            const items = itemsOf(ds);
            const isT = ds === today;
            return (
              <div
                key={i}
                onClick={() => { setDayCursor(new Date(year, month, day)); setView('day'); }}
                className={`border-b border-r border-white/4 p-1.5 min-h-[90px] cursor-pointer hover:bg-white/4 transition-colors group/day ${isT ? 'bg-indigo-500/8' : ''}`}
                title="Открыть расписание дня"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-[11px] font-semibold inline-flex w-6 h-6 items-center justify-center rounded-lg ${isT ? 'bg-indigo-500 on-accent shadow-lg shadow-indigo-500/40' : 'text-slate-500'}`}>
                    {day}
                  </span>
                  <span className="opacity-0 group-hover/day:opacity-100 transition-opacity text-slate-600"><Plus size={11} /></span>
                </div>
                <div className="space-y-1">
                  {items.slice(0, 3).map(monthChip)}
                  {items.length > 3 && <div className="text-[9px] text-slate-600 px-1">ещё {items.length - 3} →</div>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    );
  };

  // ---------- рендер дня ----------
  const renderDay = () => {
    const ds = dateStr(dayCursor);
    const items = itemsOf(ds);
    const timed = items.filter(i => i.time);
    const untimed = items.filter(i => !i.time);
    // Группируем по часу (7:00–22:00 показываем шкалу, остальное уходит в ближайший час)
    const HOURS = Array.from({ length: 16 }, (_, i) => i + 7);
    const byHour = new Map<number, CalItem[]>();
    for (const it of timed) {
      let h = Number(it.time.slice(0, 2));
      h = Math.min(22, Math.max(7, h));
      if (!byHour.has(h)) byHour.set(h, []);
      byHour.get(h)!.push(it);
    }

    return (
      <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto">
        {untimed.length > 0 && (
          <Card className="p-3 shrink-0">
            <div className="text-[11px] text-slate-500 mb-2 font-medium">Без времени ({untimed.length})</div>
            <div className="space-y-2">{untimed.map(dayCard)}</div>
          </Card>
        )}
        <Card className="flex-1 min-h-0 overflow-y-auto p-0">
          <div className="min-w-0">
            {HOURS.map(h => (
              <div key={h} className={`flex border-b border-white/4 min-h-[52px] ${byHour.has(h) ? '' : 'opacity-45'}`}>
                <div className="w-16 shrink-0 pt-2.5 text-right pr-3 text-[11px] font-mono text-slate-600 border-r border-white/6">
                  {pad(h)}:00
                </div>
                <div className="flex-1 p-1.5 space-y-1.5">
                  {(byHour.get(h) || []).map(dayCard)}
                </div>
              </div>
            ))}
          </div>
        </Card>
        {items.length === 0 && (
          <div className="text-center text-xs text-slate-600 py-6">
            На этот день ничего не запланировано — добавьте мероприятие или задачу кнопками сверху.
          </div>
        )}
      </div>
    );
  };

  const monthName = cursor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

  return (
    <div className="h-full flex flex-col animate-fade-in">
      <PageHeader title="Календарь" subtitle="Мероприятия и задачи: нажмите на день, чтобы открыть расписание">
        {/* Переключатель вида */}
        <div className="flex items-center rounded-xl border border-white/10 overflow-hidden">
          <button
            onClick={() => setView('month')}
            className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors ${view === 'month' ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:bg-white/5'}`}
          ><LayoutGrid size={13} /> Месяц</button>
          <button
            onClick={() => setView('day')}
            className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors ${view === 'day' ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:bg-white/5'}`}
          ><CalendarDays size={13} /> День</button>
        </div>
        {(canDod || canTasks) && (
          <>
            {canTasks && (
              <Button variant="default" size="sm" onClick={() => setCreateFor({ kind: 'task' })}><CheckSquare size={13} /> Задача</Button>
            )}
            {canDod && (
              <Button variant="primary" size="sm" onClick={() => setCreateFor({ kind: 'event' })}><Plus size={13} /> Мероприятие</Button>
            )}
          </>
        )}
      </PageHeader>

      {err && <div className="text-red-300 text-xs bg-red-500/10 border border-red-400/25 rounded-xl px-3 py-2 mb-2">{err}</div>}

      {/* Навигация */}
      <div className="flex items-center gap-2 mb-3">
        {view === 'month' ? (
          <div className="flex items-center gap-1">
            <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="p-2 rounded-xl border border-white/10 text-slate-400 hover:bg-white/5"><ChevronLeft size={15} /></button>
            <button onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); }} className="text-xs px-3 py-2 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 capitalize min-w-40 text-center">{monthName}</button>
            <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="p-2 rounded-xl border border-white/10 text-slate-400 hover:bg-white/5"><ChevronRight size={15} /></button>
          </div>
        ) : (
          <div className="flex items-center gap-1 flex-wrap">
            <button onClick={() => setDayCursor(new Date(dayCursor.getTime() - 86400000))} className="p-2 rounded-xl border border-white/10 text-slate-400 hover:bg-white/5"><ChevronLeft size={15} /></button>
            <button onClick={() => setDayCursor(new Date())} className="text-xs px-3 py-2 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 capitalize min-w-56 text-center">
              {fmtDayLong(dayCursor)}{dateStr(dayCursor) === today ? ' · сегодня' : ''}
            </button>
            <button onClick={() => setDayCursor(new Date(dayCursor.getTime() + 86400000))} className="p-2 rounded-xl border border-white/10 text-slate-400 hover:bg-white/5"><ChevronRight size={15} /></button>
            <button
              onClick={() => setView('month')}
              className="text-[11px] px-2.5 py-2 rounded-xl border border-white/10 text-slate-500 hover:text-slate-200 hover:bg-white/5 ml-1 flex items-center gap-1"
            ><X size={11} /> к месяцу</button>
          </div>
        )}
        <div className="hidden md:flex items-center gap-3 text-[11px] text-slate-600 ml-auto">
          {Object.entries(EVENT_TYPES).map(([k, m]) => (
            <span key={k} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: m.color }} /> {m.short}</span>
          ))}
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Задача</span>
        </div>
      </div>

      {loading ? <Spinner /> : view === 'month' ? renderMonth() : renderDay()}

      {/* Модалки */}
      {editEvent && <EventModal initial={editEvent} onClose={() => { setEditEvent(null); setErr(''); }} onDelete={deleteEvent} />}
      {editTask && <TaskModal initial={editTask} onClose={() => { setEditTask(null); setErr(''); }} onDelete={deleteTask} />}
      {createFor?.kind === 'event' && canDod && (
        <EventModal initial={{ event_type: 'dod', date: dateStr(dayCursor), time: view === 'day' ? '11:00' : '' }} onClose={() => { setCreateFor(null); setErr(''); }} />
      )}
      {createFor?.kind === 'task' && canTasks && (
        <TaskModal initial={{ date: dateStr(dayCursor), time: view === 'day' ? '12:00' : '' }} onClose={() => { setCreateFor(null); setErr(''); }} />
      )}
    </div>
  );
}
