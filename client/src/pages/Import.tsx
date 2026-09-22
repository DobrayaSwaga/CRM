import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, FileSpreadsheet, ArrowRight, ArrowLeft, Check, AlertTriangle, History, GitMerge, GraduationCap, CalendarRange } from 'lucide-react';
import { api } from '../api';
import { Card, Button, Spinner, Badge } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { useAuth } from '../auth';

type Detected = {
  kind: 'contacts' | 'event_attendance' | 'event_plan';
  summary?: string; eventName?: string; eventDate?: string; eventTime?: string;
  visited?: number; registered?: number; totalEvents?: number;
};

type Preview = {
  fileKey: string; filename: string; headers: string[]; sample: any[]; totalRows: number;
  guessedMapping: Record<number, string>; fields: { key: string; label: string }[];
  customFields: { id: number; name: string }[];
  suggestedSource?: string; detected?: Detected;
};

export default function ImportPage() {
  const { hasPerm } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fileObj, setFileObj] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [defaultSource, setDefaultSource] = useState('');
  const [result, setResult] = useState<any>(null); // { mode: 'contacts' | 'attendance' | 'plan', ... }
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadHistory = () => api.get('/api/import/history').then(d => setHistory(d.imports)).catch(() => {});
  useEffect(() => { loadHistory(); }, []);

  const uploadFile = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      const p = await api.upload<Preview>('/api/import/preview', file);
      setPreview(p);
      setFileObj(file);
      setMapping(p.guessedMapping);
      setDefaultSource(p.suggestedSource || '');
      setStep(2);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/api/import/execute', { fileKey: preview.fileKey, mapping, defaultSource, sourceLabel: defaultSource });
      setResult({ mode: 'contacts', ...res });
      setStep(3);
      loadHistory();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const importAttendance = async () => {
    if (!fileObj) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.upload('/api/import/attendance', fileObj);
      setResult({ mode: 'attendance', ...res });
      setStep(3);
      loadHistory();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const importPlan = async () => {
    if (!fileObj) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.upload('/api/dod-events/import-plan', fileObj);
      setResult({ mode: 'plan', ...res });
      setStep(3);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => { setStep(1); setPreview(null); setFileObj(null); setResult(null); setError(''); };

  const allFields = preview ? [
    ...preview.fields,
    ...preview.customFields.map(cf => ({ key: `cf_${cf.id}`, label: `★ ${cf.name} (своё поле)` })),
  ] : [];

  const usedKeys = new Set(Object.values(mapping).filter(Boolean));
  const detected = preview?.detected;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Импорт из Excel" subtitle="Загрузите таблицу — система сама определит колонки, создаст карточки и найдёт дубли" />

      {/* Шаги */}
      <div className="flex items-center gap-2 mb-5">
        {[
          { n: 1, label: 'Файл' },
          { n: 2, label: 'Проверка и сопоставление' },
          { n: 3, label: 'Результат' },
        ].map((s, i) => (
          <div key={s.n} className="flex items-center gap-2">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all ${
              step === s.n ? 'bg-indigo-500/20 border-indigo-400/40 text-indigo-300' :
              step > s.n ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-300' : 'border-white/10 text-slate-500'
            }`}>
              {step > s.n ? <Check size={12} /> : <span>{s.n}</span>}
              {s.label}
            </div>
            {i < 2 && <ArrowRight size={12} className="text-slate-600" />}
          </div>
        ))}
      </div>

      {error && <div className="text-red-300 text-sm bg-red-500/10 border border-red-400/25 rounded-xl px-4 py-3 mb-4 flex items-center gap-2"><AlertTriangle size={15} /> {error}</div>}

      {/* Шаг 1: загрузка */}
      {step === 1 && (
        <div className="grid lg:grid-cols-2 gap-3">
          <Card
            className="p-10 border-dashed !border-white/15 flex flex-col items-center justify-center text-center cursor-pointer hover:!border-indigo-400/40 transition-all min-h-64"
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) uploadFile(f); }}
          >
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ''; }} />
            <div className="w-16 h-16 rounded-2xl bg-indigo-500/15 border border-indigo-400/25 flex items-center justify-center mb-4">
              {busy ? <Spinner /> : <Upload size={26} className="text-indigo-400" />}
            </div>
            <p className="text-slate-300 font-medium">{busy ? 'Анализируем файл…' : 'Перетащите Excel-файл сюда'}</p>
            <p className="text-slate-500 text-xs mt-1">или нажмите, чтобы выбрать · форматы .xlsx, .xls, .csv · до 20 МБ</p>
            <div className="mt-4 text-[11px] text-slate-600 max-w-sm space-y-1">
              <p>Распознаются автоматически:</p>
              <p>· списки людей — колонки «ФИО», «Телефон», «Email», «Класс», «Образовательная организация» и другие;</p>
              <p>· выгрузки «Экспорт заявок» с мероприятий — статусы «Посетил» и «Зарегистрирован» проставят посещения;</p>
              <p>· планы мероприятий «Дата + Название + Время» — попадут сразу в календарь.</p>
            </div>
          </Card>

          {/* История */}
          <Card className="p-5">
            <h3 className="font-semibold text-slate-200 flex items-center gap-2 mb-3"><History size={15} className="text-slate-400" /> История загрузок</h3>
            {history.length === 0 ? (
              <p className="text-xs text-slate-600">Пока ничего не загружали</p>
            ) : (
              <div className="space-y-2">
                {history.slice(0, 8).map(h => (
                  <div key={h.id} className="flex items-center justify-between gap-2 text-xs py-1.5 border-b border-white/4 last:border-0">
                    <div className="min-w-0">
                      <div className="text-slate-300 truncate flex items-center gap-1.5">
                        <FileSpreadsheet size={11} className="text-emerald-400 shrink-0" /> {h.filename}
                        {h.kind === 'attendance' && <Badge color="#8b5cf6">посещения</Badge>}
                      </div>
                      <div className="text-slate-600 mt-0.5">{h.created_at.slice(0, 16).replace('T', ' ')} · {h.user_name}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge color="#10b981">{h.imported} новых</Badge>
                      {h.pending_duplicates > 0 && (
                        <Link to="/duplicates">
                          <Badge color="#f59e0b"><GitMerge size={9} /> {h.pending_duplicates} дубля</Badge>
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Шаг 2: маппинг + автодействия */}
      {step === 2 && preview && (
        <div className="space-y-3">
          <Card className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileSpreadsheet size={18} className="text-emerald-400" />
              <div>
                <div className="text-sm font-medium text-slate-200">{preview.filename}</div>
                <div className="text-xs text-slate-500">{preview.totalRows} строк данных</div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={reset}><ArrowLeft size={13} /> Другой файл</Button>
          </Card>

          {/* Распознана выгрузка посетителей мероприятия */}
          {detected?.kind === 'event_attendance' && (
            <Card className="p-5 border !border-violet-400/30" style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.12), transparent 60%)' }}>
              <div className="flex flex-wrap items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-violet-500/20 border border-violet-400/30 flex items-center justify-center shrink-0">
                  <GraduationCap size={22} className="text-violet-300" />
                </div>
                <div className="flex-1 min-w-56">
                  <div className="text-sm font-semibold text-slate-100">Это выгрузка участников мероприятия</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {detected.summary && <span className="text-violet-300 font-medium">{detected.summary}</span>}
                    {detected.eventTime && <span> в {detected.eventTime}</span>}
                    {(detected.visited || detected.registered) ? (
                      <span> · посетили: <b className="text-emerald-300">{detected.visited}</b>, только зарегистрировались: <b className="text-sky-300">{detected.registered}</b></span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Система найдёт событие в календаре (или создаст его), сопоставит людей по телефону и проставит посещения посетившим.
                  </div>
                </div>
                <Button variant="primary" onClick={importAttendance} disabled={busy}>
                  {busy ? 'Обрабатываем…' : <><GraduationCap size={14} /> Импортировать посещения</>}
                </Button>
              </div>
            </Card>
          )}

          {/* Распознан план мероприятий */}
          {detected?.kind === 'event_plan' && (
            <Card className="p-5 border !border-cyan-400/30" style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.12), transparent 60%)' }}>
              <div className="flex flex-wrap items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/20 border border-cyan-400/30 flex items-center justify-center shrink-0">
                  <CalendarRange size={22} className="text-cyan-300" />
                </div>
                <div className="flex-1 min-w-56">
                  <div className="text-sm font-semibold text-slate-100">Это план мероприятий</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Найдено событий: <b className="text-cyan-300">{detected.totalEvents}</b>. Все попадут в раздел «ДОД» и в календарь с датами и временем.
                  </div>
                </div>
                <Button variant="primary" onClick={importPlan} disabled={busy}>
                  {busy ? 'Загружаем…' : <><CalendarRange size={14} /> Загрузить в календарь</>}
                </Button>
              </div>
            </Card>
          )}

          <div className="text-[11px] text-slate-600 px-1">
            {detected?.kind === 'contacts'
              ? 'Колонки сопоставлены автоматически — проверьте и скорректируйте при необходимости.'
              : 'Если нужен обычный импорт людей без посещений — используйте сопоставление ниже.'}
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/8 bg-white/2">
                    {preview.headers.map((h, i) => (
                      <th key={i} className="px-3 py-3 text-left min-w-44">
                        <div className="text-[11px] text-slate-400 mb-1.5 truncate font-semibold" title={h}>{h || `Колонка ${i + 1}`}</div>
                        <select
                          value={mapping[i] ?? 'ignore'}
                          onChange={e => {
                            const v = e.target.value;
                            setMapping(m => {
                              const next = { ...m };
                              // убираем этот ключ у других колонок
                              if (v !== 'ignore' && !v.startsWith('cf_')) {
                                for (const k of Object.keys(next)) if (next[Number(k)] === v) delete next[Number(k)];
                              }
                              if (v === 'ignore') delete next[i]; else next[i] = v;
                              return next;
                            });
                          }}
                          className="w-full bg-white/4 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-200 outline-none [&>option]:bg-slate-900"
                        >
                          {allFields.map(f => (
                            <option key={f.key} value={f.key} disabled={usedKeys.has(f.key) && mapping[i] !== f.key && !f.key.startsWith('cf_')}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((row, ri) => (
                    <tr key={ri} className="border-b border-white/4">
                      {preview.headers.map((_, ci) => (
                        <td key={ci} className={`px-3 py-2 text-xs truncate max-w-48 ${mapping[ci] && mapping[ci] !== 'ignore' ? 'text-slate-200' : 'text-slate-600'}`}>
                          {String(row[ci] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-64">
              <span className="text-xs text-slate-500 shrink-0">Источник (откуда выгружен список):</span>
              <input
                value={defaultSource}
                onChange={e => setDefaultSource(e.target.value)}
                placeholder="Например: Ярмарка 18.09"
                className="flex-1 bg-white/4 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-400/50"
              />
            </div>
            <Button variant="ghost" size="sm" onClick={reset}><ArrowLeft size={13} /> Назад</Button>
            <Button variant="primary" onClick={execute} disabled={busy}>
              {busy ? 'Импортируем…' : <>Импортировать {preview.totalRows} строк <ArrowRight size={13} /></>}
            </Button>
          </Card>
        </div>
      )}

      {/* Шаг 3: результат */}
      {step === 3 && result?.mode === 'contacts' && (
        <div className="grid lg:grid-cols-2 gap-3">
          <Card className="p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center mx-auto mb-4">
              <Check size={28} className="text-emerald-400" />
            </div>
            <h3 className="text-lg font-bold text-slate-100">Импорт завершён</h3>
            <div className="grid grid-cols-3 gap-3 mt-6">
              <div className="p-3 rounded-xl bg-emerald-500/8 border border-emerald-400/20">
                <div className="text-2xl font-bold text-emerald-300">{result.imported}</div>
                <div className="text-[11px] text-slate-500">новых карточек</div>
              </div>
              <div className="p-3 rounded-xl bg-amber-500/8 border border-amber-400/20">
                <div className="text-2xl font-bold text-amber-300">{result.duplicates}</div>
                <div className="text-[11px] text-slate-500">возможных дублей</div>
              </div>
              <div className="p-3 rounded-xl bg-white/3 border border-white/10">
                <div className="text-2xl font-bold text-slate-400">{result.errors}</div>
                <div className="text-[11px] text-slate-500">пропущено строк</div>
              </div>
            </div>
            <div className="flex justify-center gap-2 mt-6">
              <Button variant="default" onClick={reset}>Загрузить ещё</Button>
              {result.duplicates > 0 && hasPerm('import.merge') && (
                <Link to="/duplicates"><Button variant="primary"><GitMerge size={14} /> Разобрать дубли</Button></Link>
              )}
              <Link to="/contacts"><Button variant="default">К контактам</Button></Link>
            </div>
          </Card>
          <Card className="p-5 text-xs text-slate-500 leading-relaxed">
            <h4 className="text-sm font-semibold text-slate-300 mb-2">Что произошло:</h4>
            <ul className="space-y-1.5 list-disc list-inside">
              <li>Для каждой строки создана карточка контакта со статусом «Новый»</li>
              <li>Совпадения по номеру телефона <b className="text-slate-300">не создавались повторно</b> — они ждут вашего решения в разделе «Дубли»</li>
              <li>Направления из таблицы добавлены в справочник и привязаны к людям</li>
              <li>Баллы скоринга пересчитаны автоматически — загляните на дашборд</li>
            </ul>
          </Card>
        </div>
      )}

      {step === 3 && result?.mode === 'attendance' && (
        <Card className="p-8 max-w-2xl mx-auto text-center">
          <div className="w-16 h-16 rounded-2xl bg-violet-500/15 border border-violet-400/30 flex items-center justify-center mx-auto mb-4">
            <GraduationCap size={28} className="text-violet-300" />
          </div>
          <h3 className="text-lg font-bold text-slate-100">Посещения загружены</h3>
          <p className="text-sm text-slate-400 mt-1">
            Мероприятие: <b className="text-violet-300">{result.event?.name}</b>
            {result.event?.created && <Badge color="#f59e0b">создано автоматически</Badge>}
          </p>
          <div className="grid grid-cols-3 gap-3 mt-6">
            <div className="p-3 rounded-xl bg-emerald-500/8 border border-emerald-400/20">
              <div className="text-2xl font-bold text-emerald-300">{result.visited}</div>
              <div className="text-[11px] text-slate-500">посещений проставлено</div>
            </div>
            <div className="p-3 rounded-xl bg-sky-500/8 border border-sky-400/20">
              <div className="text-2xl font-bold text-sky-300">{result.registered}</div>
              <div className="text-[11px] text-slate-500">регистраций отмечено</div>
            </div>
            <div className="p-3 rounded-xl bg-indigo-500/8 border border-indigo-400/20">
              <div className="text-2xl font-bold text-indigo-300">{result.created}</div>
              <div className="text-[11px] text-slate-500">новых карточек</div>
            </div>
          </div>
          <div className="text-[11px] text-slate-600 mt-3">
            Найдены в базе: {result.matched} · уже были отмечены: {result.already} · пропущено строк: {result.skipped}
          </div>
          <div className="flex justify-center gap-2 mt-6">
            <Button variant="default" onClick={reset}>Загрузить ещё</Button>
            <Link to="/dod"><Button variant="primary"><GraduationCap size={14} /> К мероприятию</Button></Link>
          </div>
        </Card>
      )}

      {step === 3 && result?.mode === 'plan' && (
        <Card className="p-8 max-w-2xl mx-auto text-center">
          <div className="w-16 h-16 rounded-2xl bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center mx-auto mb-4">
            <CalendarRange size={28} className="text-cyan-300" />
          </div>
          <h3 className="text-lg font-bold text-slate-100">Календарь заполнен</h3>
          <div className="grid grid-cols-3 gap-3 mt-6">
            <div className="p-3 rounded-xl bg-emerald-500/8 border border-emerald-400/20">
              <div className="text-2xl font-bold text-emerald-300">{result.created}</div>
              <div className="text-[11px] text-slate-500">событий создано</div>
            </div>
            <div className="p-3 rounded-xl bg-white/3 border border-white/10">
              <div className="text-2xl font-bold text-slate-400">{result.skipped}</div>
              <div className="text-[11px] text-slate-500">пропущено (дубли)</div>
            </div>
            <div className="p-3 rounded-xl bg-white/3 border border-white/10">
              <div className="text-2xl font-bold text-slate-400">{result.errors}</div>
              <div className="text-[11px] text-slate-500">ошибок</div>
            </div>
          </div>
          <div className="flex justify-center gap-2 mt-6">
            <Button variant="default" onClick={reset}>Загрузить ещё</Button>
            <Link to="/calendar"><Button variant="primary"><CalendarRange size={14} /> Открыть календарь</Button></Link>
          </div>
        </Card>
      )}
    </div>
  );
}
