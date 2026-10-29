// © 2026 DobrayaSwaga. See LICENSE.
import crypto from "node:crypto";
import { db } from "./db.js";
import { readPeopleSheet, isCollegeSheet } from "./workbook.js";
import {
  normalizePhone,
  isoDate,
  parseEventDateTime,
  recalcScore,
  audit,
} from "./util.js";
const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
const digest = (s) => crypto.createHash("sha256").update(s).digest("hex");
export function importCollege(buffer, filename, userId, requestedType = null) {
  const sheet = readPeopleSheet(buffer);
  if (!isCollegeSheet(sheet))
    throw new Error(
      "Нужен лист заявок с ФИО, ID билета и наименованием мероприятия",
    );
  const isDodReport = requestedType === "dod" || sheet.rows[0].some(h => /^фио посетителя$/i.test(String(h).trim()));
  const rows = sheet.rows.slice(1),
    h = sheet.headings;
  const value = (row, name) => String(row[h.indexOf(name)] ?? "").trim();
  const result = {
    total: rows.length,
    created: 0,
    matched: 0,
    visited: 0,
    registered: 0,
    already: 0,
    skipped: 0,
    eventsCreated: 0,
    errors: [],
  };
  const status = db
    .prepare("SELECT id FROM statuses ORDER BY sort_order LIMIT 1")
    .get();
  const affected = new Set();
  db.exec("BEGIN");
  try {
    for (const [index, row] of rows.entries()) {
      const fio = value(row, "фио"),
        phone = value(row, "телефон"),
        phoneNorm = normalizePhone(phone);
      const parts = fio.split(/\s+/),
        birth = isoDate(value(row, "дата рождения"));
      const title = value(row, "наименование мероприятия");
      const date = parseEventDateTime(
        `${value(row, "дата проведения")} ${value(row, "время проведения")}`,
      );
      if (!fio || !title || !date.date) {
        result.skipped++;
        result.errors.push({
          row: index + 2,
          error: "Отсутствует ФИО, название или дата мероприятия",
        });
        continue;
      }
      const st = norm(value(row, "статус билета"));
      const fingerprint = digest(JSON.stringify(row));
      if (
        db
          .prepare("SELECT 1 FROM college_import_rows WHERE fingerprint=?")
          .get(fingerprint)
      ) {
        result.already++;
        continue;
      }
      // GUID may describe a family account, not a person. Name is always part of identity.
      const identity = digest(
        JSON.stringify([
          norm(fio),
          phoneNorm,
          birth,
          norm(value(row, "почта")),
        ]),
      );
      let contact = db
        .prepare(
          "SELECT c.* FROM college_people p JOIN contacts c ON c.id=p.contact_id WHERE p.identity=?",
        )
        .get(identity);
      if (!contact && phoneNorm) {
        const candidates = db
          .prepare("SELECT * FROM contacts WHERE phone_normalized=?")
          .all(phoneNorm)
          .filter(
            (c) =>
              norm(
                [c.last_name, c.first_name, c.middle_name]
                  .filter(Boolean)
                  .join(" "),
              ) === norm(fio) &&
              (!c.birth_date || !birth || c.birth_date === birth),
          );
        if (candidates.length === 1) contact = candidates[0];
      }
      if (!contact) {
        const school =
          value(row, "образовательная организация (другое)") ||
          value(row, "образовательная организация");
        const role = /представител/i.test(value(row, "тип посетителя"))
          ? "parent"
          : /школьник/i.test(value(row, "тип посетителя"))
            ? "child"
            : "";
        const info = db
          .prepare(
            `INSERT INTO contacts(last_name,first_name,middle_name,phone,phone_normalized,email,birth_date,school,grade,city,source,status_id,owner_id,created_by,contact_role) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            parts[0],
            parts[1] || "",
            parts.slice(2).join(" "),
            phone,
            phoneNorm,
            value(row, "почта"),
            birth,
            school,
            value(row, "класс"),
            value(row, "регион"),
            isDodReport ? "Отчет ДОД" : "Экспорт колледж",
            status?.id || null,
            userId,
            userId,
            role,
          );
        contact = { id: Number(info.lastInsertRowid) };
        result.created++;
      } else result.matched++;
      db.prepare(
        "INSERT OR IGNORE INTO college_people(identity,contact_id) VALUES (?,?)",
      ).run(identity, contact.id);
      const eventType = ["dod", "school", "external"].includes(requestedType)
        ? requestedType
        : /день открытых|(^|\s)дод(\s|$)/i.test(`${value(row, "тип")} ${title}`)
          ? "dod"
          : /выезд.*школ|школьный выезд/i.test(`${value(row, "тип")} ${title}`)
            ? "school"
            : "external";
      let event = db
        .prepare("SELECT * FROM dod_events WHERE name=? AND event_date=?")
        .get(title, date.iso);
      if (!event) {
        const info = db
          .prepare(
            "INSERT INTO dod_events(name,event_date,location,description,event_type,created_by) VALUES (?,?,?,?,?,?)",
          )
          .run(
            title,
            date.iso,
            value(row, "адрес мероприятия"),
            `Из файла ${filename}`,
            eventType,
            userId,
          );
        event = { id: Number(info.lastInsertRowid), event_type: eventType };
        result.eventsCreated++;
      }
      const visitType = event.event_type || eventType;
      const type = st.includes("посетил")
        ? visitType
        : st.includes("зарегистр")
          ? `${visitType}_registration`
          : "note";
      if (
        !db
          .prepare(
            "SELECT id FROM touchpoints WHERE contact_id=? AND dod_event_id=? AND type=?",
          )
          .get(contact.id, event.id, type)
      ) {
        const details = Object.fromEntries(
          h.map((name, i) => [name, row[i] ?? ""]),
        );
        db.prepare(
          "INSERT INTO touchpoints(contact_id,type,title,description,event_date,dod_event_id,created_by) VALUES (?,?,?,?,?,?,?)",
        ).run(
          contact.id,
          type,
          `${type === visitType ? "Посещение" : type === `${visitType}_registration` ? "Регистрация" : st.includes("неявка") ? "Неявка" : "Заявка"}: ${title}`,
          JSON.stringify(details),
          date.iso,
          event.id,
          userId,
        );
        if (type === visitType) result.visited++;
        else if (type === `${visitType}_registration`) result.registered++;
      }
      db.prepare(
        "INSERT INTO college_import_rows(fingerprint,contact_id) VALUES (?,?)",
      ).run(fingerprint, contact.id);
      affected.add(contact.id);
    }
    for (const id of affected) recalcScore(id);
    db.prepare(
      "INSERT INTO imports(filename,kind,user_id,total_rows,imported,duplicates,errors,mapping) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      filename,
      "attendance",
      userId,
      rows.length,
      result.created,
      result.matched + result.already,
      result.skipped,
      JSON.stringify({ sheet: sheet.name, format: "college" }),
    );
    audit(userId, "import.college", "imports", null, {
      total: result.total,
      created: result.created,
      already: result.already,
      skipped: result.skipped,
    });
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
