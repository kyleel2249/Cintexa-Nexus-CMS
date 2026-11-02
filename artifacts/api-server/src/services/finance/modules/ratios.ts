/** Financial Intelligence Phase 4 — ratio engine (posted ledger only). */
import { route, ok, type Route, type Ctx } from "../core/route";
import { qstr, todayIn, ymd } from "../core/validate";
import { badRequest } from "../core/errors";
import { fromDb, formatMoney } from "../core/money";

const pct = (n: bigint, d: bigint): string => { const x = (n * 10000n * 2n + (n < 0n ? -d : d)) / (d * 2n); const neg = x < 0n; const a = neg ? -x : x; return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`; };
const ratio = (n: bigint, d: bigint): string => { const x = (n * 100n * 2n + (n < 0n ? -d : d)) / (d * 2n); const neg = x < 0n; const a = neg ? -x : x; return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`; };
const days = (n: bigint, d: bigint): string => { if (d === 0n) return "0"; return ((n * 2n + (n < 0n ? -d : d)) / (d * 2n)).toString(); };
type RV = { value: string; unit: "percent" | "ratio" | "days" | "money" | "count"; formula: string } | { value: null; reason: string; formula: string };
const moneyVal = (v: bigint, formula: string): RV => ({ value: formatMoney(v), unit: "money", formula });
const pctVal = (n: bigint, d: bigint, formula: string): RV => d === 0n ? { value: null, reason: "denominator is zero", formula } : { value: pct(n, d), unit: "percent", formula };
const ratioVal = (n: bigint, d: bigint, formula: string): RV => d === 0n ? { value: null, reason: "denominator is zero", formula } : { value: ratio(n, d), unit: "ratio", formula };
const daysVal = (n: bigint, d: bigint, formula: string): RV => d === 0n ? { value: null, reason: "denominator is zero", formula } : { value: days(n, d), unit: "days", formula };
const countVal = (n: number, formula: string): RV => ({ value: String(n), unit: "count", formula });
function balOf(row: { d: unknown; c: unknown; normal_balance?: string; type?: string }): bigint {
  const d = fromDb(row.d); const c = fromDb(row.c);
  const side = row.normal_balance ?? (row.type === "asset" || row.type === "expense" ? "debit" : "credit");
  return side === "debit" ? d - c : c - d;
}
const ratios = route("GET", "/ratios", { perm: "ledger:read" }, async (c: Ctx) => {
  const org = (await c.q.query<any>("SELECT timezone, functional_currency FROM finance_organisations WHERE id = $1", [c.org.orgId])).rows[0];
  if (!org) throw badRequest("Organisation not found");
  const today = todayIn(org.timezone, c.now);
  const asOf = qstr(c.query.as_of) ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw badRequest("as_of must be YYYY-MM-DD");
  const fy = (await c.q.query<any>("SELECT id, name, start_date, end_date FROM finance_fiscal_years WHERE org_id = $1 AND $2::date BETWEEN start_date AND end_date", [c.org.orgId, asOf])).rows[0];
  const fyStart = fy ? ymd(fy.start_date) : asOf;
  const balRows = (await c.q.query<any>(`SELECT a.type, a.category, a.subtype, a.normal_balance, COALESCE(SUM(e.debit),0) AS d, COALESCE(SUM(e.credit),0) AS c FROM finance_accounts a LEFT JOIN finance_ledger_entries e ON e.account_id = a.id AND e.org_id = a.org_id AND e.entry_date <= $2::date WHERE a.org_id = $1 GROUP BY a.type, a.category, a.subtype, a.normal_balance`, [c.org.orgId, asOf])).rows;
  const ytdRows = (await c.q.query<any>(`SELECT a.type, a.category, a.subtype, a.name, COALESCE(SUM(e.debit),0) AS d, COALESCE(SUM(e.credit),0) AS c FROM finance_ledger_entries e JOIN finance_accounts a ON a.id = e.account_id AND a.org_id = e.org_id WHERE e.org_id = $1 AND e.entry_date BETWEEN $2::date AND $3::date AND e.journal_type <> 'closing' AND a.type IN ('revenue','expense') GROUP BY a.type, a.category, a.subtype, a.name`, [c.org.orgId, fyStart, asOf])).rows;
  const hasPostings = Number((await c.q.query<any>("SELECT count(*)::int AS n FROM finance_ledger_entries WHERE org_id = $1 AND entry_date <= $2::date", [c.org.orgId, asOf])).rows[0]?.n ?? 0) > 0;
  const sumBal = (pred: (r: any) => boolean) => balRows.filter(pred).reduce<bigint>((x, r) => x + balOf(r), 0n);
  const currentAssets = sumBal((r) => r.type === "asset" && r.category === "current_asset");
  const inventory = sumBal((r) => r.subtype === "inventory");
  const cash = sumBal((r) => ["cash", "bank", "mobile_money"].includes(r.subtype));
  const receivables = sumBal((r) => r.subtype === "accounts_receivable") - sumBal((r) => r.subtype === "contra_receivable");
  const prepayments = sumBal((r) => r.subtype === "prepayment");
  const totalAssets = sumBal((r) => r.type === "asset");
  const currentLiabilities = sumBal((r) => r.type === "liability" && r.category === "current_liability");
  const totalLiabilities = sumBal((r) => r.type === "liability");
  const equity = sumBal((r) => r.type === "equity");
  const payables = sumBal((r) => r.subtype === "accounts_payable");
  const ytdCredit = (pred: (r: any) => boolean) => ytdRows.filter(pred).reduce<bigint>((x, r) => x + fromDb(r.c) - fromDb(r.d), 0n);
  const ytdDebit = (pred: (r: any) => boolean) => ytdRows.filter(pred).reduce<bigint>((x, r) => x + fromDb(r.d) - fromDb(r.c), 0n);
  const revenue = ytdCredit((r) => r.type === "revenue" && (r.category === "revenue" || r.category === "other_income"));
  const cogs = ytdDebit((r) => r.category === "cost_of_goods_sold");
  const opex = ytdDebit((r) => r.category === "operating_expense" || r.category === "administrative_expense");
  const financeCost = ytdDebit((r) => r.category === "finance_cost");
  const totalExpenses = ytdDebit((r) => r.type === "expense");
  const grossProfit = revenue - cogs; const operatingProfit = grossProfit - opex; const netProfit = revenue - totalExpenses;
  const interestExpense = ytdDebit((r) => r.category === "finance_cost" && (r.subtype === "bank_charges" || /interest/i.test(String(r.name ?? ""))));
  const marketingExpense = ytdDebit((r) => r.type === "expense" && (r.category === "operating_expense" || r.category === "administrative_expense") && /market|advertis|promo|acquisition|campaign/i.test(String(r.name ?? "")));
  const customerCount = Number((await c.q.query<any>("SELECT count(*)::int AS n FROM finance_customers WHERE org_id = $1 AND is_active = TRUE", [c.org.orgId])).rows[0]?.n ?? 0);
  const newCustomersYtd = Number((await c.q.query<any>(`SELECT count(*)::int AS n FROM finance_customers WHERE org_id = $1 AND created_at::date BETWEEN $2::date AND $3::date AND is_active = TRUE`, [c.org.orgId, fyStart, asOf])).rows[0]?.n ?? 0);
  let linkedNew = 0;
  try { linkedNew = Number((await c.q.query<any>(`SELECT count(*)::int AS n FROM finance_party_links pl JOIN sales_accounts sa ON sa.id = pl.sales_account_id WHERE pl.org_id = $1 AND sa.created_at::date BETWEEN $2::date AND $3::date AND (sa.archived_at IS NULL)`, [c.org.orgId, fyStart, asOf])).rows[0]?.n ?? 0); } catch { linkedNew = 0; }
  const acquisitionDenominator = linkedNew > 0 ? linkedNew : newCustomersYtd;
  const acquisitionSource = linkedNew > 0 ? "sales accounts linked to Finance customers created in fiscal year" : "finance customers created in fiscal year";
  const fyDays = fy ? Math.max(1, Math.round((Date.parse(asOf + "T00:00:00Z") - Date.parse(fyStart + "T00:00:00Z")) / 86400000) + 1) : 365;
  const fyDaysBig = BigInt(fyDays);
  let cac: RV;
  if (acquisitionDenominator <= 0) cac = { value: null, reason: "No new customers in the fiscal year", formula: `Marketing expense / New ${acquisitionSource}` };
  else if (marketingExpense === 0n) cac = { value: null, reason: "No marketing/advertising expense in fiscal year", formula: `Marketing expense / New ${acquisitionSource}` };
  else cac = { value: formatMoney(marketingExpense / BigInt(acquisitionDenominator)), unit: "money", formula: `Marketing expense (${formatMoney(marketingExpense)}) / ${acquisitionDenominator} new ${acquisitionSource}` };
  const ltvProxy: RV = customerCount > 0 && revenue > 0n
    ? { value: formatMoney(revenue / BigInt(customerCount)), unit: "money", formula: "YTD revenue / active finance customers (ARPU proxy, not cohort LTV)" }
    : { value: null, reason: customerCount === 0 ? "No finance customers" : "No YTD revenue", formula: "YTD revenue / active finance customers" };
  return ok({
    currency: org.functional_currency, as_of: asOf,
    fiscal_year: fy ? { id: fy.id, name: fy.name, start: fyStart, end: ymd(fy.end_date) } : null,
    has_postings: hasPostings, days_in_period: fyDays,
    profitability: {
      gross_margin_pct: pctVal(grossProfit, revenue, "(Revenue − COGS) / Revenue × 100"),
      operating_margin_pct: pctVal(operatingProfit, revenue, "(Gross profit − Operating expenses) / Revenue × 100"),
      net_margin_pct: pctVal(netProfit, revenue, "Net profit / Revenue × 100"),
      return_on_assets_pct: pctVal(netProfit, totalAssets, "Net profit / Total assets × 100"),
      return_on_equity_pct: pctVal(netProfit, equity, "Net profit / Equity × 100"),
      return_on_capital_employed_pct: pctVal(operatingProfit, totalAssets - currentLiabilities, "Operating profit / (Total assets − Current liabilities) × 100"),
    },
    liquidity: {
      current_ratio: ratioVal(currentAssets, currentLiabilities, "Current assets / Current liabilities"),
      quick_ratio: ratioVal(currentAssets - inventory - prepayments, currentLiabilities, "(Current assets − Inventory − Prepayments) / Current liabilities"),
      cash_ratio: ratioVal(cash, currentLiabilities, "Cash + Bank + Mobile money / Current liabilities"),
      working_capital: moneyVal(currentAssets - currentLiabilities, "Current assets − Current liabilities"),
    },
    solvency: {
      debt_to_equity: ratioVal(totalLiabilities, equity, "Total liabilities / Equity"),
      debt_ratio: pctVal(totalLiabilities, totalAssets, "Total liabilities / Total assets × 100"),
      equity_ratio: pctVal(equity, totalAssets, "Equity / Total assets × 100"),
      interest_coverage: ratioVal(operatingProfit, interestExpense > 0n ? interestExpense : financeCost, "Operating profit / Interest & finance costs"),
    },
    efficiency: {
      asset_turnover: ratioVal(revenue, totalAssets, "Revenue / Total assets"),
      receivables_turnover: ratioVal(revenue, receivables, "Revenue / Accounts receivable"),
      days_sales_outstanding: daysVal(receivables * fyDaysBig, revenue, "AR / Revenue × days in period"),
      payables_turnover: ratioVal(cogs > 0n ? cogs : totalExpenses, payables, "(COGS or expenses) / AP"),
      days_payables_outstanding: daysVal(payables * fyDaysBig, cogs > 0n ? cogs : totalExpenses, "AP / (COGS or expenses) × days"),
      inventory_turnover: ratioVal(cogs, inventory, "COGS / Inventory"),
      days_inventory_outstanding: daysVal(inventory * fyDaysBig, cogs, "Inventory / COGS × days"),
      working_capital_turnover: ratioVal(revenue, currentAssets - currentLiabilities, "Revenue / Working capital"),
    },
    acquisition: {
      marketing_expense_ytd: moneyVal(marketingExpense, "Marketing-named expense accounts, YTD"),
      new_customers_ytd: countVal(newCustomersYtd, "Finance customers created YTD"),
      new_linked_sales_accounts_ytd: countVal(linkedNew, "Linked sales accounts created YTD"),
      customer_acquisition_cost: cac, revenue_per_customer_proxy: ltvProxy,
      active_customers: countVal(customerCount, "Active finance customers"),
      notes: "CAC uses marketing-named expense accounts only. Null when inputs are missing — never estimated.",
    },
    components: {
      revenue: formatMoney(revenue), cost_of_sales: formatMoney(cogs), gross_profit: formatMoney(grossProfit),
      operating_expenses: formatMoney(opex), finance_costs: formatMoney(financeCost), net_profit: formatMoney(netProfit),
      current_assets: formatMoney(currentAssets), inventory: formatMoney(inventory), cash_and_bank: formatMoney(cash),
      receivables_net: formatMoney(receivables), total_assets: formatMoney(totalAssets),
      current_liabilities: formatMoney(currentLiabilities), total_liabilities: formatMoney(totalLiabilities),
      equity: formatMoney(equity), payables: formatMoney(payables),
    },
  });
});
export const ratioRoutes: Route[] = [ratios];
