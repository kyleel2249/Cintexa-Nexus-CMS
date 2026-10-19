/**
 * Forecast maths. Everything here is a documented, deterministic calculation over real opportunity data.
 * The output states plainly when history is too thin for anything beyond a stage-weighted estimate - we never
 * dress a weighted pipeline up as a statistical or AI prediction.
 */
import { add, cmp, mulQty, percentOf, ratioPercent, sub, sum } from "../core/money";
import type { Range } from "../core/time";

export type ForecastCategory = "omitted" | "pipeline" | "best_case" | "commit" | "closed";

export interface ForecastOpp {
  id: number;
  amount: string;
  /** stage probability 0-100 (or the manual override) */
  probability: number;
  category: ForecastCategory;
  expectedCloseDate: string | null;
  closeDateChanges: number;
  ownerId: number | null;
}

export interface ForecastConfig {
  minimumClosedDeals: number;
  /** fraction (0..1) of "commit" counted in the worst case */
  worstCaseHaircut: number;
  bestCaseUplift: number;
}

export interface ForecastResult {
  closed: string;
  commit: string;
  bestCaseDeals: string;
  pipelineOpen: string;
  weighted: string;
  baseCase: string;
  bestCase: string;
  worstCase: string;
  /** open pipeline value expected to close in range ÷ remaining target, null when there is no target */
  coverage: number | null;
  slippedCount: number;
  slippedAmount: string;
  overdueCount: number;
  openCount: number;
  reliability: { level: "estimate" | "supported"; closedDeals: number; message: string };
  assumptions: string[];
}

const inRange = (d: string | null, range: Range): boolean => {
  if (!d) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  // compare on the date string against the UTC date of the bounds to stay timezone-neutral for DATE columns
  return t >= Date.parse(range.from.slice(0, 10) + "T00:00:00Z") && t < Date.parse(range.to.slice(0, 10) + "T00:00:00Z");
};

export function computeForecast(args: { opps: ForecastOpp[]; closedAmount: string; closedDeals: number; range: Range; target: string | null; today: string; cfg: ForecastConfig }): ForecastResult {
  const { opps, range, cfg, today } = args;
  const open = opps.filter((o) => o.category !== "omitted" && o.category !== "closed");
  // Open deals whose expected close date is already in the past are stale: reported as overdue, not counted.
  const dueInRange = open.filter((o) => inRange(o.expectedCloseDate, range) && (o.expectedCloseDate as string) >= today);
  const weightedOf = (xs: ForecastOpp[]) => sum(xs.map((o) => percentOf(o.amount, String(o.probability))));
  const amountOf = (xs: ForecastOpp[]) => sum(xs.map((o) => o.amount));

  const commitDeals = dueInRange.filter((o) => o.category === "commit");
  const bestDeals = dueInRange.filter((o) => o.category === "best_case");
  const pipeDeals = dueInRange.filter((o) => o.category === "pipeline");

  const commit = amountOf(commitDeals);
  const bestCaseDeals = amountOf(bestDeals);
  const weighted = weightedOf(dueInRange);
  const baseCase = add(args.closedAmount, weighted);
  const bestCase = add(add(add(args.closedAmount, commit), bestCaseDeals), mulQty(weightedOf(pipeDeals), String(cfg.bestCaseUplift)));
  const worstCase = add(args.closedAmount, mulQty(commit, String(cfg.worstCaseHaircut)));
  const pipelineOpen = amountOf(dueInRange);

  const remainingTarget = args.target === null ? null : sub(args.target, args.closedAmount);
  const coverage = remainingTarget === null || cmp(remainingTarget, "0.00") <= 0 ? null : ratioPercent(pipelineOpen, remainingTarget);

  const overdue = open.filter((o) => o.expectedCloseDate !== null && o.expectedCloseDate < today);
  const slipped = open.filter((o) => o.closeDateChanges > 0);

  const supported = args.closedDeals >= cfg.minimumClosedDeals;
  const assumptions = [
    "Weighted forecast = Σ (opportunity amount × stage probability) for open opportunities whose expected close date falls inside the period.",
    "Base case = closed revenue so far + weighted pipeline.",
    `Best case = closed + all Commit + all Best-case deals (unweighted) + the weighted Pipeline deals${cfg.bestCaseUplift !== 1 ? ` × ${cfg.bestCaseUplift}` : ""}.`,
    `Worst case = closed + ${Math.round(cfg.worstCaseHaircut * 100)}% of Commit deals; nothing else is counted.`,
    "Amounts are in the opportunity's currency, exclude tax and are counted before discounts negotiated after the quotation.",
    "Opportunities marked 'omitted' are excluded; deals with no expected close date are not placed in any period.",
  ];
  if (overdue.length) assumptions.push(`${overdue.length} open opportunit${overdue.length === 1 ? "y has" : "ies have"} an expected close date in the past and ${overdue.length === 1 ? "is" : "are"} not counted until the date is updated.`);

  return {
    closed: args.closedAmount, commit, bestCaseDeals, pipelineOpen, weighted, baseCase, bestCase, worstCase, coverage,
    slippedCount: slipped.length, slippedAmount: amountOf(slipped), overdueCount: overdue.length, openCount: dueInRange.length,
    reliability: supported
      ? { level: "supported", closedDeals: args.closedDeals, message: `Based on ${args.closedDeals} closed deals of history.` }
      : { level: "estimate", closedDeals: args.closedDeals, message: `Only ${args.closedDeals} closed deal${args.closedDeals === 1 ? "" : "s"} of history (needs ${cfg.minimumClosedDeals}). This is a stage-weighted estimate, not a statistical forecast.` },
    assumptions,
  };
}

