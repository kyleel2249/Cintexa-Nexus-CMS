/**
 * CINTEXA Finance: financial ratio engine (pure and deterministic; no I/O).
 *
 * Inputs are account balances in natural sign (assets/expenses = debit-positive, liabilities/equity/revenue = credit-positive),
 * in minor units, for the chosen period. Balance-sheet ratios use closing balances, not averages (stated in each formula).
 * Every ratio says what it means, how to read it, and which accounts feed it, so any account or transaction can show its effect.
 */

export type RType = "asset" | "liability" | "equity" | "revenue" | "expense";
export interface RAccount { code: string; name: string; type: RType; subtype?: string; balance: number }
export interface RSnapshot {
  accounts: RAccount[];
  /** Days in the period the income-statement figures cover. */
  periodDays: number;
  customers: number;
  newCustomers: number;
}

export type Tag =
  | "cash" | "ar" | "inventory" | "prepaid" | "currentAssets" | "fixedAssets" | "assets"
  | "currentLiabilities" | "liabilities" | "ap" | "equity" | "revenue" | "cogs" | "opex" | "marketing" | "interest" | "depreciation";

export function tagsOf(a: { code: string; name: string; type: RType; subtype?: string }): Tag[] {
  const t: Tag[] = [];
  const n = a.name.toLowerCase();
  if (a.type === "asset") {
    t.push("assets");
    const isFixed = /^12/.test(a.code) || /^13/.test(a.code) || a.subtype === "fixed" || a.subtype === "intangible" || (a.subtype === "contra" && /depreciation|amortization/.test(n));
    if (isFixed) t.push("fixedAssets"); else t.push("currentAssets");
    if (a.subtype === "cash" || a.subtype === "bank") t.push("cash");
    if (a.subtype === "ar" || a.code === "1050") t.push("ar");
    if (a.code === "1090") t.push("inventory");
    if (a.code === "1080" || a.code === "1085" || a.subtype === "prepaid") t.push("prepaid");
  } else if (a.type === "liability") {
    t.push("liabilities");
    const longTerm = a.code === "2150" || a.subtype === "long_term";
    if (!longTerm) t.push("currentLiabilities");
    if (a.subtype === "ap" || a.code === "2010") t.push("ap");
  } else if (a.type === "equity") t.push("equity");
  else if (a.type === "revenue") t.push("revenue");
  else {
    if (a.subtype === "cos" || /^5/.test(a.code) || /cost of (goods|sales)|cogs/.test(n)) t.push("cogs");
    else t.push("opex");
    if (/marketing|advertis|promotion|sales commission|sales and marketing/.test(n)) t.push("marketing");
    if (/interest expense|finance cost|loan interest/.test(n)) t.push("interest");
    if (/depreciation|amortization/.test(n)) t.push("depreciation");
  }
  return t;
}

export type Unit = "x" | "%" | "days" | "money" | "months";
export type Category = "liquidity" | "profitability" | "leverage" | "efficiency" | "acquisition";
type Good = "higher" | "lower";

export interface RatioDef {
  id: string;
  name: string;
  category: Category;
  unit: Unit;
  formula: string;
  meaning: string;
  better: Good;
  /** Value at which the reading changes from watch to healthy (in the ratio's own unit). */
  healthy?: number;
  uses: Tag[];
  improve: string;
  calc: (v: Totals) => number | null;
}

export interface Totals {
  cash: number; ar: number; inventory: number; prepaid: number; currentAssets: number; fixedAssets: number; assets: number;
  currentLiabilities: number; liabilities: number; ap: number; equity: number;
  revenue: number; cogs: number; opex: number; marketing: number; interest: number; depreciation: number;
  net: number; gross: number; operating: number; ebitda: number;
  customers: number; newCustomers: number; periodDays: number;
}

const div = (a: number, b: number): number | null => (b === 0 ? null : a / b);

