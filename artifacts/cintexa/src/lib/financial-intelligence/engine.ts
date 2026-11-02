/**
 * CINTEXA Finance Financial Intelligence — native calculation engine.
 * Pure TypeScript. No external API keys. Monetary amounts are minor units (integers).
 */

export type Minor = number; // integer minor currency units (e.g. pesewas / cents)

export interface MoneyLine {
  accountCode: string;
  accountName: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense" | "cogs";
  debit: Minor;
  credit: Minor;
}

export interface PostedEntry {
  id: string;
  date: string; // YYYY-MM-DD
  currency: string;
  lines: MoneyLine[];
  status: "posted" | "draft" | "void";
  memo?: string;
}

export interface PeriodFilter {
  from?: string;
  to?: string;
}

function inPeriod(date: string, f?: PeriodFilter): boolean {
  if (!f) return true;
  if (f.from && date < f.from) return false;
  if (f.to && date > f.to) return false;
  return true;
}

export function netByType(entries: PostedEntry[], type: MoneyLine["type"], period?: PeriodFilter): Minor {
  let n = 0;
  for (const e of entries) {
    if (e.status !== "posted") continue;
    if (!inPeriod(e.date, period)) continue;
    for (const l of e.lines) {
      if (l.type !== type) continue;
      if (type === "asset" || type === "expense" || type === "cogs") n += l.debit - l.credit;
      else n += l.credit - l.debit;
    }
  }
  return n;
}

export function trialBalance(entries: PostedEntry[], period?: PeriodFilter): { debits: Minor; credits: Minor; balanced: boolean } {
  let debits = 0;
  let credits = 0;
  for (const e of entries) {
    if (e.status !== "posted") continue;
    if (!inPeriod(e.date, period)) continue;
    for (const l of e.lines) {
      debits += l.debit;
      credits += l.credit;
    }
  }
  return { debits, credits, balanced: debits === credits };
}

export interface PnLResult {
  revenue: Minor;
  cogs: Minor;
  grossProfit: Minor;
  operatingExpenses: Minor;
  operatingProfit: Minor;
  netProfit: Minor;
  grossMarginPct: number | null;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  formula: Record<string, string>;
}

export function profitAndLoss(entries: PostedEntry[], period?: PeriodFilter): PnLResult {
  const revenue = netByType(entries, "revenue", period);
  const cogs = netByType(entries, "cogs", period);
  const operatingExpenses = netByType(entries, "expense", period);
  const grossProfit = revenue - cogs;
  const operatingProfit = grossProfit - operatingExpenses;
  const netProfit = operatingProfit;
  const pct = (n: Minor, d: Minor) => (d === 0 ? null : Math.round((n / d) * 10000) / 100);
  return {
    revenue,
    cogs,
    grossProfit,
    operatingExpenses,
    operatingProfit,
    netProfit,
    grossMarginPct: pct(grossProfit, revenue),
    operatingMarginPct: pct(operatingProfit, revenue),
    netMarginPct: pct(netProfit, revenue),
    formula: {
      grossProfit: "revenue − cogs",
      operatingProfit: "grossProfit − operatingExpenses",
      netProfit: "operatingProfit (interest/tax not modelled until recorded)",
      grossMarginPct: "grossProfit / revenue × 100",
    },
  };
}

export interface BalanceSheetResult {
  assets: Minor;
  liabilities: Minor;
  equity: Minor;
  balanced: boolean;
  equationCheck: string;
}

export function balanceSheet(entries: PostedEntry[], asOf?: string): BalanceSheetResult {
  const period = asOf ? { to: asOf } : undefined;
  const assets = netByType(entries, "asset", period);
  const liabilities = netByType(entries, "liability", period);
  // Equity = equity accounts + retained earnings (cum net profit to date)
  const equityAccounts = netByType(entries, "equity", period);
  const pnl = profitAndLoss(entries, period);
  const equity = equityAccounts + pnl.netProfit;
  const balanced = assets === liabilities + equity;
  return {
    assets,
    liabilities,
    equity,
    balanced,
    equationCheck: `assets (${assets}) = liabilities (${liabilities}) + equity (${equity}) → ${balanced ? "OK" : "IMBALANCE"}`,
  };
}

export interface RatioSet {
  currentRatio: number | null;
  quickRatio: number | null;
  workingCapital: Minor;
  debtToEquity: number | null;
  formulas: Record<string, string>;
}

