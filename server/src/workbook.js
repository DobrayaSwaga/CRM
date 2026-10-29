// © 2026 DobrayaSwaga. See LICENSE.
import xlsx from "xlsx";
export const header = (value) =>
  String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/^"|"$/g, "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^фио посетителя$/, "фио");
export function readPeopleSheet(buffer) {
  const wb = xlsx.read(buffer, { type: "buffer", cellDates: true });
  const sheets = wb.SheetNames.map((name) => {
    const rows = xlsx.utils
      .sheet_to_json(wb.Sheets[name], {
        header: 1,
        defval: "",
        raw: false,
        dateNF: "yyyy-mm-dd",
      })
      .filter((r) => r.some((v) => String(v).trim()));
    const headings = (rows[0] || []).map(header);
    const score = headings.some((h) => /^(фио|фамилия|имя)$/.test(h))
      ? 10 +
        Number(headings.includes("телефон")) +
        Number(header(name) === "заявки")
      : 0;
    return { name, rows, headings, score };
  });
  const sheet = sheets.sort((a, b) => b.score - a.score)[0];
  if (!sheet?.rows.length) throw new Error("В книге нет непустых листов");
  if (sheet.rows.length > 50001)
    throw new Error("Максимум 50 000 строк на один импорт");
  return { ...sheet, sheetNames: wb.SheetNames };
}
export function isCollegeSheet(sheet) {
  return (
    sheet.headings.includes("id билета") &&
    sheet.headings.includes("фио") &&
    sheet.headings.includes("наименование мероприятия")
  );
}
