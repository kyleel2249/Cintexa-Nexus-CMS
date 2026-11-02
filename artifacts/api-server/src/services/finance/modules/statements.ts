/** Financial Intelligence Phase 5 — formal P&L, balance sheet, cash flow. */
import { route, ok, type Route, type Ctx, type Out } from "../core/route";
import { qstr, todayIn, ymd } from "../core/validate";
import { badRequest } from "../core/errors";
import { fromDb, formatMoney } from "../core/money";

const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (head: string[], rows: unknown[][]) => [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
type LineKind = "header" | "line" | "subtotal" | "total" | "spacer";
interface StmtLine { key: string; label: string; kind: LineKind; amount: string | null; code?: string; indent?: number }
function balOf(row: { d: unknown; c: unknown; normal_balance?: string; type?: string }): bigint {
  const d = fromDb(row.d); const c = fromDb(row.c);
  const side = row.normal_balance ?? (row.type === "asset" || row.type === "expense" ? "debit" : "credit");
  return side === "debit" ? d - c : c - d;
}
async function orgCtx(c: Ctx) {
  const org = (await c.q.query<any>("SELECT id, legal_name, trading_name, timezone, functional_currency FROM finance_organisations WHERE id = $1", [c.org.orgId])).rows[0];
  if (!org) throw badRequest("Organisation not found");
  return org;
}
function parseRange(c: Ctx, org: { timezone: string }) {
  const today = todayIn(org.timezone, c.now);
  const asOf = qstr(c.query.as_of) ?? qstr(c.query.to) ?? today;
  const fromQ = qstr(c.query.from);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw badRequest("as_of/to must be YYYY-MM-DD");
  if (fromQ && !/^\d{4}-\d{2}-\d{2}$/.test(fromQ)) throw badRequest("from must be YYYY-MM-DD");
  return { asOf, fromQ };
}
async function fiscalWindow(c: Ctx, asOf: string, fromQ?: string) {
  const fy = (await c.q.query<any>("SELECT id, name, start_date, end_date FROM finance_fiscal_years WHERE org_id = $1 AND $2::date BETWEEN start_date AND end_date", [c.org.orgId, asOf])).rows[0];
  return { from: fromQ ?? (fy ? ymd(fy.start_date) : asOf), to: asOf, fy: fy ? { id: Number(fy.id), name: String(fy.name), start: ymd(fy.start_date), end: ymd(fy.end_date) } : null };
}
async function plRows(c: Ctx, from: string, to: string) {
  return (await c.q.query<any>(`SELECT a.id, a.code, a.name, a.type, a.category, a.subtype, a.normal_balance, COALESCE(SUM(e.debit),0) AS d, COALESCE(SUM(e.credit),0) AS c FROM finance_accounts a LEFT JOIN finance_ledger_entries e ON e.account_id = a.id AND e.org_id = a.org_id AND e.entry_date BETWEEN $2::date AND $3::date AND e.journal_type <> 'closing' WHERE a.org_id = $1 AND a.type IN ('revenue','expense') AND a.allow_posting = TRUE GROUP BY a.id, a.code, a.name, a.type, a.category, a.subtype, a.normal_balance HAVING COALESCE(SUM(e.debit),0) <> 0 OR COALESCE(SUM(e.credit),0) <> 0 ORDER BY a.code`, [c.org.orgId, from, to])).rows;
}
async function sfpRows(c: Ctx, asOf: string) {
  return (await c.q.query<any>(`SELECT a.id, a.code, a.name, a.type, a.category, a.subtype, a.normal_balance, COALESCE(SUM(e.debit),0) AS d, COALESCE(SUM(e.credit),0) AS c FROM finance_accounts a LEFT JOIN finance_ledger_entries e ON e.account_id = a.id AND e.org_id = a.org_id AND e.entry_date <= $2::date WHERE a.org_id = $1 AND a.type IN ('asset','liability','equity') GROUP BY a.id, a.code, a.name, a.type, a.category, a.subtype, a.normal_balance ORDER BY a.code`, [c.org.orgId, asOf])).rows;
}
async function ytdNetProfit(c: Ctx, from: string, to: string): Promise<bigint> {
  const rows = await plRows(c, from, to); let rev = 0n, exp = 0n;
  for (const r of rows) { const b = balOf(r); if (r.type === "revenue") rev += b; else exp += b; }
  return rev - exp;
}
function plSection(rows: any[], pred: (r: any) => boolean) {
  const lines: StmtLine[] = []; let total = 0n;
  for (const r of rows.filter(pred)) { const amt = balOf(r); if (amt === 0n) continue; total += amt; lines.push({ key: `a-${r.id}`, label: r.name, kind: "line", amount: formatMoney(amt), code: r.code, indent: 1 }); }
  return { lines, total };
}
const profitLoss = route("GET", "/statements/profit-loss", { perm: "ledger:read" }, async (c: Ctx): Promise<Out> => {
  const org = await orgCtx(c); const { asOf, fromQ } = parseRange(c, org); const win = await fiscalWindow(c, asOf, fromQ);
  const rows = await plRows(c, win.from, win.to);
  const revenue = plSection(rows, (r) => r.type === "revenue" && r.category === "revenue");
  const otherIncome = plSection(rows, (r) => r.type === "revenue" && r.category === "other_income");
  const cogs = plSection(rows, (r) => r.category === "cost_of_goods_sold");
  const opex = plSection(rows, (r) => r.category === "operating_expense");
  const admin = plSection(rows, (r) => r.category === "administrative_expense");
  const finance = plSection(rows, (r) => r.category === "finance_cost");
  const tax = plSection(rows, (r) => r.category === "tax_expense");
  const otherExp = plSection(rows, (r) => r.type === "expense" && !["cost_of_goods_sold","operating_expense","administrative_expense","finance_cost","tax_expense"].includes(r.category));
  const grossProfit = revenue.total - cogs.total;
  const operatingExpenses = opex.total + admin.total + otherExp.total;
  const operatingProfit = grossProfit + otherIncome.total - operatingExpenses;
  const profitBeforeTax = operatingProfit - finance.total;
  const netProfit = profitBeforeTax - tax.total;
  const lines: StmtLine[] = [];
  const hdr = (k: string, l: string) => lines.push({ key: k, label: l, kind: "header", amount: null, indent: 0 });
  const sub = (k: string, l: string, a: bigint) => lines.push({ key: k, label: l, kind: "subtotal", amount: formatMoney(a), indent: 0 });
  const tot = (k: string, l: string, a: bigint) => lines.push({ key: k, label: l, kind: "total", amount: formatMoney(a), indent: 0 });
  hdr("rev_h", "Revenue"); lines.push(...revenue.lines); if (!revenue.lines.length) lines.push({ key: "rev_empty", label: "No revenue accounts with activity", kind: "line", amount: formatMoney(0n), indent: 1 });
  sub("rev_t", "Total revenue", revenue.total); hdr("cogs_h", "Cost of sales"); lines.push(...cogs.lines); sub("cogs_t", "Total cost of sales", cogs.total);
  tot("gp", "Gross profit", grossProfit);
  if (otherIncome.lines.length) { hdr("oi_h", "Other income"); lines.push(...otherIncome.lines); sub("oi_t", "Total other income", otherIncome.total); }
  hdr("opex_h", "Operating expenses"); lines.push(...opex.lines, ...admin.lines, ...otherExp.lines); sub("opex_t", "Total operating expenses", operatingExpenses);
  tot("op", "Operating profit", operatingProfit);
  if (finance.lines.length || finance.total !== 0n) { hdr("fin_h", "Finance costs"); lines.push(...finance.lines); sub("fin_t", "Total finance costs", finance.total); }
  tot("pbt", "Profit before tax", profitBeforeTax);
  if (tax.lines.length || tax.total !== 0n) { hdr("tax_h", "Tax expense"); lines.push(...tax.lines); sub("tax_t", "Total tax expense", tax.total); }
  tot("np", "Net profit / (loss) for the period", netProfit);
  const body = { statement: "profit_loss" as const, title: "Statement of Profit or Loss", organisation: { id: org.id, legal_name: org.legal_name, trading_name: org.trading_name }, currency: org.functional_currency, period: { from: win.from, to: win.to }, fiscal_year: win.fy, has_postings: rows.length > 0, lines, totals: { revenue: formatMoney(revenue.total), cost_of_sales: formatMoney(cogs.total), gross_profit: formatMoney(grossProfit), operating_expenses: formatMoney(operatingExpenses), operating_profit: formatMoney(operatingProfit), finance_costs: formatMoney(finance.total), profit_before_tax: formatMoney(profitBeforeTax), tax_expense: formatMoney(tax.total), net_profit: formatMoney(netProfit) }, basis: "Posted ledger entries only; closing journals excluded." };
  if (qstr(c.query.format) === "csv") return { status: 200, raw: { contentType: "text/csv; charset=utf-8", filename: `profit-loss-${win.from}_${win.to}.csv`, data: toCsv(["Code","Label","Kind","Amount"], lines.map((l) => [l.code ?? "", l.label, l.kind, l.amount ?? ""])) } };
  return ok(body);
});
const balanceSheet = route("GET", "/statements/balance-sheet", { perm: "ledger:read" }, async (c: Ctx): Promise<Out> => {
  const org = await orgCtx(c); const { asOf, fromQ } = parseRange(c, org); const win = await fiscalWindow(c, asOf, fromQ);
  const rows = await sfpRows(c, asOf); const currentProfit = await ytdNetProfit(c, win.from, asOf);
  const byPred = (pred: (r: any) => boolean) => { const lines: StmtLine[] = []; let total = 0n; for (const r of rows.filter(pred)) { const amt = balOf(r); if (amt === 0n) continue; total += amt; lines.push({ key: `a-${r.id}`, label: r.name, kind: "line", amount: formatMoney(amt), code: r.code, indent: 1 }); } return { lines, total }; };
  const cash = byPred((r) => ["cash","bank","mobile_money"].includes(r.subtype));
  const receivables = byPred((r) => r.subtype === "accounts_receivable" || r.subtype === "contra_receivable");
  const inventory = byPred((r) => r.subtype === "inventory");
  const otherCA = byPred((r) => r.type === "asset" && r.category === "current_asset" && !["cash","bank","mobile_money","accounts_receivable","contra_receivable","inventory"].includes(r.subtype ?? ""));
  const ppe = byPred((r) => r.subtype === "fixed_asset" || r.subtype === "contra_accumulated_depreciation");
  const intangibles = byPred((r) => r.subtype === "intangible");
  const otherNCA = byPred((r) => r.type === "asset" && r.category === "non_current_asset" && !["fixed_asset","contra_accumulated_depreciation","intangible"].includes(r.subtype ?? ""));
  const payables = byPred((r) => r.subtype === "accounts_payable");
  const taxLiab = byPred((r) => ["vat_payable","nhil_payable","getfund_payable","wht_payable","paye_payable","cit_payable"].includes(r.subtype ?? ""));
  const otherCL = byPred((r) => r.type === "liability" && r.category === "current_liability" && !["accounts_payable","vat_payable","nhil_payable","getfund_payable","wht_payable","paye_payable","cit_payable"].includes(r.subtype ?? ""));
  const nonCurrentLiab = byPred((r) => r.type === "liability" && (r.category === "non_current_liability" || r.category === "long_term_liability"));
  const equityAccts = byPred((r) => r.type === "equity");
  const totalCurrentAssets = cash.total + receivables.total + inventory.total + otherCA.total;
  const totalNonCurrentAssets = ppe.total + intangibles.total + otherNCA.total;
  const totalAssets = totalCurrentAssets + totalNonCurrentAssets;
  const totalCurrentLiab = payables.total + taxLiab.total + otherCL.total;
  const totalLiab = totalCurrentLiab + nonCurrentLiab.total;
  const equityWithProfit = equityAccts.total + currentProfit;
  const totalEquityAndLiab = totalLiab + equityWithProfit;
  const lines: StmtLine[] = [];
  const hdr = (k: string, l: string) => lines.push({ key: k, label: l, kind: "header", amount: null, indent: 0 });
  const sub = (k: string, l: string, a: bigint) => lines.push({ key: k, label: l, kind: "subtotal", amount: formatMoney(a), indent: 0 });
  const tot = (k: string, l: string, a: bigint) => lines.push({ key: k, label: l, kind: "total", amount: formatMoney(a), indent: 0 });
  hdr("ca_h", "Current assets"); if (cash.lines.length) { lines.push({ key: "cash_h", label: "Cash and cash equivalents", kind: "header", amount: null, indent: 0 }); lines.push(...cash.lines); }
  if (receivables.lines.length) { lines.push({ key: "ar_h", label: "Trade and other receivables", kind: "header", amount: null, indent: 0 }); lines.push(...receivables.lines); }
  if (inventory.lines.length) { lines.push({ key: "inv_h", label: "Inventories", kind: "header", amount: null, indent: 0 }); lines.push(...inventory.lines); }
  lines.push(...otherCA.lines); sub("ca_t", "Total current assets", totalCurrentAssets);
  hdr("nca_h", "Non-current assets"); lines.push(...ppe.lines, ...intangibles.lines, ...otherNCA.lines); sub("nca_t", "Total non-current assets", totalNonCurrentAssets);
  tot("ta", "Total assets", totalAssets);
  hdr("cl_h", "Current liabilities"); lines.push(...payables.lines, ...taxLiab.lines, ...otherCL.lines); sub("cl_t", "Total current liabilities", totalCurrentLiab);
  if (nonCurrentLiab.lines.length) { hdr("ncl_h", "Non-current liabilities"); lines.push(...nonCurrentLiab.lines); sub("ncl_t", "Total non-current liabilities", nonCurrentLiab.total); }
  sub("tl", "Total liabilities", totalLiab);
  hdr("eq_h", "Equity"); lines.push(...equityAccts.lines);
  if (currentProfit !== 0n) lines.push({ key: "cy_pl", label: "Current year profit / (loss) (unclosed)", kind: "line", amount: formatMoney(currentProfit), indent: 1 });
  sub("eq_t", "Total equity", equityWithProfit); tot("tel", "Total equity and liabilities", totalEquityAndLiab);
  const body = { statement: "balance_sheet" as const, title: "Statement of Financial Position", organisation: { id: org.id, legal_name: org.legal_name, trading_name: org.trading_name }, currency: org.functional_currency, as_of: asOf, period: { from: win.from, to: asOf }, fiscal_year: win.fy, has_postings: rows.some((r: any) => fromDb(r.d) !== 0n || fromDb(r.c) !== 0n), balanced: totalAssets === totalEquityAndLiab, lines, totals: { current_assets: formatMoney(totalCurrentAssets), non_current_assets: formatMoney(totalNonCurrentAssets), total_assets: formatMoney(totalAssets), current_liabilities: formatMoney(totalCurrentLiab), non_current_liabilities: formatMoney(nonCurrentLiab.total), total_liabilities: formatMoney(totalLiab), equity: formatMoney(equityWithProfit), current_year_profit: formatMoney(currentProfit), total_equity_and_liabilities: formatMoney(totalEquityAndLiab) }, basis: "Posted ledger balances. Unclosed current-year profit shown under equity so the statement balances pre-closing." };
  if (qstr(c.query.format) === "csv") return { status: 200, raw: { contentType: "text/csv; charset=utf-8", filename: `balance-sheet-${asOf}.csv`, data: toCsv(["Code","Label","Kind","Amount"], lines.map((l) => [l.code ?? "", l.label, l.kind, l.amount ?? ""])) } };
  return ok(body);
});
const cashFlow = route("GET", "/statements/cash-flow", { perm: "ledger:read" }, async (c: Ctx): Promise<Out> => {
  const org = await orgCtx(c); const { asOf, fromQ } = parseRange(c, org); const win = await fiscalWindow(c, asOf, fromQ);
  const cashBal = async (at: string, op: "<" | "<=") => {
    const rows = (await c.q.query<any>(`SELECT a.normal_balance, COALESCE(SUM(e.debit),0) AS d, COALESCE(SUM(e.credit),0) AS c FROM finance_accounts a LEFT JOIN finance_ledger_entries e ON e.account_id = a.id AND e.org_id = a.org_id AND e.entry_date ${op} $2::date WHERE a.org_id = $1 AND a.subtype IN ('cash','bank','mobile_money') GROUP BY a.normal_balance`, [c.org.orgId, at])).rows;
    return rows.reduce<bigint>((x, r) => x + balOf({ ...r, type: "asset" }), 0n);
  };
  const dayBefore = (() => { const d = new Date(win.from + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
  const openingCash = await cashBal(dayBefore, "<="); const closingCash = await cashBal(asOf, "<="); const netCashChange = closingCash - openingCash;
  const profit = await ytdNetProfit(c, win.from, asOf);
  const balAt = async (at: string, subtypes: string[]) => {
    if (!subtypes.length) return 0n;
    const rows = (await c.q.query<any>(`SELECT a.subtype, a.normal_balance, a.type, COALESCE(SUM(e.debit),0) AS d, COALESCE(SUM(e.credit),0) AS c FROM finance_accounts a LEFT JOIN finance_ledger_entries e ON e.account_id = a.id AND e.org_id = a.org_id AND e.entry_date <= $2::date WHERE a.org_id = $1 AND a.subtype = ANY($3::text[]) GROUP BY a.subtype, a.normal_balance, a.type`, [c.org.orgId, at, subtypes])).rows;
    return rows.reduce<bigint>((x, r) => x + balOf(r), 0n);
  };
  const endAR = await balAt(asOf, ["accounts_receivable","contra_receivable"]); const startAR = await balAt(dayBefore, ["accounts_receivable","contra_receivable"]);
  const endInv = await balAt(asOf, ["inventory"]); const startInv = await balAt(dayBefore, ["inventory"]);
  const endAP = await balAt(asOf, ["accounts_payable"]); const startAP = await balAt(dayBefore, ["accounts_payable"]);
  const endTax = await balAt(asOf, ["vat_payable","nhil_payable","getfund_payable","wht_payable","paye_payable","cit_payable"]);
  const startTax = await balAt(dayBefore, ["vat_payable","nhil_payable","getfund_payable","wht_payable","paye_payable","cit_payable"]);
  const endPrep = await balAt(asOf, ["prepayment"]); const startPrep = await balAt(dayBefore, ["prepayment"]);
  const depRows = (await c.q.query<any>(`SELECT COALESCE(SUM(e.debit),0) AS d, COALESCE(SUM(e.credit),0) AS c FROM finance_ledger_entries e JOIN finance_accounts a ON a.id = e.account_id AND a.org_id = e.org_id WHERE e.org_id = $1 AND e.entry_date BETWEEN $2::date AND $3::date AND e.journal_type <> 'closing' AND a.subtype = 'depreciation_expense'`, [c.org.orgId, win.from, asOf])).rows[0];
  const depreciation = fromDb(depRows?.d) - fromDb(depRows?.c);
  const endPPE = await balAt(asOf, ["fixed_asset"]); const startPPE = await balAt(dayBefore, ["fixed_asset"]); const capex = startPPE - endPPE;
  const endCap = await balAt(asOf, ["capital"]); const startCap = await balAt(dayBefore, ["capital"]); const capitalIn = endCap - startCap;
  const endDraw = await balAt(asOf, ["contra_drawings"]); const startDraw = await balAt(dayBefore, ["contra_drawings"]); const drawings = startDraw - endDraw;
  const endLoan = await balAt(asOf, ["loan"]); const startLoan = await balAt(dayBefore, ["loan"]); const loanNet = endLoan - startLoan;
  const operating = profit + depreciation + (startAR - endAR) + (startInv - endInv) + (startPrep - endPrep) + (endAP - startAP) + (endTax - startTax);
  const investing = capex; const financing = capitalIn + drawings + loanNet; const residual = netCashChange - (operating + investing + financing);
  const lines: StmtLine[] = [];
  const line = (k: string, l: string, a: bigint, indent = 1) => lines.push({ key: k, label: l, kind: "line", amount: formatMoney(a), indent });
  const sub = (k: string, l: string, a: bigint) => lines.push({ key: k, label: l, kind: "subtotal", amount: formatMoney(a), indent: 0 });
  const tot = (k: string, l: string, a: bigint) => lines.push({ key: k, label: l, kind: "total", amount: formatMoney(a), indent: 0 });
  const hdr = (k: string, l: string) => lines.push({ key: k, label: l, kind: "header", amount: null, indent: 0 });
  hdr("op_h", "Cash flows from operating activities");
  line("np", "Net profit / (loss) for the period", profit); line("dep", "Adjustments for: Depreciation", depreciation);
  line("dar", "Decrease / (increase) in receivables", startAR - endAR); line("dinv", "Decrease / (increase) in inventories", startInv - endInv);
  line("dprep", "Decrease / (increase) in prepayments", startPrep - endPrep); line("dap", "Increase / (decrease) in payables", endAP - startAP);
  line("dtax", "Increase / (decrease) in tax liabilities", endTax - startTax); sub("op_t", "Net cash from operating activities", operating);
  hdr("inv_h", "Cash flows from investing activities"); line("capex", "Purchase of / (proceeds from) PPE", capex); sub("inv_t", "Net cash from investing activities", investing);
  hdr("fin_h", "Cash flows from financing activities"); line("cap", "Proceeds from / (repayments of) capital", capitalIn);
  line("draw", "Owner drawings / dividends (net)", drawings); line("loan", "Proceeds from / (repayments of) loans", loanNet); sub("fin_t", "Net cash from financing activities", financing);
  if (residual !== 0n) line("plug", "Other / unclassified cash movements (reconciling)", residual);
  tot("net", "Net increase / (decrease) in cash", netCashChange); line("open", "Cash and cash equivalents at beginning of period", openingCash, 0); tot("close", "Cash and cash equivalents at end of period", closingCash);
  const body = { statement: "cash_flow" as const, title: "Statement of Cash Flows", method: "indirect", organisation: { id: org.id, legal_name: org.legal_name, trading_name: org.trading_name }, currency: org.functional_currency, period: { from: win.from, to: asOf }, fiscal_year: win.fy, has_postings: openingCash !== 0n || closingCash !== 0n || profit !== 0n, lines, totals: { operating: formatMoney(operating), investing: formatMoney(investing), financing: formatMoney(financing), net_change: formatMoney(netCashChange), opening_cash: formatMoney(openingCash), closing_cash: formatMoney(closingCash), residual: formatMoney(residual) }, basis: "Indirect method from posted ledger. Best-effort classification from account subtypes." };
  if (qstr(c.query.format) === "csv") return { status: 200, raw: { contentType: "text/csv; charset=utf-8", filename: `cash-flow-${win.from}_${asOf}.csv`, data: toCsv(["Label","Kind","Amount"], lines.map((l) => [l.label, l.kind, l.amount ?? ""])) } };
  return ok(body);
});
export const statementRoutes: Route[] = [profitLoss, balanceSheet, cashFlow];
