import { useEffect, useState } from 'react';
import { Users, ShieldCheck, SlidersHorizontal, ListTree, Flame, KeyRound, ScrollText, Plus, Trash2, Pencil, Check, X, Cpu, DatabaseBackup, Download, Upload, Camera, AlertTriangle } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Card, Button, Input, Select, Spinner, Badge, Modal, Field, EmptyState } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { PERMISSION_LABELS, TOUCHPOINT_TYPES } from '../constants';

const TABS = [
  { key: 'users', label: 'Пользователи', icon: Users, perm: 'admin.users' },
  { key: 'roles', label: 'Роли и доступ', icon: ShieldCheck, perm: 'admin.roles' },
  { key: 'refs', label: 'Справочники', icon: ListTree, perm: 'admin.fields' },
  { key: 'fields', label: 'Свои поля', icon: SlidersHorizontal, perm: 'admin.fields' },
  { key: 'scoring', label: 'Скоринг', icon: Flame, perm: 'admin.scoring' },
  { key: 'audit', label: 'Аудит', icon: ScrollText, perm: 'admin.audit' },
  { key: 'backup', label: 'Бэкапы', icon: DatabaseBackup, perm: 'admin.backup' },
  { key: 'profile', label: 'Мой аккаунт', icon: KeyRound, perm: null },
] as const;

