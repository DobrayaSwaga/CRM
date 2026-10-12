import { useEffect, useMemo, useRef, useState } from 'react';
import EyeLogo from './EyeLogo';

const PHRASES = [
  'Подключаемся к базе данных…',
  'Прогреваем скоринг абитуриентов…',
  'Загружаем контакты и историю…',
  'Синхронизируем календарь мероприятий…',
  'Проверяем напоминания и задачи…',
  'Готовим интерфейс…',
];

/**
 * Полноэкранная «загрузка системы»: живёт случайные 3–10 секунд,
 * показывает анимированный логотип, меняющиеся фразы и прогресс-бар,
 * затем плавно растворяется.
 */
export default function BootScreen({ onDone }: { onDone: () => void }) {
  // Случайная длительность 3–10 секунд при каждом показе
  const duration = useMemo(() => 3000 + Math.floor(Math.random() * 7000), []);
  const [pct, setPct] = useState(0);
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    const start = performance.now();
    const tick = () => {
      const elapsed = performance.now() - start;
      const p = Math.min(99, (elapsed / duration) * 100);
      // Прогресс слегка неравномерный — как «настоящая» загрузка
      setPct(Math.floor(p * (0.85 + 0.15 * Math.min(1, elapsed / 900))));
      setPhraseIdx(Math.floor(elapsed / 1150) % PHRASES.length);
      if (elapsed < duration) {
        raf = requestAnimationFrame(tick);
      } else if (!doneRef.current) {
        doneRef.current = true;
        setPct(100);
        setLeaving(true);
        setTimeout(onDone, 480);
      }
    };
    let raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration, onDone]);

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center ${leaving ? 'boot-fade-out' : ''}`}
      style={{ background: 'var(--color-ink-950)' }}
    >
      <div className="app-bg">
        <div className="blob w-[500px] h-[500px] -top-40 -left-40" style={{ background: '#4338ca' }} />
        <div className="blob w-[400px] h-[400px] top-1/3 -right-32" style={{ background: '#7c3aed', animationDelay: '-4s' }} />
        <div className="blob w-[350px] h-[350px] -bottom-32 left-1/3" style={{ background: '#0e7490', animationDelay: '-8s' }} />
      </div>

      <div className="relative boot-logo mb-8">
        <div className="boot-ring1" />
        <div className="boot-ring2" />
        <EyeLogo size={132} />
      </div>

      <h1 className="text-3xl font-bold glow-text mb-2">NexusCRM</h1>
      <p className="text-sm text-slate-500 mb-10 h-5 animate-fade-in" key={phraseIdx}>{PHRASES[phraseIdx]}</p>

      <div className="w-64">
        <div className="h-1.5 rounded-full bg-white/6 overflow-hidden">
          <div
            className="relative h-full rounded-full boot-progress-bar overflow-hidden"
            style={{
              animationDuration: `${duration}ms`,
              background: 'linear-gradient(90deg, #6366f1, #a855f7, #22d3ee)',
            }}
          >
            <div className="boot-sheen" />
          </div>
        </div>
        <div className="flex justify-between items-center mt-2.5 text-[11px] text-slate-600">
          <span>{pct}%</span>
          <span className="boot-dots flex gap-1 items-center"><span /><span /><span /></span>
        </div>
      </div>
    </div>
  );
}
