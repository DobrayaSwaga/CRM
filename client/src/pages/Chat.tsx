// © 2026 DobrayaSwaga · NexusCRM — авторский проект. Лицензия: см. файл LICENSE.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Megaphone, ListTodo, CheckSquare, Clock, X } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Button, Spinner, Select } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { PRIORITY } from '../constants';

const fmtTime = (iso: string) => {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  const today = new Date(); today.setHours(0,0,0,0);
  const day = new Date(d); day.setHours(0,0,0,0);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (days === 0) return `Сегодня, ${time}`;
  if (days === 1) return `Вчера, ${time}`;
  return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}, ${time}`;
};

const fmtDue = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) +
    (iso.includes('T') || iso.includes(':') ? ` ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : '');
};

export default function Chat() {
  const { user, hasPerm } = useAuth();
  const [messages, setMessages] = useState<any[] | null>(null);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'chat' | 'task'>('chat');
  const [announce, setAnnounce] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [due, setDue] = useState('');
  const [assignees, setAssignees] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef(0);
  const canTask = hasPerm('tasks.create');

  const scrollDown = () => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  const markRead = useCallback((msgs: any[]) => {
    const last = msgs[msgs.length - 1];
    if (last) {
      lastIdRef.current = Math.max(lastIdRef.current, last.id);
      api.post('/api/chat/read', { last_id: last.id }).catch(() => {});
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const after = lastIdRef.current;
      const d = await api.get(`/api/chat/messages${after ? `?after_id=${after}` : ''}`);
      if (!after) {
        setMessages(d.messages);
        scrollDown();
        markRead(d.messages);
      } else if (d.messages.length) {
        setMessages(prev => {
          const seen = new Set((prev || []).map(m => m.id));
          const fresh = d.messages.filter((m: any) => !seen.has(m.id));
          return fresh.length ? [...(prev || []), ...fresh] : prev;
        });
        scrollDown();
        markRead(d.messages);
      }
    } catch { /* сеть/сессия — следующий тик повторит */ }
  }, [markRead]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (mode === 'task') {
      api.get('/api/refs/assignees').then(d => setAssignees(d.users)).catch(() => {});
    }
  }, [mode]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setErr('');
    try {
      if (mode === 'task') {
        await api.post('/api/chat/task', {
          body,
          assignee_id: assigneeId ? Number(assigneeId) : undefined,
          due_date: due || undefined,
        });
        setDue('');
        setAssigneeId('');
      } else {
        await api.post('/api/chat/messages', { body, announcement: announce || undefined });
        setAnnounce(false);
      }
      setText('');
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (!messages) return <Spinner />;

  return (
    <div className="h-full flex flex-col animate-fade-in">
      <PageHeader
        title="Чат команды"
        subtitle="Внутренняя связь: сообщения, объявления и постановка задач — видно всем сотрудникам"
      />

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 pb-2">
        {messages.length === 0 && (
          <div className="text-center text-slate-600 text-xs py-16">
            Пока тихо. Напишите первое сообщение команде — объявления доступны менеджерам и администраторам.
          </div>
        )}
        {messages.map(m => {
          const own = m.user_id === user?.id;
          if (m.kind === 'announcement') {
            return (
              <div key={m.id} className="glass rounded-2xl p-3.5 !border-amber-400/30" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.10), transparent 70%)' }}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-6 h-6 rounded-lg bg-amber-500/20 border border-amber-400/30 flex items-center justify-center shrink-0"><Megaphone size={12} className="text-amber-300" /></span>
                  <span className="text-xs font-semibold text-amber-300">Объявление · {m.author_name}</span>
                  <span className="text-[10px] text-slate-600 ml-auto">{fmtTime(m.created_at)}</span>
                </div>
                <div className="text-sm text-slate-200 whitespace-pre-wrap pl-8">{m.body}</div>
              </div>
            );
          }
          if (m.kind === 'task') {
            const done = m.task_status === 'done';
            return (
              <div key={m.id} className="glass rounded-2xl p-3.5 !border-emerald-400/25" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.08), transparent 70%)' }}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-6 h-6 rounded-lg bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center shrink-0"><ListTodo size={12} className="text-emerald-300" /></span>
                  <span className="text-xs text-emerald-300/90">{m.author_name} поставил(а) задачу</span>
                  <span className="text-[10px] text-slate-600 ml-auto">{fmtTime(m.created_at)}</span>
                </div>
                <div className="pl-8">
                  <div className={`text-sm font-medium ${done ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{m.task_title || m.body}</div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[11px]">
                    <span className="px-2 py-0.5 rounded-lg bg-white/6 border border-white/10 text-slate-300 flex items-center gap-1">
                      <CheckSquare size={10} /> {m.task_assignee_name || 'без исполнителя'}
                    </span>
                    {m.task_due && (
                      <span className="px-2 py-0.5 rounded-lg bg-white/6 border border-white/10 text-slate-400 flex items-center gap-1">
                        <Clock size={10} /> {fmtDue(m.task_due)}
                      </span>
                    )}
                    {m.task_priority && m.task_priority !== 'normal' && (
                      <span className="px-2 py-0.5 rounded-lg border text-[10px]" style={{ borderColor: `${PRIORITY[m.task_priority]?.color}60`, color: PRIORITY[m.task_priority]?.color }}>
                        {PRIORITY[m.task_priority]?.label}
                      </span>
                    )}
                    {done
                      ? <span className="px-2 py-0.5 rounded-lg bg-emerald-500/15 border border-emerald-400/30 text-emerald-300">выполнена</span>
                      : <Link to="/tasks" className="px-2 py-0.5 rounded-lg bg-indigo-500/15 border border-indigo-400/30 text-indigo-300 hover:bg-indigo-500/25 transition-colors">к задачам →</Link>}
                  </div>
                </div>
              </div>
            );
          }
          return (
            <div key={m.id} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 border ${own
                ? 'bg-indigo-500/15 border-indigo-400/25 rounded-br-md'
                : 'glass rounded-bl-md'}`}>
                <div className="flex items-baseline gap-2 mb-0.5">
                  <span className={`text-[11px] font-semibold ${own ? 'text-indigo-300' : 'text-slate-300'}`}>{own ? 'Вы' : m.author_name}</span>
                  <span className="text-[9px] text-slate-600">{fmtTime(m.created_at)}</span>
                </div>
                <div className="text-sm text-slate-200 whitespace-pre-wrap break-words">{m.body}</div>
              </div>
            </div>
          );
        })}
      </div>

      {err && <div className="text-red-300 text-xs bg-red-500/10 border border-red-400/25 rounded-xl px-3 py-2 mt-2">{err}</div>}

      {/* Панель ввода */}
      <div className="glass rounded-2xl p-3 mt-2 shrink-0">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <button
            onClick={() => setMode(m => m === 'task' ? 'chat' : 'task')}
            className={`text-[11px] px-2.5 py-1 rounded-lg border flex items-center gap-1 transition-all ${mode === 'task' ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300' : 'border-white/10 text-slate-500 hover:text-slate-300'}`}
          >
            <ListTodo size={11} /> {mode === 'task' ? 'Режим задачи — отменить' : 'Написать как задачу'}
          </button>
          {canTask && mode === 'chat' && (
            <button
              onClick={() => setAnnounce(a => !a)}
              className={`text-[11px] px-2.5 py-1 rounded-lg border flex items-center gap-1 transition-all ${announce ? 'bg-amber-500/15 border-amber-400/40 text-amber-300' : 'border-white/10 text-slate-500 hover:text-slate-300'}`}
            >
              <Megaphone size={11} /> {announce ? 'Объявление для всех' : 'Сделать объявлением'}
            </button>
          )}
          {mode === 'task' && (
            <div className="flex items-center gap-2 flex-wrap">
              <Select className="!w-44 !py-1 !text-[11px]" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
                <option value="">Исполнитель: я сам</option>
                {assignees.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
              <input
                type="datetime-local"
                value={due}
                onChange={e => setDue(e.target.value)}
                className="bg-white/4 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-slate-300 outline-none focus:border-emerald-400/50"
                title="Дедлайн (необязательно)"
              />
              {due && <button onClick={() => setDue('')} className="text-slate-600 hover:text-slate-400"><X size={12} /></button>}
            </div>
          )}
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={onKey}
            rows={2}
            placeholder={mode === 'task'
              ? 'Текст задачи: что сделать… (Enter — поставить задачу)'
              : announce
                ? 'Текст объявления для всей команды…'
                : 'Сообщение команде… (Enter — отправить, Shift+Enter — новая строка)'}
            className={`flex-1 bg-white/4 border rounded-xl px-3.5 py-2.5 text-sm text-slate-200 outline-none resize-none placeholder:text-slate-600 transition-colors ${
              mode === 'task' ? 'border-emerald-400/25 focus:border-emerald-400/50' : announce ? 'border-amber-400/25 focus:border-amber-400/50' : 'border-white/10 focus:border-indigo-400/50'}`}
          />
          <Button variant="primary" onClick={send} disabled={!text.trim() || busy} className="!px-4 !py-2.5">
            <Send size={15} />
          </Button>
        </div>
      </div>
    </div>
  );
}
