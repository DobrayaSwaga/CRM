import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Megaphone, ListTodo, MessageSquare, X } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';

// Всплывающие уведомления о новых сообщениях командного чата.
// Работают на любой странице, КРОМЕ самого чата (там сообщения и так перед глазами).
// Объявления и задачи из чата дополнительно озвучиваются коротким сигналом.

type Toast = {
  key: number;
  msgId: number;
  kind: 'chat' | 'announcement' | 'task';
  author: string;
  body: string;
  extra?: string;
  duration: number;
};

const KIND_META = {
  chat: { title: 'Сообщение', icon: MessageSquare, color: '#818cf8' },
  announcement: { title: 'Объявление', icon: Megaphone, color: '#f59e0b' },
  task: { title: 'Новая задача', icon: ListTodo, color: '#10b981' },
} as const;

export default function ChatToaster() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastSeenRef = useRef(0);
  const initRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);

  // Короткий сигнал: тихий, неинвазивный. Если браузер не дал звук — просто беззвучно.
  const beep = (freq: number) => {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = (audioRef.current = audioRef.current || new Ctx());
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch { /* звук недоступен */ }
  };

  const dismiss = (key: number) => setToasts(prev => prev.filter(t => t.key !== key));

  useEffect(() => {
    if (!user) return;
    let stopped = false;

    const poll = async () => {
      try {
        if (!initRef.current) {
          // Инициализация: запоминаем актуальный хвост ленты, старое не всплывает
          const d = await api.get('/api/chat/messages');
          lastSeenRef.current = d.messages.reduce((m: number, x: any) => Math.max(m, x.id), 0);
          initRef.current = true;
          return;
        }
        const d = await api.get(`/api/chat/messages?after_id=${lastSeenRef.current}`);
        if (stopped || !d.messages.length) return;
        lastSeenRef.current = Math.max(...d.messages.map((m: any) => m.id));

        // На странице чата не дублируем — сообщения видны в самой ленте
        if (location.pathname.startsWith('/chat')) return;

        const fresh = d.messages.filter((m: any) => m.user_id !== user.id);
        if (!fresh.length) return;

        const born = Date.now();
        const shown = fresh.slice(-3).map((m: any, i: number): Toast => ({
          key: born + i,
          msgId: m.id,
          kind: m.kind,
          author: m.author_name,
          body: m.kind === 'task' ? (m.task_title || m.body) : m.body,
          extra: m.kind === 'task' ? `исполнитель: ${m.task_assignee_name || '—'}${m.task_due ? ' · ' + m.task_due.slice(0, 16).replace('T', ' ') : ''}` : undefined,
          duration: m.kind === 'chat' ? 6500 : 9000,
        }));
        setToasts(prev => [...prev, ...shown].slice(-6));
        shown.forEach((t: Toast) => setTimeout(() => dismiss(t.key), t.duration));

        if (fresh.some((m: any) => m.kind === 'announcement')) beep(988);
        else if (fresh.some((m: any) => m.kind === 'task')) beep(740);
      } catch { /* следующий тик повторит */ }
    };

    poll();
    const t = setInterval(poll, 7000);
    return () => { stopped = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, location.pathname]);

  if (!user || toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[70] w-[320px] max-w-[calc(100vw-2rem)] space-y-2 pointer-events-none">
      {toasts.map(t => {
        const meta = KIND_META[t.kind] || KIND_META.chat;
        const Icon = meta.icon;
        return (
          <div
            key={t.key}
            onClick={() => { dismiss(t.key); navigate('/chat'); }}
            className="pointer-events-auto glass rounded-2xl p-3 cursor-pointer animate-slide-up shadow-2xl hover:brightness-125 transition-all"
            style={{ border: `1px solid ${meta.color}55`, background: `linear-gradient(135deg, ${meta.color}18, rgba(13,17,30,0.92) 70%)`, backdropFilter: 'blur(14px)' }}
            role="status"
          >
            <div className="flex items-center gap-2">
              <span
                className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 border"
                style={{ background: `${meta.color}22`, borderColor: `${meta.color}55` }}
              >
                <Icon size={12} style={{ color: meta.color }} />
              </span>
              <span className="text-[11px] font-semibold" style={{ color: meta.color }}>
                {meta.title} · {t.author}
              </span>
              <button
                onClick={e => { e.stopPropagation(); dismiss(t.key); }}
                className="ml-auto text-slate-500 hover:text-slate-300 transition-colors"
                title="Скрыть"
              >
                <X size={13} />
              </button>
            </div>
            <div className="mt-1.5 text-[13px] text-slate-200 leading-snug line-clamp-3 whitespace-pre-wrap break-words pl-8">
              {t.body}
            </div>
            {t.extra && <div className="mt-1 text-[10px] text-slate-500 pl-8">{t.extra}</div>}
          </div>
        );
      })}
    </div>
  );
}