export function totalsOf(s: RSnapshot): Totals {
  const t: Totals = { cash: 0, ar: 0, inventory: 0, prepaid: 0, currentAssets: 0, fixedAssets: 0, assets: 0, currentLiabilities: 0, liabilities: 0, ap: 0, equity: 0, revenue: 0, cogs: 0, opex: 0, marketing: 0, interest: 0, depreciation: 0, net: 0, gross: 0, operating: 0, ebitda: 0, customers: s.customers, newCustomers: s.newCustomers, periodDays: Math.max(1, s.periodDays) };
  for (const a of s.accounts) {
    const tags = tagsOf(a);
    // Contra accounts carry a credit balance; the natural-sign balance of an asset contra is already negative for the sum.
    const signed = a.type === "asset" && a.subtype === "contra" ? -Math.abs(a.balance) : a.balance;
    for (const tag of tags) {
      if (tag === "marketing") t.marketing += a.balance; // marketing is an opex subset
      else (t as any)[tag] += tag === "fixedAssets" || tag === "assets" || tag === "currentAssets" ? signed : a.balance;
    }
  }
  t.gross = t.revenue - t.cogs;
  t.operating = t.gross - t.opex;
  t.net = t.operating; // interest and tax are inside opex lines in this chart; operating = net before closing entries
  t.ebitda = t.operating + t.depreciation + t.interest;
  return t;
}

const pct = (a: number, b: number) => { const d = div(a, b); return d === null ? null : d * 100; };

