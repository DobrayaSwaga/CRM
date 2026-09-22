import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Phone, Mail, MapPin, School, Calendar, Pencil, Trash2,
  Plus, Flame, AlertTriangle, CheckSquare, GraduationCap, Sparkles,
  Award, Archive, Snowflake, Clock, Paperclip, FileText, Download, X, Users
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Card, Button, Badge, Spinner, TempBadge, Modal, Field, Input, Select, Textarea, EmptyState } from '../components/ui';
import { ContactForm } from './Contacts';
import { TOUCHPOINT_TYPES } from '../constants';
import { resolveRole, ROLE_META } from '../role';

function scoreColor(score: number) {
  if (score >= 80) return '#f87171';
  if (score >= 30) return '#fbbf24';
  return '#7dd3fc';
}

const TONE: Record<string, { color: string; icon: any }> = {
  red: { color: '#f87171', icon: Flame },
  blue: { color: '#60a5fa', icon: Phone },
  violet: { color: '#a78bfa', icon: GraduationCap },
  cyan: { color: '#67e8f9', icon: Snowflake },
  amber: { color: '#fbbf24', icon: Clock },
  emerald: { color: '#34d399', icon: Award },
  slate: { color: '#94a3b8', icon: Archive },
};

function NextActionCard({ contactId, onTaskCreated }: { contactId: number; onTaskCreated: () => void }) {
  const { hasPerm } = useAuth();
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/api/contacts/${contactId}/next-action`).then(d => setData(d)).catch(() => {});
  }, [contactId]);
  useEffect(() => { load(); }, [load]);

  const s = data?.suggestion;
  if (!s) return null;
  const tone = TONE[s.tone] || TONE.slate;
  const Icon = tone.icon;

  const apply = async () => {
    setBusy(true);
    try {
      await api.post('/api/tasks', {
        title: s.action.title,
        contact_id: contactId,
        due_date: new Date(Date.now() + (s.action.due_hours || 24) * 3600_000).toISOString(),
        priority: s.action.priority || 'normal',
      });
      load();
      onTaskCreated();
    } finally { setBusy(false); }
  };

  return (
    <div
      className="rounded-2xl p-4 mb-4 border animate-slide-up relative overflow-hidden"
      style={{ background: `linear-gradient(135deg, ${tone.color}14, transparent 60%)`, borderColor: `${tone.color}35` }}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center border shrink-0" style={{ background: `${tone.color}1f`, borderColor: `${tone.color}45` }}>
          <Icon size={16} style={{ color: tone.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Sparkles size={11} style={{ color: tone.color }} />
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: tone.color }}>Рекомендация</span>
          </div>
          <div className="text-sm font-semibold text-slate-100 mt-0.5">{s.title}</div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">{s.reason}</p>
          {s.action && hasPerm('tasks.create') && (
            <button
              onClick={apply}
              disabled={busy}
              className="mt-2.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all hover:brightness-125 disabled:opacity-50"
              style={{ background: `${tone.color}22`, borderColor: `${tone.color}50`, color: tone.color }}
            >
              {busy ? 'Создаём…' : `+ ${s.action.title.length > 42 ? 'Создать задачу' : s.action.title}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ageWord(n: number) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'год';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'года';
  return 'лет';
}

