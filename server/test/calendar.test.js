// Run: node --test server/test/calendar.test.js. Uses a disposable database only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { DatabaseSync } from "node:sqlite";
const temp = mkdtempSync(path.join(os.tmpdir(), "nexus-calendar-"));
process.env.CRM_DB_PATH = path.join(temp, "test.db");
// Exercise migration of a pre-calendar tasks table, not only fresh installation.
const legacy = new DatabaseSync(process.env.CRM_DB_PATH);
legacy.exec(`CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT DEFAULT '', contact_id INTEGER, assignee_id INTEGER, created_by INTEGER, due_date TEXT, status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'normal', completed_at TEXT, created_at TEXT DEFAULT (datetime('now')));
INSERT INTO tasks(title, created_by, assignee_id) VALUES ('legacy',1,1);`);
legacy.close();
const { db } = await import("../src/db.js");
const { calendarRouter } = await import("../src/routes/calendar.routes.js");
const { tasksRouter } = await import("../src/routes/tasks.routes.js");
const { contactsRouter } = await import("../src/routes/contacts.routes.js");
const { analyticsRouter } = await import("../src/routes/analytics.routes.js");
const { exportRouter } = await import("../src/routes/export.routes.js");
const { requireAuth } = await import("../src/auth.js");
const { validDateTime } = await import("../src/calendar-access.js");
const all = [
  "tasks.view",
  "tasks.create",
  "tasks.edit",
  "tasks.delete",
  "contacts.view",
  "contacts.edit",
  "analytics.view",
  "export.run",
];
const users = { admin: { id: 1, permissions: ["*"] } };
for (const name of ["alice", "bob", "eve"]) {
  const id = Number(
    db
      .prepare(
        "INSERT INTO users(login,password_hash,name,role_id) VALUES (?,?,?,2)",
      )
      .run(name, "unused", name).lastInsertRowid,
  );
  users[name] = { id, permissions: all };
}
users.viewer = { ...users.eve, permissions: [] };
const app = express();
app.use(express.json());
// Test-only identity injection; production uses signed-in sessions via attachUser.
app.use((req, res, next) => {
  req.user = users[req.headers["x-test-user"]];
  next();
});
app.use("/api", requireAuth);
app.use("/api/calendar", calendarRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/contacts", contactsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/export", exportRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.on("listening", r));
const base = `http://127.0.0.1:${server.address().port}/api`;
async function call(user, method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { "x-test-user": user, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get("content-type") || "";
  return {
    status: res.status,
    body: type.includes("json")
      ? await res.json()
      : Buffer.from(await res.arrayBuffer()),
  };
}
const feed = (user) =>
  call(user, "GET", "/calendar?from=2026-10-01&to=2026-11-01");
const event = {
  title: "Private appointment",
  scope: "personal",
  start_at: "2026-10-21T09:00",
  end_at: "2026-10-21T10:00",
};
let personal, shared, task, contact;

test("legacy tasks migrate to shared", () =>
  assert.equal(
    db.prepare("SELECT scope FROM tasks WHERE id=1").get().scope,
    "shared",
  ));
test("date validation rejects malformed and impossible dates without throwing", () => {
  for (const d of [
    null,
    {},
    "",
    "2026-99-01",
    "2026-02-30",
    "2026-10-21T24:00",
    "2026-10-21T09:60",
  ])
    assert.equal(validDateTime(d), false);
  for (const d of ["2024-02-29", "2026-10-21T09:30"])
    assert.equal(validDateTime(d), true);
});
test("unauthenticated requests denied", async () =>
  assert.equal((await call("nobody", "GET", "/calendar")).status, 401));
test("all signed-in users can create personal events", async () => {
  const r = await call("alice", "POST", "/calendar", event);
  assert.equal(r.status, 201);
  personal = r.body.id;
  assert.equal(
    (
      await call("viewer", "POST", "/calendar", {
        ...event,
        title: "Viewer event",
      })
    ).status,
    201,
  );
});
test("personal event visible only to author and wildcard admin", async () => {
  for (const user of ["alice", "admin"])
    assert.ok(
      (await feed(user)).body.items.some(
        (i) => i.kind === "event" && i.id === personal,
      ),
    );
  for (const user of ["bob", "eve"])
    assert.ok(
      !(await feed(user)).body.items.some(
        (i) => i.kind === "event" && i.id === personal,
      ),
    );
});
test("shared events readable but not editable by another user", async () => {
  shared = (
    await call("alice", "POST", "/calendar", { ...event, scope: "shared" })
  ).body.id;
  const i = (await feed("bob")).body.items.find(
    (i) => i.kind === "event" && i.id === shared,
  );
  assert.equal(i.can_edit, false);
  assert.equal(
    (await call("bob", "PATCH", `/calendar/${shared}`, { title: "hacked" }))
      .status,
    403,
  );
  assert.equal(
    (await call("bob", "DELETE", `/calendar/${personal}`)).status,
    404,
  );
});
test("author edits, admin edits, spoofed created_by ignored", async () => {
  assert.equal(
    (
      await call("alice", "PATCH", `/calendar/${personal}`, {
        title: "Updated",
        created_by: users.bob.id,
      })
    ).status,
    200,
  );
  assert.equal(
    db
      .prepare("SELECT created_by FROM calendar_events WHERE id=?")
      .get(personal).created_by,
    users.alice.id,
  );
  assert.equal(
    (
      await call("admin", "PATCH", `/calendar/${personal}`, {
        location: "Office",
      })
    ).status,
    200,
  );
});
test("bad event input and bad ranges return 400", async () => {
  for (const patch of [
    { title: "" },
    { title: 7 },
    { scope: "unknown" },
    { end_at: event.start_at },
    { start_at: "2026-99-01" },
    { all_day: true },
    { start_at: "2026-10-21", end_at: "2026-10-22T10:00" },
    { description: {} },
  ])
    assert.equal(
      (await call("alice", "POST", "/calendar", { ...event, ...patch })).status,
      400,
    );
  for (const q of [
    "",
    "?from=2026-99-01&to=2026-11-01",
    "?from=2026-10-01&to=2028-11-01",
    "?from=2026-11-01&to=2026-10-01",
  ])
    assert.equal((await call("alice", "GET", "/calendar" + q)).status, 400);
});
test("all-day and overnight events overlap the queried interval; end excluded", async () => {
  const id = (
    await call("alice", "POST", "/calendar", {
      ...event,
      all_day: true,
      start_at: "2026-09-30",
      end_at: "2026-10-02",
    })
  ).body.id;
  assert.ok(
    (await feed("alice")).body.items.some(
      (i) => i.kind === "event" && i.id === id,
    ),
  );
  const r = await call(
    "alice",
    "GET",
    "/calendar?from=2026-10-02&to=2026-10-03",
  );
  assert.ok(!r.body.items.some((i) => i.kind === "event" && i.id === id));
  assert.equal(
    (
      await call("alice", "POST", "/calendar", {
        ...event,
        start_at: "2026-10-21T23:00",
        end_at: "2026-10-22T02:00",
      })
    ).status,
    201,
  );
});
test("personal tasks visible to author, assignee and admin only", async () => {
  contact = Number(
    db.prepare("INSERT INTO contacts(first_name) VALUES ('Test contact')").run()
      .lastInsertRowid,
  );
  const r = await call("alice", "POST", "/tasks", {
    title: "Private task",
    scope: "personal",
    due_date: "2026-10-21T10:00",
    assignee_id: users.bob.id,
    contact_id: contact,
  });
  assert.equal(r.status, 201);
  task = r.body.id;
  for (const user of ["alice", "bob", "admin"]) {
    assert.ok(
      (await feed(user)).body.items.some(
        (i) => i.kind === "task" && i.id === task,
      ),
    );
    assert.ok(
      (await call(user, "GET", "/tasks")).body.tasks.some((i) => i.id === task),
    );
  }
  assert.ok(
    !(await feed("eve")).body.items.some(
      (i) => i.kind === "task" && i.id === task,
    ),
  );
  assert.ok(
    !(await call("eve", "GET", "/tasks?search=Private")).body.tasks.some(
      (i) => i.id === task,
    ),
  );
});
test("private task absent in contact card, notifications and export", async () => {
  const card = await call("eve", "GET", `/contacts/${contact}`);
  assert.equal(card.status, 200);
  assert.ok(!card.body.contact.tasks.some((t) => t.id === task));
  const notifications = await call("eve", "GET", "/analytics/notifications");
  assert.equal(notifications.status, 200);
  assert.ok(!JSON.stringify(notifications.body).includes("Private task"));
  const exported = await call("eve", "GET", "/export/tasks");
  assert.equal(exported.status, 200);
  const XLSX = (await import("xlsx")).default;
  const book = XLSX.read(exported.body);
  assert.ok(
    !JSON.stringify(
      XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]),
    ).includes("Private task"),
  );
  for (const url of [
    "/analytics/dashboard",
    "/analytics/managers",
    "/export/analytics",
  ])
    assert.equal((await call("eve", "GET", url)).status, 200);
});
test("task ownership enforced even with tasks.delete permission; assignee can complete", async () => {
  assert.equal(
    (await call("eve", "PATCH", `/tasks/${task}`, { title: "hacked" })).status,
    403,
  );
  assert.equal((await call("eve", "DELETE", `/tasks/${task}`)).status, 403);
  assert.equal(
    (await call("bob", "PATCH", `/tasks/${task}`, { status: "done" })).status,
    200,
  );
  assert.equal(
    db.prepare("SELECT status FROM tasks WHERE id=?").get(task).status,
    "done",
  );
  assert.equal(
    (await call("alice", "PATCH", `/tasks/${task}`, { scope: "shared" }))
      .status,
    200,
  );
  assert.ok(
    (await feed("eve")).body.items.some(
      (i) => i.kind === "task" && i.id === task,
    ),
  );
});
test("invalid task updates do not partially update title", async () => {
  const title = db
    .prepare("SELECT title FROM tasks WHERE id=?")
    .get(task).title;
  assert.equal(
    (
      await call("alice", "PATCH", `/tasks/${task}`, {
        title: "changed",
        due_date: "invalid",
      })
    ).status,
    400,
  );
  assert.equal(
    db.prepare("SELECT title FROM tasks WHERE id=?").get(task).title,
    title,
  );
});
test("deletion by author/admin works and missing resources return 404", async () => {
  assert.equal(
    (await call("alice", "DELETE", `/calendar/${personal}`)).status,
    200,
  );
  assert.equal(
    (await call("admin", "DELETE", `/calendar/${shared}`)).status,
    200,
  );
  assert.equal((await call("bob", "DELETE", `/tasks/${task}`)).status, 200);
  assert.equal(
    (await call("alice", "DELETE", `/calendar/${personal}`)).status,
    404,
  );
});
after(async () => {
  await new Promise((r) => server.close(r));
  db.close();
  rmSync(temp, { recursive: true, force: true });
});
