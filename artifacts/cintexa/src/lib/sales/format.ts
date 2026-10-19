/** Display helpers. Money arrives from the API as exact decimal strings and is only converted for display. */

let currency = "USD";
let locale = "en-US";
let timeZone: string | undefined;

export function configureFormat(c: { currency?: string; locale?: string; timezone?: string }): void {
  if (c.currency) currency = c.currency;
  if (c.locale) locale = c.locale;
  if (c.timezone) timeZone = c.timezone;
}

export const getCurrency = () => currency;

export function money(value: string | number | null | undefined, cur?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: cur ?? currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${cur ?? currency} ${n.toFixed(2)}`;
  }
}

export function moneyCompact(value: string | number | null | undefined, cur?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: cur ?? currency, notation: "compact", maximumFractionDigits: 1 }).format(n);
  } catch {
    return money(value, cur);
  }
}

export function num(value: number | string | null | undefined, digits = 0): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n) : "—";
}

export function percent(value: number | string | null | undefined, digits = 1): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n)}%` : "—";
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  // a bare YYYY-MM-DD is a calendar date: never shift it through a timezone
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00Z`) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function dateOnly(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return "—";
  const bare = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: bare ? "UTC" : timeZone }).format(d);
}

export function dateTime(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone }).format(d);
}

export function relative(v: string | Date | null | undefined, now = new Date()): string {
  const d = toDate(v);
  if (!d) return "—";
  const diff = d.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [[86_400_000 * 365, "year"], [86_400_000 * 30, "month"], [86_400_000 * 7, "week"], [86_400_000, "day"], [3_600_000, "hour"], [60_000, "minute"]];
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [ms, unit] of units) if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  return rtf.format(0, "minute");
}

export function titleCase(s: string | null | undefined): string {
  if (!s) return "—";
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** value for <input type="datetime-local"> from an ISO instant, in the browser's zone */
export function toLocalInput(iso: string | null | undefined): string {
  const d = toDate(iso);
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}
