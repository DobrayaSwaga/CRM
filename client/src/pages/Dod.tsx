import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, Plus, MapPin, Users, Upload, Trash2, X, CalendarRange, Copy, Send, Check, Mail } from 'lucide-react';
import { api, copyText } from '../api';
import { useAuth } from '../auth';
import { Card, Button, Input, Textarea, Spinner, EmptyState, Modal, Field, TempBadge, Badge } from '../components/ui';
import { PageHeader } from '../components/Layout';

export default function Dod() {
  const { hasPerm } = useAuth();
  const [events, setEvents] = useState<any[] | null>(null);
  const [selected, setSelected] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', event_date: '', location: '', description: '' });
  const [showImport, setShowImport] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [showPlanImport, setShowPlanImport] = useState(false);
  const [planResult, setPlanResult] = useState<any>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(0);

  // Почты всех участников мероприятия (посетившие + зарегистрированные), без дублей
  const emailsOf = (ev: any): string[] =>
    [...new Set([...(ev?.attendees || []), ...(ev?.registrations || [])].map((a: any) => a.email?.trim()).filter(Boolean))];
  const copyMailing = async (thenOpen = false) => {
    const emails = emailsOf(selected);
    if (!emails.length) return;
    if (await copyText(emails.join('; '))) {
      setCopied(emails.length);
      setTimeout(() => setCopied(0), 3000);
    }
    if (thenOpen) window.open('https://mail.yandex.ru/compose', '_blank');
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const planFileRef = useRef<HTMLInputElement>(null);
  const canManage = hasPerm('dod.manage');

  const load = useCallback(() => {
    api.get('/api/dod-events').then(d => setEvents(d.events));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEvent = async (id: number) => {
    const d = await api.get(`/api/dod-events/${id}`);
    setSelected(d.event);
  };

  const create = async () => {
    await api.post('/api/dod-events', form);
    setShowCreate(false);
    setForm({ name: '', event_date: '', location: '', description: '' });
    load();
  };

  const importAttendance = async (file: File) => {
    setBusy(true);
    setImportResult(null);
    try {
      const res = await api.upload(`/api/import/attendance/${selected.id}`, file);
      setImportResult(res);
      openEvent(selected.id);
      load();
    } catch (e: any) {
      setImportResult({ error: e.message });
    } finally {
      setBusy(false);
    }
  };

  const importPlan = async (file: File) => {
    setPlanBusy(true);
    setPlanResult(null);
    try {
      const res = await api.upload('/api/dod-events/import-plan', file);
      setPlanResult(res);
      load();
    } catch (e: any) {
      setPlanResult({ error: e.message });
    } finally {
      setPlanBusy(false);
    }
  };

  if (!events) return <Spinner />;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Дни открытых дверей" subtitle="Мероприятия и посещаемость — главный сигнал скоринга">
        {canManage && <Button variant="default" size="sm" onClick={() => { setShowPlanImport(true); setPlanResult(null); }}><CalendarRange size={14} /> Импорт плана (Excel)</Button>}
        {canManage && <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}><Plus size={14} /> Мероприятие</Button>}
      </PageHeader>

      {events.length === 0 ? (
        <Card><EmptyState icon={<GraduationCap size={40} />} title="Мероприятий нет" hint="Создайте первый ДОД, а после загрузите список посетителей из Excel — система сама пересчитает баллы" /></Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {events.map(e => {
            const isPast = e.event_date < new Date().toISOString();
            return (
              <Card key={e.id} hover className="p-4" onClick={() => openEvent(e.id)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500/30 to-purple-500/20 border border-violet-400/30 flex items-center justify-center shrink-0">
                    <GraduationCap size={20} className="text-violet-300" />
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-lg border ${isPast ? 'bg-white/4 border-white/10 text-slate-500' : 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'}`}>
                    {isPast ? 'Прошёл' : 'Предстоит'}
                  </span>
                </div>
                <h3 className="font-semibold text-slate-200 mt-3">{e.name}</h3>
                <div className="text-xs text-slate-500 mt-1">
                  {new Date(e.event_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                  {e.location && <> · <MapPin size={10} className="inline" /> {e.location}</>}
                </div>
                <div className="flex items-center gap-1.5 mt-3 text-xs text-slate-400">
                  <Users size={13} className="text-violet-400" />
                  <span className="font-semibold text-slate-200">{e.attendees_count}</span> посетителей
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Импорт плана мероприятий */}
      <Modal open={showPlanImport} onClose={() => setShowPlanImport(false)} title="Импорт плана мероприятий">
        <div className="space-y-3">
          <div className="text-xs text-slate-400 leading-relaxed">
            Excel с колонками «Дата», «Время», «Название» (плюс необязательные «Формат», «Этап», «Программа», «Направление»).
            Колонки определяются автоматически, повторы «та же дата + название» пропускаются.
          </div>
          <input ref={planFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importPlan(f); e.target.value = ''; }} />
          <div
            className="p-6 rounded-xl border border-dashed border-white/15 text-center cursor-pointer hover:border-cyan-400/40 transition-all"
            onClick={() => planFileRef.current?.click()}
          >
            <CalendarRange size={22} className="text-cyan-300 mx-auto mb-2" />
            <div className="text-xs text-slate-400">{planBusy ? 'Загружаем события…' : 'Выбрать файл плана'}</div>
          </div>
          {planResult && !planResult.error && (
            <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-400/25 rounded-lg px-3 py-2">
              Готово. Создано событий: {planResult.created} из {planResult.total}
              {planResult.skipped > 0 && ` · пропущено (дубли/пустые): ${planResult.skipped}`}
              {planResult.errors > 0 && ` · ошибок: ${planResult.errors}`}
            </div>
          )}
          {planResult?.error && (
            <div className="text-xs text-red-300 bg-red-500/10 border border-red-400/25 rounded-lg px-3 py-2">{planResult.error}</div>
          )}
        </div>
      </Modal>

      {/* Создание */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Новое мероприятие ДОД">
        <div className="space-y-3">
          <Field label="Название"><Input autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="ДОД Института информационных технологий" /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Дата и время"><Input type="datetime-local" value={form.event_date} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))} /></Field>
            <Field label="Место"><Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Актовый зал / онлайн" /></Field>
          </div>
          <Field label="Описание"><Textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Отмена</Button>
            <Button variant="primary" onClick={create} disabled={!form.name.trim() || !form.event_date}>Создать</Button>
          </div>
        </div>
      </Modal>

      {/* Детали мероприятия */}
      <Modal open={!!selected} onClose={() => { setSelected(null); setImportResult(null); setCopied(0); }} title={selected?.name || ''} width="max-w-2xl">
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span>{new Date(selected.event_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</span>
              {selected.location && <span className="flex items-center gap-1"><MapPin size={11} /> {selected.location}</span>}
              <span className="flex items-center gap-1"><Users size={11} /> {selected.attendees.length} посетителей{(selected.registrations?.length || 0) > 0 && ` + ${selected.registrations.length} регистраций`}</span>
            </div>

            {canManage && (
              <div className="flex gap-2">
                <Button size="sm" variant="primary" onClick={() => { setShowImport(true); setImportResult(null); }}>
                  <Upload size={13} /> Загрузить список посетителей (Excel)
                </Button>
                <Button size="sm" variant="danger" onClick={async () => {
                  if (confirm('Удалить мероприятие и все отметки о посещении?')) {
                    await api.del(`/api/dod-events/${selected.id}`);
                    setSelected(null);
                    load();
                  }
                }}><Trash2 size={13} /></Button>
              </div>
            )}

            {showImport && (
              <div className="p-4 rounded-xl bg-white/3 border border-white/10 animate-fade-in">
                <div className="text-xs text-slate-400 mb-2">
                  «Экспорт заявок» с мероприятия или любой список с колонками «Телефон»/«ФИО».
                  Статусы билетов учитываются: «Посетил» — проставим посещение, «Зарегистрирован» — отметим регистрацию.
                </div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importAttendance(f); e.target.value = ''; }} />
                <Button size="sm" variant="default" onClick={() => fileRef.current?.click()} disabled={busy}>
                  {busy ? 'Обрабатываем…' : 'Выбрать файл'}
                </Button>
                {importResult && !importResult.error && (
                  <div className="mt-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-400/25 rounded-lg px-3 py-2">
                    Готово. Посещений: {importResult.visited} · регистраций: {importResult.registered} · новых карточек: {importResult.created} · найдено в базе: {importResult.matched}
                    {importResult.already > 0 && ` · уже отмечены: ${importResult.already}`}
                    {importResult.skipped > 0 && ` · пропущено: ${importResult.skipped}`}
                  </div>
                )}
                {importResult?.error && (
                  <div className="mt-2 text-xs text-red-300 bg-red-500/10 border border-red-400/25 rounded-lg px-3 py-2">{importResult.error}</div>
                )}
              </div>
            )}

            {/* Массовая рассылка участникам */}
            {emailsOf(selected).length > 0 && (
              <div className="p-3 rounded-xl bg-sky-500/8 border border-sky-400/25">
                <div className="flex flex-wrap items-center gap-2">
                  <Mail size={14} className="text-sky-300 shrink-0" />
                  <span className="text-xs text-slate-400 flex-1 min-w-40">
                    Рассылка: у <b className="text-slate-200">{emailsOf(selected).length}</b> участников есть email
                  </span>
                  <Button size="sm" variant="default" onClick={() => copyMailing(false)}>
                    {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? `Скопировано: ${copied}` : 'Скопировать адреса'}
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => copyMailing(true)}>
                    <Send size={13} /> Яндекс.Почта
                  </Button>
                </div>
                <p className="text-[10px] text-slate-600 mt-1.5">
                  Адреса копируются через «;» — откроется новое письмо, вставьте их в поле «Кому» или «Скрытая копия».
                </p>
              </div>
            )}

            <div>
              <div className="text-xs text-slate-500 mb-2">Посетители:</div>
              {selected.attendees.length === 0 ? (
                <p className="text-xs text-slate-600">Пока никто не отмечен</p>
              ) : (
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  {selected.attendees.map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg hover:bg-white/4 group">
                      <Link to={`/contacts/${a.id}`} className="text-sm text-slate-200 hover:text-indigo-300 transition-colors flex-1 truncate">
                        {a.last_name} {a.first_name} {a.middle_name}
                        <span className="text-slate-600 text-xs ml-2">{a.phone}</span>
                      </Link>
                      <div className="flex items-center gap-1.5">
                        {a.status_name && <Badge color="#64748b">{a.status_name}</Badge>}
                        <TempBadge temp={a.temperature} size="sm" />
                        {canManage && (
                          <button
                            onClick={async () => { await api.del(`/api/dod-events/${selected.id}/attend/${a.id}`); openEvent(selected.id); load(); }}
                            className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Зарегистрировались, но не дошли */}
            {(selected.registrations?.length || 0) > 0 && (
              <div>
                <div className="text-xs text-slate-500 mb-2">Зарегистрировались, но не пришли ({selected.registrations.length}):</div>
                <div className="space-y-1 max-h-44 overflow-y-auto">
                  {selected.registrations.map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg hover:bg-white/4">
                      <Link to={`/contacts/${a.id}`} className="text-sm text-slate-300 hover:text-indigo-300 transition-colors flex-1 truncate">
                        {a.last_name} {a.first_name} {a.middle_name}
                        <span className="text-slate-600 text-xs ml-2">{a.phone}</span>
                      </Link>
                      <TempBadge temp={a.temperature} size="sm" />
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-slate-600 mt-1.5">Этим людям стоит позвонить или написать — они уже проявляли интерес.</p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
