/**
 * Exchange rates. A stored rate says: 1 BASE = rate QUOTE on `effective_on`. Lookups are historical (latest rate on or before the date, never today's rate for an old record),
 * try the direct pair, then the inverse, then a cross through a pivot currency. All arithmetic is exact (BigInt), rates carry 10 decimal places.
 */
import type { Queryable } from "../core/types";

export interface RateHit { rate: string; source: string; effectiveOn: string; via: string | null; kind: "same" | "direct" | "inverse" | "cross" }
const RS = 10, MS = 2;
const P = (n: number) => 10n ** BigInt(n);

export function toScaled(v: string, scale: number): bigint {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(v.trim());
  if (!m) throw new Error(`not a decimal number: ${v}`);
  const frac = (m[3] ?? "").padEnd(scale, "0");
  const n = BigInt(m[2]! + frac.slice(0, scale));
  const roundUp = (m[3] ?? "").length > scale && Number((m[3] ?? "")[scale]) >= 5;
  return (m[1] ? -1n : 1n) * (n + (roundUp ? 1n : 0n));
}
export function fromScaled(n: bigint, scale: number): string {
  const neg = n < 0n; const a = neg ? -n : n; const s = a.toString().padStart(scale + 1, "0");
  const i = s.slice(0, s.length - scale), f = s.slice(s.length - scale);
  return `${neg ? "-" : ""}${i}${scale ? "." + f : ""}`;
}
const divRound = (a: bigint, d: bigint) => { const neg = (a < 0n) !== (d < 0n); const x = (a < 0n ? -a : a), y = (d < 0n ? -d : d); const q = (x * 2n + y) / (y * 2n); return neg ? -q : q; };

/** amount (2 dp) x rate (10 dp), rounded half away from zero to 2 dp */
export function convertPrecise(amount: string, rate: string): string {
  return fromScaled(divRound(toScaled(amount, MS) * toScaled(rate, RS), P(RS)), MS);
}
export const multiplyRates = (a: string, b: string): string => fromScaled(divRound(toScaled(a, RS) * toScaled(b, RS), P(RS)), RS);
export const invertRate = (r: string): string => fromScaled(divRound(P(RS) * P(RS), toScaled(r, RS)), RS);

async function pair(q: Queryable, base: string, quote: string, on: string): Promise<{ rate: string; source: string; effectiveOn: string } | null> {
  const r = (await q.query<{ rate: string; source: string; effective_on: any }>("SELECT rate::text, source, effective_on FROM sales_exchange_rates WHERE base = $1 AND quote = $2 AND effective_on <= $3::date ORDER BY effective_on DESC, (source = 'manual') DESC, id DESC LIMIT 1", [base, quote, on])).rows[0];
  return r ? { rate: r.rate, source: r.source, effectiveOn: r.effective_on instanceof Date ? r.effective_on.toISOString().slice(0, 10) : String(r.effective_on).slice(0, 10) } : null;
}
const PIVOTS = ["USD", "EUR", "GBP", "GHS"];

export async function findRate(q: Queryable, from: string, to: string, on: string): Promise<RateHit | null> {
  if (from === to) return { rate: "1", source: "identity", effectiveOn: on, via: null, kind: "same" };
  const d = await pair(q, from, to, on);
  if (d) return { ...d, via: null, kind: "direct" };
  const i = await pair(q, to, from, on);
  if (i) return { rate: invertRate(i.rate), source: i.source, effectiveOn: i.effectiveOn, via: null, kind: "inverse" };
  for (const pv of PIVOTS) {
    if (pv === from || pv === to) continue;
    const a = (await pair(q, from, pv, on)) ?? ((x) => x && { ...x, rate: invertRate(x.rate) })(await pair(q, pv, from, on));
    const b = a && ((await pair(q, pv, to, on)) ?? ((x) => x && { ...x, rate: invertRate(x.rate) })(await pair(q, to, pv, on)));
    if (a && b) return { rate: multiplyRates(a.rate, b.rate), source: a.source === b.source ? a.source : `${a.source}+${b.source}`, effectiveOn: a.effectiveOn < b.effectiveOn ? a.effectiveOn : b.effectiveOn, via: pv, kind: "cross" };
  }
  return null;
}
