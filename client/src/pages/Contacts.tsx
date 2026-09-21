import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Users, Plus, Search, Download, Filter, ChevronLeft, ChevronRight, Phone, Mail, Upload } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Card, Button, Input, Select, Badge, Spinner, TempBadge, EmptyState, Modal, Field, Textarea } from '../components/ui';
import { PageHeader } from '../components/Layout';

export function ContactForm({ initial, onSaved, onClose }: { initial?: any; onSaved: (id: number) => void; onClose: () => void }) {
  const { user, hasPerm } = useAuth();
  const [form, setForm] = useState<any>({
    last_name: '', first_name: '', middle_name: '', phone: '', email: '',
    birth_date: '', city: '', school: '', source: '', ege_score: '', note: '',
    status_id: '', owner_id: '', program_ids: [] as number[], custom: {} as Record<string, string>,
    ...(initial ? {
      last_name: initial.last_name, first_name: initial.first_name, middle_name: initial.middle_name,
      phone: initial.phone, email: initial.email, birth_date: initial.birth_date || '',
      city: initial.city, school: initial.school, source: initial.source, ege_score: initial.ege_score ?? '',
      status_id: initial.status_id || '', owner_id: initial.owner_id || '',
      program_ids: (initial.programs || []).map((p: any) => p.id),
      custom: Object.fromEntries((initial.custom_values || []).map((cv: any) => [cv.field_id, cv.value])),
    } : {}),
  });
  const [refs, setRefs] = useState<{ statuses: any[]; programs: any[]; assignees: any[]; fields: any[] }>({ statuses: [], programs: [], assignees: [], fields: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/api/refs/statuses'),
      api.get('/api/refs/programs'),
      api.get('/api/refs/assignees'),
      api.get('/api/refs/custom-fields'),
    ]).then(([s, p, a, f]) => setRefs({ statuses: s.statuses, programs: p.programs, assignees: a.users, fields: f.fields }));
  }, []);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (initial?.id) {
        await api.patch(`/api/contacts/${initial.id}`, { ...form, ege_score: form.ege_score || null, note: undefined });
        onSaved(initial.id);
      } else {
        const { id } = await api.post('/api/contacts', { ...form, ege_score: form.ege_score || null, owner_id: form.owner_id || user?.id });
        onSaved(id);
      }
    } catch (e: any) {
      setError(e.data?.existing_id ? `${e.message} (id ${e.data.existing_id})` : e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleProgram = (id: number) => {
    set('program_ids', form.program_ids.includes(id) ? form.program_ids.filter((x: number) => x !== id) : [...form.program_ids, id]);
  };

  return (
    <div className="space-y-3">
      {error && <div className="text-red-300 text-xs bg-red-500/10 border border-red-400/25 rounded-xl px-3 py-2">{error}</div>}
      <div className="grid grid-cols-3 gap-2">
        <Field label="Фамилия"><Input value={form.last_name} onChange={e => set('last_name', e.target.value)} /></Field>
        <Field label="Имя"><Input value={form.first_name} onChange={e => set('first_name', e.target.value)} /></Field>
        <Field label="Отчество"><Input value={form.middle_name} onChange={e => set('middle_name', e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Телефон"><Input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+7 900 123-45-67" /></Field>
        <Field label="Email"><Input value={form.email} onChange={e => set('email', e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Дата рождения"><Input type="date" value={form.birth_date} onChange={e => set('birth_date', e.target.value)} /></Field>
        <Field label="Город"><Input value={form.city} onChange={e => set('city', e.target.value)} /></Field>
        <Field label="Балл ЕГЭ"><Input type="number" value={form.ege_score} onChange={e => set('ege_score', e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Школа"><Input value={form.school} onChange={e => set('school', e.target.value)} /></Field>
        <Field label="Источник" hint="Откуда узнал: сайт, ДОД, соцсети…"><Input value={form.source} onChange={e => set('source', e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Статус">
          <Select value={form.status_id} onChange={e => set('status_id', e.target.value ? Number(e.target.value) : '')}>
            <option value="">—</option>
            {refs.statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Ответственный">
          <Select value={form.owner_id} onChange={e => set('owner_id', e.target.value ? Number(e.target.value) : '')}>
            <option value="">—</option>
            {refs.assignees.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </Field>
      </div>

      {refs.programs.length > 0 && (
        <Field label="Направления интереса">
          <div className="flex flex-wrap gap-1.5">
            {refs.programs.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => toggleProgram(p.id)}
                className="text-xs px-2.5 py-1 rounded-lg border transition-all"
                style={form.program_ids.includes(p.id)
                  ? { background: `${p.color}30`, borderColor: `${p.color}70`, color: p.color }
                  : { background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.1)', color: '#94a3b8' }}
              >
                {p.name}
              </button>
            ))}
          </div>
        </Field>
      )}

      {refs.fields.map(f => (
        <Field key={f.id} label={f.name}>
          {f.field_type === 'select'
            ? <Select value={form.custom[f.id] || ''} onChange={e => set('custom', { ...form.custom, [f.id]: e.target.value })}>
                <option value="">—</option>
                {f.options.map((o: string) => <option key={o} value={o}>{o}</option>)}
              </Select>
            : <Input type={f.field_type === 'number' ? 'number' : f.field_type === 'date' ? 'date' : 'text'}
                value={form.custom[f.id] || ''} onChange={e => set('custom', { ...form.custom, [f.id]: e.target.value })} />}
        </Field>
      ))}

      {!initial?.id && (
        <Field label="Первая заметка (необязательно)">
          <Textarea rows={2} value={form.note} onChange={e => set('note', e.target.value)} />
        </Field>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onClose}>Отмена</Button>
        <Button variant="primary" onClick={submit} disabled={busy}>{busy ? 'Сохраняем…' : initial?.id ? 'Сохранить' : 'Создать контакт'}</Button>
      </div>
    </div>
  );
}

export default function Contacts() {
  const { hasPerm } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refs, setRefs] = useState<{ statuses: any[]; programs: any[]; assignees: any[] }>({ statuses: [], programs: [], assignees: [] });
  const [showCreate, setShowCreate] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const filters = useMemo(() => ({
    search: searchParams.get('search') || '',
    status_id: searchParams.get('status_id') || '',
    temperature: searchParams.get('temperature') || '',
    program_id: searchParams.get('program_id') || '',
    owner_id: searchParams.get('owner_id') || '',
    sort: searchParams.get('sort') || 'created',
    page: Number(searchParams.get('page')) || 1,
  }), [searchParams]);

  const [searchInput, setSearchInput] = useState(filters.search);

  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(searchParams);
    if (v) next.set(k, v); else next.delete(k);
    if (k !== 'page') next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    Object.entries({ ...filters, per_page: '25' }).forEach(([k, v]) => v && qs.set(k, String(v)));
    api.get(`/api/contacts?${qs}`).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSearchInput(filters.search); }, [filters.search]);

  useEffect(() => {
    Promise.all([api.get('/api/refs/statuses'), api.get('/api/refs/programs'), api.get('/api/refs/assignees')])
      .then(([s, p, a]) => setRefs({ statuses: s.statuses, programs: p.programs, assignees: a.users }));
  }, []);

  return (
    <div className="animate-fade-in">
      <PageHeader title="Контакты" subtitle={data ? `${data.total} записей в базе` : 'Загрузка…'}>
        {hasPerm('export.run') && (
          <Button variant="default" size="sm" onClick={() => {
            const qs = new URLSearchParams();
            Object.entries(filters).forEach(([k, v]) => v && qs.set(k, String(v)));
            window.open(`/api/export/contacts?${qs}`, '_blank');
          }}>
            <Download size={14} /> Excel
          </Button>
        )}
        {hasPerm('contacts.create') && (
          <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}><Plus size={14} /> Добавить</Button>
        )}
      </PageHeader>

      {/* Поиск и фильтры */}
      <Card className="p-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input
              className="!pl-9"
              placeholder="Поиск по ФИО, телефону или email…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && setFilter('search', searchInput)}
            />
          </div>
          <Button variant="default" size="sm" onClick={() => setFilter('search', searchInput)}>Найти</Button>
          <Button variant={showFilters ? 'primary' : 'ghost'} size="sm" onClick={() => setShowFilters(!showFilters)}>
            <Filter size={14} /> Фильтры
          </Button>
        </div>

        {showFilters && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3 animate-fade-in">
            <Select value={filters.status_id} onChange={e => setFilter('status_id', e.target.value)}>
              <option value="">Все статусы</option>
              {refs.statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <Select value={filters.temperature} onChange={e => setFilter('temperature', e.target.value)}>
              <option value="">Любая температура</option>
              <option value="hot">Горячие</option>
              <option value="warm">Тёплые</option>
              <option value="cold">Холодные</option>
            </Select>
            <Select value={filters.program_id} onChange={e => setFilter('program_id', e.target.value)}>
              <option value="">Все направления</option>
              {refs.programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select value={filters.owner_id} onChange={e => setFilter('owner_id', e.target.value)}>
              <option value="">Все ответственные</option>
              {refs.assignees.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
            <Select value={filters.sort} onChange={e => setFilter('sort', e.target.value)}>
              <option value="created">Сначала новые</option>
              <option value="score">По баллам ↓</option>
              <option value="fio">По фамилии А→Я</option>
              <option value="updated">По обновлению</option>
            </Select>
          </div>
        )}
      </Card>

      {/* Таблица */}
      <Card className="overflow-hidden">
        {loading && !data ? <Spinner /> : !data || data.contacts.length === 0 ? (
          <EmptyState
            icon={<Users size={40} />}
            title={filters.search ? 'Никого не найдено' : 'База пуста'}
            hint={filters.search ? 'Попробуйте изменить запрос' : 'Загрузите Excel-таблицу через «Импорт» — система сама создаст карточки'}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-slate-500 uppercase tracking-wider border-b border-white/8">
                    <th className="px-4 py-3 font-medium">ФИО</th>
                    <th className="px-4 py-3 font-medium">Контакты</th>
                    <th className="px-4 py-3 font-medium">Направления</th>
                    <th className="px-4 py-3 font-medium">Статус</th>
                    <th className="px-4 py-3 font-medium">Баллы</th>
                    <th className="px-4 py-3 font-medium">Ответственный</th>
                    <th className="px-4 py-3 font-medium">Добавлен</th>
                  </tr>
                </thead>
                <tbody>
                  {data.contacts.map((c: any) => (
                    <tr key={c.id} className="border-b border-white/5 hover:bg-white/4 transition-colors group">
                      <td className="px-4 py-2.5">
                        <Link to={`/contacts/${c.id}`} className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-white/8 to-white/4 border border-white/10 flex items-center justify-center text-[11px] font-bold text-slate-300 shrink-0 group-hover:border-indigo-400/40 transition-colors">
                            {(c.first_name?.[0] || '?')}{c.last_name?.[0] || ''}
                          </div>
                          <span className="font-medium text-slate-200 group-hover:text-indigo-300 transition-colors whitespace-nowrap">
                            {[c.last_name, c.first_name, c.middle_name].filter(Boolean).join(' ')}
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        {c.phone && <div className="flex items-center gap-1.5 text-slate-400 text-xs"><Phone size={11} /> {c.phone}</div>}
                        {c.email && <div className="flex items-center gap-1.5 text-slate-500 text-xs mt-0.5"><Mail size={11} /> {c.email}</div>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1 max-w-[220px]">
                          {c.programs.slice(0, 2).map((p: any) => <Badge key={p.id} color={p.color}>{p.name}</Badge>)}
                          {c.programs.length > 2 && <Badge color="#64748b">+{c.programs.length - 2}</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col gap-1 items-start">
                          {c.status_name && <Badge color={c.status_color}>{c.status_name}</Badge>}
                          <TempBadge temp={c.temperature} size="sm" />
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-mono font-semibold text-slate-200">{c.score}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-400">{c.owner_name || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">{c.created_at?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Пагинация */}
            {data.pages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-white/8">
                <span className="text-xs text-slate-500">Страница {data.page} из {data.pages} · всего {data.total}</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="default" disabled={data.page <= 1} onClick={() => setFilter('page', String(data.page - 1))}>
                    <ChevronLeft size={14} />
                  </Button>
                  <Button size="sm" variant="default" disabled={data.page >= data.pages} onClick={() => setFilter('page', String(data.page + 1))}>
                    <ChevronRight size={14} />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Новый контакт" width="max-w-2xl">
        <ContactForm onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); load(); }} />
      </Modal>
    </div>
  );
}
