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

/** Prefer the centralized formatter; re-export for any engine consumers. */
export { formatMinor, formatCurrency, formatMoney } from "@/lib/finance/money";


/* --------------------------------------------------------------------------
 * Intelligent visual clues — pure TypeScript, deterministic, no external AI.
 * Interprets actual posted figures and produces colour-coded guidance.
 * -------------------------------------------------------------------------- */

export type ClueSeverity = "positive" | "caution" | "elevated" | "critical" | "neutral" | "opportunity";

export interface FinancialClue {
  id: string;
  severity: ClueSeverity;
  title: string;
  whatHappened: string;
  whyItMatters: string;
  potentialConsequences: string;
  recommendedAction: string;
  supportingFigures: Record<string, string>;
  periodLabel?: string;
  confidence: "high" | "medium" | "estimate";
  metricKeys: string[];
}

export interface ClueInput {
  currency?: string;
  periodLabel?: string;
  revenue: Minor;
  grossRevenue?: Minor;
  discountAllowed?: Minor;
  expense: Minor;
  netProfit: Minor;
  cash: Minor;
  accountsReceivable: Minor;
  accountsPayable?: Minor;
  assets?: Minor;
  liabilities?: Minor;
  equity?: Minor;
  workingCapital?: Minor;
  previous?: {
    revenue?: Minor;
    expense?: Minor;
    netProfit?: Minor;
    cash?: Minor;
  };
  trialBalanceBalanced?: boolean;
}

function money(n: Minor, currency = "GHS"): string {
  // local helper to avoid circular import issues at module evaluation time
  const abs = Math.abs(Math.round(n || 0));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const sign = n < 0 ? "-" : "";
  const body = `${whole.toLocaleString("en-US")}.${String(frac).padStart(2, "0")}`;
  return `GH₵ ${sign}${body}`.replace("GH₵ -", "GH₵ -");
}

/**
 * Generate contextual financial clues from real KPI values.
 * All conclusions are rule-based and fully reproducible.
 */
