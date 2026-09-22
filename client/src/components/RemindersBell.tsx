import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, AlertTriangle, Clock, GraduationCap, Flame } from 'lucide-react';
import { api } from '../api';

export default function RemindersBell() {
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = () => api.get('/api/analytics/notifications').then(setData).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const count = data?.count || 0;
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`relative p-2 rounded-xl border transition-all ${open ? 'bg-indigo-500/15 border-indigo-400/40 text-indigo-300' : 'border-white/10 text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
        title="Напоминания"
      >
        <Bell size={16} />
        {count > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-gradient-to-br from-red-500 to-rose-600 on-accent text-[9px] font-bold flex items-center justify-center shadow-lg shadow-red-500/40 animate-pulse">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-80 glass-strong rounded-2xl z-50 animate-slide-up overflow-hidden">
          <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-200">Напоминания</span>
            {count > 0 && <span className="text-[10px] bg-red-500/15 text-red-300 border border-red-400/30 rounded-md px-1.5 py-px">{count}</span>}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {(!data || count === 0) && (
              <div className="p-6 text-center text-xs text-slate-500">Всё спокойно — срочных дел нет</div>
            )}

            {data?.overdue?.length > 0 && (
              <Section title="Просрочено" color="text-red-400">
                {data.overdue.map((t: any) => (
                  <Row key={t.id} to={t.contact_id ? `/contacts/${t.contact_id}` : '/tasks'} onClick={() => setOpen(false)}
                    icon={<AlertTriangle size={13} className="text-red-400 shrink-0" />}
                    main={t.title} sub={t.contact_name ? `${t.contact_name} · ` : ''} extra={`был ${fmt(t.due_date)}`} extraClass="text-red-400" />
                ))}
                <Link to="/tasks?overdue=1" onClick={() => setOpen(false)} className="block text-center text-[11px] text-red-400 hover:text-red-300 py-1.5 hover:bg-white/3 transition-colors">
                  Все просроченные →
                </Link>
              </Section>
            )}

            {data?.today?.length > 0 && (
              <Section title="На сегодня" color="text-amber-400">
                {data.today.map((t: any) => (
                  <Row key={t.id} to={t.contact_id ? `/contacts/${t.contact_id}` : '/tasks'} onClick={() => setOpen(false)}
                    icon={<Clock size={13} className="text-amber-400 shrink-0" />}
                    main={t.title} sub={t.contact_name || ''} extra={new Date(t.due_date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} />
                ))}
              </Section>
            )}

            {data?.upcomingDod?.length > 0 && (
              <Section title="Ближайшие ДОД" color="text-violet-400">
                {data.upcomingDod.map((d: any) => (
                  <Row key={d.id} to="/dod" onClick={() => setOpen(false)}
                    icon={<GraduationCap size={13} className="text-violet-400 shrink-0" />}
                    main={d.name} sub={`${d.attendees} записалось`} extra={fmt(d.event_date)} />
                ))}
              </Section>
            )}

            {data?.idleHot?.length > 0 && (
              <Section title="Горячие без задач" color="text-orange-400">
                {data.idleHot.map((c: any) => (
                  <Row key={c.id} to={`/contacts/${c.id}`} onClick={() => setOpen(false)}
                    icon={<Flame size={13} className="text-orange-400 shrink-0" />}
                    main={c.name} sub="нет открытых задач" extra={`${c.score} баллов`} />
                ))}
              </Section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/5 last:border-0">
      <div className={`px-4 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider ${''}`}>{title}</div>
      {children}
    </div>
  );
}

function Row({ to, onClick, icon, main, sub, extra, extraClass }: any) {
  return (
    <Link to={to} onClick={onClick} className="flex items-start gap-2.5 px-4 py-2 hover:bg-white/4 transition-colors">
      <span className="mt-0.5">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-xs text-slate-200 truncate">{main}</span>
        {sub && <span className="block text-[10px] text-slate-500 truncate">{sub}</span>}
      </span>
      <span className={`text-[10px] shrink-0 ${extraClass || 'text-slate-500'}`}>{extra}</span>
    </Link>
  );
}
