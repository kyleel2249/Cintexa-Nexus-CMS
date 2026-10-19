/**
 * Tiny dependency-free validation library.
 *
 *  - strips unknown keys (mass-assignment protection)
 *  - money is validated and returned as a canonical decimal string - never a float
 *  - numeric strings are accepted for numbers/ints/booleans so the same schemas validate query strings
 *  - every failure is collected, so the UI can highlight all invalid fields at once
 */
import { validationFailed, type FieldIssue } from "./errors";

export interface Schema<T> {
  readonly kind: string;
  /** Returns the parsed value, or undefined after pushing issues. */
  parse(value: unknown, path: string, issues: FieldIssue[]): T | undefined;
  readonly isOptional?: boolean;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

const MISSING = (path: string, issues: FieldIssue[]) => issues.push({ path, message: `${label(path)} is required` });
const label = (path: string) => (path.split(".").pop() || "value").replace(/\[\d+\]$/, "").replace(/_/g, " ");

function make<T>(kind: string, parse: Schema<T>["parse"], isOptional = false): Schema<T> {
  return { kind, parse, isOptional };
}

export interface StringOpts {
  min?: number;
  max?: number;
  pattern?: RegExp;
  patternMessage?: string;
  lower?: boolean;
  upper?: boolean;
  /** keep inner/outer whitespace untouched (default trims) */
  raw?: boolean;
  /** allow the empty string (default: empty string is treated as missing when min>=1) */
  allowEmpty?: boolean;
}

function string(opts: StringOpts = {}): Schema<string> {
  return make("string", (value, path, issues) => {
    if (value === undefined || value === null) return MISSING(path, issues), undefined;
    if (typeof value !== "string") return issues.push({ path, message: `${label(path)} must be text` }), undefined;
    let s = opts.raw ? value : value.trim();
    // control characters other than tab/newline are never valid in business text
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(s)) return issues.push({ path, message: `${label(path)} contains invalid characters` }), undefined;
    if (opts.lower) s = s.toLowerCase();
    if (opts.upper) s = s.toUpperCase();
    const min = opts.min ?? 0;
    if (s.length === 0 && min >= 1 && !opts.allowEmpty) return MISSING(path, issues), undefined;
    if (s.length < min) return issues.push({ path, message: `${label(path)} must be at least ${min} characters` }), undefined;
    if (opts.max !== undefined && s.length > opts.max) return issues.push({ path, message: `${label(path)} must be at most ${opts.max} characters` }), undefined;
    if (opts.pattern && !opts.pattern.test(s)) return issues.push({ path, message: opts.patternMessage ?? `${label(path)} is not in a valid format` }), undefined;
    return s;
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const email = () => string({ max: 254, lower: true, pattern: EMAIL_RE, patternMessage: "Enter a valid email address" });
const phone = () => string({ max: 40, pattern: /^[+()\d][\d\s().\-+x]{3,38}$/, patternMessage: "Enter a valid phone number" });

export interface NumberOpts {
  min?: number;
  max?: number;
  int?: boolean;
}

function number(opts: NumberOpts = {}): Schema<number> {
  return make("number", (value, path, issues) => {
    if (value === undefined || value === null || value === "") return MISSING(path, issues), undefined;
    let n: number;
    if (typeof value === "number") n = value;
    else if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) n = Number(value.trim());
    else return issues.push({ path, message: `${label(path)} must be a number` }), undefined;
    if (!Number.isFinite(n)) return issues.push({ path, message: `${label(path)} must be a finite number` }), undefined;
    if (opts.int && !Number.isInteger(n)) return issues.push({ path, message: `${label(path)} must be a whole number` }), undefined;
    if (opts.min !== undefined && n < opts.min) return issues.push({ path, message: `${label(path)} must be at least ${opts.min}` }), undefined;
    if (opts.max !== undefined && n > opts.max) return issues.push({ path, message: `${label(path)} must be at most ${opts.max}` }), undefined;
    return n;
  });
}

const int = (opts: Omit<NumberOpts, "int"> = {}) => number({ ...opts, int: true });
/** Database ids are positive 32-bit integers. */
const id = () => int({ min: 1, max: 2147483647 });

function boolean(): Schema<boolean> {
  return make("boolean", (value, path, issues) => {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
    if (value === undefined || value === null) return MISSING(path, issues), undefined;
    return issues.push({ path, message: `${label(path)} must be true or false` }), undefined;
  });
}

export interface MoneyOpts {
  min?: string;
  max?: string;
  /** decimal places allowed (default 2) */
  scale?: number;
}

/** Canonical decimal string, e.g. 12 -> "12.00", "1,000" is rejected. Compared with BigInt, never floats. */
export function normalizeDecimal(raw: unknown, scale: number): string | null {
  let s: string;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    // numbers are only accepted when their shortest representation has no exponent
    s = String(raw);
    if (/e/i.test(s)) return null;
  } else if (typeof raw === "string") s = raw.trim();
  else return null;
  const m = /^(-)?(\d{1,15})(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = m[3] ?? "";
  if (frac.length > scale) {
    // 1.50 with scale 1 is fine, 1.55 with scale 1 is not
    if (/[^0]/.test(frac.slice(scale))) return null;
  }
  const padded = (frac + "0".repeat(scale)).slice(0, scale);
  const int = m[2]!.replace(/^0+(?=\d)/, "");
  const negative = m[1] && /[^0]/.test(int + padded) ? "-" : "";
  return `${negative}${int}${scale > 0 ? "." + padded : ""}`;
}

export function compareDecimal(a: string, b: string): number {
  const scale = Math.max(a.split(".")[1]?.length ?? 0, b.split(".")[1]?.length ?? 0);
  const toBig = (s: string) => {
    const neg = s.startsWith("-");
    const [i, f = ""] = s.replace("-", "").split(".");
    const v = BigInt(i! + (f + "0".repeat(scale)).slice(0, scale));
    return neg ? -v : v;
  };
  const x = toBig(a);
  const y = toBig(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function money(opts: MoneyOpts = {}): Schema<string> {
  const scale = opts.scale ?? 2;
  return make("money", (value, path, issues) => {
    if (value === undefined || value === null || value === "") return MISSING(path, issues), undefined;
    const d = normalizeDecimal(value, scale);
    if (d === null) return issues.push({ path, message: `${label(path)} must be an amount with at most ${scale} decimal places` }), undefined;
    const min = opts.min ?? "0";
    if (compareDecimal(d, min) < 0) return issues.push({ path, message: `${label(path)} must be at least ${min}` }), undefined;
    if (opts.max !== undefined && compareDecimal(d, opts.max) > 0) return issues.push({ path, message: `${label(path)} must be at most ${opts.max}` }), undefined;
    return d;
  });
}

function enumOf<const T extends readonly string[]>(values: T): Schema<T[number]> {
  return make("enum", (value, path, issues) => {
    if (value === undefined || value === null || value === "") return MISSING(path, issues), undefined;
    if (typeof value === "string" && (values as readonly string[]).includes(value)) return value as T[number];
    return issues.push({ path, message: `${label(path)} must be one of: ${values.join(", ")}` }), undefined;
  });
}

/** Strict calendar date YYYY-MM-DD (rejects 2026-02-30). */
export function isValidDateString(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function date(): Schema<string> {
  return make("date", (value, path, issues) => {
    if (value === undefined || value === null || value === "") return MISSING(path, issues), undefined;
    if (typeof value !== "string" || !isValidDateString(value.trim())) return issues.push({ path, message: `${label(path)} must be a valid date (YYYY-MM-DD)` }), undefined;
    return value.trim();
  });
}

/** ISO-8601 instant. A timezone designator is mandatory so ambiguous local times are never stored. */
function timestamp(): Schema<string> {
  return make("timestamp", (value, path, issues) => {
    if (value === undefined || value === null || value === "") return MISSING(path, issues), undefined;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(value.trim()))
      return issues.push({ path, message: `${label(path)} must be an ISO date-time with a timezone (e.g. 2026-10-17T09:00:00Z)` }), undefined;
    const t = Date.parse(value.trim());
    if (Number.isNaN(t)) return issues.push({ path, message: `${label(path)} is not a valid date-time` }), undefined;
    return new Date(t).toISOString();
  });
}

function array<T>(item: Schema<T>, opts: { min?: number; max?: number } = {}): Schema<T[]> {
  return make("array", (value, path, issues) => {
    if (value === undefined || value === null) return MISSING(path, issues), undefined;
    if (!Array.isArray(value)) return issues.push({ path, message: `${label(path)} must be a list` }), undefined;
    if (opts.min !== undefined && value.length < opts.min) return issues.push({ path, message: `${label(path)} needs at least ${opts.min} item(s)` }), undefined;
    const max = opts.max ?? 1000;
    if (value.length > max) return issues.push({ path, message: `${label(path)} can have at most ${max} items` }), undefined;
    const out: T[] = [];
    let ok = true;
    value.forEach((el, i) => {
      const before = issues.length;
      const parsed = item.parse(el, `${path}[${i}]`, issues);
      if (issues.length > before) ok = false;
      else out.push(parsed as T);
    });
    return ok ? out : undefined;
  });
}

type Shape = Record<string, Schema<any>>;
type ObjectOut<S extends Shape> = {
  [K in keyof S as undefined extends Infer<S[K]> ? never : K]: Infer<S[K]>;
} & {
  [K in keyof S as undefined extends Infer<S[K]> ? K : never]?: Infer<S[K]>;
};

function object<S extends Shape>(shape: S): Schema<ObjectOut<S>> {
  return make("object", (value, path, issues) => {
    if (value === undefined || value === null) return MISSING(path, issues), undefined;
    if (typeof value !== "object" || Array.isArray(value)) return issues.push({ path: path || "body", message: "A JSON object is required" }), undefined;
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let ok = true;
    for (const key of Object.keys(shape)) {
      const child = shape[key]!;
      const raw = src[key];
      const childPath = path ? `${path}.${key}` : key;
      if ((raw === undefined || raw === null) && child.isOptional) {
        if (raw === null) out[key] = null;
        continue;
      }
      const before = issues.length;
      const parsed = child.parse(raw, childPath, issues);
      if (issues.length > before) ok = false;
      else if (parsed !== undefined) out[key] = parsed;
    }
    return ok ? (out as ObjectOut<S>) : undefined;
  });
}

function optional<T>(inner: Schema<T>): Schema<T | undefined> {
  return make(inner.kind, (value, path, issues) => (value === undefined || value === null || value === "" ? undefined : inner.parse(value, path, issues)), true);
}

/** Accepts an explicit null (clear the field) as well as a value. */
function nullable<T>(inner: Schema<T>): Schema<T | null | undefined> {
  return make(
    inner.kind,
    (value, path, issues) => (value === null || value === "" ? null : value === undefined ? undefined : inner.parse(value, path, issues)),
    true,
  );
}

function withDefault<T>(inner: Schema<T>, fallback: T): Schema<T> {
  // Not flagged optional: object() must still call parse() so the default is applied when the key is absent.
  return make(inner.kind, (value, path, issues) => (value === undefined || value === null || value === "" ? fallback : inner.parse(value, path, issues)), false);
}

function any(): Schema<unknown> {
  return make("any", (value) => value, true);
}

function record<T>(item: Schema<T>, opts: { maxKeys?: number } = {}): Schema<Record<string, T>> {
  return make("record", (value, path, issues) => {
    if (value === undefined || value === null) return MISSING(path, issues), undefined;
    if (typeof value !== "object" || Array.isArray(value)) return issues.push({ path, message: `${label(path)} must be an object` }), undefined;
    const keys = Object.keys(value as object);
    if (keys.length > (opts.maxKeys ?? 200)) return issues.push({ path, message: `${label(path)} has too many entries` }), undefined;
    const out: Record<string, T> = {};
    let ok = true;
    for (const k of keys) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") {
        issues.push({ path: `${path}.${k}`, message: "Reserved key" });
        ok = false;
        continue;
      }
      const before = issues.length;
      const parsed = item.parse((value as Record<string, unknown>)[k], `${path}.${k}`, issues);
      if (issues.length > before) ok = false;
      else out[k] = parsed as T;
    }
    return ok ? out : undefined;
  });
}

export const v = {
  string,
  email,
  phone,
  number,
  int,
  id,
  boolean,
  money,
  enumOf,
  date,
  timestamp,
  array,
  object,
  optional,
  nullable,
  withDefault,
  any,
  record,
};

export function parse<T>(schema: Schema<T>, input: unknown, rootPath = ""): T {
  const issues: FieldIssue[] = [];
  const out = schema.parse(input === undefined ? {} : input, rootPath, issues);
  if (issues.length || out === undefined) throw validationFailed(issues.length ? issues : [{ path: rootPath || "body", message: "Invalid input" }]);
  return out;
}

/** Escape LIKE wildcards so user search text is matched literally. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
