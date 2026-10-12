import { useEffect, useState } from 'react';
import { BarChart3, Download, TrendingUp, Users, Target, Award } from 'lucide-react';
import { api } from '../api';
import { Card, Button, Spinner, Badge } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { useAuth } from '../auth';

function FunnelBar({ stage, max, color, i }: { stage: any; max: number; color: string; i: number }) {
  return (
    <div className="animate-slide-up" style={{ animationDelay: `${i * 60}ms` }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-slate-300">{stage.name}</span>
        <span className="text-xs text-slate-500">{stage.count} · {stage.pct}%</span>
      </div>
      <div className="h-8 bg-white/4 rounded-xl overflow-hidden relative">
        <div
          className="h-full rounded-xl transition-all duration-700 flex items-center px-3"
          style={{ width: `${Math.max(stage.pct, 2)}%`, background: `linear-gradient(90deg, ${color}44, ${color}88)` }}
        >
          <span className="text-xs font-bold" style={{ color }}>{stage.count > 0 ? stage.count : ''}</span>
        </div>
      </div>
    </div>
  );
}

export default function Analytics() {
  const { hasPerm } = useAuth();
  const [funnel, setFunnel] = useState<any>(null);
  const [sources, setSources] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);
  const [dynamics, setDynamics] = useState<any>(null);
  const [dates, setDates] = useState({ from: '', to: '' });

  const load = () => {
    const qs = new URLSearchParams();
    if (dates.from) qs.set('from', dates.from);
    if (dates.to) qs.set('to', dates.to);
    api.get(`/api/analytics/funnel?${qs}`).then(setFunnel);
    api.get('/api/analytics/sources').then(d => setSources(d.sources));
    api.get('/api/analytics/managers').then(d => setManagers(d.managers));
    api.get('/api/analytics/dynamics').then(setDynamics);
  };

  useEffect(() => { load(); }, [dates]);

  if (!funnel) return <Spinner />;

  const funnelColors = ['#818cf8', '#a78bfa', '#fbbf24', '#34d399', '#10b981'];
  const maxSource = Math.max(1, ...sources.map(s => s.c));
  const maxMonth = dynamics ? Math.max(1, ...dynamics.contacts.map((d: any) => d.c)) : 1;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Аналитика" subtitle="Эффективность приёмной кампании в цифрах">
        {hasPerm('export.run') && (
          <Button variant="default" size="sm" onClick={() => window.open('/api/export/analytics', '_blank')}>
            <Download size={14} /> Полный отчёт Excel
          </Button>
        )}
      </PageHeader>

      <Card className="p-3 mb-3 flex flex-wrap items-center gap-3">
        <span className="text-xs text-slate-500">Период:</span>
        <input type="date" value={dates.from} onChange={e => setDates(d => ({ ...d, from: e.target.value }))}
          className="bg-white/4 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-200 outline-none" />
        <span className="text-slate-600">—</span>
        <input type="date" value={dates.to} onChange={e => setDates(d => ({ ...d, to: e.target.value }))}
          className="bg-white/4 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-200 outline-none" />
        {(dates.from || dates.to) && (
          <button onClick={() => setDates({ from: '', to: '' })} className="text-xs text-indigo-400 hover:text-indigo-300">сбросить</button>
        )}
      </Card>

      <div className="grid lg:grid-cols-2 gap-3 mb-3">
        {/* Воронка конверсий */}
        <Card className="p-5">
          <h3 className="font-semibold text-slate-200 flex items-center gap-2 mb-4"><Target size={16} className="text-violet-400" /> Воронка: от контакта до студента</h3>
          <div className="space-y-3">
            {funnel.stages.map((s: any, i: number) => (
              <FunnelBar key={s.key} stage={s} max={funnel.stages[0]?.count || 1} color={funnelColors[i]} i={i} />
            ))}
          </div>
        </Card>

        {/* Распределение по статусам */}
        <Card className="p-5">
          <h3 className="font-semibold text-slate-200 flex items-center gap-2 mb-4"><BarChart3 size={16} className="text-indigo-400" /> По статусам</h3>
          <div className="space-y-2.5">
            {funnel.byStatus.map((s: any) => {
              const total = Math.max(1, funnel.byStatus.reduce((a: number, x: any) => a + x.c, 0));
              return (
                <div key={s.id} className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 w-32 shrink-0 truncate">{s.name}</span>
                  <div className="flex-1 h-5 bg-white/4 rounded-lg overflow-hidden">
                    <div className="h-full rounded-lg transition-all duration-500" style={{ width: `${(s.c / total) * 100}%`, background: `${s.color}55`, borderRight: `2px solid ${s.color}` }} />
                  </div>
                  <span className="text-sm font-semibold text-slate-200 w-10 text-right">{s.c}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-3 mb-3">
        {/* Источники */}
        <Card className="p-5">
          <h3 className="font-semibold text-slate-200 flex items-center gap-2 mb-4"><TrendingUp size={16} className="text-cyan-400" /> Откуда приходят (источники)</h3>
          {sources.length === 0 ? <p className="text-xs text-slate-600">Поле «источник» пока не заполняется</p> : (
            <div className="space-y-2">
              {sources.slice(0, 10).map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 w-36 shrink-0 truncate">{s.source}</span>
                  <div className="flex-1 h-4 bg-white/4 rounded-md overflow-hidden">
                    <div className="h-full rounded-md bg-gradient-to-r from-cyan-500/40 to-cyan-500/70 transition-all duration-500" style={{ width: `${(s.c / maxSource) * 100}%` }} />
                  </div>
                  <span className="text-xs text-slate-300 w-8 text-right">{s.c}</span>
                  <span className="text-xs w-8 text-right" title="горячих">{s.hot > 0 ? <span className="text-red-400">{s.hot}</span> : ''}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Динамика */}
        <Card className="p-5">
          <h3 className="font-semibold text-slate-200 flex items-center gap-2 mb-4"><BarChart3 size={16} className="text-emerald-400" /> Динамика по месяцам</h3>
          {!dynamics || dynamics.contacts.length === 0 ? <p className="text-xs text-slate-600">Данных пока мало</p> : (
            <div className="flex items-end gap-2 h-36">
              {dynamics.contacts.map((d: any, i: number) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-slate-500">{d.c}</span>
                  <div className="w-full bg-gradient-to-t from-indigo-500/50 to-violet-500/70 rounded-t-lg transition-all duration-500" style={{ height: `${(d.c / maxMonth) * 100}%` }} />
                  <span className="text-[9px] text-slate-600">{d.month.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Эффективность менеджеров */}
      <Card className="p-5">
        <h3 className="font-semibold text-slate-200 flex items-center gap-2 mb-4"><Users size={16} className="text-amber-400" /> Эффективность команды</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-slate-500 uppercase tracking-wider border-b border-white/8">
                <th className="pb-2 font-medium">Менеджер</th>
                <th className="pb-2 font-medium">Контактов</th>
                <th className="pb-2 font-medium">Горячих</th>
                <th className="pb-2 font-medium">Задач выполнено</th>
                <th className="pb-2 font-medium">Открытых</th>
                <th className="pb-2 font-medium">Просрочено</th>
                <th className="pb-2 font-medium">Поступило</th>
              </tr>
            </thead>
            <tbody>
              {managers.sort((a, b) => b.enrolled - a.enrolled).map((m, i) => (
                <tr key={m.id} className="border-b border-white/4">
                  <td className="py-2.5 font-medium text-slate-200">
                    {i === 0 && m.enrolled > 0 && <Award size={13} className="inline text-amber-400 mr-1" />}
                    {m.name}
                  </td>
                  <td className="py-2.5 text-slate-300">{m.contacts}</td>
                  <td className="py-2.5">{m.hot_contacts > 0 ? <Badge color="#f87171">{m.hot_contacts}</Badge> : <span className="text-slate-600">0</span>}</td>
                  <td className="py-2.5 text-emerald-400">{m.tasks_done}</td>
                  <td className="py-2.5 text-slate-300">{m.tasks_open}</td>
                  <td className="py-2.5">{m.tasks_overdue > 0 ? <Badge color="#ef4444">{m.tasks_overdue}</Badge> : <span className="text-slate-600">0</span>}</td>
                  <td className="py-2.5 font-bold text-emerald-300">{m.enrolled}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
