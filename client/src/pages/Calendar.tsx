// © 2026 DobrayaSwaga. See LICENSE.
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, CalendarDays } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import {
  Modal,
  Field,
  Input,
  Textarea,
  Select,
  Button,
} from "../components/ui";
import "./Calendar.css";

type Item = {
  id: number;
  kind: "event" | "task" | "plan";
  title: string;
  description: string;
  location?: string;
  start_at: string;
  end_at: string;
  scope: "personal" | "shared";
  all_day: boolean;
  can_edit: boolean;
  status?: string;
  assignee_id?: number;
  assignee_name?: string;
  created_by_name?: string;
  priority?: string;
};
type View = "day" | "week" | "month";
const pad = (n: number) => String(n).padStart(2, "0");
const key = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const add = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};
const monday = (d: Date) => add(d, -((d.getDay() + 6) % 7));
const midnight = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00`);
const time = (s: string) => (s.length > 10 ? s.slice(11, 16) : "");
const minutes = (s: string) => {
  const t = time(s);
  return t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : 0;
};
const layer = (i: Item) =>
  i.kind === "plan"
    ? "plan"
    : i.kind === "task"
      ? i.scope === "personal"
        ? "mytasks"
        : "tasks"
      : i.scope;
const layers = [
  { id: "personal", name: "Личный", color: "#a78bfa" },
  { id: "shared", name: "Общий", color: "#60a5fa" },
  { id: "mytasks", name: "Мои задачи", color: "#34d399" },
  { id: "tasks", name: "Общие задачи", color: "#fbbf24" },
  { id: "plan", name: "План мероприятий КАИТ20", color: "#fb923c" },
];
const color = (i: Item) => layers.find((l) => l.id === layer(i))!.color;
const spansDay = (i: Item, d: Date) =>
  i.kind !== "event"
    ? i.start_at.slice(0, 10) === key(d)
    : i.start_at < key(add(d, 1)) &&
      i.end_at > (i.all_day ? key(d) : `${key(d)}T00:00`);
const isLong = (i: Item) =>
  !!i.all_day || i.start_at.slice(0, 10) !== i.end_at.slice(0, 10);

// Stable component identity: opening/editing an item never remounts the form on each keystroke.
function Editor({
  item,
  day,
  onClose,
  onSaved,
}: {
  item: Item | null;
  day: Date;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [kind, setKind] = useState(item?.kind || "event");
  const [form, setForm] = useState({
    title: item?.title || "",
    description: item?.description || "",
    location: item?.location || "",
    scope: item?.scope || "personal",
    all_day: !!item?.all_day,
    start:
      item?.start_at.replace(" ", "T").slice(0, 16) ||
      `${key(day)}T${pad(day.getHours() >= 7 && day.getHours() < 22 ? day.getHours() : 9)}:00`,
    end:
      item?.kind === "event"
        ? item.end_at.replace(" ", "T").slice(0, 16)
        : `${key(day)}T${pad(day.getHours() >= 7 && day.getHours() < 22 ? day.getHours() + 1 : 10)}:00`,
    assignee_id: item?.assignee_id || user!.id,
    priority: item?.priority || "normal",
  });
  const [users, setUsers] = useState<{ id: number; name: string }[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const writable = !item || item.can_edit;
  useEffect(() => {
    api
      .get("/api/refs/assignees")
      .then((r) => setUsers(r.users))
      .catch(() => setError("Не удалось загрузить исполнителей"));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  const update = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const action = async (mode: "save" | "delete" | "done") => {
    if (busy) return;
    if (
      mode === "delete" &&
      !window.confirm("Удалить без возможности восстановления?")
    )
      return;
    setBusy(true);
    setError("");
    try {
      const url = kind === "task" ? "/api/tasks" : "/api/calendar";
      if (mode === "delete") await api.del(`${url}/${item!.id}`);
      else if (mode === "done")
        await api.patch(`${url}/${item!.id}`, {
          status: item!.status === "done" ? "open" : "done",
        });
      else {
        const start = form.all_day ? form.start.slice(0, 10) : form.start;
        const end = form.all_day ? form.end.slice(0, 10) : form.end;
        const body =
          kind === "task"
            ? {
                title: form.title,
                description: form.description,
                scope: form.scope,
                due_date: start,
                assignee_id: Number(form.assignee_id),
                priority: form.priority,
              }
            : {
                title: form.title,
                description: form.description,
                location: form.location,
                scope: form.scope,
                all_day: form.all_day,
                start_at: start,
                end_at: end,
              };
        if (item) await api.patch(`${url}/${item.id}`, body);
        else await api.post(url, body);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title={
        item
          ? kind === "plan"
            ? "Мероприятие из плана"
            : "Подробности"
          : "Новое событие или задача"
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          action("save");
        }}
      >
        {error && (
          <p role="alert" className="text-red-400 text-sm">
            {error}
          </p>
        )}
        {!item && (
          <Field label="Тип">
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as "event" | "task")}
            >
              <option value="event">Событие</option>
              <option value="task">Задача</option>
            </Select>
          </Field>
        )}
        <fieldset disabled={!writable || busy} className="space-y-4">
          <Field label="Название">
            <Input
              required
              maxLength={500}
              value={form.title}
              onChange={(e) => update({ title: e.target.value })}
            />
          </Field>
          {kind !== "plan" && (
            <Field label="Календарь">
              <Select
                value={form.scope}
                onChange={(e) =>
                  update({ scope: e.target.value as "personal" | "shared" })
                }
              >
                <option value="personal">
                  Личный — автор, исполнитель и администратор
                </option>
                <option value="shared">Общий — виден всем пользователям</option>
              </Select>
            </Field>
          )}
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.all_day}
              onChange={(e) => {
                const all = e.target.checked;
                update({
                  all_day: all,
                  start: all
                    ? form.start.slice(0, 10)
                    : `${form.start.slice(0, 10)}T09:00`,
                  end: all
                    ? key(add(midnight(form.start), 1))
                    : `${form.start.slice(0, 10)}T10:00`,
                });
              }}
            />
            Весь день
          </label>
          <Field label={kind === "task" ? "Срок выполнения" : "Начало"}>
            <Input
              required
              type={form.all_day ? "date" : "datetime-local"}
              value={form.start}
              onChange={(e) => update({ start: e.target.value })}
            />
          </Field>
          {kind === "event" && (
            <Field
              label={
                form.all_day
                  ? "Окончание (эта дата не включается)"
                  : "Окончание"
              }
            >
              <Input
                required
                type={form.all_day ? "date" : "datetime-local"}
                value={form.end}
                onChange={(e) => update({ end: e.target.value })}
              />
            </Field>
          )}
          {kind === "task" && (
            <>
              <Field label="Исполнитель">
                <Select
                  value={form.assignee_id}
                  onChange={(e) =>
                    update({ assignee_id: Number(e.target.value) })
                  }
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Приоритет">
                <Select
                  value={form.priority}
                  onChange={(e) => update({ priority: e.target.value })}
                >
                  <option value="low">Низкий</option>
                  <option value="normal">Обычный</option>
                  <option value="high">Высокий</option>
                </Select>
              </Field>
            </>
          )}
          {kind !== "task" && (
            <Field label="Место">
              <Input
                value={form.location}
                onChange={(e) => update({ location: e.target.value })}
              />
            </Field>
          )}
          <Field label="Описание">
            <Textarea
              rows={4}
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
            />
          </Field>
        </fieldset>
        {item?.created_by_name && (
          <p className="text-xs text-slate-400">
            Автор: {item.created_by_name}
          </p>
        )}
        {kind === "plan" && (
          <p className="text-sm text-slate-400">
            Событие из плана. Изменения доступны в разделе «ДОД».
          </p>
        )}
        {!writable && kind !== "plan" && (
          <p className="text-sm text-slate-400">
            Доступно только для просмотра.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {writable && (
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Сохранение…" : "Сохранить"}
            </Button>
          )}
          {item && writable && (
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={() => action("delete")}
            >
              Удалить
            </Button>
          )}
          {item && kind === "task" && writable && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => action("done")}
            >
              {item.status === "done" ? "Вернуть в работу" : "Выполнить"}
            </Button>
          )}
          <Button type="button" disabled={busy} onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => new Date());
  const [mini, setMini] = useState(() => new Date());
  const [view, setView] = useState<View>("week");
  const [enabled, setEnabled] = useState(
    () => new Set(layers.map((l) => l.id)),
  );
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<{ item: Item | null; day: Date } | null>(
    null,
  );
  const [showDone, setShowDone] = useState(false);
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start =
    view === "month"
      ? monday(monthStart)
      : view === "week"
        ? monday(cursor)
        : midnight(key(cursor));
  const count = view === "month" ? 42 : view === "week" ? 7 : 1;
  const from = key(start),
    to = key(add(start, count));
  const days = useMemo(
    () => Array.from({ length: count }, (_, i) => add(midnight(from), i)),
    [from, count],
  );
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api
      .get(`/api/calendar?from=${from}&to=${to}`)
      .then((r) => {
        if (active) setItems(r.items);
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setItems([]);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [from, to, revision]);
  const visible = items.filter(
    (i) =>
      enabled.has(layer(i)) &&
      (showDone || !["done", "cancelled"].includes(i.status || "")),
  );
  const selectDay = (d: Date) => {
    setCursor(d);
    setMini(d);
  };
  const shift = (n: number) =>
    selectDay(
      view === "month"
        ? new Date(
            cursor.getFullYear(),
            cursor.getMonth() + n,
            Math.min(
              cursor.getDate(),
              new Date(
                cursor.getFullYear(),
                cursor.getMonth() + n + 1,
                0,
              ).getDate(),
            ),
          )
        : add(cursor, n * (view === "week" ? 7 : 1)),
    );
  const miniDays = Array.from({ length: 42 }, (_, i) =>
    add(monday(new Date(mini.getFullYear(), mini.getMonth(), 1)), i),
  );
  const title = cursor.toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
    ...(view === "day" ? { day: "numeric" as const } : {}),
  });
  const chip = (item: Item, extra?: React.CSSProperties) => (
    <button
      key={`${item.kind}-${item.id}`}
      type="button"
      className={`cal-event ${item.status === "done" ? "cal-done" : ""}`}
      title={`${item.title}\n${item.start_at.replace("T", " ")}${item.kind === "event" ? " — " + item.end_at.replace("T", " ") : ""}`}
      style={{ "--event-color": color(item), ...extra } as React.CSSProperties}
      onClick={(e) => {
        e.stopPropagation();
        setEditor({ item, day: midnight(item.start_at) });
      }}
    >
      <span>
        {item.kind === "task" ? "☐ " : ""}
        {!item.all_day && time(item.start_at)} {item.title}
      </span>
    </button>
  );
  return (
    <section className="cal-shell">
      <aside className="cal-sidebar">
        <h1>
          <CalendarDays size={22} /> Календарь
        </h1>
        <button
          className="cal-create"
          onClick={() => setEditor({ item: null, day: cursor })}
        >
          <Plus size={20} /> Создать событие
        </button>
        <div className="cal-mini-title">
          <strong>
            {mini.toLocaleDateString("ru-RU", {
              month: "long",
              year: "numeric",
            })}
          </strong>
          <button
            aria-label="Предыдущий месяц мини-календаря"
            onClick={() =>
              setMini(new Date(mini.getFullYear(), mini.getMonth() - 1, 1))
            }
          >
            <ChevronLeft size={16} />
          </button>
          <button
            aria-label="Следующий месяц мини-календаря"
            onClick={() =>
              setMini(new Date(mini.getFullYear(), mini.getMonth() + 1, 1))
            }
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="cal-mini">
          {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((s) => (
            <span key={s}>{s}</span>
          ))}
          {miniDays.map((d) => (
            <button
              key={key(d)}
              className={`${d.getMonth() !== mini.getMonth() ? "muted" : ""} ${key(d) === key(cursor) ? "selected" : ""} ${key(d) === key(new Date()) ? "today" : ""}`}
              onClick={() => selectDay(d)}
            >
              {d.getDate()}
            </button>
          ))}
        </div>
        <h2>Мои календари</h2>
        {layers.map((l) => (
          <label className="cal-layer" key={l.id}>
            <input
              type="checkbox"
              style={{ accentColor: l.color }}
              checked={enabled.has(l.id)}
              onChange={() =>
                setEnabled((s) => {
                  const next = new Set(s);
                  if (next.has(l.id)) next.delete(l.id);
                  else next.add(l.id);
                  return next;
                })
              }
            />
            <span>{l.name}</span>
          </label>
        ))}
        <label className="cal-layer cal-completed">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
          />
          Показывать завершённые
        </label>
        <p className="cal-hint">
          Личный календарь виден только вам и администратору. Личные задачи
          также видит исполнитель или постановщик. Общий календарь доступен всей
          команде.
        </p>
      </aside>
      <div className="cal-main">
        <header className="cal-toolbar">
          <div className="cal-navigation">
            <button onClick={() => selectDay(new Date())}>Сегодня</button>
            <button aria-label="Предыдущий период" onClick={() => shift(-1)}>
              <ChevronLeft size={19} />
            </button>
            <button aria-label="Следующий период" onClick={() => shift(1)}>
              <ChevronRight size={19} />
            </button>
            <h2>{title}</h2>
          </div>
          <div className="cal-views">
            {(
              [
                ["day", "День"],
                ["week", "Неделя"],
                ["month", "Месяц"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                aria-pressed={view === v}
                className={view === v ? "active" : ""}
                onClick={() => setView(v)}
              >
                {label}
              </button>
            ))}
          </div>
        </header>
        {error && (
          <div role="alert" className="cal-error">
            {error}{" "}
            <button onClick={() => setRevision((r) => r + 1)}>Повторить</button>
          </div>
        )}
        <div aria-live="polite" className="cal-status">
          {loading
            ? "Загрузка…"
            : `${visible.length} событий и задач · время местное`}
        </div>
        <div className="cal-scroll" aria-busy={loading}>
          {view === "month" ? (
            <div className="cal-month">
              <div className="cal-weekdays">
                {[
                  "Понедельник",
                  "Вторник",
                  "Среда",
                  "Четверг",
                  "Пятница",
                  "Суббота",
                  "Воскресенье",
                ].map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </div>
              <div className="cal-month-days">
                {days.map((d) => (
                  <div
                    key={key(d)}
                    className={`cal-month-cell ${d.getMonth() !== cursor.getMonth() ? "cal-outside" : ""}`}
                  >
                    <button
                      className={`cal-date ${key(d) === key(new Date()) ? "today" : ""}`}
                      onClick={() => {
                        selectDay(d);
                        setView("day");
                      }}
                    >
                      {d.getDate()}
                    </button>
                    <button
                      className="cal-cell-add"
                      aria-label={`Создать ${key(d)}`}
                      onClick={() => setEditor({ item: null, day: d })}
                    >
                      +
                    </button>
                    {visible
                      .filter((i) => spansDay(i, d))
                      .sort((a, b) => a.start_at.localeCompare(b.start_at))
                      .map((i) => chip(i))}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div
              className="cal-time"
              style={{ minWidth: view === "week" ? 760 : 320 }}
            >
              <div
                className="cal-day-head"
                style={{
                  gridTemplateColumns: `52px repeat(${count}, minmax(0, 1fr))`,
                }}
              >
                <span />
                {days.map((d) => (
                  <button
                    key={key(d)}
                    onClick={() => {
                      selectDay(d);
                      setView("day");
                    }}
                  >
                    <small>
                      {d.toLocaleDateString("ru-RU", { weekday: "short" })}
                    </small>
                    <b className={key(d) === key(new Date()) ? "today" : ""}>
                      {d.getDate()}
                    </b>
                  </button>
                ))}
              </div>
              <div
                className="cal-allday"
                style={{
                  gridTemplateColumns: `52px repeat(${count}, minmax(0, 1fr))`,
                }}
              >
                <small>
                  Весь
                  <br />
                  день /<br />
                  вне сетки
                </small>
                {days.map((d) => (
                  <div key={key(d)}>
                    {visible
                      .filter(
                        (i) =>
                          spansDay(i, d) &&
                          (isLong(i) ||
                            minutes(i.start_at) < 420 ||
                            minutes(i.start_at) >= 1320),
                      )
                      .map((i) => chip(i))}
                  </div>
                ))}
              </div>
              <div
                className="cal-grid"
                style={{
                  gridTemplateColumns: `52px repeat(${count}, minmax(0, 1fr))`,
                }}
              >
                <div className="cal-hours">
                  {Array.from({ length: 16 }, (_, h) => (
                    <span key={h} style={{ top: h * 60 }}>
                      {pad(h + 7)}:00
                    </span>
                  ))}
                </div>
                {days.map((d) => {
                  const timed = visible
                    .filter(
                      (i) =>
                        spansDay(i, d) &&
                        !isLong(i) &&
                        minutes(i.start_at) >= 420 &&
                        minutes(i.start_at) < 1320,
                    )
                    .sort((a, b) => a.start_at.localeCompare(b.start_at));
                  // Allocate columns by connected overlap groups, not globally per day.
                  const positioned: {
                    item: Item;
                    start: number;
                    end: number;
                    col: number;
                    cols: number;
                  }[] = [];
                  let group: typeof positioned = [],
                    groupEnd = -1;
                  const flush = () => {
                    const cols = Math.max(1, ...group.map((x) => x.col + 1));
                    group.forEach((x) => (x.cols = cols));
                    positioned.push(...group);
                    group = [];
                  };
                  for (const item of timed) {
                    const s = minutes(item.start_at);
                    const e = Math.max(
                      s + 30,
                      item.kind === "event" ? minutes(item.end_at) : s + 30,
                    );
                    if (s >= groupEnd) {
                      flush();
                      groupEnd = -1;
                    }
                    const occupied = new Set(
                      group.filter((x) => x.end > s).map((x) => x.col),
                    );
                    let col = 0;
                    while (occupied.has(col)) col++;
                    group.push({ item, start: s, end: e, col, cols: 1 });
                    groupEnd = Math.max(groupEnd, e);
                  }
                  flush();
                  return (
                    <div key={key(d)} className="cal-day-column">
                      {Array.from({ length: 15 }, (_, h) => (
                        <button
                          key={h}
                          className="cal-slot"
                          aria-label={`Создать ${key(d)} ${pad(h + 7)}:00`}
                          onClick={() => {
                            const date = new Date(d);
                            date.setHours(h + 7);
                            setEditor({ item: null, day: date });
                          }}
                        />
                      ))}
                      {positioned.map((p) =>
                        chip(p.item, {
                          position: "absolute",
                          top: p.start - 420,
                          height: Math.min(p.end, 1320) - p.start - 2,
                          left: `${(p.col / p.cols) * 100}%`,
                          width: `calc(${100 / p.cols}% - 3px)`,
                        }),
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      {editor && (
        <Editor
          key={
            editor.item
              ? `${editor.item.kind}-${editor.item.id}`
              : `new-${editor.day.toISOString()}`
          }
          item={editor.item}
          day={editor.day}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            setRevision((r) => r + 1);
          }}
        />
      )}
    </section>
  );
}
