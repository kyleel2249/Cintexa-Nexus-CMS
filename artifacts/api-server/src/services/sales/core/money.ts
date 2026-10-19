/**
 * Decimal-safe money arithmetic.
 *
 * Amounts are canonical decimal strings ("1234.50") at every boundary (API, database NUMERIC) and BigInt
 * "minor units" (cents) internally. Floating point is never used for money.
 *
 * Rounding is explicit: HALF_UP (away from zero on .5) is the default; HALF_EVEN is available for settings.
 * Rates (tax %, discount %, commission %) are decimal strings with up to 4 decimal places ("12.5000").
 */
export type Rounding = "half_up" | "half_even";

export const SCALE = 2;
const TEN = 10n;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Parse a decimal string into minor units at the given scale. Throws on garbage or excess precision. */
export function toMinor(value: string | number, scale = SCALE): bigint {
  const s = typeof value === "number" ? String(value) : value.trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new MoneyError(`Invalid amount: "${value}"`);
  const frac = m[3] ?? "";
  if (frac.length > scale && /[^0]/.test(frac.slice(scale))) throw new MoneyError(`Amount "${value}" has more than ${scale} decimal places`);
  const digits = m[2]! + (frac + "0".repeat(scale)).slice(0, scale);
  const v = BigInt(digits);
  return m[1] ? -v : v;
}

export function fromMinor(minor: bigint, scale = SCALE): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const s = abs.toString().padStart(scale + 1, "0");
  const int = s.slice(0, s.length - scale);
  const frac = s.slice(s.length - scale);
  return `${neg ? "-" : ""}${int}${scale > 0 ? "." + frac : ""}`;
}

/** Normalise any decimal string to the canonical 2dp form. */
export function money(value: string | number): string {
  return fromMinor(toMinor(value));
}

/** Parse a rate such as "12.5" or "7.5000" into integer basis of 1e-4 (i.e. "12.5" -> 125000n). */
export function rateToUnits(rate: string | number): bigint {
  return toMinor(rate, 4);
}

const RATE_DENOM = 10000n; // 1.0000 == 10000 units
const PERCENT_DENOM = 1000000n; // 100.0000 % == 1000000 units

function divRound(numerator: bigint, denominator: bigint, mode: Rounding): bigint {
  if (denominator === 0n) throw new MoneyError("Division by zero");
  const neg = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  let q = n / d;
  const r = n % d;
  const twice = r * 2n;
  if (twice > d) q += 1n;
  else if (twice === d) {
    if (mode === "half_up") q += 1n;
    else if (q % 2n === 1n) q += 1n; // half_even
  }
  return neg ? -q : q;
}

export const add = (...amounts: string[]): string => fromMinor(amounts.reduce((a, b) => a + toMinor(b), 0n));
export const sub = (a: string, b: string): string => fromMinor(toMinor(a) - toMinor(b));
export const neg = (a: string): string => fromMinor(-toMinor(a));
export const cmp = (a: string, b: string): number => {
  const x = toMinor(a);
  const y = toMinor(b);
  return x < y ? -1 : x > y ? 1 : 0;
};
export const isZero = (a: string): boolean => toMinor(a) === 0n;
export const gt = (a: string, b: string) => cmp(a, b) > 0;
export const lt = (a: string, b: string) => cmp(a, b) < 0;
export const min = (a: string, b: string) => (cmp(a, b) <= 0 ? a : b);
export const max = (a: string, b: string) => (cmp(a, b) >= 0 ? a : b);
export const abs = (a: string) => (toMinor(a) < 0n ? neg(a) : money(a));
export function sum(values: Iterable<string>): string {
  let t = 0n;
  for (const v of values) t += toMinor(v);
  return fromMinor(t);
}

/** amount x quantity where quantity may have up to 4 decimals ("2.5"). */
export function mulQty(amount: string, qty: string | number, mode: Rounding = "half_up"): string {
  return fromMinor(divRound(toMinor(amount) * rateToUnits(qty), RATE_DENOM, mode));
}

/** amount x percent, e.g. percentOf("200.00", "12.5") === "25.00". */
export function percentOf(amount: string, percent: string | number, mode: Rounding = "half_up"): string {
  return fromMinor(divRound(toMinor(amount) * rateToUnits(percent), PERCENT_DENOM, mode));
}

/** amount × (num ÷ den), rounded once at the end. Used for proportional reversals and pro-rata splits. */
export function proportion(amount: string, num: string, den: string, mode: Rounding = "half_up"): string {
  return fromMinor(divRound(toMinor(amount) * toMinor(num), toMinor(den), mode));
}

/** What percentage is `part` of `whole`, as a number rounded to 2dp. Returns null when whole is zero. */
export function ratioPercent(part: string, whole: string): number | null {
  const w = toMinor(whole);
  if (w === 0n) return null;
  return Number(divRound(toMinor(part) * 10000n, w, "half_up")) / 100;
}

/**
 * Split an amount across weights without losing or inventing a cent (largest-remainder method).
 * allocate("100.00", [1,1,1]) -> ["33.34","33.33","33.33"]
 */
