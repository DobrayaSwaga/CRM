import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckSquare, Plus, Download, Zap, Check, Clock, AlertTriangle, User } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Card, Button, Input, Select, Textarea, Spinner, EmptyState, Modal, Field, Badge } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { PRIORITY } from '../constants';

const fmtDate = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(d); target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  const dateStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  if (diff === 0) return `Сегодня`;
  if (diff === 1) return `Завтра`;
  if (diff === -1) return `Вчера`;
  return dateStr;
};

export default function Tasks() {
  const { hasPerm, user } = useAuth();
  const [searchParams] = useSearchParams();
  const [tasks, setTasks] = useState<any[] | null>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [assignees, setAssignees] = useState<any[]>([]);
  const [statuses, setStatuses] = useState<any[]>([]);
  const [programs, setPrograms] = useState<any[]>([]);
  const [filter, setFilter] = useState({ status: searchParams.get('overdue') === '1' ? '' : 'open', assignee_id: '', overdue: searchParams.get('overdue') || '', mine: '' });
  const [showCreate, setShowCreate] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [form, setForm] = useState<any>({ title: '', description: '', due_date: '', priority: 'normal', assignee_id: '' });
  const [bulkForm, setBulkForm] = useState<any>({ title: '', template_id: '', due_date: '', priority: 'normal', assignee_id: '', filters: {} as any });
  const [err, setErr] = useState('');
  const [bulkResult, setBulkResult] = useState('');

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    Object.entries(filter).forEach(([k, v]) => v && qs.set(k, v));
    api.get(`/api/tasks?${qs}`).then(d => setTasks(d.tasks));
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/api/tasks/templates').then(d => setTemplates(d.templates));
    api.get('/api/refs/assignees').then(d => setAssignees(d.users));
    api.get('/api/refs/statuses').then(d => setStatuses(d.statuses));
    api.get('/api/refs/programs').then(d => setPrograms(d.programs));
  }, []);

  const createTask = async () => {
    try {
      await api.post('/api/tasks', { ...form, assignee_id: form.assignee_id ? Number(form.assignee_id) : undefined });
      setShowCreate(false);
      setForm({ title: '', description: '', due_date: '', priority: 'normal', assignee_id: '' });
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const createBulk = async () => {
    setErr('');
    try {
      const filters: any = {};
      Object.entries(bulkForm.filters).forEach(([k, v]) => { if (v) filters[k] = v; });
      const res = await api.post('/api/tasks/bulk', {
        title: bulkForm.title, due_date: bulkForm.due_date || undefined, priority: bulkForm.priority,
        assignee_id: bulkForm.assignee_id ? Number(bulkForm.assignee_id) : undefined, filters,
      });
      setBulkResult(`Создано задач: ${res.created}`);
      setTimeout(() => { setShowBulk(false); setBulkResult(''); load(); }, 1500);
    } catch (e: any) { setBulkResult(''); setErr(e.message); }
  };

  const setTaskStatus = async (id: number, status: string) => {
    await api.patch(`/api/tasks/${id}`, { status });
    load();
  };

  const isOverdue = (t: any) => t.status === 'open' && t.due_date && t.due_date < new Date().toISOString();

  return (
    <div className="animate-fade-in">
      <PageHeader title="Задачи" subtitle="Контроль работы с абитуриентами">
        {hasPerm('export.run') && (
          <Button variant="default" size="sm" onClick={() => window.open('/api/export/tasks', '_blank')}>
            <Download size={14} /> Excel
          </Button>
        )}
        {hasPerm('tasks.create') && (
          <>
            <Button variant="default" size="sm" onClick={() => { setShowBulk(true); setErr(''); }}>
              <Zap size={14} /> Массовая постановка
            </Button>
            <Button variant="primary" size="sm" onClick={() => { setShowCreate(true); setErr(''); }}>
              <Plus size={14} /> Задача
            </Button>
          </>
        )}
      </PageHeader>

      <Card className="p-3 mb-3 flex flex-wrap items-center gap-2">
        {[
          { k: '', label: 'Все' },
          { k: 'open', label: 'Открытые' },
          { k: 'done', label: 'Выполненные' },
        ].map(f => (
          <button
            key={f.k}
            onClick={() => setFilter(fl => ({ ...fl, status: f.k, overdue: '' }))}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${filter.status === f.k && !filter.overdue ? 'bg-indigo-500/20 border-indigo-400/40 text-indigo-300' : 'border-white/10 text-slate-400 hover:bg-white/5'}`}
          >
            {f.label}
          </button>
        ))}
        <button
          onClick={() => setFilter(fl => ({ ...fl, overdue: fl.overdue ? '' : '1', status: '' }))}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1 ${filter.overdue ? 'bg-red-500/20 border-red-400/40 text-red-300' : 'border-white/10 text-slate-400 hover:bg-white/5'}`}
        >
          <AlertTriangle size={11} /> Просроченные
        </button>
        <button
          onClick={() => setFilter(fl => ({ ...fl, mine: fl.mine ? '' : '1' }))}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1 ${filter.mine ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300' : 'border-white/10 text-slate-400 hover:bg-white/5'}`}
        >
          <User size={11} /> Мои
        </button>
        <div className="flex-1" />
        <Select className="!w-44" value={filter.assignee_id} onChange={e => setFilter(f => ({ ...f, assignee_id: e.target.value }))}>
          <option value="">Все исполнители</option>
          {assignees.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
      </Card>

      {!tasks ? <Spinner /> : tasks.length === 0 ? (
        <Card><EmptyState icon={<CheckSquare size={40} />} title="Задач нет" hint="Создайте задачу вручную или используйте массовую постановку по фильтрам" /></Card>
      ) : (
        <div className="space-y-2">
          {tasks.map((t, i) => (
            <Card key={t.id} className="p-3.5 animate-slide-up" hover>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => hasPerm('tasks.edit') && setTaskStatus(t.id, t.status === 'done' ? 'open' : 'done')}
                  className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all ${
                    t.status === 'done' ? 'bg-emerald-500/30 border-emerald-400 text-emerald-300' : 'border-white/20 hover:border-emerald-400/60 text-transparent hover:text-emerald-400/50'
                  }`}
                >
                  <Check size={13} strokeWidth={3} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium ${t.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                    {t.title}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[11px] text-slate-500 flex-wrap">
                    {t.contact_id_ref && (
                      <Link to={`/contacts/${t.contact_id_ref}`} className="text-indigo-400 hover:text-indigo-300" onClick={e => e.stopPropagation()}>
                        {t.last_name} {t.first_name}
                      </Link>
                    )}
                    {t.assignee_name && <span>{t.assignee_name}</span>}
                    {t.due_date && (
                      <span className={`flex items-center gap-1 ${isOverdue(t) ? 'text-red-400 font-semibold' : ''}`}>
                        <Clock size={10} /> {fmtDate(t.due_date)}
                        {isOverdue(t) && ' — просрочено!'}
                      </span>
                    )}
                  </div>
                </div>
                <Badge color={PRIORITY[t.priority]?.color}>{PRIORITY[t.priority]?.label}</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Создание задачи */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Новая задача">
        <div className="space-y-3">
          {err && <div className="text-red-300 text-xs bg-red-500/10 border border-red-400/25 rounded-xl px-3 py-2">{err}</div>}
          <Field label="Задача"><Input autoFocus value={form.title} onChange={e => setForm((f: any) => ({ ...f, title: e.target.value }))} placeholder="Например: Проверить заявки с ДОД" /></Field>
          <Field label="Описание"><Textarea rows={2} value={form.description} onChange={e => setForm((f: any) => ({ ...f, description: e.target.value }))} /></Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Дедлайн"><Input type="datetime-local" value={form.due_date} onChange={e => setForm((f: any) => ({ ...f, due_date: e.target.value }))} /></Field>
            <Field label="Приоритет">
              <Select value={form.priority} onChange={e => setForm((f: any) => ({ ...f, priority: e.target.value }))}>
                <option value="low">Низкий</option>
                <option value="normal">Обычный</option>
                <option value="high">Высокий</option>
              </Select>
            </Field>
            <Field label="Исполнитель">
              <Select value={form.assignee_id} onChange={e => setForm((f: any) => ({ ...f, assignee_id: e.target.value }))}>
                <option value="">Я сам</option>
                {assignees.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Отмена</Button>
            <Button variant="primary" onClick={createTask} disabled={!form.title.trim()}>Создать</Button>
          </div>
        </div>
      </Modal>

      {/* Массовая постановка */}
      <Modal open={showBulk} onClose={() => setShowBulk(false)} title="Массовая постановка задач" width="max-w-2xl">
        <div className="space-y-3">
          {err && <div className="text-red-300 text-xs bg-red-500/10 border border-red-400/25 rounded-xl px-3 py-2">{err}</div>}
          {bulkResult && <div className="text-emerald-300 text-xs bg-emerald-500/10 border border-emerald-400/25 rounded-xl px-3 py-2">{bulkResult}</div>}
          <p className="text-xs text-slate-500">Задача будет создана для каждого контакта, подходящего под фильтры. Пример: «Обзвонить всех горячих лидов» → 50 задач.</p>

          {templates.length > 0 && (
            <Field label="Из шаблона">
              <Select value={bulkForm.template_id} onChange={e => {
                const t = templates.find(x => x.id === Number(e.target.value));
                setBulkForm((f: any) => ({ ...f, template_id: e.target.value, title: t ? t.title : f.title, priority: t ? t.priority : f.priority }));
              }}>
                <option value="">— не выбран —</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Текст задачи"><Input value={bulkForm.title} onChange={e => setBulkForm((f: any) => ({ ...f, title: e.target.value }))} placeholder="Позвонить и пригласить на ДОД" /></Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Фильтр: статус">
              <Select value={bulkForm.filters.status_id || ''} onChange={e => setBulkForm((f: any) => ({ ...f, filters: { ...f.filters, status_id: e.target.value } }))}>
                <option value="">Любой</option>
                {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Фильтр: температура">
              <Select value={bulkForm.filters.temperature || ''} onChange={e => setBulkForm((f: any) => ({ ...f, filters: { ...f.filters, temperature: e.target.value } }))}>
                <option value="">Любая</option>
                <option value="hot">Горячие</option>
                <option value="warm">Тёплые</option>
                <option value="cold">Холодные</option>
              </Select>
            </Field>
            <Field label="Фильтр: направление">
              <Select value={bulkForm.filters.program_id || ''} onChange={e => setBulkForm((f: any) => ({ ...f, filters: { ...f.filters, program_id: e.target.value } }))}>
                <option value="">Все</option>
                {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Фильтр: ответственный контакта">
              <Select value={bulkForm.filters.owner_id || ''} onChange={e => setBulkForm((f: any) => ({ ...f, filters: { ...f.filters, owner_id: e.target.value } }))}>
                <option value="">Любой</option>
                {assignees.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Field label="Дедлайн"><Input type="datetime-local" value={bulkForm.due_date} onChange={e => setBulkForm((f: any) => ({ ...f, due_date: e.target.value }))} /></Field>
            <Field label="Приоритет">
              <Select value={bulkForm.priority} onChange={e => setBulkForm((f: any) => ({ ...f, priority: e.target.value }))}>
                <option value="low">Низкий</option>
                <option value="normal">Обычный</option>
                <option value="high">Высокий</option>
              </Select>
            </Field>
            <Field label="Исполнитель">
              <Select value={bulkForm.assignee_id} onChange={e => setBulkForm((f: any) => ({ ...f, assignee_id: e.target.value }))}>
                <option value="">Я сам</option>
                {assignees.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowBulk(false)}>Отмена</Button>
            <Button variant="primary" onClick={createBulk} disabled={!bulkForm.title.trim()}>Поставить задачи</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
