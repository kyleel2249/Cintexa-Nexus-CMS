import { buildCategories, poolOf, type CharsetOptions } from "./charsets";
import { getCrypto, log2, pick, randomBytes, randomInt, toBase64Url, toHex } from "./random";

export const ID_LIMITS = { minLength: 4, maxLength: 128, defaultLength: 16, maxBulk: 500, minTokenBytes: 16, maxTokenBytes: 128 } as const;

export interface RandomIdOptions extends CharsetOptions {
  length: number;
  prefix?: string;
  suffix?: string;
}

const safeAffix = (s?: string) => (s ?? "").replace(/[\u0000-\u0020\u007f-\u009f]/g, "").slice(0, 32);

export function randomIdEntropyBits(o: RandomIdOptions): number {
  const pool = poolOf(buildCategories(o)).length;
  return pool < 2 ? 0 : o.length * log2(pool);
}

export function generateRandomId(o: RandomIdOptions): string {
  if (!Number.isInteger(o.length) || o.length < ID_LIMITS.minLength || o.length > ID_LIMITS.maxLength) throw new Error(`ID length must be between ${ID_LIMITS.minLength} and ${ID_LIMITS.maxLength}.`);
  const pool = poolOf(buildCategories(o));
  if (pool.length < 2) throw new Error("Select at least one character type.");
  let body = "";
  for (let i = 0; i < o.length; i++) body += pick(pool);
  return safeAffix(o.prefix) + body + safeAffix(o.suffix);
}

/** Generates up to `count` values, retrying on collision so every value in the batch is unique. */
export function generateUnique(generate: () => string, count: number, max: number = ID_LIMITS.maxBulk): string[] {
  const n = Math.min(Math.max(1, Math.floor(count)), max);
  const seen = new Set<string>();
  let guard = 0;
  while (seen.size < n) {
    if (guard++ > n * 50) throw new Error("Could not generate enough unique values. Increase the length or character set.");
    seen.add(generate());
  }
  return Array.from(seen);
}

const hex = (b: Uint8Array, from: number, to: number) => toHex(b.subarray(from, to));
function formatUuid(b: Uint8Array): string {
  return `${hex(b, 0, 4)}-${hex(b, 4, 6)}-${hex(b, 6, 8)}-${hex(b, 8, 10)}-${hex(b, 10, 16)}`;
}

/** UUID v4 (RFC 9562): 122 random bits. */
export function uuidv4(): string {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  return formatUuid(b);
}

/** UUID v7 (RFC 9562): 48-bit Unix ms timestamp followed by 74 random bits. Time-ordered; NOT a secret. */
export function uuidv7(now: number = Date.now()): string {
  const b = randomBytes(16);
  const ts = Math.floor(now);
  const t = BigInt(ts);
  for (let i = 0; i < 6; i++) b[i] = Number((t >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  return formatUuid(b);
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID: 48-bit ms timestamp (10 chars) + 80 random bits (16 chars), Crockford base32. Sortable; NOT a secret. */
export function ulid(now: number = Date.now()): string {
  let t = Math.floor(now);
  let time = "";
  for (let i = 0; i < 10; i++) { time = CROCKFORD[t % 32]! + time; t = Math.floor(t / 32); }
  let rand = "";
  for (let i = 0; i < 16; i++) rand += CROCKFORD[randomInt(32)]!;
  return time + rand;
}

export const UUID_NAMESPACES = {
  DNS: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  URL: "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
  OID: "6ba7b812-9dad-11d1-80b4-00c04fd430c8",
  X500: "6ba7b814-9dad-11d1-80b4-00c04fd430c8",
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);

/** UUID v5 (RFC 9562): deterministic SHA-1 name-based identifier. Same input always yields the same ID, so it is never a secret. */
export async function uuidv5(name: string, namespace: string): Promise<string> {
  if (!isUuid(namespace)) throw new Error("Namespace must be a valid UUID.");
  if (name.length === 0 || name.length > 1024) throw new Error("Name must be 1 to 1024 characters.");
  const ns = new Uint8Array(namespace.replace(/-/g, "").match(/../g)!.map((h) => parseInt(h, 16)));
  const nm = new TextEncoder().encode(name);
  const data = new Uint8Array(ns.length + nm.length);
  data.set(ns); data.set(nm, ns.length);
  const hash = new Uint8Array(await getCrypto().subtle.digest("SHA-1", data)).slice(0, 16);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  return formatUuid(hash);
}

export type TokenEncoding = "hex" | "base64url";
export interface TokenOptions { bytes: number; encoding: TokenEncoding; prefix?: string }

export function generateToken(o: TokenOptions): { value: string; entropyBits: number } {
  if (!Number.isInteger(o.bytes) || o.bytes < ID_LIMITS.minTokenBytes || o.bytes > ID_LIMITS.maxTokenBytes) throw new Error(`Token size must be ${ID_LIMITS.minTokenBytes} to ${ID_LIMITS.maxTokenBytes} bytes.`);
  const raw = randomBytes(o.bytes);
  const body = o.encoding === "hex" ? toHex(raw) : toBase64Url(raw);
  return { value: safeAffix(o.prefix) + body, entropyBits: o.bytes * 8 };
}