export function allocate(total: string, weights: number[]): string[] {
  if (!weights.length) return [];
  if (weights.some((w) => !(w >= 0) || !Number.isFinite(w))) throw new MoneyError("Weights must be non-negative numbers");
  const wsum = weights.reduce((a, b) => a + b, 0);
  const t = toMinor(total);
  if (wsum === 0) throw new MoneyError("At least one weight must be positive");
  // work in integer weights at 1e6 resolution to stay deterministic
  const iw = weights.map((w) => BigInt(Math.round((w / wsum) * 1_000_000)));
  const isum = iw.reduce((a, b) => a + b, 0n);
  const parts = iw.map((w) => (t * w) / isum);
  let remainder = t - parts.reduce((a, b) => a + b, 0n);
  const order = iw.map((w, i) => ({ i, r: (t * w) % isum })).sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const step = remainder < 0n ? -1n : 1n;
  for (let k = 0; remainder !== 0n; k = (k + 1) % order.length) {
    parts[order[k]!.i]! += step;
    remainder -= step;
  }
  return parts.map((p) => fromMinor(p));
}

export interface LineInput {
  quantity: string | number;
  unitPrice: string;
  /** percentage discount 0-100 */
  discountPercent?: string | number;
  /** fixed amount discount for the whole line (applied after percentage) */
  discountAmount?: string;
  /** tax percentage applied after discount */
  taxRate?: string | number;
  /** unit cost (optional - used for margin) */
  unitCost?: string | null;
}

export interface LineTotals {
  gross: string; // qty x unit price
  discount: string; // total discount value
  net: string; // gross - discount (taxable base)
  tax: string;
  total: string; // net + tax
  cost: string | null; // qty x unit cost
  margin: string | null; // net - cost
}

/**
 * Line maths: gross -> discount (percent first, then fixed amount, never below zero) -> tax on net.
 * Tax is calculated per line and rounded per line (documented in settings as "line" rounding).
 */
export function lineTotals(line: LineInput, mode: Rounding = "half_up"): LineTotals {
  const gross = mulQty(line.unitPrice, line.quantity, mode);
  const pct = line.discountPercent === undefined ? "0" : String(line.discountPercent);
  const pctValue = percentOf(gross, pct, mode);
  let discount = pctValue;
  if (line.discountAmount !== undefined && line.discountAmount !== "") discount = add(discount, money(line.discountAmount));
  if (gt(discount, gross)) discount = gross; // a discount can never push a line below zero
  const net = sub(gross, discount);
  const tax = percentOf(net, line.taxRate === undefined ? "0" : String(line.taxRate), mode);
  const total = add(net, tax);
  const cost = line.unitCost === undefined || line.unitCost === null ? null : mulQty(line.unitCost, line.quantity, mode);
  return { gross, discount, net, tax, total, cost, margin: cost === null ? null : sub(net, cost) };
}

export interface DocumentTotals {
  subtotal: string; // sum of gross
  discountTotal: string;
  netTotal: string;
  taxTotal: string;
  total: string;
  costTotal: string | null;
  marginTotal: string | null;
  /** margin / net as a percentage, null when unknown or net is zero */
  marginPercent: number | null;
}

export function documentTotals(lines: LineTotals[]): DocumentTotals {
  const subtotal = sum(lines.map((l) => l.gross));
  const discountTotal = sum(lines.map((l) => l.discount));
  const netTotal = sum(lines.map((l) => l.net));
  const taxTotal = sum(lines.map((l) => l.tax));
  const total = sum(lines.map((l) => l.total));
  const allCosted = lines.length > 0 && lines.every((l) => l.cost !== null);
  const costTotal = allCosted ? sum(lines.map((l) => l.cost as string)) : null;
  const marginTotal = costTotal === null ? null : sub(netTotal, costTotal);
  return { subtotal, discountTotal, netTotal, taxTotal, total, costTotal, marginTotal, marginPercent: marginTotal === null ? null : ratioPercent(marginTotal, netTotal) };
}

/** Effective discount percentage of a line or document (0-100, 2dp). */
export function effectiveDiscountPercent(gross: string, discount: string): number {
  return ratioPercent(discount, gross) ?? 0;
}

/** Convert using a decimal rate (up to 6dp) - the rate must be supplied; a missing rate is an error, never 1. */
export function convert(amount: string, rate: string | null | undefined): string {
  if (rate === null || rate === undefined || rate === "") throw new MoneyError("Missing exchange rate");
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(String(rate).trim());
  if (!m || /^0+(\.0+)?$/.test(String(rate).trim())) throw new MoneyError(`Invalid exchange rate: "${rate}"`);
  const units = BigInt(m[1]! + ((m[2] ?? "") + "000000").slice(0, 6));
  return fromMinor(divRound(toMinor(amount) * units, 1_000_000n, "half_up"));
}

/** Locale-aware display only (never parse the result back). */
export function formatMoney(amount: string, currency: string, locale = "en-US"): string {
  const n = Number(amount);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export { TEN as _TEN };