// ---------- Пользователи ----------
function UsersTab() {
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [form, setForm] = useState({ login: '', password: '', name: '', role_id: '' });
  const [err, setErr] = useState('');

  const load = () => {
    api.get('/api/admin/users').then(d => setUsers(d.users));
    api.get('/api/admin/roles').then(d => setRoles(d.roles));
  };
  useEffect(load, []);

  const create = async () => {
    setErr('');
    try {
      await api.post('/api/admin/users', { ...form, role_id: Number(form.role_id) });
      setShowCreate(false);
      setForm({ login: '', password: '', name: '', role_id: '' });
      load();
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button size="sm" variant="primary" onClick={() => setShowCreate(true)}><Plus size={13} /> Пользователь</Button>
      </div>
      <div className="space-y-2">
        {users.map(u => (
          <div key={u.id} className="glass rounded-xl p-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/6 border border-white/10 flex items-center justify-center text-xs font-bold text-slate-300">
              {u.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-200">{u.name}</div>
              <div className="text-[11px] text-slate-500">@{u.login} · добавлен {u.created_at.slice(0, 10)}</div>
            </div>
            <Badge color={u.role_id === 1 ? '#8b5cf6' : u.role_id === 2 ? '#3b82f6' : '#64748b'}>{u.role_name}</Badge>
            <Badge color={u.active ? '#10b981' : '#ef4444'}>{u.active ? 'активен' : 'выключен'}</Badge>
            <Button size="sm" variant="ghost" onClick={() => { setEditUser({ ...u, newPassword: '' }); setErr(''); }}><Pencil size={13} /></Button>
          </div>
        ))}
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Новый пользователь">
        <div className="space-y-3">
          {err && <div className="text-red-300 text-xs bg-red-500/10 border border-red-400/25 rounded-xl px-3 py-2">{err}</div>}
          <Field label="ФИО"><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Иванова Анна Петровна" /></Field>
          <Field label="Логин"><Input value={form.login} onChange={e => setForm(f => ({ ...f, login: e.target.value }))} placeholder="ivanova" /></Field>
          <Field label="Пароль" hint="минимум 6 символов"><Input type="text" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} /></Field>
          <Field label="Роль">
            <Select value={form.role_id} onChange={e => setForm(f => ({ ...f, role_id: e.target.value }))}>
              <option value="">— выберите —</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Отмена</Button>
            <Button variant="primary" onClick={create} disabled={!form.name || !form.login || !form.password || !form.role_id}>Создать</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!editUser} onClose={() => setEditUser(null)} title={`Редактирование: ${editUser?.name || ''}`}>
        {editUser && (
          <div className="space-y-3">
            {err && <div className="text-red-300 text-xs bg-red-500/10 border border-red-400/25 rounded-xl px-3 py-2">{err}</div>}
            <Field label="ФИО"><Input value={editUser.name} onChange={e => setEditUser((u: any) => ({ ...u, name: e.target.value }))} /></Field>
            <Field label="Роль">
              <Select value={editUser.role_id} onChange={e => setEditUser((u: any) => ({ ...u, role_id: Number(e.target.value) }))}>
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </Field>
            <Field label="Новый пароль" hint="оставьте пустым, чтобы не менять">
              <Input value={editUser.newPassword} onChange={e => setEditUser((u: any) => ({ ...u, newPassword: e.target.value }))} />
            </Field>
            <div className="flex items-center justify-between pt-1">
              <Button
                variant={editUser.active ? 'danger' : 'default'}
                size="sm"
                onClick={async () => {
                  try {
                    await api.patch(`/api/admin/users/${editUser.id}`, { active: editUser.active ? 0 : 1 });
                    setEditUser(null);
                    load();
                  } catch (e: any) { setErr(e.message); }
                }}
              >
                {editUser.active ? 'Деактивировать' : 'Активировать'}
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setEditUser(null)}>Отмена</Button>
                <Button variant="primary" onClick={async () => {
                  setErr('');
                  try {
                    await api.patch(`/api/admin/users/${editUser.id}`, {
                      name: editUser.name, role_id: editUser.role_id,
                      password: editUser.newPassword || undefined,
                    });
                    setEditUser(null);
                    load();
                  } catch (e: any) { setErr(e.message); }
                }}>Сохранить</Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------- Роли ----------
function RolesTab() {
  const [roles, setRoles] = useState<any[]>([]);
  const [allPerms, setAllPerms] = useState<string[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [err, setErr] = useState('');

  const load = () => api.get('/api/admin/roles').then(d => { setRoles(d.roles); setAllPerms(d.allPermissions); });
  useEffect(() => { load(); }, []);

  const save = async () => {
    setErr('');
    try {
      if (editing.id) await api.patch(`/api/admin/roles/${editing.id}`, { name: editing.name, permissions: editing.permissions });
      else await api.post('/api/admin/roles', { name: editing.name, permissions: editing.permissions });
      setEditing(null);
      load();
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button size="sm" variant="primary" onClick={() => setEditing({ name: '', permissions: [] })}><Plus size={13} /> Роль</Button>
      </div>
      <div className="space-y-2">
        {roles.map(r => (
          <div key={r.id} className="glass rounded-xl p-3.5 flex items-center gap-3">
            <ShieldCheck size={17} className={r.permissions.includes('*') ? 'text-violet-400' : 'text-slate-500'} />
            <div className="flex-1">
              <div className="text-sm font-medium text-slate-200">{r.name}</div>
              <div className="text-[11px] text-slate-500">
                {r.permissions.includes('*') ? 'Полный доступ ко всему' : `${r.permissions.length} прав: ${r.permissions.slice(0, 3).map((p: string) => PERMISSION_LABELS[p]?.split(': ')[1] || p).join(', ')}${r.permissions.length > 3 ? '…' : ''}`}
              </div>
            </div>
            {r.is_system === 1 && <Badge color="#64748b">системная</Badge>}
            {(!r.is_system || r.id !== 1) && (
              <Button size="sm" variant="ghost" onClick={() => { setEditing({ ...r }); setErr(''); }}><Pencil size={13} /></Button>
            )}
          </div>
        ))}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Роль: ${editing.name}` : 'Новая роль'} width="max-w-xl">
        {editing && (
          <div className="space-y-3">
            {err && <div className="text-red-300 text-xs bg-red-500/10 border border-red-400/25 rounded-xl px-3 py-2">{err}</div>}
            <Field label="Название роли"><Input value={editing.name} onChange={e => setEditing((r: any) => ({ ...r, name: e.target.value }))} /></Field>
            <Field label="Права доступа">
              <div className="grid grid-cols-2 gap-1.5 mt-1 max-h-64 overflow-y-auto pr-1">
                {allPerms.filter(p => p !== '*').map(p => {
                  const on = editing.permissions.includes(p);
                  return (
                    <button
                      key={p}
                      onClick={() => setEditing((r: any) => ({
                        ...r,
                        permissions: on ? r.permissions.filter((x: string) => x !== p) : [...r.permissions, p],
                      }))}
                      className={`text-left text-[11px] px-2.5 py-1.5 rounded-lg border transition-all ${
                        on ? 'bg-indigo-500/15 border-indigo-400/40 text-indigo-300' : 'border-white/8 text-slate-500 hover:bg-white/4'
                      }`}
                    >
                      {on ? '• ' : ''}{PERMISSION_LABELS[p] || p}
                    </button>
                  );
                })}
              </div>
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>Отмена</Button>
              <Button variant="primary" onClick={save} disabled={!editing.name.trim()}>Сохранить</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------- Справочники: статусы и направления ----------
function RefsTab() {
  const [statuses, setStatuses] = useState<any[]>([]);
  const [programs, setPrograms] = useState<any[]>([]);
  const [newStatus, setNewStatus] = useState({ name: '', color: '#6366f1' });
  const [newProgram, setNewProgram] = useState({ name: '', color: '#8b5cf6' });
  const [popup, setPopup] = useState('');

  const load = () => {
    api.get('/api/refs/statuses').then(d => setStatuses(d.statuses));
    api.get('/api/refs/programs').then(d => setPrograms(d.programs));
  };
  useEffect(load, []);

  const notify = (msg: string) => { setPopup(msg); setTimeout(() => setPopup(''), 3000); };

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {popup && <div className="lg:col-span-2 text-red-300 text-xs bg-red-500/10 border border-red-400/25 rounded-xl px-3 py-2">{popup}</div>}
      <div>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">Статусы воронки</h3>
        <div className="space-y-1.5">
          {statuses.map(s => (
            <div key={s.id} className="flex items-center gap-2 glass rounded-xl px-3 py-2">
              <input type="color" value={s.color} className="w-6 h-6 rounded cursor-pointer bg-transparent border-none" onChange={async e => {
                await api.patch(`/api/refs/statuses/${s.id}`, { color: e.target.value }); load();
              }} />
              <span className="text-sm text-slate-200 flex-1">{s.name}</span>
              {s.is_final ? <Badge color={s.is_success ? '#10b981' : '#ef4444'}>{s.is_success ? 'успех' : 'отказ'}</Badge> : <Badge color="#3b82f6">в работе</Badge>}
              <button className="text-slate-600 hover:text-red-400" onClick={async () => {
                if (!confirm(`Удалить статус «${s.name}»?`)) return;
                try { await api.del(`/api/refs/statuses/${s.id}`); load(); } catch (e: any) { notify(e.message); }
              }}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          <input type="color" value={newStatus.color} onChange={e => setNewStatus(s => ({ ...s, color: e.target.value }))} className="w-9 h-9 rounded-lg cursor-pointer bg-transparent border-none shrink-0" />
          <Input placeholder="Новый статус…" value={newStatus.name} onChange={e => setNewStatus(s => ({ ...s, name: e.target.value }))} />
          <Button size="sm" variant="primary" disabled={!newStatus.name.trim()} onClick={async () => {
            await api.post('/api/refs/statuses', { ...newStatus, sort_order: statuses.length + 1 });
            setNewStatus({ name: '', color: '#6366f1' });
            load();
          }}><Plus size={13} /></Button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">Направления подготовки</h3>
        <div className="space-y-1.5">
          {programs.map(p => (
            <div key={p.id} className="flex items-center gap-2 glass rounded-xl px-3 py-2">
              <input type="color" value={p.color} className="w-6 h-6 rounded cursor-pointer bg-transparent border-none" onChange={async e => {
                await api.patch(`/api/refs/programs/${p.id}`, { color: e.target.value }); load();
              }} />
              <span className="text-sm text-slate-200 flex-1">{p.name}</span>
              <span className="text-[11px] text-slate-500">{p.contacts_count} чел.</span>
              <button className="text-slate-600 hover:text-red-400" onClick={async () => {
                if (!confirm(`Удалить направление «${p.name}»?`)) return;
                await api.del(`/api/refs/programs/${p.id}`); load();
              }}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          <input type="color" value={newProgram.color} onChange={e => setNewProgram(p => ({ ...p, color: e.target.value }))} className="w-9 h-9 rounded-lg cursor-pointer bg-transparent border-none shrink-0" />
          <Input placeholder="Новое направление…" value={newProgram.name} onChange={e => setNewProgram(p => ({ ...p, name: e.target.value }))} />
          <Button size="sm" variant="primary" disabled={!newProgram.name.trim()} onClick={async () => {
            try {
              await api.post('/api/refs/programs', newProgram);
              setNewProgram({ name: '', color: '#8b5cf6' });
              load();
            } catch (e: any) { notify(e.message); }
          }}><Plus size={13} /></Button>
        </div>
      </div>
    </div>
  );
}

// ---------- Свои поля ----------
function FieldsTab() {
  const [fields, setFields] = useState<any[]>([]);
  const [form, setForm] = useState({ name: '', field_type: 'text', options: '' });

  const load = () => api.get('/api/refs/custom-fields').then(d => setFields(d.fields));
  useEffect(() => { load(); }, []);

  return (
    <div>
      <p className="text-xs text-slate-500 mb-3">
        Свои поля появляются в карточке каждого контакта и доступны для маппинга при импорте. Примеры: «СНИЛС», «Дата ЕГЭ», «Согласие на обработку ПД».
      </p>
      <div className="space-y-1.5 mb-3">
        {fields.map(f => (
          <div key={f.id} className="flex items-center gap-2 glass rounded-xl px-3 py-2">
            <span className="text-sm text-slate-200 flex-1">{f.name}</span>
            <Badge color="#3b82f6">{f.field_type === 'text' ? 'текст' : f.field_type === 'number' ? 'число' : f.field_type === 'date' ? 'дата' : 'список'}</Badge>
            {f.field_type === 'select' && <span className="text-[11px] text-slate-500">{f.options.join(', ')}</span>}
            <button className="text-slate-600 hover:text-red-400" onClick={async () => {
              if (confirm('Удалить поле? Значения в карточках тоже удалятся.')) { await api.del(`/api/refs/custom-fields/${f.id}`); load(); }
            }}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-2">
        <Input placeholder="Название поля" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="col-span-2" />
        <Select value={form.field_type} onChange={e => setForm(f => ({ ...f, field_type: e.target.value }))}>
          <option value="text">Текст</option>
          <option value="number">Число</option>
          <option value="date">Дата</option>
          <option value="select">Список</option>
        </Select>
        {form.field_type === 'select'
          ? <Input placeholder="Варианты через запятую" value={form.options} onChange={e => setForm(f => ({ ...f, options: e.target.value }))} />
          : <span />}
        <Button variant="primary" size="sm" disabled={!form.name.trim()} onClick={async () => {
          await api.post('/api/refs/custom-fields', {
            name: form.name, field_type: form.field_type,
            options: form.field_type === 'select' ? form.options.split(',').map(s => s.trim()).filter(Boolean) : [],
          });
          setForm({ name: '', field_type: 'text', options: '' });
          load();
        }} className="col-span-4 sm:col-span-1"><Plus size={13} /> Добавить поле</Button>
      </div>
    </div>
  );
}

// ---------- Скоринг ----------
function ScoringTab() {
  const [rules, setRules] = useState<any[]>([]);
  const [thresholds, setThresholds] = useState({ hot: 80, warm: 30 });
  const [ml, setMl] = useState<any>(null);
  const [statuses, setStatuses] = useState<any[]>([]);
  const [showRule, setShowRule] = useState(false);
  const [form, setForm] = useState<any>({ name: '', rule_type: 'touchpoint', touchpoint_type: 'dod', min_count: 1, period_days: '', status_id: '', points: 30 });
  const [recalc, setRecalc] = useState('');

  const load = () => {
    api.get('/api/scoring/rules').then(d => { setRules(d.rules); setThresholds(d.thresholds); });
    api.get('/api/scoring/ml-readiness').then(setMl);
    api.get('/api/refs/statuses').then(d => setStatuses(d.statuses));
  };
  useEffect(load, []);

  const createRule = async () => {
    const condition = form.rule_type === 'touchpoint'
      ? { touchpoint_type: form.touchpoint_type, min_count: Number(form.min_count), ...(form.period_days ? { period_days: Number(form.period_days) } : {}) }
      : form.rule_type === 'inactivity'
      ? { days: Number(form.days) }
      : { status_id: Number(form.status_id) };
    await api.post('/api/scoring/rules', { name: form.name, rule_type: form.rule_type, condition, points: Number(form.points) });
    setShowRule(false);
    setForm({ name: '', rule_type: 'touchpoint', touchpoint_type: 'dod', min_count: 1, period_days: '', status_id: '', points: 30 });
    load();
  };

  return (
    <div className="space-y-4">
      {/* Пороги */}
      <div className="glass rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-200 mb-3">Пороги температуры</h3>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            Горячий от <Input type="number" className="!w-20" value={thresholds.hot} onChange={e => setThresholds(t => ({ ...t, hot: Number(e.target.value) }))} /> баллов
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            Тёплый от <Input type="number" className="!w-20" value={thresholds.warm} onChange={e => setThresholds(t => ({ ...t, warm: Number(e.target.value) }))} /> баллов
          </div>
          <Button size="sm" variant="primary" onClick={async () => {
            try {
              await api.patch('/api/scoring/thresholds', thresholds);
              await api.post('/api/scoring/recalculate');
              setRecalc('Пороги сохранены, баллы пересчитаны');
              setTimeout(() => setRecalc(''), 3000);
            } catch (e: any) { setRecalc('Ошибка: ' + e.message); }
          }}>Сохранить и пересчитать всех</Button>
          {recalc && <span className="text-xs text-slate-400">{recalc}</span>}
        </div>
      </div>

      {/* Правила */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-200">Правила начисления баллов</h3>
          <Button size="sm" variant="primary" onClick={() => setShowRule(true)}><Plus size={13} /> Правило</Button>
        </div>
        <div className="space-y-1.5">
          {rules.map(r => (
            <div key={r.id} className="flex items-center gap-3 glass rounded-xl px-3.5 py-2.5">
              <Flame size={14} className={r.active ? 'text-amber-400' : 'text-slate-600'} />
              <div className="flex-1">
                <div className={`text-sm ${r.active ? 'text-slate-200' : 'text-slate-500 line-through'}`}>{r.name}</div>
                <div className="text-[11px] text-slate-500">
                  {r.rule_type === 'touchpoint'
                    ? `${r.condition.min_count}+ × «${TOUCHPOINT_TYPES[r.condition.touchpoint_type]?.label}»${r.condition.period_days ? ` за ${r.condition.period_days} дн.` : ''} → +${r.points}`
                    : r.rule_type === 'inactivity'
                    ? `нет касаний ${r.condition.days}+ дней → ${r.points}`
                    : `статус «${statuses.find(s => s.id === r.condition.status_id)?.name || '?'}» → +${r.points}`}
                </div>
              </div>
              <Badge color={r.points < 0 ? '#60a5fa' : r.points >= 50 ? '#f87171' : r.points >= 30 ? '#fbbf24' : '#7dd3fc'}>{r.points > 0 ? '+' : ''}{r.points}</Badge>
              <button className="text-slate-600 hover:text-slate-300" title={r.active ? 'Выключить' : 'Включить'} onClick={async () => {
                await api.patch(`/api/scoring/rules/${r.id}`, { active: r.active ? 0 : 1 }); load();
              }}>
                {r.active ? <X size={14} /> : <Check size={14} />}
              </button>
              <button className="text-slate-600 hover:text-red-400" onClick={async () => {
                if (confirm('Удалить правило?')) { await api.del(`/api/scoring/rules/${r.id}`); load(); }
              }}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      </div>

      {/* ML-готовность */}
      {ml && (
        <div className="glass rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2 mb-2"><Cpu size={15} className="text-cyan-400" /> Будущая ML-модель</h3>
          <p className="text-xs text-slate-400 mb-3">{ml.recommendation}</p>
          <div className="flex gap-3">
            <div className="flex-1 p-3 rounded-xl bg-white/3 border border-white/8 text-center">
              <div className="text-xl font-bold text-slate-200">{ml.total_contacts}</div>
              <div className="text-[10px] text-slate-500">всего в базе</div>
            </div>
            <div className="flex-1 p-3 rounded-xl bg-emerald-500/6 border border-emerald-400/20 text-center">
              <div className="text-xl font-bold text-emerald-300">{ml.success}</div>
              <div className="text-[10px] text-slate-500">поступило</div>
            </div>
            <div className="flex-1 p-3 rounded-xl bg-red-500/6 border border-red-400/20 text-center">
              <div className="text-xl font-bold text-red-300">{ml.fail}</div>
              <div className="text-[10px] text-slate-500">отказов</div>
            </div>
            <div className="flex-1 p-3 rounded-xl bg-cyan-500/6 border border-cyan-400/20 text-center">
              <div className="text-xl font-bold text-cyan-300">{ml.ready ? '100%' : `${Math.min(100, Math.round(((ml.success + ml.fail) / 100) * 100))}%`}</div>
              <div className="text-[10px] text-slate-500">готовность</div>
            </div>
          </div>
        </div>
      )}

      <Modal open={showRule} onClose={() => setShowRule(false)} title="Новое правило скоринга">
        <div className="space-y-3">
          <Field label="Название"><Input value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} placeholder="Например: Посетил 3 ДОД" /></Field>
          <Field label="Тип правила">
            <Select value={form.rule_type} onChange={e => setForm((f: any) => ({
              ...f, rule_type: e.target.value,
              points: e.target.value === 'inactivity' ? -20 : 30,
            }))}>
              <option value="touchpoint">По событиям истории</option>
              <option value="status">По статусу контакта</option>
              <option value="inactivity">Остывание (нет касаний N дней)</option>
            </Select>
          </Field>
          {form.rule_type === 'touchpoint' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Событие">
                  <Select value={form.touchpoint_type} onChange={e => setForm((f: any) => ({ ...f, touchpoint_type: e.target.value }))}>
                    {Object.entries(TOUCHPOINT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </Select>
                </Field>
                <Field label="Минимум раз"><Input type="number" min={1} value={form.min_count} onChange={e => setForm((f: any) => ({ ...f, min_count: e.target.value }))} /></Field>
              </div>
              <Field label="За период (дней)" hint="пусто = за всё время"><Input type="number" value={form.period_days} onChange={e => setForm((f: any) => ({ ...f, period_days: e.target.value }))} /></Field>
            </>
          )}
          {form.rule_type === 'inactivity' && (
            <Field label="Нет касаний (дней)" hint="если тишина дольше — начисляем баллы (обычно отрицательные)">
              <Input type="number" min={1} value={form.days || 14} onChange={e => setForm((f: any) => ({ ...f, days: e.target.value }))} />
            </Field>
          )}
          {form.rule_type === 'status' && (
            <Field label="Статус">
              <Select value={form.status_id} onChange={e => setForm((f: any) => ({ ...f, status_id: e.target.value }))}>
                <option value="">— выберите —</option>
                {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Баллы" hint="отрицательные = штраф, например −20">
            <Input type="number" value={form.points} onChange={e => setForm((f: any) => ({ ...f, points: e.target.value }))} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowRule(false)}>Отмена</Button>
            <Button variant="primary" onClick={createRule} disabled={!form.name.trim() || (form.rule_type === 'status' && !form.status_id)}>Создать</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------- Аудит ----------
function AuditTab() {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api.get('/api/admin/audit').then(d => setRows(d.audit)); }, []);
  if (!rows) return <Spinner />;
  return (
    <div className="space-y-1">
      {rows.slice(0, 100).map(r => (
        <div key={r.id} className="flex items-center gap-3 text-xs py-1.5 border-b border-white/4">
          <span className="text-slate-600 w-32 shrink-0">{r.created_at.slice(0, 16).replace('T', ' ')}</span>
          <span className="text-slate-400 w-36 shrink-0 truncate">{r.user_name || 'система'}</span>
          <Badge color="#64748b">{r.action}</Badge>
          <span className="text-slate-500 truncate">{r.entity}{r.entity_id ? ` #${r.entity_id}` : ''}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Бэкапы ----------
function BackupTab() {
  const [backups, setBackups] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<File | null>(null);
  const fileRef = { current: null as HTMLInputElement | null };

  const load = () => api.get('/api/backup/list').then(d => setBackups(d.backups)).catch(() => {});
  useEffect(() => { load(); }, []);

  const fmtSize = (b: number) => b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(b / 1024))} КБ`;

  const restore = async () => {
    if (!confirmRestore) return;
    setBusy(true);
    try {
      const res = await api.upload('/api/backup/restore', confirmRestore);
      setMsg(`Восстановлено ${res.restored} записей из бэкапа от ${new Date(res.backup_from).toLocaleString('ru-RU')}. Перезайдите в систему для гарантии.`);
      load();
    } catch (e: any) {
      setMsg('Ошибка: ' + e.message);
    } finally {
      setBusy(false);
      setConfirmRestore(null);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-xs text-slate-500">
        Бэкап — это вся база в одном файле: контакты, история, задачи, пользователи, настройки.
        <b className="text-slate-300"> Автобэкап делается сам каждый день</b>, последние 10 хранятся на сервере.
      </p>

      {msg && <div className={`text-xs rounded-xl px-3 py-2 border ${!msg.startsWith('Ошибка:') ? 'text-emerald-300 bg-emerald-500/10 border-emerald-400/25' : 'text-red-300 bg-red-500/10 border-red-400/25'}`}>{msg}</div>}

      <div className="grid sm:grid-cols-3 gap-2">
        <button
          onClick={() => {
            // window.open не подходит для проверки прав через cookie — но cookie httpOnly sameSite=lax ок в том же origin
            const a = document.createElement('a');
            a.href = '/api/backup/download';
            a.download = '';
            a.click();
          }}
          className="glass glass-hover rounded-xl p-4 text-left"
        >
          <Download size={18} className="text-indigo-400 mb-2" />
          <div className="text-sm font-medium text-slate-200">Скачать бэкап</div>
          <div className="text-[11px] text-slate-500 mt-0.5">JSON-файл со всей базой</div>
        </button>

        <button
          onClick={() => fileRef.current?.click()}
          className="glass glass-hover rounded-xl p-4 text-left"
        >
          <Upload size={18} className="text-amber-400 mb-2" />
          <div className="text-sm font-medium text-slate-200">Восстановить</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Загрузить файл бэкапа</div>
        </button>
        <input
          ref={el => { fileRef.current = el; }}
          type="file" accept=".json" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) setConfirmRestore(f); e.target.value = ''; }}
        />

        <button
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api.post('/api/backup/snapshot');
              setMsg(`Снапшот создан: ${r.file}`);
              load();
            } catch (e: any) { setMsg('Ошибка: ' + e.message); }
            finally { setBusy(false); }
          }}
          className="glass glass-hover rounded-xl p-4 text-left"
          disabled={busy}
        >
          <Camera size={18} className="text-emerald-400 mb-2" />
          <div className="text-sm font-medium text-slate-200">Снапшот сейчас</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Прямая копия файла БД</div>
        </button>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">Автобэкапы на сервере (последние 10)</h3>
        {backups.length === 0 ? (
          <p className="text-xs text-slate-600">Пока нет — первый создастся через 10 секунд после запуска сервера</p>
        ) : (
          <div className="space-y-1.5">
            {backups.map(b => (
              <div key={b.name} className="flex items-center gap-3 glass rounded-xl px-3.5 py-2.5">
                <DatabaseBackup size={15} className="text-emerald-400 shrink-0" />
                <span className="text-sm text-slate-200 font-mono flex-1">{b.name}</span>
                <span className="text-[11px] text-slate-500">{fmtSize(b.size)}</span>
                <span className="text-[11px] text-slate-500">{new Date(b.created).toLocaleString('ru-RU')}</span>
                <a href={`/api/backup/file/${b.name}`} className="text-indigo-400 hover:text-indigo-300" title="Скачать файл БД">
                  <Download size={14} />
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={!!confirmRestore} onClose={() => setConfirmRestore(null)} title="⚠️ Восстановление базы">
        <div className="space-y-3">
          <div className="flex gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-400/25 text-xs text-amber-200">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>Текущая база будет <b>полностью заменена</b> содержимым файла <b>{confirmRestore?.name}</b>. Перед этим автоматически создаётся страховочный снапшот.</span>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmRestore(null)}>Отмена</Button>
            <Button variant="danger" onClick={restore} disabled={busy}>{busy ? 'Восстанавливаем…' : 'Да, восстановить'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------- Профиль ----------
function ProfileTab() {
  const { user } = useAuth();
  const [form, setForm] = useState({ oldPassword: '', newPassword: '', confirm: '' });
  const [msg, setMsg] = useState('');

  return (
    <div className="max-w-sm">
      <div className="glass rounded-xl p-4 mb-4">
        <div className="text-sm font-medium text-slate-200">{user?.name}</div>
        <div className="text-xs text-slate-500">@{user?.login} · {user?.roleName}</div>
      </div>
      <h3 className="text-sm font-semibold text-slate-300 mb-2">Сменить пароль</h3>
      <div className="space-y-2">
        <Field label="Текущий пароль"><Input type="password" value={form.oldPassword} onChange={e => setForm(f => ({ ...f, oldPassword: e.target.value }))} /></Field>
        <Field label="Новый пароль"><Input type="password" value={form.newPassword} onChange={e => setForm(f => ({ ...f, newPassword: e.target.value }))} /></Field>
        <Field label="Повторите новый"><Input type="password" value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} /></Field>
        {msg && <div className={`text-xs rounded-xl px-3 py-2 border ${!msg.startsWith('Ошибка:') ? 'text-emerald-300 bg-emerald-500/10 border-emerald-400/25' : 'text-red-300 bg-red-500/10 border-red-400/25'}`}>{msg}</div>}
        <Button variant="primary" disabled={!form.oldPassword || !form.newPassword} onClick={async () => {
          if (form.newPassword !== form.confirm) { setMsg('Пароли не совпадают'); return; }
          try {
            await api.post('/api/auth/change-password', form);
            setMsg('Пароль изменён');
            setForm({ oldPassword: '', newPassword: '', confirm: '' });
          } catch (e: any) { setMsg(e.message); }
        }}>Сменить пароль</Button>
      </div>
    </div>
  );
}

export default function Settings() {
  const { hasPerm } = useAuth();
  const available = TABS.filter(t => !t.perm || hasPerm(t.perm));
  const [tab, setTab] = useState<string>(available[0]?.key || 'profile');

  return (
    <div className="animate-fade-in">
      <PageHeader title="Настройки" subtitle="Администрирование системы и аккаунта" />
      <div className="flex gap-3 items-start">
        <Card className="p-2 w-52 shrink-0">
          {available.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all ${
                tab === t.key ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-400/25' : 'text-slate-400 hover:bg-white/5 border border-transparent'
              }`}
            >
              <t.icon size={15} /> {t.label}
            </button>
          ))}
        </Card>
        <Card className="flex-1 p-5 min-h-96">
          {tab === 'users' && <UsersTab />}
          {tab === 'roles' && <RolesTab />}
          {tab === 'refs' && <RefsTab />}
          {tab === 'fields' && <FieldsTab />}
          {tab === 'scoring' && <ScoringTab />}
          {tab === 'audit' && <AuditTab />}
          {tab === 'backup' && <BackupTab />}
          {tab === 'profile' && <ProfileTab />}
        </Card>
      </div>
    </div>
  );
}
