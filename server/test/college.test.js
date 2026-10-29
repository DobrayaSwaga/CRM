// © 2026 DobrayaSwaga. See LICENSE.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import xlsx from "xlsx";
const dir = mkdtempSync(path.join(os.tmpdir(), "crm-college-"));
process.env.CRM_DB_PATH = path.join(dir, "test.db");
const { db } = await import("../src/db.js");
const { importCollege } = await import("../src/college-import.js");
const { readPeopleSheet } = await import("../src/workbook.js");
const { importRouter, guessMapping } = await import(
  "../src/routes/import.routes.js"
);
const { exportRouter } = await import("../src/routes/export.routes.js");
const { calendarRouter } = await import("../src/routes/calendar.routes.js");
const { requireAuth } = await import("../src/auth.js");
const file = readFileSync(
  new URL("../../Экспорт_колледж - 20261029-184934.xlsx", import.meta.url),
);
let report;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  if (req.headers["x-user"])
    req.user = {
      id: req.headers["x-user"] === "admin" ? 1 : 2,
      permissions:
        req.headers["x-user"] === "admin"
          ? ["*"]
          : ["import.run", "export.run"],
    };
  next();
});
app.use("/api", requireAuth);
app.use("/api/import", importRouter);
app.use("/api/export", exportRouter);
app.use("/api/calendar", calendarRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.on("listening", r));
const base = `http://127.0.0.1:${server.address().port}/api`;
async function upload(url, user = "admin") {
  const form = new FormData();
  form.append("file", new Blob([file]), "college.xlsx");
  return fetch(base + url, {
    method: "POST",
    headers: { "x-user": user },
    body: form,
  });
}

test("selects the applications sheet, not the event/organizer sheet", () => {
  const s = readPeopleSheet(file);
  assert.equal(s.name, "Заявки");
  assert.equal(s.rows.length - 1, 851);
  const { mapping } = guessMapping(s.rows[0]);
  assert.equal(
    s.headings[Object.keys(mapping).find((k) => mapping[k] === "phone")],
    "телефон",
  );
  assert.equal(
    s.headings[Object.keys(mapping).find((k) => mapping[k] === "email")],
    "почта",
  );
});
test("imports the actual supplied workbook without skipped people", () => {
  report = importCollege(file, "college.xlsx", 1);
  assert.equal(report.total, 851);
  assert.equal(report.skipped, 0);
  assert.deepEqual(report.errors, []);
  assert.ok(report.created > 600);
  assert.equal(report.created + report.matched, 851);
  assert.equal(report.eventsCreated, 14);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM college_import_rows").get().n,
    851,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM contacts WHERE search_text = ''").get()
      .n,
    0,
  );
  console.log("College report (counts only)", JSON.stringify(report));
});
test("repeat import never duplicates people or attendance", () => {
  const before = db.prepare("SELECT COUNT(*) n FROM touchpoints").get().n;
  const again = importCollege(file, "renamed.xlsx", 1);
  assert.equal(again.created, 0);
  assert.equal(again.already, 851);
  assert.equal(again.eventsCreated, 0);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM touchpoints").get().n,
    before,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM contacts").get().n,
    report.created,
  );
});
test("shared family phone does not merge distinct names", () => {
  const rows = db
    .prepare(
      "SELECT phone_normalized, COUNT(*) n FROM contacts WHERE phone_normalized != '' GROUP BY phone_normalized HAVING COUNT(*)>1",
    )
    .all();
  assert.ok(rows.length > 0);
});
test("preview endpoint reports the correct sheet and specialized importer", async () => {
  const response = await upload("/import/preview");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.sheetName, "Заявки");
  assert.equal(data.totalRows, 851);
  assert.equal(data.detected.kind, "college");
  const forbidden = await fetch(base + "/import/execute", {
    method: "POST",
    headers: { "x-user": "other", "Content-Type": "application/json" },
    body: JSON.stringify({
      fileKey: data.fileKey,
      mapping: data.guessedMapping,
    }),
  });
  // Cached previews are owned by the uploading user.
  assert.equal(forbidden.status, 400);
});
test("attendance endpoint supports all events and replay", async () => {
  const res = await upload("/import/attendance");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.college, true);
  assert.equal(data.already, 851);
});
test("calendar feed includes imported plan entries", async () => {
  const response = await fetch(
    base + "/calendar?from=2026-10-01&to=2026-11-01",
    { headers: { "x-user": "admin" } },
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.items.filter((i) => i.kind === "plan").length, 14);
});
test("full Excel requires wildcard admin and contains every contact, not secrets", async () => {
  const forbidden = await fetch(base + "/export/database", {
    headers: { "x-user": "other" },
  });
  assert.equal(forbidden.status, 403);
  assert.equal((await fetch(base + "/export/database")).status, 401);
  const response = await fetch(base + "/export/database?search=not-found", {
    headers: { "x-user": "admin" },
  });
  assert.equal(response.status, 200);
  const wb = xlsx.read(Buffer.from(await response.arrayBuffer()));
  assert.equal(
    xlsx.utils.sheet_to_json(wb.Sheets.contacts).length,
    report.created,
  );
  assert.equal(xlsx.utils.sheet_to_json(wb.Sheets.dod_events).length, 14);
  assert.equal(wb.Sheets.sessions, undefined);
  const users = xlsx.utils.sheet_to_json(wb.Sheets.users);
  assert.equal(users[0].password_hash, undefined);
  assert.ok(wb.Sheets.calendar_events);
  assert.ok(wb.Sheets.touchpoints);
});
test("logical backup round-trip retains new calendar and college identity tables", async () => {
  const { createLogicalBackup, restoreLogicalBackup } = await import(
    "../src/backup.js"
  );
  db.prepare(
    "INSERT INTO calendar_events(title,start_at,end_at,scope,created_by) VALUES ('Backup test','2026-10-29T09:00','2026-10-29T10:00','personal',1)",
  ).run();
  const payload = createLogicalBackup("test");
  assert.equal(payload.tables.college_import_rows.length, 851);
  assert.equal(payload.tables.calendar_events.length, 1);
  restoreLogicalBackup(payload, 1);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM college_import_rows").get().n,
    851,
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM calendar_events").get().n, 1);
  assert.equal(importCollege(file, "replay.xlsx", 1).created, 0);
});
after(async () => {
  await new Promise((r) => server.close(r));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
