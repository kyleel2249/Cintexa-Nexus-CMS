import { CREDENTIAL_TYPES, FAILURE_CODES, SkError, type CredentialType } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const bad = (field: string, message: string) => new SkError(400, "validation_failed", `${field}: ${message}`, { issues: [{ path: field, message }] });

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export function uuid(v: unknown, field: string): string { if (!isUuid(v)) throw bad(field, "must be a UUID"); return v.toLowerCase(); }
export function obj(v: unknown, field = "body"): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v)) throw bad(field, "must be an object"); return v as Record<string, unknown>; }

export function str(v: unknown, field: string, max: number, opts: { required?: boolean } = {}): string | null {
  if (v === undefined || v === null || v === "") { if (opts.required) throw bad(field, "is required"); return null; }
  if (typeof v !== "string") throw bad(field, "must be text");
  const t = v.trim();
  if (!t) { if (opts.required) throw bad(field, "is required"); return null; }
  if (t.length > max) throw bad(field, `must be at most ${max} characters`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(t)) throw bad(field, "contains control characters");
  return t;
}
export function tags(v: unknown, field = "tags"): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 20) throw bad(field, "must be a list of at most 20 tags");
  const out = new Set<string>();
  for (const t of v) { const s = str(t, field, 40); if (s) out.add(s); }
  return [...out];
}
export function date(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) throw bad(field, "must be an ISO date");
  return new Date(v).toISOString();
}
export function bool(v: unknown, field: string): boolean | undefined { if (v === undefined) return undefined; if (typeof v !== "boolean") throw bad(field, "must be true or false"); return v; }
export function credentialType(v: unknown, field = "type"): CredentialType {
  if (typeof v !== "string" || !(CREDENTIAL_TYPES as readonly string[]).includes(v)) throw bad(field, `must be one of ${CREDENTIAL_TYPES.join(", ")}`);
  return v as CredentialType;
}
export function failureCode(v: unknown): string { if (typeof v !== "string" || !(FAILURE_CODES as readonly string[]).includes(v)) throw bad("code", `must be one of ${FAILURE_CODES.join(", ")}`); return v; }

/** Generation settings are non-secret descriptors (length, format...). Only flat scalars are accepted, size-bounded. */
export function settings(v: unknown, field = "settings"): Record<string, string | number | boolean> {
  if (v === undefined || v === null) return {};
  const o = obj(v, field);
  const keys = Object.keys(o);
  if (keys.length > 30) throw bad(field, "has too many entries");
  const out: Record<string, string | number | boolean> = {};
  for (const k of keys) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k) || k === "__proto__") throw bad(field, `invalid key "${k}"`);
    const x = o[k];
    if (typeof x === "string") { if (x.length > 120) throw bad(field, `${k} is too long`); out[k] = x; }
    else if (typeof x === "number" && Number.isFinite(x)) out[k] = x;
    else if (typeof x === "boolean") out[k] = x;
    else throw bad(field, `${k} must be text, number or boolean`);
  }
  return out;
}
export function b64(v: unknown, field: string, minLen: number, maxLen: number): string {
  if (typeof v !== "string" || v.length < minLen || v.length > maxLen || !B64.test(v)) throw bad(field, "must be base64");
  return v;
}
export const nameKey = (name: string) => name.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
export const MAX_CIPHERTEXT = 96 * 1024;
export function int(v: unknown, def: number, min: number, max: number): number { const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN; return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : def; }
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
