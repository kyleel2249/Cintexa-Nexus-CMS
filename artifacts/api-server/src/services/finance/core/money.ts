/**
 * Decimal-safe money. Amounts travel as strings with exactly two decimals ("1234.50") and are computed as BigInt
 * minor units - never as JavaScript floating point. NUMERIC(18,2) in PostgreSQL is the system of record.
 */
const RE = /^-?\d{1,16}(\.\d{1,2})?$/;

export function parseMoney(v: unknown): bigint | null {
  if (typeof v === "number") { if (!Number.isFinite(v)) return null; v = v.toFixed(2); }
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!RE.test(s)) return null;
  const neg = s.startsWith("-");
  const [i, f = ""] = s.replace("-", "").split(".");
  const minor = BigInt(i! + f.padEnd(2, "0"));
  return neg ? -minor : minor;
}

export function formatMoney(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const s = abs.toString().padStart(3, "0");
  return `${neg ? "-" : ""}${s.slice(0, -2)}.${s.slice(-2)}`;
}

export const ZERO = 0n;
export const sum = (xs: bigint[]): bigint => xs.reduce((a, b) => a + b, 0n);
/** database NUMERIC strings ("100.00") -> minor units */
export const fromDb = (v: unknown): bigint => parseMoney(String(v ?? "0")) ?? 0n;
