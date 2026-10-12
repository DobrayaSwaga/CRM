import React from 'react';
import clsx from 'clsx';
import { X } from 'lucide-react';

export function Card({ className, children, hover, ...rest }: React.HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  return (
    <div className={clsx('glass rounded-2xl', hover && 'glass-hover cursor-pointer', className)} {...rest}>
      {children}
    </div>
  );
}

export function Button({ className, variant = 'default', size = 'md', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'success';
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all duration-200 disabled:opacity-40 disabled:pointer-events-none select-none',
        size === 'sm' && 'text-xs px-3 py-1.5',
        size === 'md' && 'text-sm px-4 py-2',
        size === 'lg' && 'text-base px-6 py-3',
        variant === 'default' && 'bg-white/6 border border-white/10 text-slate-200 hover:bg-white/10 hover:border-white/20',
        variant === 'primary' && 'bg-gradient-to-br from-indigo-500 to-violet-600 on-accent shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:brightness-110 border border-indigo-400/30',
        variant === 'success' && 'bg-gradient-to-br from-emerald-500 to-teal-600 on-accent shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:brightness-110 border border-emerald-400/30',
        variant === 'danger' && 'bg-red-500/15 border border-red-400/30 text-red-300 hover:bg-red-500/25',
        variant === 'ghost' && 'text-slate-400 hover:text-slate-200 hover:bg-white/5',
        className
      )}
      {...rest}
    />
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={clsx(
        'w-full bg-white/4 border border-white/10 rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-all',
        'focus:border-indigo-400/50 focus:bg-white/6 focus:ring-2 focus:ring-indigo-500/20',
        className
      )}
      {...rest}
    />
  );
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={clsx(
        'w-full bg-white/4 border border-white/10 rounded-xl px-3.5 py-2 text-sm text-slate-100 outline-none transition-all appearance-none cursor-pointer',
        'focus:border-indigo-400/50 focus:ring-2 focus:ring-indigo-500/20 [&>option]:bg-slate-900',
        className
      )}
      {...rest}
    >
      {children}
    </select>
  );
});

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={clsx(
        'w-full bg-white/4 border border-white/10 rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-all resize-none',
        'focus:border-indigo-400/50 focus:bg-white/6 focus:ring-2 focus:ring-indigo-500/20',
        className
      )}
      {...rest}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-400 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-600 mt-1">{hint}</span>}
    </label>
  );
}

export function Badge({ color = '#6366f1', children, className }: { color?: string; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={clsx('inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-lg whitespace-nowrap', className)}
      style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}
    >
      {children}
    </span>
  );
}

export function TempBadge({ temp, size = 'md' }: { temp: string; size?: 'sm' | 'md' }) {
  const conf: Record<string, any> = {
    hot: { label: 'Горячий', color: '#f87171' },
    warm: { label: 'Тёплый', color: '#fbbf24' },
    cold: { label: 'Холодный', color: '#7dd3fc' },
  };
  const c = conf[temp] || conf.cold;
  return (
    <span
      className={clsx('inline-flex items-center gap-1.5 font-medium rounded-lg whitespace-nowrap', size === 'sm' ? 'text-[10px] px-1.5 py-px' : 'text-[11px] px-2 py-0.5')}
      style={{ background: `${c.color}1f`, color: c.color, border: `1px solid ${c.color}40` }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.color, boxShadow: `0 0 6px ${c.color}` }} />
      {c.label}
    </span>
  );
}

export function Modal({ open, onClose, title, children, width }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; width?: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className={clsx('glass-strong rounded-2xl relative max-h-[88vh] flex flex-col animate-slide-up w-full', width || 'max-w-lg')}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/8">
          <h3 className="text-base font-semibold text-slate-100">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/8 transition-all">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="text-slate-600 mb-3">{icon}</div>
      <p className="text-slate-400 font-medium">{title}</p>
      {hint && <p className="text-slate-600 text-sm mt-1 max-w-xs">{hint}</p>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-indigo-400 animate-spin" />
    </div>
  );
}
