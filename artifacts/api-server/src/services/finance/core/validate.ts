import { validationFailed, type FieldIssue } from "./errors";
import { parseMoney } from "./money";

/** Minimal request-body validator. Collects every issue and throws one 422 `validation_failed`. */
export class V {
  readonly issues: FieldIssue[] = [];
  constructor(private readonly src: Record<string, any>, private readonly prefix = "") {}
  private fail(k: string, m: string) { this.issues.push({ path: this.prefix + k, message: m }); }
  str(k: string, o: { min?: number; max?: number; optional?: boolean; oneOf?: readonly string[]; pattern?: RegExp } = {}): string | undefined {
    const v = this.src[k];
    if (v === undefined || v === null || v === "") { if (!o.optional) this.fail(k, `${k} is required`); return undefined; }
    if (typeof v !== "string") { this.fail(k, `${k} must be text`); return undefined; }
    const s = v.trim();
    if (o.min && s.length < o.min) this.fail(k, `${k} must be at least ${o.min} characters`);
    if (s.length > (o.max ?? 2000)) this.fail(k, `${k} must be at most ${o.max ?? 2000} characters`);
    if (o.oneOf && !o.oneOf.includes(s)) this.fail(k, `${k} must be one of: ${o.oneOf.join(", ")}`);
    if (o.pattern && !o.pattern.test(s)) this.fail(k, `${k} is not in a valid format`);
    return s;
  }
  date(k: string, optional = false): string | undefined {
    const v = this.src[k];
    if (v === undefined || v === null || v === "") { if (!optional) this.fail(k, `${k} is required`); return undefined; }
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + "T00:00:00Z")) || new Date(v + "T00:00:00Z").toISOString().slice(0, 10) !== v) { this.fail(k, `${k} must be a valid date (YYYY-MM-DD)`); return undefined; }
    return v;
  }
  int(k: string, o: { min?: number; max?: number; optional?: boolean } = {}): number | undefined {
    const v = this.src[k];
    if (v === undefined || v === null || v === "") { if (!o.optional) this.fail(k, `${k} is required`); return undefined; }
    const n = typeof v === "string" ? Number(v) : v;
    if (!Number.isInteger(n) || n < (o.min ?? -2147483648) || n > (o.max ?? 2147483647)) { this.fail(k, `${k} must be a whole number`); return undefined; }
    return n;
  }
  bool(k: string, optional = true): boolean | undefined {
    const v = this.src[k];
    if (v === undefined || v === null) { if (!optional) this.fail(k, `${k} is required`); return undefined; }
    if (typeof v !== "boolean") { this.fail(k, `${k} must be true or false`); return undefined; }
    return v;
  }
  money(k: string, o: { optional?: boolean; allowNegative?: boolean } = {}): bigint | undefined {
    const v = this.src[k];
    if (v === undefined || v === null || v === "") { if (!o.optional) this.fail(k, `${k} is required`); return undefined; }
    const m = parseMoney(v);
    if (m === null) { this.fail(k, `${k} must be a decimal amount with at most 2 decimals`); return undefined; }
    if (m < 0n && !o.allowNegative) { this.fail(k, `${k} cannot be negative`); return undefined; }
    return m;
  }
  raw(k: string) { return this.src[k]; }
  done(): void { if (this.issues.length) throw validationFailed(this.issues); }
}

export const asObject = (b: unknown): Record<string, any> => (b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, any>) : {});
export const todayIn = (tz: string, now: Date): string => {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now); } catch { return now.toISOString().slice(0, 10); }
};
export const qstr = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v) || undefined;

/** DATE columns arrive as 'YYYY-MM-DD' from the server `pg` adapter but as Date objects from some on-device drivers; normalise. */
export const ymd = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