export function generateFinancialClues(input: ClueInput): FinancialClue[] {
  const currency = input.currency || "GHS";
  const period = input.periodLabel || "current period";
  const clues: FinancialClue[] = [];
  const rev = input.revenue || 0;
  const exp = input.expense || 0;
  const profit = input.netProfit || 0;
  const cash = input.cash || 0;
  const ar = input.accountsReceivable || 0;
  const prev = input.previous || {};

  // Trial balance integrity
  if (input.trialBalanceBalanced === false) {
    clues.push({
      id: "tb-unbalanced",
      severity: "critical",
      title: "Trial balance is out of balance",
      whatHappened: "Total debits do not equal total credits in the posted ledger.",
      whyItMatters: "An unbalanced trial balance indicates a data integrity problem in the general ledger.",
      potentialConsequences: "Financial statements may be unreliable until the imbalance is resolved.",
      recommendedAction: "Review recent journal entries, reverse incorrect postings, and re-run the trial balance.",
      supportingFigures: {},
      periodLabel: period,
      confidence: "high",
      metricKeys: ["trialBalance"],
    });
  }

  // Profitability
  if (rev > 0 && profit > 0) {
    const margin = Math.round((profit / rev) * 10000) / 100;
    clues.push({
      id: "profit-positive",
      severity: margin >= 15 ? "positive" : "neutral",
      title: margin >= 15 ? "Healthy net profit margin" : "Business is profitable",
      whatHappened: `Net profit of ${money(profit, currency)} on revenue of ${money(rev, currency)} (${margin}% margin).`,
      whyItMatters: "Positive profitability indicates the core business model is generating surplus after expenses.",
      potentialConsequences: "Sustained profits support growth, reserves and investor confidence.",
      recommendedAction: margin < 10
        ? "Review cost structure and pricing to improve margin while protecting volume."
        : "Maintain cost discipline and consider allocating a portion of surplus to cash reserves.",
      supportingFigures: {
        revenue: money(rev, currency),
        netProfit: money(profit, currency),
        margin: `${margin}%`,
      },
      periodLabel: period,
      confidence: "high",
      metricKeys: ["netProfit", "revenue"],
    });
  } else if (rev > 0 && profit < 0) {
    clues.push({
      id: "loss-making",
      severity: "critical",
      title: "Net loss recorded",
      whatHappened: `Expenses of ${money(exp, currency)} exceeded revenue of ${money(rev, currency)}, producing a loss of ${money(profit, currency)}.`,
      whyItMatters: "Continued losses erode equity and can create liquidity pressure.",
      potentialConsequences: "Working capital may tighten; external funding or cost reduction may become necessary.",
      recommendedAction: "Identify the largest expense categories, defer non-essential spend, and accelerate collections.",
      supportingFigures: {
        revenue: money(rev, currency),
        expenses: money(exp, currency),
        netProfit: money(profit, currency),
      },
      periodLabel: period,
      confidence: "high",
      metricKeys: ["netProfit", "expense", "revenue"],
    });
  }

  // Cash vs receivables
  if (ar > 0 && cash >= 0) {
    if (ar > cash * 2 && ar > 50000) {
      // AR more than 2× cash and material
      clues.push({
        id: "ar-cash-gap",
        severity: "elevated",
        title: "Receivables significantly exceed available cash",
        whatHappened: `Accounts receivable (${money(ar, currency)}) are large relative to cash (${money(cash, currency)}).`,
        whyItMatters: "High receivables with low cash indicate collection lag and potential liquidity risk.",
        potentialConsequences: "Inability to meet short-term obligations even though the P&L looks healthy.",
        recommendedAction: "Prioritise collection of overdue invoices, tighten credit terms, and review ageing analysis.",
        supportingFigures: {
          accountsReceivable: money(ar, currency),
          cash: money(cash, currency),
        },
        periodLabel: period,
        confidence: "high",
        metricKeys: ["accountsReceivable", "cash"],
      });
    } else if (cash > ar * 2 && cash > 100000) {
      clues.push({
        id: "strong-cash",
        severity: "opportunity",
        title: "Strong cash position relative to receivables",
        whatHappened: `Cash (${money(cash, currency)}) comfortably exceeds outstanding receivables (${money(ar, currency)}).`,
        whyItMatters: "Liquidity is healthy, giving flexibility for investment or debt reduction.",
        potentialConsequences: "Idle cash may under-perform if not deployed according to policy.",
        recommendedAction: "Review treasury policy; consider short-term instruments or planned capital expenditure.",
        supportingFigures: {
          cash: money(cash, currency),
          accountsReceivable: money(ar, currency),
        },
        periodLabel: period,
        confidence: "high",
        metricKeys: ["cash", "accountsReceivable"],
      });
    }
  }

  // Low / zero cash
  if (cash <= 0 && (rev > 0 || ar > 0)) {
    clues.push({
      id: "cash-critical",
      severity: "critical",
      title: "Cash and bank balance is zero or negative",
      whatHappened: `Available cash is ${money(cash, currency)} while the business still records activity.`,
      whyItMatters: "Without cash the organisation cannot settle obligations as they fall due.",
      potentialConsequences: "Immediate liquidity crisis, potential supplier and payroll disruption.",
      recommendedAction: "Accelerate collections, arrange short-term financing, and halt non-critical payments.",
      supportingFigures: { cash: money(cash, currency) },
      periodLabel: period,
      confidence: "high",
      metricKeys: ["cash"],
    });
  }

  // Period-over-period revenue change
  if (prev.revenue != null && prev.revenue > 0) {
    const delta = rev - prev.revenue;
    const pctChange = Math.round((delta / prev.revenue) * 10000) / 100;
    if (pctChange >= 10) {
      clues.push({
        id: "revenue-growth",
        severity: "positive",
        title: "Revenue increased versus prior period",
        whatHappened: `Revenue rose ${pctChange}% from ${money(prev.revenue, currency)} to ${money(rev, currency)}.`,
        whyItMatters: "Growth in the top line is a primary driver of long-term value.",
        potentialConsequences: "If costs are controlled, profitability and cash generation should improve.",
        recommendedAction: "Identify the products, customers or channels driving growth and protect those engines.",
        supportingFigures: {
          previousRevenue: money(prev.revenue, currency),
          currentRevenue: money(rev, currency),
          change: `+${pctChange}%`,
        },
        periodLabel: period,
        confidence: "high",
        metricKeys: ["revenue"],
      });
    } else if (pctChange <= -10) {
      clues.push({
        id: "revenue-decline",
        severity: "elevated",
        title: "Revenue declined versus prior period",
        whatHappened: `Revenue fell ${Math.abs(pctChange)}% from ${money(prev.revenue, currency)} to ${money(rev, currency)}.`,
        whyItMatters: "Sustained revenue decline reduces capacity to cover fixed costs.",
        potentialConsequences: "Margin compression and potential cash shortfalls if the trend continues.",
        recommendedAction: "Analyse lost volume by customer and product; review pricing and sales pipeline.",
        supportingFigures: {
          previousRevenue: money(prev.revenue, currency),
          currentRevenue: money(rev, currency),
          change: `${pctChange}%`,
        },
        periodLabel: period,
        confidence: "high",
        metricKeys: ["revenue"],
      });
    }
  }

  // Expense growth faster than revenue
  if (prev.revenue != null && prev.expense != null && prev.revenue > 0 && rev > 0) {
    const revGrowth = (rev - prev.revenue) / prev.revenue;
    const expGrowth = (exp - prev.expense) / (prev.expense || 1);
    if (expGrowth > revGrowth + 0.05 && exp > prev.expense) {
      clues.push({
        id: "expense-outpacing",
        severity: "caution",
        title: "Expenses growing faster than revenue",
        whatHappened: "Cost growth is outpacing revenue growth, putting pressure on margins.",
        whyItMatters: "If the trend continues, profitability will deteriorate even if the top line expands.",
        potentialConsequences: "Lower net profit margin and reduced ability to self-fund growth.",
        recommendedAction: "Review variable and discretionary spend; set expense targets relative to revenue.",
        supportingFigures: {
          revenue: money(rev, currency),
          expenses: money(exp, currency),
        },
        periodLabel: period,
        confidence: "medium",
        metricKeys: ["expense", "revenue"],
      });
    }
  }

  // Discount pressure
  if ((input.discountAllowed || 0) > 0 && rev > 0) {
    const disc = input.discountAllowed || 0;
    const discPct = Math.round((disc / (rev + disc)) * 10000) / 100;
    if (discPct >= 8) {
      clues.push({
        id: "high-discount",
        severity: "caution",
        title: "Material discounts granted",
        whatHappened: `Discounts allowed of ${money(disc, currency)} represent approximately ${discPct}% of gross revenue.`,
        whyItMatters: "Heavy discounting reduces realised margin and can train customers to expect lower prices.",
        potentialConsequences: "Erosion of list-price integrity and pressure on net profitability.",
        recommendedAction: "Review discount authority matrix and analyse whether volume gains justify the margin sacrifice.",
        supportingFigures: {
          discountAllowed: money(disc, currency),
          estimatedShare: `${discPct}%`,
        },
        periodLabel: period,
        confidence: "medium",
        metricKeys: ["discountAllowed", "revenue"],
      });
    }
  }

  // Empty books
  if (rev === 0 && exp === 0 && cash === 0 && ar === 0) {
    clues.push({
      id: "empty-ledger",
      severity: "neutral",
      title: "No posted financial activity yet",
      whatHappened: "The ledger contains no posted revenue, expense, cash or receivable balances for the selected period.",
      whyItMatters: "Dashboards and intelligence views will show zeros until journals are posted.",
      potentialConsequences: "None — this is the expected state for a new or empty book set.",
      recommendedAction: "Post opening balances or day-to-day journals to begin seeing live intelligence.",
      supportingFigures: {},
      periodLabel: period,
      confidence: "high",
      metricKeys: [],
    });
  }

  return clues;
}

/** Map severity to UI colour tokens used by the CINTEXA design system. */
export function clueSeverityColour(severity: ClueSeverity): string {
  switch (severity) {
    case "positive":
      return "emerald";
    case "opportunity":
      return "amber";
    case "caution":
      return "yellow";
    case "elevated":
      return "orange";
    case "critical":
      return "red";
    default:
      return "sky";
  }
}
