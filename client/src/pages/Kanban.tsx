import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Spinner, TempBadge, Badge, Modal } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { ContactForm } from './Contacts';

export default function Kanban() {
  const { hasPerm } = useAuth();
  const [statuses, setStatuses] = useState<any[]>([]);
  const [byStatus, setByStatus] = useState<Record<number, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overStatus, setOverStatus] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [programFilter, setProgramFilter] = useState('');
  const [programs, setPrograms] = useState<any[]>([]);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const s = await api.get('/api/refs/statuses');
    setStatuses(s.statuses);
    const result: Record<number, any[]> = {};
    await Promise.all(s.statuses.map(async (st: any) => {
      const qs = new URLSearchParams({ status_id: String(st.id), per_page: '100', sort: 'score' });
      if (programFilter) qs.set('program_id', programFilter);
      const d = await api.get(`/api/contacts?${qs}`);
      result[st.id] = d.contacts;
    }));
    setByStatus(result);
    setLoading(false);
  }, [programFilter]);

  useEffect(() => {
    load();
    api.get('/api/refs/programs').then(d => setPrograms(d.programs));
  }, [load]);

  const onDrop = async (statusId: number) => {
    setOverStatus(null);
    if (!dragId) return;
    const current = Object.entries(byStatus).find(([, list]) => list.some(c => c.id === dragId));
    if (!current || Number(current[0]) === statusId) return;
    // оптимистично
    const card = current[1].find(c => c.id === dragId);
    setByStatus(prev => ({
      ...prev,
      [Number(current[0])]: prev[Number(current[0])].filter(c => c.id !== dragId),
      [statusId]: [card, ...(prev[statusId] || [])],
    }));
    setDragId(null);
    await api.patch(`/api/contacts/${dragId}`, { status_id: statusId }).catch(() => load());
    load(); // пересчёт скоринга мог поменять баллы
  };

  if (loading) return <Spinner />;

  return (
    <div className="h-full flex flex-col animate-fade-in">
      <PageHeader title="Воронка" subtitle="Перетаскивайте карточки между статусами">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Быстрый поиск…"
          className="bg-white/4 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-slate-300 outline-none placeholder:text-slate-600 focus:border-indigo-400/50 w-40"
        />
        <select
          value={programFilter}
          onChange={e => setProgramFilter(e.target.value)}
          className="bg-white/4 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-slate-300 outline-none [&>option]:bg-slate-900"
        >
          <option value="">Все направления</option>
          {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {hasPerm('contacts.create') && (
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 text-xs bg-gradient-to-br from-indigo-500 to-violet-600 text-white rounded-xl px-3 py-1.5 shadow-lg shadow-indigo-500/25 hover:brightness-110 transition-all">
            <Plus size={13} /> Контакт
          </button>
        )}
      </PageHeader>

      <div className="flex-1 min-h-0 overflow-x-auto pb-2">
        <div className="flex gap-3 h-full" style={{ minWidth: statuses.length * 268 }}>
          {statuses.map(st => {
            const q = search.trim().toLowerCase();
            const cards = (byStatus[st.id] || []).filter(c =>
              !q || `${c.last_name} ${c.first_name} ${c.phone}`.toLowerCase().includes(q)
            );
            return (
              <div
                key={st.id}
                className={`w-64 shrink-0 flex flex-col glass rounded-2xl transition-all ${overStatus === st.id ? 'drag-over' : ''}`}
                onDragOver={e => { e.preventDefault(); setOverStatus(st.id); }}
                onDragLeave={() => setOverStatus(null)}
                onDrop={() => onDrop(st.id)}
              >
                <div className="px-3.5 py-3 border-b border-white/8 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: st.color, boxShadow: `0 0 8px ${st.color}80` }} />
                  <span className="text-[13px] font-semibold text-slate-200 flex-1 truncate">{st.name}</span>
                  <span className="text-[11px] text-slate-500 bg-white/6 rounded-md px-1.5 py-px">{cards.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {cards.map(c => (
                    <div
                      key={c.id}
                      draggable={hasPerm('contacts.edit')}
                      onDragStart={() => setDragId(c.id)}
                      className="glass glass-hover rounded-xl p-3 cursor-grab active:cursor-grabbing"
                    >
                      <Link to={`/contacts/${c.id}`} onClick={e => e.stopPropagation()}>
                        <div className="text-[13px] font-medium text-slate-200 hover:text-indigo-300 transition-colors leading-tight">
                          {c.last_name} {c.first_name}
                        </div>
                      </Link>
                      {c.phone && <div className="text-[11px] text-slate-500 mt-1">{c.phone}</div>}
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex gap-1 flex-wrap">
                          {(c.programs || []).slice(0, 1).map((p: any) => <Badge key={p.id} color={p.color} className="!text-[9px] !px-1.5">{p.name}</Badge>)}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <TempBadge temp={c.temperature} size="sm" />
                          <span className="text-[11px] font-mono text-slate-400">{c.score}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {cards.length === 0 && (
                    <div className="text-center text-[11px] text-slate-600 py-6 border border-dashed border-white/8 rounded-xl">
                      Перетащите сюда
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Новый контакт" width="max-w-2xl">
        <ContactForm onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); load(); }} />
      </Modal>
    </div>
  );
}
