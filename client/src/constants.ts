// © 2026 DobrayaSwaga · NexusCRM — авторский проект. Лицензия: см. файл LICENSE.
export const TEMP_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  hot: { label: 'Горячий', color: '#f87171', bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.35)' },
  warm: { label: 'Тёплый', color: '#fbbf24', bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.3)' },
  cold: { label: 'Холодный', color: '#7dd3fc', bg: 'rgba(125,211,252,0.08)', border: 'rgba(125,211,252,0.25)' },
};

export const TOUCHPOINT_TYPES: Record<string, { label: string; icon: string; color: string }> = {
  dod: { label: 'День открытых дверей', icon: '🎓', color: '#8b5cf6' },
  dod_registration: { label: 'Регистрация на ДОД', icon: '🎟️', color: '#0ea5e9' },
  school: { label: 'Выезд в школу', icon: '🏫', color: '#34d399' },
  school_registration: { label: 'Запись со школьного выезда', icon: '🏫', color: '#2dd4bf' },
  external: { label: 'Внешнее мероприятие', icon: '🎪', color: '#f472b6' },
  external_registration: { label: 'Внешняя регистрация', icon: '🎪', color: '#fb7185' },
  call: { label: 'Звонок', icon: '📞', color: '#3b82f6' },
  email: { label: 'Письмо / сообщение', icon: '✉️', color: '#06b6d4' },
  application: { label: 'Заявка', icon: '📝', color: '#f59e0b' },
  document: { label: 'Документы', icon: '📄', color: '#10b981' },
  note: { label: 'Заметка', icon: '🗒️', color: '#64748b' },
  other: { label: 'Прочее', icon: '💬', color: '#94a3b8' },
};

// Типы мероприятий (источники выгрузок)
export const EVENT_TYPES: Record<string, { label: string; short: string; color: string }> = {
  dod: { label: 'День открытых дверей', short: 'ДОД', color: '#8b5cf6' },
  school: { label: 'Выезд в школу', short: 'Школа', color: '#34d399' },
  external: { label: 'Внешнее мероприятие', short: 'Внешнее', color: '#f472b6' },
};

export const TASK_STATUS: Record<string, string> = {
  open: 'Открыта',
  done: 'Выполнена',
  cancelled: 'Отменена',
};

export const PRIORITY: Record<string, { label: string; color: string }> = {
  low: { label: 'Низкий', color: '#64748b' },
  normal: { label: 'Обычный', color: '#3b82f6' },
  high: { label: 'Высокий', color: '#ef4444' },
};

export const PERMISSION_LABELS: Record<string, string> = {
  '*': 'Полный доступ (всё)',
  'contacts.view': 'Контакты: просмотр',
  'contacts.create': 'Контакты: создание',
  'contacts.edit': 'Контакты: редактирование',
  'contacts.delete': 'Контакты: удаление',
  'tasks.view': 'Задачи: просмотр',
  'tasks.create': 'Задачи: создание',
  'tasks.edit': 'Задачи: редактирование',
  'tasks.delete': 'Задачи: удаление',
  'dod.manage': 'ДОД: управление мероприятиями',
  'import.run': 'Импорт: загрузка таблиц',
  'import.merge': 'Импорт: слияние дублей',
  'export.run': 'Экспорт: выгрузка данных',
  'analytics.view': 'Аналитика: просмотр',
  'admin.users': 'Админ: пользователи',
  'admin.roles': 'Админ: роли и права',
  'admin.fields': 'Админ: справочники и поля',
  'admin.scoring': 'Админ: правила скоринга',
  'admin.audit': 'Админ: журнал аудита',
  'admin.backup': 'Админ: бэкапы базы',
};
