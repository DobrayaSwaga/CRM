import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  LayoutDashboard, Users, Columns3, CheckSquare, CalendarDays,
  GraduationCap, Upload, GitMerge, BarChart3, Settings, LogOut,
  Search, Flame, ChevronRight
} from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../api';
import RemindersBell from './RemindersBell';

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Дашборд', end: true },
  { to: '/contacts', icon: Users, label: 'Контакты' },
  { to: '/kanban', icon: Columns3, label: 'Воронка' },
  { to: '/tasks', icon: CheckSquare, label: 'Задачи' },
  { to: '/calendar', icon: CalendarDays, label: 'Календарь' },
  { to: '/dod', icon: GraduationCap, label: 'ДОД' },
  { to: '/import', icon: Upload, label: 'Импорт', perm: 'import.run' },
  { to: '/duplicates', icon: GitMerge, label: 'Дубли', perm: 'import.merge', badge: true },
  { to: '/analytics', icon: BarChart3, label: 'Аналитика', perm: 'analytics.view' },
  { to: '/settings', icon: Settings, label: 'Настройки' },
];

export default function Layout() {
  const { user, logout, hasPerm } = useAuth();
  const navigate = useNavigate();
  const [globalSearch, setGlobalSearch] = useState('');
  const [dupCount, setDupCount] = useState(0);

  useEffect(() => {
    if (hasPerm('import.merge')) {
      api.get('/api/import/duplicates').then(d => setDupCount(d.candidates.length)).catch(() => {});
    }
  }, []);

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && globalSearch.trim()) {
      navigate(`/contacts?search=${encodeURIComponent(globalSearch.trim())}`);
      setGlobalSearch('');
    }
  };

  return (
    <div className="h-screen flex overflow-hidden">
      {/* Фоновые блобы */}
      <div className="app-bg">
        <div className="blob w-[500px] h-[500px] -top-40 -left-40" style={{ background: '#4338ca' }} />
        <div className="blob w-[400px] h-[400px] top-1/3 -right-32" style={{ background: '#7c3aed', animationDelay: '-4s' }} />
        <div className="blob w-[350px] h-[350px] -bottom-32 left-1/3" style={{ background: '#0e7490', animationDelay: '-8s' }} />
      </div>

      {/* Сайдбар */}
      <aside className="w-[230px] shrink-0 flex flex-col m-3 mr-0 glass rounded-2xl overflow-hidden">
        <div className="px-5 py-5 border-b border-white/8">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Flame size={18} className="text-white" />
            </div>
            <div>
              <div className="font-bold text-[15px] glow-text leading-tight">CampusCRM</div>
              <div className="text-[10px] text-slate-500">приёмная комиссия</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          {NAV.filter(n => !n.perm || hasPerm(n.perm)).map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 group relative',
                isActive
                  ? 'bg-gradient-to-r from-indigo-500/20 to-violet-500/10 text-indigo-300 border border-indigo-400/25 shadow-inner'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
              )}
            >
              <n.icon size={17} />
              <span className="flex-1">{n.label}</span>
              {n.badge && dupCount > 0 && (
                <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-400/30 rounded-md px-1.5 py-px font-semibold">
                  {dupCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-white/8">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 border border-white/15 flex items-center justify-center text-xs font-bold text-slate-200">
              {user?.name?.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-slate-200 truncate">{user?.name}</div>
              <div className="text-[10px] text-slate-500 truncate">{user?.roleName}</div>
            </div>
            <button onClick={logout} title="Выйти" className="p-1.5 rounded-lg text-slate-500 hover:text-red-300 hover:bg-red-500/10 transition-all">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Основная область */}
      <div className="flex-1 flex flex-col min-w-0 p-3 gap-3">
        <header className="glass rounded-2xl px-5 py-3 flex items-center gap-4 shrink-0">
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={globalSearch}
              onChange={e => setGlobalSearch(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Глобальный поиск: ФИО, телефон, email… (Enter)"
              className="w-full bg-white/4 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-indigo-400/50 focus:ring-2 focus:ring-indigo-500/20 transition-all"
            />
          </div>
          <div className="flex-1" />
          <RemindersBell />
          <div className="text-xs text-slate-500 hidden md:block">
            {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto pr-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: React.ReactNode; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </div>
  );
}

export function Crumb({ children }: { children: React.ReactNode }) {
  return <ChevronRight size={14} className="text-slate-600">{children}</ChevronRight>;
}