/** Simplified: all assets treated as current for ratio demos when no sub-classification exists. */
export function liquidityRatios(entries: PostedEntry[], asOf?: string): RatioSet {
  const bs = balanceSheet(entries, asOf);
  const currentAssets = bs.assets;
  const currentLiabilities = bs.liabilities;
  const equity = bs.equity;
  const div = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 100) / 100);
  return {
    currentRatio: div(currentAssets, currentLiabilities),
    quickRatio: div(currentAssets, currentLiabilities),
    workingCapital: currentAssets - currentLiabilities,
    debtToEquity: div(currentLiabilities, equity),
    formulas: {
      currentRatio: "current assets / current liabilities",
      workingCapital: "current assets − current liabilities",
      debtToEquity: "liabilities / equity",
    },
  };
}

export interface HealthScore {
  score: number | null;
  components: { key: string; score: number | null; weight: number; note: string }[];
  method: string;
  insufficientData: boolean;
}

export function financialHealthScore(entries: PostedEntry[]): HealthScore {
  const posted = entries.filter((e) => e.status === "posted");
  if (posted.length === 0) {
    return {
      score: null,
      components: [],
      method: "Weighted average of liquidity, profitability, solvency (0–100). Requires posted entries.",
      insufficientData: true,
    };
  }
  const pnl = profitAndLoss(posted);
  const ratios = liquidityRatios(posted);
  const components = [
    {
      key: "liquidity",
      weight: 0.35,
      score: ratios.currentRatio == null ? null : Math.max(0, Math.min(100, ratios.currentRatio * 40)),
      note: "current ratio scaled (2.5 → 100)",
    },
    {
      key: "profitability",
      weight: 0.35,
      score: pnl.netMarginPct == null ? null : Math.max(0, Math.min(100, 50 + pnl.netMarginPct * 2)),
      note: "net margin mapped around 0%",
    },
    {
      key: "solvency",
      weight: 0.3,
      score: ratios.debtToEquity == null ? null : Math.max(0, Math.min(100, 100 - ratios.debtToEquity * 25)),
      note: "lower debt/equity scores higher",
    },
  ];
  const usable = components.filter((c) => c.score != null);
  if (!usable.length) {
    return { score: null, components, method: "Weighted component model", insufficientData: true };
  }
  const w = usable.reduce((s, c) => s + c.weight, 0);
  const score = Math.round(usable.reduce((s, c) => s + (c.score as number) * c.weight, 0) / w);
  return { score, components, method: "Weighted average of available components", insufficientData: false };
}

/** Simple linear trend forecast from monthly series (minor units). */
export function linearForecast(series: { period: string; value: Minor }[], periodsAhead: number): { period: string; value: Minor; method: string }[] {
  if (series.length < 2) return [];
  const n = series.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += series[i]!.value;
    sumXY += i * series[i]!.value;
    sumXX += i * i;
  }
  const den = n * sumXX - sumX * sumX;
  if (den === 0) return [];
  const slope = (n * sumXY - sumX * sumY) / den;
  const intercept = (sumY - slope * sumX) / n;
  const out: { period: string; value: Minor; method: string }[] = [];
  for (let k = 1; k <= periodsAhead; k++) {
    const x = n - 1 + k;
    out.push({
      period: `+${k}`,
      value: Math.round(intercept + slope * x),
      method: "ordinary least squares linear regression on historical monthly totals",
    });
  }
  return out;
}

export function scenarioAdjust(
  base: PnLResult,
  assumptions: { revenueGrowthPct?: number; expenseGrowthPct?: number },
): PnLResult {
  const rg = (assumptions.revenueGrowthPct ?? 0) / 100;
  const eg = (assumptions.expenseGrowthPct ?? 0) / 100;
  const revenue = Math.round(base.revenue * (1 + rg));
  const cogs = Math.round(base.cogs * (1 + rg));
  const operatingExpenses = Math.round(base.operatingExpenses * (1 + eg));
  const grossProfit = revenue - cogs;
  const operatingProfit = grossProfit - operatingExpenses;
  const netProfit = operatingProfit;
  const pct = (n: Minor, d: Minor) => (d === 0 ? null : Math.round((n / d) * 10000) / 100);
  return {
    revenue,
    cogs,
    grossProfit,
    operatingExpenses,
    operatingProfit,
    netProfit,
    grossMarginPct: pct(grossProfit, revenue),
    operatingMarginPct: pct(operatingProfit, revenue),
    netMarginPct: pct(netProfit, revenue),
    formula: {
      ...base.formula,
      scenario: `revenue×(1+${assumptions.revenueGrowthPct ?? 0}%), expenses×(1+${assumptions.expenseGrowthPct ?? 0}%) — does not alter ledger`,
    },
  };
}

export function formatMinor(minor: Minor, currency = "GHS", fractionDigits = 2): string {
  const v = minor / Math.pow(10, fractionDigits);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: fractionDigits }).format(v);
  } catch {
    return `${currency} ${v.toFixed(fractionDigits)}`;
  }
}
