/** ISO calendar date, YYYY-MM-DD. ISO dates compare correctly as plain strings. */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL = /^\d+(\.\d+)?$/;
const DIGITS = /^\d+$/;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** True for a non-negative whole number written as digits, e.g. an amount in minor units (pesewas). */
export function isDigits(value: unknown): value is string {
  return typeof value === "string" && DIGITS.test(value);
}

/** Scale used for decimal percentages / rates. 6 dp is enough for any rate in a policy. */
export const DECIMAL_SCALE = 6;
export const DECIMAL_FACTOR = 10n ** BigInt(DECIMAL_SCALE);

/**
 * Parse a non-negative decimal string ("25", "0.5") into a bigint scaled by 10^scale, without floating point.
 * Returns null when the text is not a plain decimal or has more fractional digits than the scale allows.
 */
export function parseDecimalScaled(value: unknown, scale: number = DECIMAL_SCALE): bigint | null {
  if (typeof value !== "string" || !DECIMAL.test(value)) return null;
  const parts = value.split(".");
  const whole = parts[0] ?? "0";
  const frac = parts[1] ?? "";
  if (frac.length > scale) return null;
  return BigInt(whole + frac.padEnd(scale, "0"));
}

export function absBig(x: bigint): bigint {
  return x < 0n ? -x : x;
}
