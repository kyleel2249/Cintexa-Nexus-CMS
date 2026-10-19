/** RFC 4180 CSV parser (quotes, escaped quotes, CRLF, embedded newlines). Dependency-free. */
export function parseCsv(text: string, maxRows = 5000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === "") inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      if (rows.length > maxRows + 1) throw new Error(`Too many rows (limit ${maxRows})`);
    } else field += c;
  }
  if (inQuotes) throw new Error("Unterminated quoted field");
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

/** First row = headers. Header names are normalised to snake_case so "First Name" maps to first_name. */
export function csvToObjects(text: string, maxRows = 5000): Array<Record<string, string>> {
  const rows = parseCsv(text, maxRows);
  if (!rows.length) return [];
  const headers = rows[0]!.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) o[h] = (r[i] ?? "").trim(); });
    return o;
  });
}