export const RATIOS: RatioDef[] = [
  { id: "current_ratio", name: "Current ratio", category: "liquidity", unit: "x", formula: "Current assets ÷ Current liabilities", meaning: "Can short-term assets cover short-term debts?", better: "higher", healthy: 1.5, uses: ["currentAssets", "currentLiabilities"], improve: "Collect receivables faster, hold more cash, or pay down short-term debt.", calc: (v) => div(v.currentAssets, v.currentLiabilities) },
  { id: "quick_ratio", name: "Quick (acid-test) ratio", category: "liquidity", unit: "x", formula: "(Cash + Receivables) ÷ Current liabilities", meaning: "Can the business pay short-term debts without selling inventory or using prepaid items such as data bandwidth?", better: "higher", healthy: 1, uses: ["cash", "ar", "currentLiabilities"], improve: "Speed up invoice collection and keep a cash buffer.", calc: (v) => div(v.cash + v.ar, v.currentLiabilities) },
  { id: "cash_ratio", name: "Cash ratio", category: "liquidity", unit: "x", formula: "Cash ÷ Current liabilities", meaning: "How much of short-term debt could be paid from cash alone?", better: "higher", healthy: 0.5, uses: ["cash", "currentLiabilities"], improve: "Retain more cash or defer non-essential spending.", calc: (v) => div(v.cash, v.currentLiabilities) },
  { id: "working_capital", name: "Working capital", category: "liquidity", unit: "money", formula: "Current assets − Current liabilities", meaning: "Short-term resources left after short-term debts.", better: "higher", healthy: 0, uses: ["currentAssets", "currentLiabilities"], improve: "Grow current assets from profit or reduce short-term borrowing.", calc: (v) => v.currentAssets - v.currentLiabilities },
  { id: "gross_margin", name: "Gross profit margin", category: "profitability", unit: "%", formula: "(Revenue − Direct costs) ÷ Revenue", meaning: "Share of each sale left after the direct cost of delivering it.", better: "higher", healthy: 40, uses: ["revenue", "cogs"], improve: "Raise prices, cut delivery costs or shift to higher-margin services.", calc: (v) => pct(v.gross, v.revenue) },
  { id: "operating_margin", name: "Operating profit margin", category: "profitability", unit: "%", formula: "Operating profit ÷ Revenue", meaning: "Profit from running the business after all operating costs.", better: "higher", healthy: 15, uses: ["revenue", "cogs", "opex"], improve: "Control overheads such as rent, data bandwidth and marketing relative to sales.", calc: (v) => pct(v.operating, v.revenue) },
  { id: "net_margin", name: "Net profit margin", category: "profitability", unit: "%", formula: "Net profit ÷ Revenue", meaning: "What is left of each sale as profit.", better: "higher", healthy: 10, uses: ["revenue", "cogs", "opex"], improve: "Grow revenue faster than costs.", calc: (v) => pct(v.net, v.revenue) },
  { id: "ebitda_margin", name: "EBITDA margin", category: "profitability", unit: "%", formula: "(Operating profit + Depreciation + Interest) ÷ Revenue", meaning: "Operating cash-style profit before depreciation and financing.", better: "higher", healthy: 20, uses: ["revenue", "cogs", "opex", "depreciation", "interest"], improve: "Same levers as operating margin; depreciation does not affect it.", calc: (v) => pct(v.ebitda, v.revenue) },
  { id: "roa", name: "Return on assets (ROA)", category: "profitability", unit: "%", formula: "Net profit ÷ Total assets (closing)", meaning: "Profit earned from each cedi of assets.", better: "higher", healthy: 5, uses: ["assets", "revenue", "cogs", "opex"], improve: "Earn more from existing assets or sell idle ones.", calc: (v) => pct(v.net, v.assets) },
  { id: "roe", name: "Return on equity (ROE)", category: "profitability", unit: "%", formula: "Net profit ÷ Equity (closing)", meaning: "Profit earned for the owners on their investment.", better: "higher", healthy: 10, uses: ["equity", "revenue", "cogs", "opex"], improve: "Raise profit or use sensible borrowing; avoid over-borrowing.", calc: (v) => pct(v.net, v.equity) },
  { id: "debt_to_equity", name: "Debt-to-equity", category: "leverage", unit: "x", formula: "Total liabilities ÷ Equity", meaning: "How much is owed to others for each cedi owners have put in.", better: "lower", healthy: 1.5, uses: ["liabilities", "equity"], improve: "Repay debt or retain profits.", calc: (v) => div(v.liabilities, v.equity) },
  { id: "debt_ratio", name: "Debt ratio", category: "leverage", unit: "%", formula: "Total liabilities ÷ Total assets", meaning: "Share of assets financed by other people's money.", better: "lower", healthy: 60, uses: ["liabilities", "assets"], improve: "Reduce borrowing or grow assets from retained profit.", calc: (v) => pct(v.liabilities, v.assets) },
  { id: "equity_multiplier", name: "Equity multiplier", category: "leverage", unit: "x", formula: "Total assets ÷ Equity", meaning: "How many times the owners' equity the assets are.", better: "lower", healthy: 2.5, uses: ["assets", "equity"], improve: "Fund growth from retained profit rather than debt.", calc: (v) => div(v.assets, v.equity) },
  { id: "interest_coverage", name: "Interest coverage", category: "leverage", unit: "x", formula: "Operating profit ÷ Interest expense", meaning: "How many times profit covers interest payments.", better: "higher", healthy: 3, uses: ["interest", "revenue", "cogs", "opex"], improve: "Raise operating profit or refinance expensive debt.", calc: (v) => (v.interest > 0 ? div(v.operating, v.interest) : null) },
  { id: "asset_turnover", name: "Asset turnover", category: "efficiency", unit: "x", formula: "Revenue ÷ Total assets (closing, annualised)", meaning: "Sales generated per cedi of assets.", better: "higher", healthy: 1, uses: ["revenue", "assets"], improve: "Use assets more intensively or dispose of idle ones.", calc: (v) => { const d = div(v.revenue * (365 / v.periodDays), v.assets); return d; } },
  { id: "fixed_asset_turnover", name: "Fixed-asset turnover", category: "efficiency", unit: "x", formula: "Revenue ÷ Net fixed assets (annualised)", meaning: "Sales earned from equipment such as computers and phones.", better: "higher", healthy: 2, uses: ["revenue", "fixedAssets"], improve: "Avoid buying equipment that is not used to earn revenue.", calc: (v) => div(v.revenue * (365 / v.periodDays), v.fixedAssets) },
  { id: "receivables_turnover", name: "Receivables turnover", category: "efficiency", unit: "x", formula: "Revenue ÷ Receivables (annualised)", meaning: "How many times a year receivables are collected.", better: "higher", healthy: 6, uses: ["revenue", "ar"], improve: "Invoice promptly and chase overdue accounts.", calc: (v) => div(v.revenue * (365 / v.periodDays), v.ar) },
  { id: "dso", name: "Days sales outstanding (DSO)", category: "efficiency", unit: "days", formula: "Receivables ÷ Revenue × days in period", meaning: "Average days to collect payment.", better: "lower", healthy: 45, uses: ["revenue", "ar"], improve: "Shorter payment terms, deposits, reminders.", calc: (v) => { const d = div(v.ar, v.revenue); return d === null ? null : d * v.periodDays; } },
  { id: "payables_turnover", name: "Payables turnover", category: "efficiency", unit: "x", formula: "(Direct costs + Operating costs) ÷ Accounts payable (annualised)", meaning: "How many times a year suppliers are paid.", better: "higher", uses: ["ap", "cogs", "opex"], improve: "Pay on agreed terms, not earlier and not later.", calc: (v) => div((v.cogs + v.opex) * (365 / v.periodDays), v.ap) },
  { id: "dpo", name: "Days payables outstanding (DPO)", category: "efficiency", unit: "days", formula: "Accounts payable ÷ (Direct + Operating costs) × days in period", meaning: "Average days taken to pay suppliers.", better: "higher", uses: ["ap", "cogs", "opex"], improve: "Negotiate terms without harming supplier relationships.", calc: (v) => { const d = div(v.ap, v.cogs + v.opex); return d === null ? null : d * v.periodDays; } },
  { id: "inventory_turnover", name: "Inventory turnover", category: "efficiency", unit: "x", formula: "Direct costs ÷ Inventory (annualised)", meaning: "How many times stock is used or sold in a year.", better: "higher", uses: ["inventory", "cogs"], improve: "Hold less slow-moving stock.", calc: (v) => (v.inventory > 0 ? div(v.cogs * (365 / v.periodDays), v.inventory) : null) },
  { id: "cac", name: "Customer Acquisition Cost (CAC)", category: "acquisition", unit: "money", formula: "Marketing and sales spend ÷ New customers", meaning: "What it costs, on average, to win one new customer.", better: "lower", uses: ["marketing"], improve: "Focus spend on the channels that bring paying customers; improve conversion.", calc: (v) => (v.newCustomers > 0 ? div(v.marketing, v.newCustomers) : null) },
  { id: "cac_ratio", name: "CAC ratio (CAC ÷ revenue per customer)", category: "acquisition", unit: "%", formula: "CAC ÷ Average revenue per customer", meaning: "Share of a customer's first revenue spent to win them. Below 100% means the first sales cover the acquisition cost.", better: "lower", healthy: 33, uses: ["marketing", "revenue"], improve: "Reduce acquisition spend or raise average deal size.", calc: (v) => { const cac = v.newCustomers > 0 ? v.marketing / v.newCustomers : null; const arpc = div(v.revenue, v.customers); return cac === null || arpc === null ? null : pct(cac, arpc); } },
  { id: "ltv_cac", name: "LTV : CAC", category: "acquisition", unit: "x", formula: "(Average revenue per customer × Gross margin) ÷ CAC", meaning: "Gross profit a customer brings for each cedi spent to win them (uses revenue to date as a lifetime proxy).", better: "higher", healthy: 3, uses: ["marketing", "revenue", "cogs"], improve: "Raise repeat business and margin, or lower CAC.", calc: (v) => { if (v.newCustomers <= 0 || v.marketing <= 0 || v.customers <= 0 || v.revenue <= 0) return null; const ltv = (v.revenue / v.customers) * (v.gross / v.revenue); return div(ltv, v.marketing / v.newCustomers); } },
  { id: "cac_payback", name: "CAC payback", category: "acquisition", unit: "months", formula: "CAC ÷ (Monthly revenue per customer × Gross margin)", meaning: "Months of gross profit needed to recover the cost of winning a customer.", better: "lower", healthy: 12, uses: ["marketing", "revenue", "cogs"], improve: "Shorten the sales cycle, raise prices or lower acquisition spend.", calc: (v) => { if (v.newCustomers <= 0 || v.marketing <= 0 || v.customers <= 0 || v.revenue <= 0 || v.gross <= 0) return null; const monthlyGp = (v.revenue / v.customers) * (v.gross / v.revenue) * (30 / v.periodDays); return div(v.marketing / v.newCustomers, monthlyGp); } },
  { id: "marketing_pct", name: "Marketing spend % of revenue", category: "acquisition", unit: "%", formula: "Marketing and advertising ÷ Revenue", meaning: "How much of revenue goes into acquiring customers.", better: "lower", uses: ["marketing", "revenue"], improve: "Compare each channel's customers per cedi and cut the weakest.", calc: (v) => pct(v.marketing, v.revenue) },
];

