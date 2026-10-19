import { badRequest } from "./errors";
import { v, parse } from "./validate";

export interface Page {
  page: number;
  pageSize: number;
  offset: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

const pageSchema = v.object({ page: v.withDefault(v.int({ min: 1, max: 100000 }), 1), pageSize: v.withDefault(v.int({ min: 1, max: 200 }), 25) });

export function pageOf(query: Record<string, unknown>): Page {
  const p = parse(pageSchema, query);
  return { page: p.page, pageSize: p.pageSize, offset: (p.page - 1) * p.pageSize };
}

/** Whitelisted ORDER BY - user input only ever selects a key from the map, never reaches SQL. */
export function orderBy(query: Record<string, unknown>, allowed: Record<string, string>, fallback: string, defaultDir: "asc" | "desc" = "desc"): string {
  const key = typeof query.sort === "string" ? query.sort : "";
  const col = allowed[key] ?? allowed[fallback];
  if (!col) throw badRequest("Invalid sort");
  const dir = (query.dir === "asc" || query.dir === "desc" ? query.dir : defaultDir) === "asc" ? "ASC" : "DESC";
  return `${col} ${dir} NULLS LAST, 1 ASC`;
}

export function str(query: Record<string, unknown>, key: string): string | undefined {
  const x = query[key];
  const s = Array.isArray(x) ? x[0] : x;
  return typeof s === "string" && s.trim() ? s.trim() : undefined;
}

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "object" ? JSON.stringify(value) : String(value);
  // CSV/Excel formula injection hardening
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  return [columns.join(","), ...rows.map((r) => columns.map((c) => csvEscape(r[c])).join(","))].join("\r\n") + "\r\n";
}

/** DATE/TIMESTAMP -> "YYYY-MM-DD" regardless of which driver produced the value. */
export function d10(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function iso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

/** Parse a comma-separated list of positive integer ids from a query value (safe to inline in SQL). */
export function idList(raw: string | undefined, max = 200): number[] {
  if (!raw) return [];
  const out = raw.split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  if (out.length > max || out.some((n) => !Number.isInteger(n) || n < 1 || n > 2147483647)) throw badRequest("Invalid id list");
  return [...new Set(out)];
}

/** Build a safe `col IN (1,2,3)` predicate; an empty list yields FALSE. */
export function inIds(column: string, ids: number[]): string {
  return ids.length ? `${column} IN (${ids.join(",")})` : "FALSE";
}