function formatSize(bytes: number) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function DocumentsCard({ contactId, onChanged }: { contactId: number; onChanged: () => void }) {
  const { hasPerm } = useAuth();
  const [docs, setDocs] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const canEdit = hasPerm('contacts.edit');

  const load = useCallback(() => {
    api.get(`/api/contacts/${contactId}/documents`).then(d => setDocs(d.documents)).catch(() => setDocs([]));
  }, [contactId]);
  useEffect(() => { load(); }, [load]);

  const upload = async (file: File) => {
    setBusy(true);
    setErr('');
    try {
      await api.upload(`/api/contacts/${contactId}/documents`, file);
      load();
      onChanged(); // обновляем карточку: появляется запись в истории и пересчитывается скоринг
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-slate-500 flex items-center gap-1.5"><Paperclip size={12} /> Документы ({docs?.length || 0})</div>
        {canEdit && (
          <>
            <input ref={fileRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 disabled:opacity-50">
              <Plus size={11} /> {busy ? 'загружаем…' : 'файл'}
            </button>
          </>
        )}
      </div>
      {err && <div className="text-[11px] text-red-300 mb-2">{err}</div>}
      {!docs ? (
        <p className="text-xs text-slate-600">Загрузка…</p>
      ) : docs.length === 0 ? (
        <p className="text-xs text-slate-600">Нет файлов. Загрузите заявление, согласие или копию аттестата — загрузка засчитывается в скоринг.</p>
      ) : (
        <div className="space-y-1">
          {docs.map(d => (
            <div key={d.id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-white/4 group">
              <FileText size={14} className="text-emerald-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-slate-300 truncate" title={d.original_name}>{d.original_name}</div>
                <div className="text-[10px] text-slate-600">{formatSize(d.size)} · {d.created_at?.slice(0, 10)}{d.uploaded_by_name ? ` · ${d.uploaded_by_name}` : ''}</div>
              </div>
              <a
                href={`/api/contacts/documents/${d.id}/download`}
                className="p-1 text-slate-500 hover:text-indigo-300 transition-colors"
                title="Скачать"
              >
                <Download size={13} />
              </a>
              {canEdit && (
                <button
                  onClick={async () => { if (confirm(`Удалить «${d.original_name}»?`)) { await api.del(`/api/contacts/documents/${d.id}`); load(); onChanged(); } }}
                  className="p-1 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                  title="Удалить"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPerm, user } = useAuth();
  const [contact, setContact] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [showTouchpoint, setShowTouchpoint] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const [showDod, setShowDod] = useState(false);
  const [dodEvents, setDodEvents] = useState<any[]>([]);
  const [statuses, setStatuses] = useState<any[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tpForm, setTpForm] = useState({ type: 'call', title: '', description: '', event_date: new Date().toISOString().slice(0, 16) });
  const [taskForm, setTaskForm] = useState({ title: '', due_date: '', assignee_id: '' });
  const [assignees, setAssignees] = useState<any[]>([]);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    api.get(`/api/contacts/${id}`).then(d => { setContact(d.contact); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
    api.get('/api/refs/assignees').then(d => setAssignees(d.users));
    api.get('/api/refs/statuses').then(d => setStatuses(d.statuses));
    api.get('/api/dod-events').then(d => setDodEvents(d.events));
  }, [load]);

  if (loading) return <Spinner />;
  if (!contact) return <EmptyState icon={<AlertTriangle size={40} />} title="Контакт не найден" />;

  const fio = [contact.last_name, contact.first_name, contact.middle_name].filter(Boolean).join(' ');

  const addTouchpoint = async () => {
    try {
      await api.post(`/api/contacts/${id}/touchpoints`, tpForm);
      setShowTouchpoint(false);
      setTpForm({ type: 'call', title: '', description: '', event_date: new Date().toISOString().slice(0, 16) });
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const addTask = async () => {
    try {
      await api.post('/api/tasks', { ...taskForm, contact_id: contact.id, assignee_id: taskForm.assignee_id ? Number(taskForm.assignee_id) : undefined });
      setShowTask(false);
      setTaskForm({ title: '', due_date: '', assignee_id: '' });
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const remove = async () => {
    await api.del(`/api/contacts/${id}`);
    navigate('/contacts');
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-4 flex items-center justify-between">
        <Link to="/contacts" className="text-sm text-slate-400 hover:text-slate-200 flex items-center gap-1.5 transition-colors">
          <ArrowLeft size={15} /> К списку контактов
        </Link>
        <div className="flex gap-2">
          {hasPerm('contacts.edit') && <Button size="sm" variant="default" onClick={() => setShowEdit(true)}><Pencil size={13} /> Редактировать</Button>}
          {hasPerm('contacts.delete') && <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}><Trash2 size={13} /></Button>}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-3">
        {/* Левая колонка: профиль */}
        <div className="space-y-3">
          <Card className="p-5">
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500/30 to-violet-500/20 border border-white/15 flex items-center justify-center text-xl font-bold text-slate-100 shrink-0">
                {(contact.first_name?.[0] || '?')}{contact.last_name?.[0] || ''}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-lg font-bold text-slate-100 leading-tight">{fio}</h1>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <TempBadge temp={contact.temperature} />
                  {hasPerm('contacts.edit') ? (
                    <select
                      value={contact.status_id || ''}
                      onChange={async e => { await api.patch(`/api/contacts/${contact.id}`, { status_id: Number(e.target.value) }); load(); }}
                      className="text-[11px] font-medium px-2 py-0.5 rounded-lg outline-none cursor-pointer appearance-none transition-all hover:brightness-125"
                      style={{ background: `${contact.status_color || '#6366f1'}22`, color: contact.status_color || '#6366f1', border: `1px solid ${contact.status_color || '#6366f1'}44` }}
                    >
                      {statuses.map(s => <option key={s.id} value={s.id} style={{ background: '#0f172a', color: '#e2e8f0' }}>{s.name}</option>)}
                    </select>
                  ) : (
                    contact.status_name && <Badge color={contact.status_color}>{contact.status_name}</Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Быстрые действия */}
            {hasPerm('dod.manage') && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setShowDod(true)}
                  className="flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-xl bg-violet-500/15 border border-violet-400/30 text-violet-300 hover:bg-violet-500/25 transition-all"
                >
                  Отметить ДОД
                </button>
                <a
                  href={contact.phone ? `tel:${contact.phone}` : undefined}
                  className={`flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-xl border transition-all ${contact.phone ? 'bg-blue-500/12 border-blue-400/30 text-blue-300 hover:bg-blue-500/22' : 'bg-white/3 border-white/8 text-slate-600 pointer-events-none'}`}
                >
                  Позвонить
                </a>
              </div>
            )}

            {/* Скоринг-метер */}
            <div className="mt-4 p-3 rounded-xl bg-white/3 border border-white/8">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-slate-500 flex items-center gap-1"><Flame size={12} style={{ color: scoreColor(contact.score) }} /> Скоринг потенциала</span>
                <span className="text-lg font-bold font-mono" style={{ color: scoreColor(contact.score) }}>{contact.score}</span>
              </div>
              <div className="h-2 bg-white/6 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.min(100, (contact.score / 120) * 100)}%`,
                    background: `linear-gradient(90deg, #38bdf8, #fbbf24, #f87171)`,
                  }}
                />
              </div>
              {resolveRole(contact).role === 'parent' && (
                <div className="text-[10px] text-slate-600 mt-1.5">Для родителей баллы не начисляются — скоринг ведём по детям</div>
              )}
            </div>

            <div className="mt-4 space-y-2 text-sm">
              {contact.phone && <div className="flex items-center gap-2.5 text-slate-300"><Phone size={14} className="text-slate-500" /> {contact.phone}</div>}
              {contact.email && <div className="flex items-center gap-2.5 text-slate-300"><Mail size={14} className="text-slate-500" /> {contact.email}</div>}
              {contact.city && <div className="flex items-center gap-2.5 text-slate-300"><MapPin size={14} className="text-slate-500" /> {contact.city}</div>}
              {contact.school && <div className="flex items-center gap-2.5 text-slate-300"><School size={14} className="text-slate-500" /> {contact.school}</div>}
              {contact.grade && <div className="flex items-center gap-2.5 text-slate-300"><GraduationCap size={14} className="text-slate-500" /> {contact.grade}</div>}
              {contact.birth_date && <div className="flex items-center gap-2.5 text-slate-300"><Calendar size={14} className="text-slate-500" /> {new Date(contact.birth_date).toLocaleDateString('ru-RU')}</div>}
              {(() => {
                const ri = resolveRole(contact);
                const meta = ROLE_META[ri.role];
                if (ri.role === 'unknown' && !ri.suspicious && !hasPerm('contacts.edit')) return null;
                return (
                  <div className="flex items-center gap-2 text-slate-300">
                    <Users size={14} className="text-slate-500 shrink-0" />
                    <span className="font-medium" style={{ color: meta.color }}>{meta.label}</span>
                    {ri.age !== null && <span className="text-slate-500 text-xs">· {ri.age} {ageWord(ri.age)}</span>}
                    {ri.manual && <span className="text-[10px] text-slate-600">(вручную)</span>}
                    {ri.suspicious && <span className="text-[10px] text-amber-400">проверьте дату рождения</span>}
                  </div>
                );
              })()}
              {hasPerm('contacts.edit') && (
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-slate-600">Роль:</span>
                  <select
                    value={contact.contact_role || ''}
                    onChange={async e => { await api.patch(`/api/contacts/${contact.id}`, { contact_role: e.target.value }); load(); }}
                    className="bg-white/4 border border-white/10 rounded-lg px-2 py-1 text-slate-300 outline-none [&>option]:bg-slate-900"
                  >
                    <option value="">авто (по дате рождения)</option>
                    <option value="child">школьник</option>
                    <option value="adult">взрослый</option>
                    <option value="parent">родитель</option>
                  </select>
                </div>
              )}
            </div>

            {(contact.source || contact.ege_score || contact.owner_name) && (
              <div className="mt-4 pt-3 border-t border-white/8 space-y-1.5 text-xs text-slate-500">
                {contact.source && <div>Источник: <span className="text-slate-300">{contact.source}</span></div>}
                {contact.ege_score && <div>Балл ЕГЭ: <span className="text-slate-300 font-semibold">{contact.ege_score}</span></div>}
                {contact.owner_name && <div>Ответственный: <span className="text-slate-300">{contact.owner_name}</span></div>}
                <div>В базе с: <span className="text-slate-300">{contact.created_at?.slice(0, 10)}</span></div>
              </div>
            )}
          </Card>

          {/* Направления */}
          {contact.programs?.length > 0 && (
            <Card className="p-4">
              <div className="text-xs text-slate-500 mb-2">Направления интереса</div>
              <div className="flex flex-wrap gap-1.5">
                {contact.programs.map((p: any) => <Badge key={p.id} color={p.color}>{p.name}</Badge>)}
              </div>
            </Card>
          )}

          {/* Кастомные поля */}
          {contact.custom_values?.filter((cv: any) => cv.value).length > 0 && (
            <Card className="p-4">
              <div className="text-xs text-slate-500 mb-2">Дополнительно</div>
              <div className="space-y-1.5 text-xs">
                {contact.custom_values.filter((cv: any) => cv.value).map((cv: any) => (
                  <div key={cv.field_id} className="flex justify-between gap-2">
                    <span className="text-slate-500">{cv.name}</span>
                    <span className="text-slate-300 text-right">{cv.value}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Документы */}
          <DocumentsCard contactId={contact.id} onChanged={load} />

          {/* Задачи контакта */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-slate-500">Задачи ({contact.tasks?.filter((t: any) => t.status === 'open').length || 0} открытых)</div>
              {hasPerm('tasks.create') && (
                <button onClick={() => setShowTask(true)} className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
                  <Plus size={11} /> задача
                </button>
              )}
            </div>
            {(!contact.tasks || contact.tasks.length === 0) ? (
              <p className="text-xs text-slate-600">Задач нет</p>
            ) : (
              <div className="space-y-1.5">
                {contact.tasks.slice(0, 5).map((t: any) => (
                  <div key={t.id} className="flex items-center gap-2 text-xs">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.status === 'done' ? 'bg-emerald-400' : t.due_date && t.due_date < new Date().toISOString() ? 'bg-red-400' : 'bg-amber-400'}`} />
                    <span className={`flex-1 truncate ${t.status === 'done' ? 'text-slate-600 line-through' : 'text-slate-300'}`}>{t.title}</span>
                    {t.due_date && <span className="text-slate-600">{t.due_date.slice(5, 10)}</span>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Правая колонка: рекомендация + история касаний */}
        <div className="lg:col-span-2">
          <NextActionCard contactId={contact.id} onTaskCreated={load} />
          <Card className="p-5">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-semibold text-slate-200">История касаний</h2>
            {hasPerm('contacts.edit') && (
              <Button size="sm" variant="primary" onClick={() => setShowTouchpoint(true)}><Plus size={13} /> Добавить событие</Button>
            )}
          </div>

          {contact.touchpoints?.length === 0 ? (
            <EmptyState icon={<Phone size={36} />} title="История пуста" hint="Добавьте первое касание: звонок, письмо или отметьте посещение ДОД" />
          ) : (
            <div className="relative">
              <div className="absolute left-[17px] top-2 bottom-2 w-px bg-gradient-to-b from-indigo-500/40 via-white/10 to-transparent" />
              <div className="space-y-4">
                {contact.touchpoints.map((tp: any, i: number) => {
                  const conf = TOUCHPOINT_TYPES[tp.type] || TOUCHPOINT_TYPES.other;
                  return (
                    <div key={tp.id} className="flex gap-4 animate-slide-up" style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}>
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0 border relative z-10"
                        style={{ background: `${conf.color}20`, borderColor: `${conf.color}50` }}
                      >
                        {conf.icon}
                      </div>
                      <div className="flex-1 min-w-0 pb-4">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-slate-200">{tp.title}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[11px] text-slate-500">{new Date(tp.event_date).toLocaleDateString('ru-RU')}</span>
                            {hasPerm('contacts.edit') && (tp.created_by === user?.id || hasPerm('contacts.delete')) && (
                              <button
                                onClick={async () => { if (confirm('Удалить запись?')) { await api.del(`/api/contacts/touchpoints/${tp.id}`); load(); } }}
                                className="text-slate-600 hover:text-red-400 transition-colors"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                        {tp.description && <p className="text-xs text-slate-400 mt-1 whitespace-pre-wrap">{tp.description}</p>}
                        <div className="text-[10px] text-slate-600 mt-1">
                          {conf.label}{tp.created_by_name ? ` · ${tp.created_by_name}` : ''}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          </Card>
        </div>
      </div>

      {/* Модалки */}
      <Modal open={showDod} onClose={() => setShowDod(false)} title="Отметить посещение ДОД">
        <div className="space-y-2">
          {dodEvents.length === 0 && <p className="text-xs text-slate-500">Мероприятий нет — создайте в разделе «ДОД»</p>}
          {dodEvents.map(d => {
            const attended = contact.touchpoints?.some((t: any) => t.type === 'dod' && t.dod_event_id === d.id);
            return (
              <div key={d.id} className="flex items-center gap-3 glass rounded-xl px-3.5 py-2.5">
                <GraduationCap size={18} className="text-violet-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-200 truncate">{d.name}</div>
                  <div className="text-[11px] text-slate-500">{new Date(d.event_date).toLocaleDateString('ru-RU')}</div>
                </div>
                {attended ? (
                  <span className="text-xs text-emerald-400 flex items-center gap-1">Посещал</span>
                ) : (
                  <Button size="sm" variant="primary" onClick={async () => {
                    await api.post(`/api/dod-events/${d.id}/attend`, { contact_id: contact.id }).catch(e => setErr(e.message));
                    load();
                  }}>Отметить</Button>
                )}
              </div>
            );
          })}
        </div>
      </Modal>

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Редактировать контакт" width="max-w-2xl">
        <ContactForm initial={contact} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); load(); }} />
      </Modal>

      <Modal open={showTouchpoint} onClose={() => setShowTouchpoint(false)} title="Новое событие в истории">
        <div className="space-y-3">
          {err && <div className="text-red-300 text-xs bg-red-500/10 border border-red-400/25 rounded-xl px-3 py-2">{err}</div>}
          <Field label="Тип события">
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(TOUCHPOINT_TYPES).map(([key, conf]) => (
                <button
                  key={key}
                  onClick={() => setTpForm(f => ({ ...f, type: key, title: f.title || (key === 'dod' ? '' : conf.label) }))}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl border text-xs transition-all text-left"
                  style={tpForm.type === key
                    ? { background: `${conf.color}25`, borderColor: `${conf.color}60`, color: '#e2e8f0' }
                    : { borderColor: 'rgba(255,255,255,0.08)', color: '#94a3b8' }}
                >
                  <span>{conf.icon}</span> {conf.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Заголовок"><Input value={tpForm.title} onChange={e => setTpForm(f => ({ ...f, title: e.target.value }))} placeholder="Например: Позвонил, рассказал о направлениях" /></Field>
          <Field label="Описание"><Textarea rows={3} value={tpForm.description} onChange={e => setTpForm(f => ({ ...f, description: e.target.value }))} /></Field>
          <Field label="Дата события"><Input type="datetime-local" value={tpForm.event_date} onChange={e => setTpForm(f => ({ ...f, event_date: e.target.value }))} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowTouchpoint(false)}>Отмена</Button>
            <Button variant="primary" onClick={addTouchpoint} disabled={!tpForm.title.trim()}>Добавить</Button>
          </div>
        </div>
      </Modal>

      <Modal open={showTask} onClose={() => setShowTask(false)} title="Новая задача">
        <div className="space-y-3">
          <Field label="Что нужно сделать"><Input autoFocus value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} placeholder="Например: Перезвонить" /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Дедлайн"><Input type="datetime-local" value={taskForm.due_date} onChange={e => setTaskForm(f => ({ ...f, due_date: e.target.value }))} /></Field>
            <Field label="Ответственный">
              <Select value={taskForm.assignee_id} onChange={e => setTaskForm(f => ({ ...f, assignee_id: e.target.value }))}>
                <option value="">Я сам</option>
                {assignees.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowTask(false)}>Отмена</Button>
            <Button variant="primary" onClick={addTask} disabled={!taskForm.title.trim()}>Создать задачу</Button>
          </div>
        </div>
      </Modal>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Удалить контакт?">
        <p className="text-sm text-slate-400 mb-4">
          Карточка «{fio}» будет удалена вместе со всей историей и задачами. Действие необратимо.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Отмена</Button>
          <Button variant="danger" onClick={remove}>Удалить навсегда</Button>
        </div>
      </Modal>
    </div>
  );
}
