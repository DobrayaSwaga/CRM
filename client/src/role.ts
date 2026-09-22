// Роль контакта: школьник / взрослый / родитель.
// Рамка (логика приёмной комиссии): младше 18 — школьник; 18–31 — взрослый
// (может быть и старшим абитуриентом, и молодым родителем); 32+ — родитель.
// Младше 5 и старше 90 — дата рождения под вопросом.

export type RoleKey = 'child' | 'adult' | 'parent' | 'unknown';

export function ageFrom(birth?: string | null): number | null {
  if (!birth) return null;
  const s = String(birth).trim();
  let y = 0, m = 0, d = 0;
  let mt = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (mt) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else {
    mt = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (!mt) return null;
    d = +mt[1]; m = +mt[2]; y = +mt[3];
  }
  const now = new Date();
  let age = now.getFullYear() - y;
  const md = now.getMonth() + 1 - m;
  if (md < 0 || (md === 0 && now.getDate() < d)) age--;
  return age;
}

export type RoleInfo = { role: RoleKey; age: number | null; suspicious: boolean; manual: boolean };

export function resolveRole(c: { birth_date?: string | null; contact_role?: string | null }): RoleInfo {
  const manual = String(c.contact_role || '');
  const age = ageFrom(c.birth_date);
  if (manual === 'child' || manual === 'adult' || manual === 'parent') {
    return { role: manual, age, suspicious: false, manual: true };
  }
  if (age === null) return { role: 'unknown', age: null, suspicious: false, manual: false };
  if (age < 5 || age > 90) return { role: 'unknown', age, suspicious: true, manual: false };
  if (age < 18) return { role: 'child', age, suspicious: false, manual: false };
  if (age >= 32) return { role: 'parent', age, suspicious: false, manual: false };
  return { role: 'adult', age, suspicious: false, manual: false };
}

export const ROLE_META: Record<RoleKey, { label: string; color: string; plural: string }> = {
  child: { label: 'Школьник', color: '#818cf8', plural: 'Школьники' },
  adult: { label: 'Взрослый', color: '#94a3b8', plural: 'Взрослые (18–31)' },
  parent: { label: 'Родитель', color: '#fbbf24', plural: 'Родители' },
  unknown: { label: 'Не определена', color: '#64748b', plural: 'Без даты рождения' },
};
