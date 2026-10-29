/**
 * Sentinel Key: cryptographically secure randomness.
 * Every secret in this module is derived from crypto.getRandomValues(); Math.random() is never used.
 */

export function getCrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || typeof c.getRandomValues !== "function") {
    throw new Error("A secure random number generator is not available in this browser.");
  }
  return c;
}

export function randomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 1 || length > 65536) throw new RangeError("Invalid byte length.");
  const out = new Uint8Array(length);
  getCrypto().getRandomValues(out);
  return out;
}

/** Unbiased integer in [0, maxExclusive) using rejection sampling over 32-bit values. */
export function randomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 2 ** 32) throw new RangeError("randomInt: range must be an integer between 1 and 2^32.");
  if (maxExclusive === 1) return 0;
  const limit = Math.floor(2 ** 32 / maxExclusive) * maxExclusive;
  const buf = new Uint32Array(1);
  const c = getCrypto();
  do {
    c.getRandomValues(buf);
  } while (buf[0]! >= limit);
  return buf[0]! % maxExclusive;
}

export function pick<T>(items: readonly T[]): T {
  if (items.length === 0) throw new RangeError("pick: empty list.");
  return items[randomInt(items.length)]!;
}

/** Fisher-Yates shuffle using secure randomness. Returns a new array. */
export function shuffle<T>(items: readonly T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function randomString(chars: readonly string[], length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) s += pick(chars);
  return s;
}

export const log2 = (n: number): number => Math.log(n) / Math.LN2;

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
