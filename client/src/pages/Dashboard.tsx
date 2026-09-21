import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Flame, Sun, Snowflake, CheckSquare, GraduationCap, AlertTriangle, TrendingUp, ArrowRight } from 'lucide-react';
import { api } from '../api';
import { Card, Badge, Spinner, TempBadge, EmptyState } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { useAuth } from '../auth';

function Sparkline({ points, color = '#818cf8', height = 44 }: { points: number[]; color?: string; height?: number }) {
  if (!points.length) return null;
  const w = 280, h = height, pad = 3;
  const max = Math.max(...points, 1);
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((p, i) => [pad + i * step, h - pad - (p / max) * (h - pad * 2)]);
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${h} L${coords[0][0].toFixed(1)},${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={`sg-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${color.slice(1)})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      {coords.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === coords.length - 1 ? 3 : 0} fill={color} />
      ))}
    </svg>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [dynamics, setDynamics] = useState<any>(null);

  useEffect(() => {
    api.get('/api/analytics/dashboard').then(setData).catch(() => setData({ error: true }));
    api.get('/api/analytics/dynamics').then(setDynamics).catch(() => {});
  }, []);

  if (!data) return <Spinner />;
  if (data.error) return <EmptyState icon={<AlertTriangle size={40} />} title="Не удалось загрузить дашборд" />;

  const statCards = [
    { label: 'Всего в базе', value: data.totals.contacts, icon: Users, color: '#818cf8', extra: `+${data.totals.new30} за 30 дней` },
    { label: 'Горячие', value: data.totals.hot, icon: Flame, color: '#f87171', extra: 'потенциальные студенты' },
    { label: 'Тёплые', value: data.totals.warm, icon: Sun, color: '#fbbf24', extra: 'требуют прогрева' },
    { label: 'Холодные', value: data.totals.cold, icon: Snowflake, color: '#7dd3fc', extra: 'нужен первый контакт' },
  ];

  const maxStatus = Math.max(1, ...data.byStatus.map((s: any) => s.c));

  return (
    <div className="animate-fade-in">
      <PageHeader title={`Здравствуйте, ${user?.name.split(' ')[0]}`} subtitle="Вот что сейчас происходит с базой абитуриентов" />

      {/* Статы */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {statCards.map((s, i) => (
          <Card key={s.label} hover className="p-4 animate-slide-up relative overflow-hidden" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full opacity-15 blur-2xl" style={{ background: s.color }} />
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-500">{s.label}</span>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center border" style={{ background: `${s.color}1a`, borderColor: `${s.color}38` }}>
                <s.icon size={15} style={{ color: s.color }} />
              </div>
            </div>
            <div className="text-2xl font-bold text-slate-100">{s.value}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{s.extra}</div>
          </Card>
        ))}
      </div>

      {/* Спарклайн динамики */}
      {dynamics && dynamics.contacts.length > 1 && (
        <Card className="p-5 mb-4 animate-slide-up">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-slate-200 text-sm flex items-center gap-2"><TrendingUp size={15} className="text-indigo-400" /> Приток лидов по месяцам</h3>
            <div className="flex items-center gap-3 text-[11px] text-slate-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-400" /> новые контакты</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-400" /> посещения ДОД</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Sparkline points={dynamics.contacts.map((d: any) => d.c)} color="#818cf8" />
              <div className="flex justify-between text-[9px] text-slate-600 mt-1 px-0.5">
                {dynamics.contacts.map((d: any, i: number) => i % 3 === 0 ? <span key={i}>{d.month.slice(5)}.{d.month.slice(2, 4)}</span> : null).filter(Boolean)}
              </div>
            </div>
            <div>
              <Sparkline points={dynamics.dod.map((d: any) => d.c)} color="#a78bfa" />
              <div className="flex justify-between text-[9px] text-slate-600 mt-1 px-0.5">
                {dynamics.dod.map((d: any, i: number) => i % 3 === 0 ? <span key={i}>{d.month.slice(5)}.{d.month.slice(2, 4)}</span> : null).filter(Boolean)}
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-3 mb-4">
        {/* Воронка мини */}
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-200 flex items-center gap-2"><TrendingUp size={16} className="text-indigo-400" /> Воронка по статусам</h3>
            <Link to="/analytics" className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">Подробнее <ArrowRight size={12} /></Link>
          </div>
          <div className="space-y-2.5">
            {data.byStatus.map((s: any, i: number) => (
              <div key={s.id} className="flex items-center gap-3 animate-slide-up" style={{ animationDelay: `${i * 40}ms` }}>
                <span className="text-xs text-slate-400 w-32 shrink-0 truncate">{s.name}</span>
                <div className="flex-1 h-6 bg-white/4 rounded-lg overflow-hidden relative">
                  <div
                    className="h-full rounded-lg transition-all duration-700 relative"
                    style={{ width: `${(s.c / maxStatus) * 100}%`, background: `linear-gradient(90deg, ${s.color}55, ${s.color}99)`, borderRight: `2px solid ${s.color}` }}
                  />
                </div>
                <span className="text-sm font-semibold text-slate-200 w-8 text-right">{s.c}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Задачи + ДОД */}
        <div className="space-y-3">
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <CheckSquare size={16} className="text-emerald-400" />
              <h3 className="font-semibold text-slate-200">Задачи</h3>
            </div>
            <div className="flex items-baseline gap-4">
              <div>
                <div className="text-2xl font-bold text-slate-100">{data.openTasks}</div>
                <div className="text-[11px] text-slate-500">открыто</div>
              </div>
              {data.overdueTasks > 0 && (
                <Link to="/tasks?overdue=1" className="flex items-center gap-1.5 text-red-400 bg-red-500/10 border border-red-400/25 rounded-xl px-3 py-1.5 hover:bg-red-500/20 transition-all">
                  <AlertTriangle size={14} />
                  <span className="text-sm font-semibold">{data.overdueTasks} просрочено</span>
                </Link>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <GraduationCap size={16} className="text-violet-400" />
                <h3 className="font-semibold text-slate-200">Ближайшие ДОД</h3>
              </div>
              <Link to="/dod" className="text-xs text-indigo-400 hover:text-indigo-300">Все →</Link>
            </div>
            {data.upcomingDod.length === 0 ? (
              <p className="text-xs text-slate-500">Мероприятий не запланировано</p>
            ) : (
              <div className="space-y-2">
                {data.upcomingDod.map((d: any) => (
                  <div key={d.id} className="flex items-center justify-between text-sm">
                    <div className="min-w-0">
                      <div className="text-slate-300 truncate text-[13px]">{d.name}</div>
                      <div className="text-[11px] text-slate-500">{new Date(d.event_date).toLocaleDateString('ru-RU')} · {d.attendees} гостей</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Недавние контакты */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-200 flex items-center gap-2"><Users size={16} className="text-cyan-400" /> Недавно добавленные</h3>
          <Link to="/contacts" className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">Вся база <ArrowRight size={12} /></Link>
        </div>
        {data.recentContacts.length === 0 ? (
          <EmptyState
            icon={<Users size={36} />}
            title="База пока пуста"
            hint="Загрузите первую Excel-таблицу через раздел «Импорт» или добавьте контакт вручную"
          />
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-2">
            {data.recentContacts.map((c: any) => (
              <Link key={c.id} to={`/contacts/${c.id}`}>
                <div className="glass glass-hover rounded-xl p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white/6 border border-white/10 flex items-center justify-center text-xs font-bold text-slate-300 shrink-0">
                    {(c.first_name?.[0] || '?')}{(c.last_name?.[0] || '')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-slate-200 truncate">{c.last_name} {c.first_name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <TempBadge temp={c.temperature} size="sm" />
                      {c.status_name && <Badge color={c.status_color} className="!text-[10px] !px-1.5">{c.status_name}</Badge>}
                    </div>
                  </div>
                  <span className="text-xs font-mono text-slate-500">{c.score}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
