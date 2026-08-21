/**
 * Nexus Finance — financial health, ratios, distress indicators, survival estimates.
 * Adapted from CINTEXA-Nexus-Finance financial-engine concepts; no fabricated statements.
 */

export type StatementInput = {
  revenue?: number | null;
  cogs?: number | null;
  operatingExpenses?: number | null;
  ebit?: number | null;
  ebitda?: number | null;
  interestExpense?: number | null;
  netIncome?: number | null;
  currentAssets?: number | null;
  cash?: number | null;
  inventory?: number | null;
  receivables?: number | null;
  totalAssets?: number | null;
  currentLiabilities?: number | null;
  totalLiabilities?: number | null;
  totalEquity?: number | null;
  totalDebt?: number | null;
  operatingCashFlow?: number | null;
  freeCashFlow?: number | null;
  monthlyBurn?: number | null;
  currency?: string;
  periodLabel?: string;
};

export type RatioResult = {
  name: string;
  category: string;
  value: number | null;
  formula: string;
  interpretation: string;
  risk: "low" | "medium" | "high" | "unknown";
  evidence: "CALCULATED" | "UNKNOWN";
};

function n(v: number | null | undefined): number | null {
  return v == null || Number.isNaN(Number(v)) ? null : Number(v);
}

function safeDiv(a: number | null, b: number | null): number | null {
  if (a == null || b == null || b === 0) return null;
  return a / b;
}

export function calculateRatios(s: StatementInput): RatioResult[] {
  const revenue = n(s.revenue);
  const cogs = n(s.cogs);
  const ni = n(s.netIncome);
  const ebit = n(s.ebit);
  const ebitda = n(s.ebitda);
  const ca = n(s.currentAssets);
  const cl = n(s.currentLiabilities);
  const cash = n(s.cash);
  const inv = n(s.inventory);
  const ta = n(s.totalAssets);
  const te = n(s.totalEquity);
  const td = n(s.totalDebt) ?? n(s.totalLiabilities);
  const interest = n(s.interestExpense);
  const ocf = n(s.operatingCashFlow);

  const ratios: RatioResult[] = [];

  const push = (
    name: string,
    category: string,
    value: number | null,
    formula: string,
    interpretation: string,
    risk: RatioResult["risk"],
  ) => {
    ratios.push({
      name,
      category,
      value: value == null ? null : Math.round(value * 1000) / 1000,
      formula,
      interpretation: value == null ? "Insufficient data" : interpretation,
      risk: value == null ? "unknown" : risk,
      evidence: value == null ? "UNKNOWN" : "CALCULATED",
    });
  };

  const current = safeDiv(ca, cl);
  push("Current Ratio", "liquidity", current, "Current Assets / Current Liabilities", current != null && current >= 1.5 ? "Adequate short-term coverage" : "Pressure on short-term coverage", current != null && current >= 1.2 ? "low" : "high");

  const quick = safeDiv(ca != null && inv != null ? ca - inv : ca != null && cash != null ? cash : null, cl);
  push("Quick Ratio", "liquidity", quick, "(Current Assets − Inventory) / Current Liabilities", "Near-cash coverage of short-term liabilities", quick != null && quick >= 1 ? "low" : "medium");

  const cashRatio = safeDiv(cash, cl);
  push("Cash Ratio", "liquidity", cashRatio, "Cash / Current Liabilities", "Cash-only coverage", cashRatio != null && cashRatio >= 0.2 ? "low" : "high");

  const grossMargin = revenue != null && cogs != null ? ((revenue - cogs) / revenue) * 100 : null;
  push("Gross Margin %", "profitability", grossMargin, "(Revenue − COGS) / Revenue × 100", "Core product/service margin", grossMargin != null && grossMargin >= 30 ? "low" : "medium");

  const netMargin = revenue != null && ni != null ? (ni / revenue) * 100 : null;
  push("Net Profit Margin %", "profitability", netMargin, "Net Income / Revenue × 100", "Bottom-line profitability", netMargin != null && netMargin >= 5 ? "low" : netMargin != null && netMargin >= 0 ? "medium" : "high");

  const opMargin = revenue != null && ebit != null ? (ebit / revenue) * 100 : null;
  push("Operating Margin %", "profitability", opMargin, "EBIT / Revenue × 100", "Operating profitability", opMargin != null && opMargin >= 8 ? "low" : "medium");

  const roe = safeDiv(ni, te);
  push("ROE", "profitability", roe != null ? roe * 100 : null, "Net Income / Equity × 100", "Return on equity", "medium");

  const roa = safeDiv(ni, ta);
  push("ROA", "profitability", roa != null ? roa * 100 : null, "Net Income / Total Assets × 100", "Asset efficiency of earnings", "medium");

  const de = safeDiv(td, te);
  push("Debt-to-Equity", "solvency", de, "Total Debt / Equity", "Leverage intensity", de != null && de <= 1.5 ? "low" : "high");

  const da = safeDiv(td, ta);
  push("Debt-to-Assets", "solvency", da, "Total Debt / Total Assets", "Asset funding by debt", da != null && da <= 0.5 ? "low" : "medium");

  const interestCov = safeDiv(ebit, interest);
  push("Interest Coverage", "solvency", interestCov, "EBIT / Interest Expense", "Ability to service interest", interestCov != null && interestCov >= 2.5 ? "low" : "high");

  const assetTurn = safeDiv(revenue, ta);
  push("Asset Turnover", "efficiency", assetTurn, "Revenue / Total Assets", "Revenue generated per asset unit", "medium");

  const ocfMargin = revenue != null && ocf != null ? (ocf / revenue) * 100 : null;
  push("OCF Margin %", "cashflow", ocfMargin, "Operating Cash Flow / Revenue × 100", "Cash conversion of sales", ocfMargin != null && ocfMargin > 0 ? "low" : "high");

  return ratios;
}