export type Reading = "healthy" | "watch" | "unknown";
export interface RatioResult {
  id: string; name: string; category: Category; unit: Unit; formula: string; meaning: string; better: Good; healthy?: number;
  value: number | null; reading: Reading; improve: string; uses: Tag[];
}

export function readingOf(def: RatioDef, value: number | null): Reading {
  if (value === null || !Number.isFinite(value)) return "unknown";
  if (def.healthy === undefined) return "unknown";
  return def.better === "higher" ? (value >= def.healthy ? "healthy" : "watch") : value <= def.healthy ? "healthy" : "watch";
}

export function computeRatios(s: RSnapshot): { totals: Totals; ratios: RatioResult[] } {
  const totals = totalsOf(s);
  const ratios = RATIOS.map((d) => {
    const raw = d.calc(totals);
    const value = raw === null || !Number.isFinite(raw) ? null : Math.round(raw * 100) / 100;
    return { id: d.id, name: d.name, category: d.category, unit: d.unit, formula: d.formula, meaning: d.meaning, better: d.better, healthy: d.healthy, value, reading: readingOf(d, value), improve: d.improve, uses: d.uses };
  });
  return { totals, ratios };
}

/** Ratios an account feeds, with a plain explanation of why. */
export function ratiosForAccount(a: { code: string; name: string; type: RType; subtype?: string }): Array<{ id: string; name: string; why: string }> {
  const tags = new Set(tagsOf(a));
  return RATIOS.filter((r) => r.uses.some((u) => tags.has(u))).map((r) => ({
    id: r.id,
    name: r.name,
    why: `${a.name} is part of "${r.formula}". ${r.meaning}`,
  }));
}

