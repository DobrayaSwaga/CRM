import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, GraduationCap, CheckSquare } from 'lucide-react';
import { api } from '../api';
import { Card, Spinner } from '../components/ui';
import { PageHeader } from '../components/Layout';

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [tasks, setTasks] = useState<any[]>([]);
  const [dodEvents, setDodEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1).toISOString();
    const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59).toISOString();
    Promise.all([
      api.get(`/api/tasks?due_from=${encodeURIComponent(from)}&due_to=${encodeURIComponent(to)}`),
      api.get('/api/dod-events'),
    ]).then(([t, d]) => {
      setTasks(t.tasks);
      setDodEvents(d.events);
      setLoading(false);
    });
  }, [cursor]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Понедельник = 0
  const startOffset = (firstDay.getDay() + 6) % 7;

  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const dayItems = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayTasks = tasks.filter(t => t.due_date?.slice(0, 10) === dateStr);
    const dayDod = dodEvents.filter(d => d.event_date?.slice(0, 10) === dateStr);
    return { dayTasks, dayDod };
  };

  const isToday = (day: number) => {
    const now = new Date();
    return now.getFullYear() === year && now.getMonth() === month && now.getDate() === day;
  };

  const monthName = cursor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

  return (
    <div className="h-full flex flex-col animate-fade-in">
      <PageHeader
        title="Календарь"
        subtitle="Задачи по дедлайнам и дни открытых дверей"
      >
        <div className="flex items-center gap-1">
          <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="p-2 rounded-xl border border-white/10 text-slate-400 hover:bg-white/5"><ChevronLeft size={15} /></button>
          <button onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); }} className="text-xs px-3 py-2 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 capitalize min-w-36 text-center">{monthName}</button>
          <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="p-2 rounded-xl border border-white/10 text-slate-400 hover:bg-white/5"><ChevronRight size={15} /></button>
        </div>
      </PageHeader>

      <Card className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {loading ? <Spinner /> : (
          <>
            <div className="grid grid-cols-7 border-b border-white/8 shrink-0">
              {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => (
                <div key={d} className="text-center text-[11px] font-medium text-slate-500 py-2.5">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 flex-1 auto-rows-fr overflow-y-auto">
              {cells.map((day, i) => {
                if (day === null) return <div key={i} className="border-b border-r border-white/4 bg-white/[0.015]" />;
                const { dayTasks, dayDod } = dayItems(day);
                return (
                  <div key={i} className={`border-b border-r border-white/4 p-1.5 min-h-[90px] ${isToday(day) ? 'bg-indigo-500/8' : ''}`}>
                    <div className={`text-[11px] font-semibold mb-1 inline-flex w-6 h-6 items-center justify-center rounded-lg ${isToday(day) ? 'bg-indigo-500 on-accent shadow-lg shadow-indigo-500/40' : 'text-slate-500'}`}>
                      {day}
                    </div>
                    <div className="space-y-1">
                      {dayDod.map(d => (
                        <Link
                          key={`d${d.id}`}
                          to="/dod"
                          title={new Date(d.event_date).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          className="block text-[10px] px-1.5 py-1 rounded-md bg-violet-500/20 border border-violet-400/30 text-violet-300 truncate hover:bg-violet-500/30 transition-colors"
                        >
                          <GraduationCap size={9} className="inline mr-1" />{d.event_date.length > 10 && <span className="font-semibold">{d.event_date.slice(11, 16)} </span>}{d.name}
                        </Link>
                      ))}
                      {dayTasks.slice(0, 3).map(t => (
                        <div key={`t${t.id}`} className={`text-[10px] px-1.5 py-1 rounded-md truncate border ${t.status === 'done' ? 'bg-white/4 border-white/8 text-slate-600 line-through' : 'bg-emerald-500/12 border-emerald-400/25 text-emerald-300'}`}>
                          <CheckSquare size={9} className="inline mr-1" />{t.title}
                        </div>
                      ))}
                      {dayTasks.length > 3 && <div className="text-[9px] text-slate-600 px-1">ещё {dayTasks.length - 3}…</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