/** Forecast error of a past snapshot against what really happened: (forecast − actual) ÷ actual × 100. */
export function forecastError(forecast: string, actual: string): number | null {
  const r = ratioPercent(sub(forecast, actual), actual);
  return r;
}

export function accuracyOf(pairs: Array<{ forecast: string; actual: string }>): { mape: number | null; bias: number | null; n: number } {
  const errs = pairs.map((p) => forecastError(p.forecast, p.actual)).filter((e): e is number => e !== null);
  if (!errs.length) return { mape: null, bias: null, n: 0 };
  const mape = errs.reduce((a, e) => a + Math.abs(e), 0) / errs.length;
  const bias = errs.reduce((a, e) => a + e, 0) / errs.length;
  return { mape: Math.round(mape * 100) / 100, bias: Math.round(bias * 100) / 100, n: errs.length };
}

/** Month-of-year seasonality index (1.0 = average). Needs `minMonths` of history, else null - never invented. */
export function seasonalIndex(monthly: Array<{ month: string; amount: number }>, minMonths: number): number[] | null {
  if (monthly.length < minMonths) return null;
  const sums = Array<number>(12).fill(0);
  const counts = Array<number>(12).fill(0);
  for (const m of monthly) {
    const idx = Number(m.month.slice(5, 7)) - 1;
    if (idx < 0 || idx > 11) continue;
    sums[idx]! += m.amount;
    counts[idx]!++;
  }
  if (counts.some((c) => c < 2)) return null;
  const avgs = sums.map((s, i) => s / counts[i]!);
  const overall = avgs.reduce((a, b) => a + b, 0) / 12;
  if (overall === 0) return null;
  return avgs.map((a) => Math.round((a / overall) * 1000) / 1000);
}

export interface Trend {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
  next: number;
}

/** Ordinary least squares over equally spaced periods. Requires >= 6 points; r2 is reported so weak fits are visible. */
export function linearTrend(values: number[]): Trend | null {
  const n = values.length;
  if (n < 6) return null;
  const xs = values.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = values.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (values[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (values[i]! - my) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2: Math.round(r2 * 1000) / 1000, n, next: Math.max(0, intercept + slope * n) };
}

export function slippage(prev: string | null, next: string | null): number {
  if (!prev || !next) return 0;
  return Math.round((Date.parse(next) - Date.parse(prev)) / 86_400_000);
}