export const fmtValue = (v: number | null, unit: Unit): string => {
  if (v === null) return "n/a";
  if (unit === "%") return `${v.toFixed(1)}%`;
  if (unit === "x") return `${v.toFixed(2)}x`;
  if (unit === "days") return `${Math.round(v)} days`;
  if (unit === "months") return `${v.toFixed(1)} months`;
  const major = v / 100;
  return Number.isInteger(major) ? major.toLocaleString("en-US") : major.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export interface RatioChange {
  id: string; name: string; unit: Unit; before: number | null; after: number | null;
  direction: "improves" | "worsens" | "unchanged" | "new";
  explanation: string; impact: string;
}

/** Apply hypothetical journal lines (minor units) to a snapshot and explain every ratio that moves. */
export function ratioImpact(s: RSnapshot, lines: Array<{ accountCode: string; debit: number; credit: number }>): { changes: RatioChange[]; before: RatioResult[]; after: RatioResult[]; unknownAccounts: string[] } {
  const base = computeRatios(s);
  const clone: RSnapshot = { ...s, accounts: s.accounts.map((a) => ({ ...a })) };
  const unknown: string[] = [];
  for (const l of lines) {
    const acc = clone.accounts.find((a) => a.code === l.accountCode);
    if (!acc) { unknown.push(l.accountCode); continue; }
    const natural = acc.type === "asset" || acc.type === "expense" ? l.debit - l.credit : l.credit - l.debit;
    acc.balance += natural;
  }
  const after = computeRatios(clone);
  const changes: RatioChange[] = [];
  for (const d of RATIOS) {
    const b = base.ratios.find((r) => r.id === d.id)!.value;
    const a = after.ratios.find((r) => r.id === d.id)!.value;
    if (b === a) continue;
    let direction: RatioChange["direction"];
    if (b === null && a !== null) direction = "new";
    else if (b !== null && a === null) direction = "worsens";
    else if (Math.abs((a as number) - (b as number)) < 1e-9) direction = "unchanged";
    else direction = (d.better === "higher") === ((a as number) > (b as number)) ? "improves" : "worsens";
    const move = b === null ? `became ${fmtValue(a, d.unit)}` : a === null ? "can no longer be calculated" : `moved from ${fmtValue(b, d.unit)} to ${fmtValue(a, d.unit)}`;
    changes.push({
      id: d.id, name: d.name, unit: d.unit, before: b, after: a, direction,
      explanation: `${d.name} ${move}. ${d.meaning}`,
      impact: direction === "improves" ? "This entry improves it." : direction === "worsens" ? `This entry weakens it. ${d.improve}` : direction === "new" ? "It can now be measured." : "No net change.",
    });
  }
  return { changes, before: base.ratios, after: after.ratios, unknownAccounts: unknown };
}

/** Plain-language findings across the whole ratio set, for the analysis page and recommendations. */
export function ratioFindings(ratios: RatioResult[]): Array<{ severity: "info" | "watch"; ratio: string; text: string }> {
  const out: Array<{ severity: "info" | "watch"; ratio: string; text: string }> = [];
  for (const r of ratios) {
    if (r.reading === "watch" && r.value !== null) out.push({ severity: "watch", ratio: r.id, text: `${r.name} is ${fmtValue(r.value, r.unit)} (target ${r.better === "higher" ? "at least" : "at most"} ${fmtValue(r.healthy ?? null, r.unit)}). ${r.improve}` });
  }
  const unknownAcq = ratios.filter((r) => r.category === "acquisition" && r.value === null).length;
  if (unknownAcq >= 3) out.push({ severity: "info", ratio: "cac", text: "Customer Acquisition Cost needs marketing spend (6200 Marketing and Advertising) and at least one new customer in the period." });
  return out;
}
