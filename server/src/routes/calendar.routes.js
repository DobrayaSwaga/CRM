// © 2026 DobrayaSwaga. See LICENSE.
import { Router } from "express";
import { db } from "../db.js";
import {
  isAdmin,
  taskVisibility,
  canEditTask,
  validDateTime,
} from "../calendar-access.js";
import { audit } from "../util.js";
export const calendarRouter = Router();

calendarRouter.get("/", (req, res) => {
  const { from, to } = req.query;
  if (
    !validDateTime(from) ||
    !validDateTime(to) ||
    from >= to ||
    Date.parse(to) - Date.parse(from) > 370 * 86400000
  ) {
    return res.status(400).json({
      error: "Укажите диапазон дат до 370 дней (to — исключительная граница)",
    });
  }
  const events = db
    .prepare(
      `SELECT e.*, u.name AS created_by_name FROM calendar_events e
    LEFT JOIN users u ON u.id = e.created_by WHERE e.start_at < ? AND e.end_at > ?
    AND (e.scope = 'shared' OR e.created_by = ? OR ?)`,
    )
    .all(to, from, req.user.id, Number(isAdmin(req.user)))
    .map((e) => ({
      ...e,
      kind: "event",
      can_edit: isAdmin(req.user) || e.created_by === req.user.id,
    }));
  const tasks = db
    .prepare(
      `SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
    WHERE t.due_date >= ? AND t.due_date < ? AND ${taskVisibility(req.user)}`,
    )
    .all(from, to)
    .map((t) => ({
      ...t,
      kind: "task",
      start_at: t.due_date,
      end_at: t.due_date,
      all_day: !t.due_date.includes("T") && !t.due_date.includes(" "),
      can_edit: canEditTask(req.user, t),
    }));
  const plan = db
    .prepare(
      `SELECT id, name AS title, event_date AS start_at, location, description, created_by
    FROM dod_events WHERE event_date >= ? AND event_date < ?`,
    )
    .all(from, to)
    .map((e) => ({
      ...e,
      kind: "plan",
      scope: "shared",
      end_at: e.start_at,
      all_day: e.start_at.length === 10,
      can_edit: false,
    }));
  res.json({ items: [...events, ...tasks, ...plan] });
});
function validate(b) {
  if (typeof b.title !== "string" || !b.title.trim() || b.title.length > 500)
    return "Укажите название до 500 символов";
  if (!["personal", "shared"].includes(b.scope)) return "Неверный календарь";
  if (
    !validDateTime(b.start_at) ||
    !validDateTime(b.end_at) ||
    b.end_at <= b.start_at
  )
    return "Окончание должно быть позже начала";
  if (![true, false, 0, 1].includes(b.all_day))
    return "Некорректный формат целого дня";
  if (
    b.all_day
      ? b.start_at.length !== 10 || b.end_at.length !== 10
      : b.start_at.length !== 16 || b.end_at.length !== 16
  )
    return "Для события на весь день нужны даты, для остальных — дата и время";
  if (typeof b.description !== "string" || typeof b.location !== "string")
    return "Некорректное описание или место";
}
calendarRouter.post("/", (req, res) => {
  const b = {
    description: "",
    location: "",
    scope: "personal",
    all_day: false,
    ...req.body,
  };
  const error = validate(b);
  if (error) return res.status(400).json({ error });
  const info = db
    .prepare(
      `INSERT INTO calendar_events (title, description, location, start_at, end_at, all_day, scope, created_by)
    VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      b.title.trim(),
      b.description,
      b.location,
      b.start_at,
      b.end_at,
      Number(b.all_day),
      b.scope,
      req.user.id,
    );
  const id = Number(info.lastInsertRowid);
  audit(req.user.id, "calendar.create", "calendar_events", id);
  res.status(201).json({ id });
});
calendarRouter.use("/:id", (req, res, next) => {
  const event = db
    .prepare("SELECT * FROM calendar_events WHERE id = ?")
    .get(Number(req.params.id));
  if (
    !event ||
    (event.scope === "personal" &&
      event.created_by !== req.user.id &&
      !isAdmin(req.user))
  )
    return res.status(404).json({ error: "Событие не найдено" });
  if (!isAdmin(req.user) && event.created_by !== req.user.id)
    return res
      .status(403)
      .json({ error: "Изменять событие может только автор или администратор" });
  req.calendarEvent = event;
  next();
});
calendarRouter.patch("/:id", (req, res) => {
  const b = { ...req.calendarEvent, ...req.body };
  const error = validate(b);
  if (error) return res.status(400).json({ error });
  db.prepare(
    `UPDATE calendar_events SET title=?, description=?, location=?, start_at=?, end_at=?, all_day=?, scope=? WHERE id=?`,
  ).run(
    b.title.trim(),
    b.description,
    b.location,
    b.start_at,
    b.end_at,
    Number(b.all_day),
    b.scope,
    req.calendarEvent.id,
  );
  audit(
    req.user.id,
    "calendar.update",
    "calendar_events",
    req.calendarEvent.id,
  );
  res.json({ ok: true });
});
calendarRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM calendar_events WHERE id = ?").run(
    req.calendarEvent.id,
  );
  audit(
    req.user.id,
    "calendar.delete",
    "calendar_events",
    req.calendarEvent.id,
  );
  res.json({ ok: true });
});
