import { createHash } from "node:crypto";
import { parseMoney } from "../core/money";

/** Small RFC-4180 CSV parser (quotes, escaped quotes, CRLF, BOM, comma/semicolon/tab auto-detect). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (q) { if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === delim) { row.push(cell); cell = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && src[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((c) => c.trim() !== "")) rows.push(row); row = []; } else cell += ch;
  }
  row.push(cell); if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

export type DateFormat = "ymd" | "dmy" | "mdy";
export function parseDate(s: string, fmt: DateFormat): string | null {
  const m = /^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})/.exec(s.trim()); if (!m) return null;
  let y: number, mo: number, d: number;
  if (fmt === "ymd") { y = +m[1]!; mo = +m[2]!; d = +m[3]!; } else if (fmt === "dmy") { d = +m[1]!; mo = +m[2]!; y = +m[3]!; } else { mo = +m[1]!; d = +m[2]!; y = +m[3]!; }
  if (y < 100) y += 2000;
  const iso = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return Number.isNaN(Date.parse(iso + "T00:00:00Z")) || new Date(iso + "T00:00:00Z").toISOString().slice(0, 10) !== iso ? null : iso;
}
/** "1,234.50", "(50.00)", "GHS 12.5", "-3" -> minor units; empty -> 0n; garbage -> null */
export function parseAmount(s: string): bigint | null {
  let t = s.trim(); if (t === "") return 0n;
  let neg = false; if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  t = t.replace(/[A-Za-z$£€₵\s]/g, "").replace(/,/g, "");
  if (t.startsWith("-")) { neg = !neg; t = t.slice(1); } else if (t.startsWith("+")) t = t.slice(1);
  const m = parseMoney(t); if (m === null) return null;
  return neg ? -m : m;
}

export interface Mapping { date?: string; description?: string; reference?: string; amount?: string; debit?: string; credit?: string; balance?: string }
export interface ParsedTxn { line: number; date: string; description: string; reference: string | null; amount: bigint; balance: bigint | null; fingerprint: string }
export interface ParseResult { headers: string[]; mapping: Required<Pick<Mapping, never>> & Mapping; rows: ParsedTxn[]; errors: { line: number; message: string }[]; skipped: number }

const GUESS: Record<keyof Mapping, RegExp> = { date: /date/i, description: /desc|narrat|detail|particular|memo/i, reference: /ref|cheque|check|trans(action)?\s*(id|no)/i, amount: /^(net\s*)?amount$/i, debit: /debit|withdraw|paid\s*out|money\s*out|dr\b/i, credit: /credit|deposit|paid\s*in|money\s*in|cr\b/i, balance: /balance/i };

export function parseStatement(text: string, o: { mapping?: Mapping; dateFormat: DateFormat }): ParseResult {
  const table = parseCsv(text);
  if (table.length < 2) return { headers: [], mapping: {}, rows: [], errors: [{ line: 1, message: "The file has no data rows" }], skipped: 0 };
  const headers = table[0]!;
  const mapping: Mapping = { ...(o.mapping ?? {}) };
  for (const k of Object.keys(GUESS) as (keyof Mapping)[]) if (!mapping[k]) { const h = headers.find((x) => GUESS[k].test(x) && !Object.values(mapping).includes(x)); if (h) mapping[k] = h; }
  const idx = (name?: string) => (name ? headers.findIndex((h) => h === name) : -1);
  const di = idx(mapping.date), ni = idx(mapping.description), ri = idx(mapping.reference), ai = idx(mapping.amount), dbi = idx(mapping.debit), ci = idx(mapping.credit), bi = idx(mapping.balance);
  const errors: { line: number; message: string }[] = [];
  if (di < 0) errors.push({ line: 1, message: "Could not find the date column - choose it in the column mapping" });
  if (ni < 0) errors.push({ line: 1, message: "Could not find the description column - choose it in the column mapping" });
  if (ai < 0 && dbi < 0 && ci < 0) errors.push({ line: 1, message: "Could not find an amount (or debit/credit) column - choose it in the column mapping" });
  if (errors.length) return { headers, mapping, rows: [], errors, skipped: 0 };
  const rows: ParsedTxn[] = []; const seen = new Map<string, number>(); let skipped = 0;
  if (table.length > 5001) errors.push({ line: 0, message: "At most 5000 rows can be imported at once" });
  for (let r = 1; r < Math.min(table.length, 5001); r++) {
    const c = table[r]!; const line = r + 1;
    const date = parseDate(c[di] ?? "", o.dateFormat); if (!date) { errors.push({ line, message: `Invalid date "${c[di] ?? ""}" (expected ${o.dateFormat === "ymd" ? "YYYY-MM-DD" : o.dateFormat === "dmy" ? "DD/MM/YYYY" : "MM/DD/YYYY"})` }); continue; }
    let amount: bigint | null;
    if (ai >= 0) amount = parseAmount(c[ai] ?? "");
    else { const out = parseAmount(c[dbi] ?? ""); const inn = parseAmount(c[ci] ?? ""); amount = out === null || inn === null ? null : (inn < 0n ? -inn : inn) - (out < 0n ? -out : out); }
    if (amount === null) { errors.push({ line, message: "Invalid amount" }); continue; }
    if (amount === 0n) { skipped++; continue; }
    const description = (c[ni] ?? "").slice(0, 300) || "(no description)"; const reference = ri >= 0 && c[ri] ? c[ri]!.slice(0, 120) : null;
    const bal = bi >= 0 && c[bi] ? parseAmount(c[bi]!) : null;
    const base = `${date}|${amount}|${description.toLowerCase().replace(/\s+/g, " ")}|${reference ?? ""}`;
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n); // identical lines in one file get distinct, repeatable fingerprints
    rows.push({ line, date, description, reference, amount, balance: bal, fingerprint: createHash("sha256").update(`${base}|${n}`).digest("hex") });
  }
  return { headers, mapping, rows, errors, skipped };
}
export const hashText = (s: string) => createHash("sha256").update(s).digest("hex");