export function healthScore(s: StatementInput) {
  const ratios = calculateRatios(s);
  const get = (name: string) => ratios.find((r) => r.name === name)?.value ?? null;

  const scoreFrom = (v: number | null, good: number, ok: number, bad: number) => {
    if (v == null) return 50;
    if (v >= good) return 90;
    if (v >= ok) return 70;
    if (v >= bad) return 40;
    return 15;
  };

  const liquidity = scoreFrom(get("Current Ratio"), 1.5, 1.2, 0.9);
  const profitability = (() => {
    const m = get("Net Profit Margin %");
    if (m == null) return 50;
    if (m >= 8) return 90;
    if (m >= 3) return 70;
    if (m >= 0) return 45;
    return 15;
  })();
  const solvency = (() => {
    const de = get("Debt-to-Equity");
    if (de == null) return 50;
    if (de <= 0.8) return 90;
    if (de <= 1.5) return 70;
    if (de <= 2.5) return 40;
    return 15;
  })();
  const cashFlow = (() => {
    const ocf = n(s.operatingCashFlow);
    if (ocf == null) return 50;
    if (ocf > 0) return 85;
    return 25;
  })();

  const overall = Math.round(liquidity * 0.25 + profitability * 0.25 + solvency * 0.25 + cashFlow * 0.25);
  let rating = "Watch";
  if (overall >= 80) rating = "Healthy";
  else if (overall >= 60) rating = "Stable";
  else if (overall >= 40) rating = "At Risk";
  else rating = "Critical";

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  if (liquidity >= 70) strengths.push("Liquidity");
  else weaknesses.push("Liquidity");
  if (profitability >= 70) strengths.push("Profitability");
  else weaknesses.push("Profitability");
  if (solvency >= 70) strengths.push("Solvency");
  else weaknesses.push("Solvency");
  if (cashFlow >= 70) strengths.push("Cash flow");
  else weaknesses.push("Cash flow");

  return {
    overall,
    rating,
    dimensions: { liquidity, profitability, solvency, cashFlow, efficiency: scoreFrom(get("Asset Turnover"), 1.2, 0.8, 0.4) },
    primaryStrength: strengths[0] || "Insufficient data",
    primaryWeakness: weaknesses[0] || "Insufficient data",
    confidence: ratios.filter((r) => r.value != null).length >= 6 ? 0.85 : ratios.filter((r) => r.value != null).length >= 3 ? 0.6 : 0.35,
    ratios,
    evidence: "CALCULATED",
    disclaimer: "Analytical indication only — not an audit opinion, investment advice, or guarantee of survival.",
  };
}

