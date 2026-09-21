import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, FileSpreadsheet, ArrowRight, ArrowLeft, Check, AlertTriangle, History, GitMerge } from 'lucide-react';
import { api } from '../api';
import { Card, Button, Spinner, EmptyState, Badge } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { useAuth } from '../auth';

type Preview = {
  fileKey: string; filename: string; headers: string[]; sample: any[]; totalRows: number;
  guessedMapping: Record<number, string>; fields: { key: string; label: string }[];
  customFields: { id: number; name: string }[];
};

export default function ImportPage() {
  const { hasPerm } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [defaultSource, setDefaultSource] = useState('');
  const [result, setResult] = useState<any>(null);
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
      setMapping(p.guessedMapping);
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
      const res = await api.post('/api/import/execute', { fileKey: preview.fileKey, mapping, defaultSource });
      setResult(res);
      setStep(3);
      loadHistory();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const allFields = preview ? [
    ...preview.fields,
    ...preview.customFields.map(cf => ({ key: `cf_${cf.id}`, label: `★ ${cf.name} (своё поле)` })),
  ] : [];

  const usedKeys = new Set(Object.values(mapping).filter(Boolean));

  return (
    <div className="animate-fade-in">
      <PageHeader title="Импорт из Excel" subtitle="Загрузите таблицу — система сама создаст карточки и найдёт дубли" />

      {/* Шаги */}
      <div className="flex items-center gap-2 mb-5">
        {[
          { n: 1, label: 'Файл' },
          { n: 2, label: 'Сопоставление колонок' },
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
            <div className="mt-4 text-[11px] text-slate-600 max-w-xs">
              Колонки «ФИО», «Телефон», «Email» и другие распознаются автоматически — вы сможете скорректировать на следующем шаге
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
                      <div className="text-slate-300 truncate flex items-center gap-1.5"><FileSpreadsheet size={11} className="text-emerald-400 shrink-0" /> {h.filename}</div>
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

      {/* Шаг 2: маппинг */}
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
            <Button variant="ghost" size="sm" onClick={() => { setStep(1); setPreview(null); }}><ArrowLeft size={13} /> Другой файл</Button>
          </Card>

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
              <span className="text-xs text-slate-500 shrink-0">Источник по умолчанию:</span>
              <input
                value={defaultSource}
                onChange={e => setDefaultSource(e.target.value)}
                placeholder="Например: Ярмарка 18.09"
                className="flex-1 bg-white/4 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-400/50"
              />
            </div>
            <Button variant="ghost" size="sm" onClick={() => setStep(1)}><ArrowLeft size={13} /> Назад</Button>
            <Button variant="primary" onClick={execute} disabled={busy}>
              {busy ? 'Импортируем…' : <>Импортировать {preview.totalRows} строк <ArrowRight size={13} /></>}
            </Button>
          </Card>
        </div>
      )}

      {/* Шаг 3: результат */}
      {step === 3 && result && (
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
              <Button variant="default" onClick={() => { setStep(1); setPreview(null); setResult(null); }}>Загрузить ещё</Button>
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
    </div>
  );
}
