import { useEffect, useState } from 'react';
import { GitMerge, Check, X, AlertTriangle, ArrowRight } from 'lucide-react';
import { api } from '../api';
import { Card, Button, Spinner, EmptyState, Badge, TempBadge } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { Link } from 'react-router-dom';

export default function Duplicates() {
  const [candidates, setCandidates] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = () => api.get('/api/import/duplicates').then(d => setCandidates(d.candidates));
  useEffect(() => { load(); }, []);

  const resolve = async (id: number, action: 'merge' | 'skip') => {
    setBusy(id);
    try {
      await api.post(`/api/import/duplicates/${id}/resolve`, { action });
      load();
    } finally {
      setBusy(null);
    }
  };

  if (!candidates) return <Spinner />;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Возможные дубли"
        subtitle="Люди из загруженных таблиц, чей телефон уже есть в базе. Решите: объединить данные или пропустить."
      />

      {candidates.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Check size={40} className="text-emerald-400" />}
            title="Дублей нет — база чистая ✨"
            hint="После очередного импорта Excel здесь появятся совпадения по телефону, если человек уже был в базе"
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {candidates.map(c => {
            const inc = c.incoming;
            const newFio = [inc.last_name, inc.first_name, inc.middle_name].filter(Boolean).join(' ') || '(без имени)';
            const existingFio = [c.last_name, c.first_name, c.middle_name].filter(Boolean).join(' ');
            // Что нового принесёт слияние
            const additions: string[] = [];
            if (inc.email && !c.email) additions.push('email');
            if (inc.city && !c.city) additions.push('город');
            if (inc.programs) additions.push('направления');
            if (inc.ege_score) additions.push('ЕГЭ');
            if (inc.source) additions.push('источник');

            return (
              <Card key={c.id} className="p-4 animate-slide-up">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-72">
                    <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-400/25 shrink-0">
                      <GitMerge size={16} className="text-amber-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-slate-200">{newFio}</span>
                        <span className="text-xs text-slate-500">{inc.phone}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">из файла {c.filename} · {c.created_at.slice(0, 10)}</div>
                    </div>
                  </div>

                  <ArrowRight size={16} className="text-slate-600 shrink-0" />

                  <div className="min-w-0 flex-1 min-w-72">
                    <Link to={`/contacts/${c.existing_contact_id}`} className="text-sm font-medium text-indigo-300 hover:text-indigo-200">
                      {existingFio}
                    </Link>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className="text-xs text-slate-500">{c.phone}</span>
                      {c.status_name && <Badge color="#64748b">{c.status_name}</Badge>}
                      <TempBadge temp={c.temperature} size="sm" />
                      <span className="text-[11px] text-slate-600">баллы: {c.score}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {additions.length > 0 && (
                      <span className="text-[11px] text-emerald-400/80">добавит: {additions.join(', ')}</span>
                    )}
                    <Button size="sm" variant="success" disabled={busy === c.id} onClick={() => resolve(c.id, 'merge')}>
                      <Check size={13} /> Объединить
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy === c.id} onClick={() => resolve(c.id, 'skip')}>
                      <X size={13} /> Пропустить
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
