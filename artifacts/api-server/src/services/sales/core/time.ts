/**
 * Time handling. All instants are stored as UTC (TIMESTAMPTZ) and serialised as ISO strings. Business periods
 * (today, week, month, quarter, year) are computed in the configured *business timezone* so "today's sales"
 * means today for the company, not for the server.
 */
export type Period = "today" | "yesterday" | "week" | "last_week" | "month" | "last_month" | "quarter" | "last_quarter" | "year" | "last_year" | "last_30_days" | "last_90_days";

export interface Range {
  /** inclusive, UTC ISO instant */
  from: string;
  /** exclusive, UTC ISO instant */
  to: string;
  label: string;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface Parts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
}

function partsIn(instant: Date, tz: string): Parts {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(instant)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year!, m: o.month!, d: o.day!, hh: o.hour!, mm: o.minute!, ss: o.second! };
}

/** Offset (ms) of `tz` from UTC at the given instant. */
function offsetAt(instant: Date, tz: string): number {
  const p = partsIn(instant, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `tz` reads y-m-d 00:00 (handles DST by re-checking the offset). */
export function startOfDayUtc(y: number, m: number, d: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  let t = guess - offsetAt(new Date(guess), tz);
  const off2 = offsetAt(new Date(t), tz);
  t = guess - off2;
  return new Date(t);
}

/** Calendar date (YYYY-MM-DD) of an instant in the business timezone. */
export function businessDate(instant: Date, tz: string): string {
  const p = partsIn(instant, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function addDays(y: number, m: number, d: number, n: number): { y: number; m: number; d: number } {
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function rangeFor(period: Period, now: Date, tz: string, weekStartsOn: 0 | 1 = 1): Range {
  const p = partsIn(now, tz);
  const sod = (y: number, m: number, d: number) => startOfDayUtc(y, m, d, tz).toISOString();
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  const sinceWeekStart = (dow - weekStartsOn + 7) % 7;
  switch (period) {
    case "today": {
      const n = addDays(p.y, p.m, p.d, 1);
      return { from: sod(p.y, p.m, p.d), to: sod(n.y, n.m, n.d), label: "Today" };
    }
    case "yesterday": {
      const s = addDays(p.y, p.m, p.d, -1);
      return { from: sod(s.y, s.m, s.d), to: sod(p.y, p.m, p.d), label: "Yesterday" };
    }
    case "week":
    case "last_week": {
      const s = addDays(p.y, p.m, p.d, -sinceWeekStart - (period === "last_week" ? 7 : 0));
      const e = addDays(s.y, s.m, s.d, 7);
      return { from: sod(s.y, s.m, s.d), to: sod(e.y, e.m, e.d), label: period === "week" ? "This week" : "Last week" };
    }
    case "month":
    case "last_month": {
      const off = period === "last_month" ? -1 : 0;
      const start = new Date(Date.UTC(p.y, p.m - 1 + off, 1));
      const end = new Date(Date.UTC(p.y, p.m + off, 1));
      return {
        from: sod(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
        to: sod(end.getUTCFullYear(), end.getUTCMonth() + 1, 1),
        label: `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`,
      };
    }
    case "quarter":
    case "last_quarter": {
      const q = Math.floor((p.m - 1) / 3) + (period === "last_quarter" ? -1 : 0);
      const start = new Date(Date.UTC(p.y, q * 3, 1));
      const end = new Date(Date.UTC(p.y, q * 3 + 3, 1));
      return {
        from: sod(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
        to: sod(end.getUTCFullYear(), end.getUTCMonth() + 1, 1),
        label: `Q${(((q % 4) + 4) % 4) + 1} ${start.getUTCFullYear()}`,
      };
    }
    case "year":
    case "last_year": {
      const y = p.y + (period === "last_year" ? -1 : 0);
      return { from: sod(y, 1, 1), to: sod(y + 1, 1, 1), label: String(y) };
    }
    case "last_30_days":
    case "last_90_days": {
      const days = period === "last_30_days" ? 30 : 90;
      const s = addDays(p.y, p.m, p.d, -(days - 1));
      const e = addDays(p.y, p.m, p.d, 1);
      return { from: sod(s.y, s.m, s.d), to: sod(e.y, e.m, e.d), label: `Last ${days} days` };
    }
  }
}

/** Range from two business dates (inclusive start, inclusive end date). */
export function rangeFromDates(fromDate: string, toDate: string, tz: string): Range {
  const [fy, fm, fd] = fromDate.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = toDate.split("-").map(Number) as [number, number, number];
  const e = addDays(ty, tm, td, 1);
  return { from: startOfDayUtc(fy, fm, fd, tz).toISOString(), to: startOfDayUtc(e.y, e.m, e.d, tz).toISOString(), label: `${fromDate} – ${toDate}` };
}

/** The immediately preceding range of equal length (for period-over-period comparison). */
export function previousRange(r: Range): Range {
  const f = Date.parse(r.from);
  const t = Date.parse(r.to);
  return { from: new Date(f - (t - f)).toISOString(), to: r.from, label: "Previous period" };
}

/** Whole days between two instants, floored (can be negative). */
export function daysBetween(a: Date | string, b: Date | string): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

/** Fraction (0..1) of the range that has elapsed at `now`, clamped. Used for pacing. */
export function elapsedFraction(r: Range, now: Date): number {
  const f = Date.parse(r.from);
  const t = Date.parse(r.to);
  if (t <= f) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - f) / (t - f)));
}

export function addDaysIso(instant: Date | string, days: number): string {
  return new Date(new Date(instant).getTime() + days * 86_400_000).toISOString();
}