/** Simplified Altman Z' style signal for private firms when data permits */
export function distressSignals(s: StatementInput) {
  const ta = n(s.totalAssets);
  const wc = n(s.currentAssets) != null && n(s.currentLiabilities) != null ? n(s.currentAssets)! - n(s.currentLiabilities)! : null;
  const re = n(s.netIncome); // proxy retained earnings unavailable
  const ebit = n(s.ebit) ?? n(s.ebitda);
  const te = n(s.totalEquity);
  const tl = n(s.totalLiabilities) ?? n(s.totalDebt);
  const rev = n(s.revenue);

  let z: number | null = null;
  if (ta && ta > 0 && wc != null && ebit != null && te != null && tl != null && rev != null) {
    // Z' approximate components
    z = 0.717 * (wc / ta) + 0.847 * ((re ?? 0) / ta) + 3.107 * (ebit / ta) + 0.42 * (te / tl) + 0.998 * (rev / ta);
    z = Math.round(z * 100) / 100;
  }

  let interpretation = "Insufficient data for distress model";
  let risk: "low" | "medium" | "high" | "unknown" = "unknown";
  if (z != null) {
    if (z > 2.9) {
      interpretation = "Model zone: lower distress indication";
      risk = "low";
    } else if (z > 1.23) {
      interpretation = "Model zone: grey — investigate further";
      risk = "medium";
    } else {
      interpretation = "Model zone: higher distress indication";
      risk = "high";
    }
  }

  return {
    model: "Altman Z' (simplified, private-firm oriented)",
    score: z,
    interpretation,
    risk,
    limitations: "Requires complete balance sheet and earnings inputs. Not a bankruptcy prediction or certified score.",
    evidence: z == null ? "UNKNOWN" : "CALCULATED",
  };
}

export function survivalEstimate(s: StatementInput) {
  const cash = n(s.cash) ?? 0;
  const ocf = n(s.operatingCashFlow);
  const burn = n(s.monthlyBurn);
  const fcf = n(s.freeCashFlow);

  let monthlyNet = burn != null ? -Math.abs(burn) : null;
  if (monthlyNet == null && ocf != null) monthlyNet = ocf / 12;
  if (monthlyNet == null && fcf != null) monthlyNet = fcf / 12;

  let runwayMonths: number | null = null;
  if (monthlyNet != null && monthlyNet < 0 && cash > 0) {
    runwayMonths = Math.round((cash / Math.abs(monthlyNet)) * 10) / 10;
  } else if (monthlyNet != null && monthlyNet >= 0) {
    runwayMonths = null; // cash-flow positive — runway not burn-based
  }

  const base = runwayMonths;
  const stress = runwayMonths != null ? Math.round(runwayMonths * 0.5 * 10) / 10 : null;
  const recovery = runwayMonths != null ? Math.round(runwayMonths * 1.7 * 10) / 10 : null;

  return {
    estimatedRunwayMonths: runwayMonths,
    baseCase: base,
    stressCase: stress,
    recoveryCase: recovery,
    cashBalance: cash,
    monthlyNetFlow: monthlyNet,
    note:
      runwayMonths == null
        ? monthlyNet != null && monthlyNet >= 0
          ? "Cash generation appears non-negative under provided inputs — burn runway not applicable."
          : "Insufficient cash/burn inputs for runway estimate."
        : "Probabilistic planning estimate only — not a guarantee of survival duration.",
    evidence: runwayMonths == null && monthlyNet == null ? "UNKNOWN" : "CALCULATED",
    disclaimer: "Requires professional judgment. Not a formal going-concern opinion.",
  };
}

export function scenarioSimulate(
  base: StatementInput,
  changes: { revenueGrowthPct?: number; opexChangePct?: number; marginShiftPct?: number },
) {
  const rev = n(base.revenue) ?? 0;
  const growth = (changes.revenueGrowthPct ?? 0) / 100;
  const opexShift = (changes.opexChangePct ?? 0) / 100;
  const marginShift = (changes.marginShiftPct ?? 0) / 100;
  const newRev = rev * (1 + growth);
  const ni = n(base.netIncome) ?? 0;
  const opex = n(base.operatingExpenses) ?? 0;
  const newOpex = opex * (1 + opexShift);
  const newNi = ni * (1 + growth) - opex * opexShift + rev * marginShift;
  const simulated: StatementInput = {
    ...base,
    revenue: newRev,
    operatingExpenses: newOpex,
    netIncome: newNi,
  };
  return {
    inputs: changes,
    simulated,
    health: healthScore(simulated),
    survival: survivalEstimate(simulated),
    evidence: "CALCULATED",
    note: "Scenario is illustrative based on user assumptions — not a forecast guarantee.",
  };
}

export function featureEnabled() {
  return process.env.NEXUS_FINANCE_ENABLED !== "false";
}
