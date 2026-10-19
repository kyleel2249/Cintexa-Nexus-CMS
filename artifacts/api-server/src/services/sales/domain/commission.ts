import { add, cmp, mulQty, percentOf, sub, toMinor, allocate, abs, neg, proportion } from "../core/money";

export interface Tier {
  /** inclusive lower bound of cumulative amount */
  from: string;
  /** exclusive upper bound, null = unbounded */
  to: string | null;
  /** percent, 0-100 */
  rate: string;
}

export interface Plan {
  id: number;
  version: number;
  kind: "percent" | "fixed" | "tiered";
  basis: "booked" | "invoiced" | "collected";
  measure: "revenue" | "gross_profit";
  rate: string | null;
  fixedAmount: string | null;
  tiers: Tier[];
  productId: number | null;
  category: string | null;
  memberId: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
  quotaBonus: { thresholdPercent: number; amount: string } | null;
}

export function validateTiers(tiers: Tier[]): string | null {
  if (!tiers.length) return "At least one tier is required";
  const sorted = [...tiers].sort((a, b) => cmp(a.from, b.from));
  if (cmp(sorted[0]!.from, "0.00") !== 0) return "The first tier must start at 0.00";
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]!;
    if (Number(t.rate) < 0 || Number(t.rate) > 100) return `Tier ${i + 1}: rate must be between 0 and 100`;
    if (t.to !== null && cmp(t.to, t.from) <= 0) return `Tier ${i + 1}: "to" must be greater than "from"`;
    const next = sorted[i + 1];
    if (next) {
      if (t.to === null) return `Tier ${i + 1}: only the last tier can be unbounded`;
      if (cmp(t.to, next.from) !== 0) return `Tiers must be contiguous: tier ${i + 1} ends at ${t.to} but tier ${i + 2} starts at ${next.from}`;
    } else if (t.to !== null) return "The last tier must be unbounded (leave 'to' empty)";
  }
  return null;
}

/** Progressive (marginal) tiered commission on a cumulative amount, like income tax bands. */
export function tieredTotal(cumulative: string, tiers: Tier[]): string {
  const sorted = [...tiers].sort((a, b) => cmp(a.from, b.from));
  let total = "0.00";
  for (const t of sorted) {
    if (cmp(cumulative, t.from) <= 0) break;
    const upper = t.to !== null && cmp(cumulative, t.to) > 0 ? t.to : cumulative;
    total = add(total, percentOf(sub(upper, t.from), t.rate));
  }
  return total;
}

export function isEffective(plan: Pick<Plan, "active" | "effectiveFrom" | "effectiveTo">, on: string): boolean {
  return plan.active && plan.effectiveFrom <= on && (plan.effectiveTo === null || plan.effectiveTo >= on);
}

/** Specificity: member+product > member+category > member > product > category > global. */
export function specificity(plan: Plan): number {
  return (plan.memberId !== null ? 4 : 0) + (plan.productId !== null ? 2 : plan.category !== null ? 1 : 0);
}

export function selectPlan(plans: Plan[], ctx: { memberId: number; productId: number | null; category: string | null; on: string }): Plan | null {
  const matching = plans.filter(
    (p) =>
      isEffective(p, ctx.on) &&
      (p.memberId === null || p.memberId === ctx.memberId) &&
      (p.productId === null || p.productId === ctx.productId) &&
      (p.category === null || p.category === ctx.category),
  );
  matching.sort((a, b) => specificity(b) - specificity(a) || b.version - a.version || b.id - a.id);
  return matching[0] ?? null;
}

export interface CommissionResult {
  amount: string;
  rate: string | null;
  breakdown: Record<string, unknown>;
}

/**
 * Commission for `basisAmount` (revenue or gross profit, per the plan) credited to one member.
 * `cumulativeBefore` is the member's cumulative basis in the period *before* this order (needed for tiers).
 * `splitPercent` handles shared credit. All arithmetic is decimal-safe.
 */
export function computeCommission(plan: Plan, basisAmount: string, splitPercent: string, cumulativeBefore = "0.00"): CommissionResult {
  const credited = percentOf(basisAmount, splitPercent);
  const base = { planId: plan.id, planVersion: plan.version, kind: plan.kind, basis: plan.basis, measure: plan.measure, basisAmount, splitPercent, credited };
  if (toMinor(credited) <= 0n) return { amount: "0.00", rate: plan.rate, breakdown: { ...base, note: "No commissionable amount" } };
  switch (plan.kind) {
    case "percent": {
      const amount = percentOf(credited, plan.rate ?? "0");
      return { amount, rate: plan.rate, breakdown: { ...base, rate: plan.rate, formula: `${credited} × ${plan.rate}%` } };
    }
    case "fixed": {
      const amount = percentOf(plan.fixedAmount ?? "0.00", splitPercent);
      return { amount, rate: null, breakdown: { ...base, fixedAmount: plan.fixedAmount, formula: `${plan.fixedAmount} × ${splitPercent}% share` } };
    }
    case "tiered": {
      const after = add(cumulativeBefore, credited);
      const amount = sub(tieredTotal(after, plan.tiers), tieredTotal(cumulativeBefore, plan.tiers));
      return { amount, rate: null, breakdown: { ...base, cumulativeBefore, cumulativeAfter: after, tiers: plan.tiers, formula: "progressive tiers on cumulative basis" } };
    }
  }
}

/** Proportional reversal (clawback) for a return or cancellation. Returns a NEGATIVE amount (or "0.00"). */
export function reversalFor(entryAmount: string, entryBasis: string, returnedBasis: string): string {
  if (toMinor(entryBasis) <= 0n || toMinor(returnedBasis) <= 0n) return "0.00";
  const returned = cmp(returnedBasis, entryBasis) > 0 ? entryBasis : returnedBasis;
  const amt = proportion(entryAmount, returned, entryBasis);
  return toMinor(amt) === 0n ? "0.00" : neg(abs(amt));
}

/** Quota-attainment bonus: paid once when attainment reaches the threshold. */
export function quotaBonus(plan: Plan, attainmentPercent: number | null, alreadyPaid: boolean): string {
  if (!plan.quotaBonus || attainmentPercent === null || alreadyPaid) return "0.00";
  return attainmentPercent >= plan.quotaBonus.thresholdPercent ? plan.quotaBonus.amount : "0.00";
}

/** Split credit by weights with exact cents, e.g. {1: 60, 2: 40}. Weights must be positive. */
export function splitCredit(amount: string, weights: number[]): string[] {
  return allocate(amount, weights);
}

export { mulQty };
