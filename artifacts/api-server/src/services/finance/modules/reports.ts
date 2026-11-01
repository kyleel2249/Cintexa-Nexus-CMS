import { route, ok, type Route, type Ctx, type Out } from "../core/route";
import { audit, verifyAuditChain } from "../core/audit";
import { qstr, todayIn, ymd } from "../core/validate";
import { badRequest, notFound } from "../core/errors";
import { fromDb, formatMoney } from "../core/money";
import { hasPermission } from "../core/rbac";

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
const csvCell = (v: unknown) => { const s = String(v ?? ""); return /^[=+\-@\t\r]/.test(s) ? `'${s}`.replace(/"/g, '""').replace(/^(.*)$/, '"$1"') : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (head: string[], rows: unknown[][]) => [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");

/** percentage with 2 decimals, rounded half away from zero, using integer arithmetic only */
const pct = (n: bigint, d: bigint): string => { const x = (n * 10000n * 2n + (n < 0n ? -d : d)) / (d * 2n); const neg = x < 0n; const a = neg ? -x : x; return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`; };
const ADJUSTING = ["adjustment", "accrual", "prepayment", "reclassification"];

export async function trialBalance(c: Ctx, asOf: string, basis: string, from?: string) {
  const fy = (await c.q.query<any>("SELECT start_date FROM finance_fiscal_years WHERE org_id = $1 AND $2::date BETWEEN start_date AND end_date", [c.org.orgId, asOf])).rows[0];
  const fyStart = fy ? ymd(fy.start_date) : "0001-01-01";
  // closing entries of the CURRENT year are excluded from pre-closing bases so revenue/expenses still show the year's activity
  const cond = ["e.org_id = a.org_id", "e.entry_date <= $2::date", "$3::date IS NOT NULL"];
  if (basis !== "post_closing") cond.push(`(e.journal_type <> 'closing' OR e.entry_date < $3::date)`);
  if (basis === "unadjusted") cond.push(`e.journal_type NOT IN (${ADJUSTING.map((t) => `'${t}'`).join(",")})`);
  const rows = (await c.q.query<any>(
    `SELECT a.id, a.code, a.name, a.type, a.normal_balance, COALESCE(SUM(e.debit),0) AS d, COALESCE(SUM(e.credit),0) AS c,
            COALESCE(SUM(e.debit) FILTER (WHERE $4::date IS NOT NULL AND e.entry_date < $4::date),0) AS od, COALESCE(SUM(e.credit) FILTER (WHERE $4::date IS NOT NULL AND e.entry_date < $4::date),0) AS oc
       FROM finance_accounts a LEFT JOIN finance_ledger_entries e ON e.account_id = a.id AND ${cond.join(" AND ")}
      WHERE a.org_id = $1 GROUP BY a.id, a.code, a.name, a.type, a.normal_balance ORDER BY a.code`, [c.org.orgId, asOf, fyStart, from ?? null])).rows;
  let td = 0n; let tc = 0n; const out = [];
  for (const r of rows) {
    const d = fromDb(r.d); const cr = fromDb(r.c); const net = d - cr;
    if (d === cr) continue; // nil balance (never used, or fully closed) - not listed
    const debitBal = net > 0n ? net : 0n; const creditBal = net < 0n ? -net : 0n;
    td += debitBal; tc += creditBal;
    const opening = fromDb(r.od) - fromDb(r.oc);
    out.push({ account_id: Number(r.id), code: r.code, name: r.name, type: r.type, debit_total: formatMoney(d), credit_total: formatMoney(cr), debit_balance: formatMoney(debitBal), credit_balance: formatMoney(creditBal),
      ...(from ? { opening_balance: formatMoney(opening < 0n ? -opening : opening), opening_side: opening >= 0n ? "debit" : "credit", movement_debit: formatMoney(d - fromDb(r.od)), movement_credit: formatMoney(cr - fromDb(r.oc)) } : {}) });
  }
  return { as_of: asOf, basis, from: from ?? null, currency: c.org.functionalCurrency, rows: out, total_debit: formatMoney(td), total_credit: formatMoney(tc), balanced: td === tc, difference: formatMoney(td - tc) };
}

const tb = route("GET", "/trial-balance", { perm: "ledger:read" }, async (c): Promise<Out> => {
  const org = (await c.q.query<any>("SELECT timezone FROM finance_organisations WHERE id = $1", [c.org.orgId])).rows[0];
  const asOf = qstr(c.query.as_of) ?? todayIn(org.timezone, c.now); const basis = qstr(c.query.basis) ?? "adjusted"; const from = qstr(c.query.from); const cmp = qstr(c.query.compare_as_of);
  if (!isDate(asOf) || (from && !isDate(from)) || (cmp && !isDate(cmp))) throw badRequest("Dates must be YYYY-MM-DD");
  if (!["unadjusted", "adjusted", "post_closing"].includes(basis)) throw badRequest("basis must be unadjusted, adjusted or post_closing");
  const cur = await trialBalance(c, asOf, basis, from);
  const comparative = cmp ? await trialBalance(c, cmp, basis) : undefined;
  if (qstr(c.query.format) === "csv") {
    if (!hasPermission(c.org.role, "reports:export")) throw badRequest("Missing permission reports:export");
    return { status: 200, raw: { contentType: "text/csv; charset=utf-8", filename: `trial-balance-${asOf}.csv`, data: toCsv(["Code", "Account", "Debit", "Credit"], [...cur.rows.map((r) => [r.code, r.name, r.debit_balance, r.credit_balance]), ["", "TOTAL", cur.total_debit, cur.total_credit]]) } };
  }
  return ok({ trial_balance: cur, comparative });
});

const ledger = route("GET", "/ledger", { perm: "ledger:read" }, async (c): Promise<Out> => {
  const accId = qstr(c.query.account_id); const code = qstr(c.query.account_code);
  if (!accId && !code) throw badRequest("account_id or account_code is required");
  const a = (await c.q.query<any>(`SELECT id, code, name, type, normal_balance FROM finance_accounts WHERE org_id = $1 AND ${accId ? "id = $2" : "code = $2"}`, [c.org.orgId, accId ?? code])).rows[0];
  if (!a) throw notFound("Account");
  const from = qstr(c.query.from); const to = qstr(c.query.to);
  if ((from && !isDate(from)) || (to && !isDate(to))) throw badRequest("Dates must be YYYY-MM-DD");
  const limit = Math.min(500, Math.max(1, Number(qstr(c.query.limit)) || 100)); const offset = Math.max(0, Number(qstr(c.query.offset)) || 0);
  const sign = (d: bigint, cr: bigint) => (a.normal_balance === "debit" ? d - cr : cr - d);
  const op = (await c.q.query<any>("SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c FROM finance_ledger_entries WHERE org_id = $1 AND account_id = $2 AND ($3::date IS NOT NULL AND entry_date < $3::date)", [c.org.orgId, a.id, from ?? null])).rows[0];
  const opening = from ? sign(fromDb(op.d), fromDb(op.c)) : 0n;
  const rows = (await c.q.query<any>(
    `SELECT e.id, e.entry_date, e.reference, e.journal_id, e.journal_type, e.description, e.debit, e.credit, j.source_module, j.source_ref
       FROM finance_ledger_entries e JOIN finance_journals j ON j.id = e.journal_id AND j.org_id = e.org_id
      WHERE e.org_id = $1 AND e.account_id = $2 AND ($3::date IS NULL OR e.entry_date >= $3::date) AND ($4::date IS NULL OR e.entry_date <= $4::date)
      ORDER BY e.entry_date, e.id`, [c.org.orgId, a.id, from ?? null, to ?? null])).rows;
  let run = opening; let td = 0n; let tc = 0n;
  const all = rows.map((r: any) => { const d = fromDb(r.debit); const cr = fromDb(r.credit); td += d; tc += cr; run += sign(d, cr); return { ...r, debit: formatMoney(d), credit: formatMoney(cr), running_balance: formatMoney(run) }; });
  const body = { account: a, from: from ?? null, to: to ?? null, opening_balance: formatMoney(opening), total_debit: formatMoney(td), total_credit: formatMoney(tc), closing_balance: formatMoney(run), total: all.length, limit, offset, items: all.slice(offset, offset + limit) };
  if (qstr(c.query.format) === "csv") {
    if (!hasPermission(c.org.role, "reports:export")) throw badRequest("Missing permission reports:export");
    return { status: 200, raw: { contentType: "text/csv; charset=utf-8", filename: `ledger-${a.code}.csv`, data: toCsv(["Date", "Reference", "Description", "Debit", "Credit", "Balance"], all.map((r) => [ymd(r.entry_date), r.reference, r.description, r.debit, r.credit, r.running_balance])) } };
  }
  return ok(body);
});

const overview = route("GET", "/overview", { perm: "finance:read" }, async (c) => {
  const org = (await c.q.query<any>("SELECT id, legal_name, trading_name, functional_currency, timezone FROM finance_organisations WHERE id = $1", [c.org.orgId])).rows[0];
  const today = todayIn(org.timezone, c.now);
  const counts = (await c.q.query<any>("SELECT status, count(*)::int AS n FROM finance_journals WHERE org_id = $1 GROUP BY status", [c.org.orgId])).rows;
  const period = (await c.q.query<any>("SELECT id, name, status FROM finance_periods WHERE org_id = $1 AND $2::date BETWEEN start_date AND end_date", [c.org.orgId, today])).rows[0] ?? null;
  const t = await trialBalance(c, today, "post_closing");
  return ok({ organisation: org, role: c.org.role, current_period: period, journals: Object.fromEntries(counts.map((r: any) => [r.status, r.n])), trial_balance: { balanced: t.balanced, total_debit: t.total_debit, total_credit: t.total_credit, accounts_with_activity: t.rows.length } });
});


/** Executive dashboard: every figure is a deterministic SQL aggregate over POSTED ledger entries, with its formula stated. */
const dashboard = route("GET", "/dashboard", { perm: "ledger:read" }, async (c) => {
  const org = (await c.q.query<any>("SELECT timezone, functional_currency FROM finance_organisations WHERE id = $1", [c.org.orgId])).rows[0];
  const today = todayIn(org.timezone, c.now);
  const fy = (await c.q.query<any>("SELECT id, name, start_date, end_date FROM finance_fiscal_years WHERE org_id = $1 AND $2::date BETWEEN start_date AND end_date", [c.org.orgId, today])).rows[0];
  const from = fy ? ymd(fy.start_date) : today;
  const ytd = (await c.q.query<any>(
    `SELECT a.type, a.category, COALESCE(SUM(e.debit),0) AS d, COALESCE(SUM(e.credit),0) AS c FROM finance_ledger_entries e JOIN finance_accounts a ON a.id = e.account_id AND a.org_id = e.org_id
      WHERE e.org_id = $1 AND e.entry_date BETWEEN $2::date AND $3::date AND e.journal_type <> 'closing' AND a.type IN ('revenue','expense') GROUP BY a.type, a.category`, [c.org.orgId, from, today])).rows;
  const credit = (t: string, cat?: string): bigint => ytd.filter((r: any) => r.type === t && (!cat || r.category === cat)).reduce<bigint>((x, r: any) => x + fromDb(r.c) - fromDb(r.d), 0n);
  const debit = (t: string, cat?: string): bigint => ytd.filter((r: any) => r.type === t && (!cat || r.category === cat)).reduce<bigint>((x, r: any) => x + fromDb(r.d) - fromDb(r.c), 0n);
  const revenue = credit("revenue"); const cogs = debit("expense", "cost_of_goods_sold"); const expenses = debit("expense");
  const bal = (await c.q.query<any>(
    `SELECT a.subtype, a.normal_balance, COALESCE(SUM(e.debit),0) AS d, COALESCE(SUM(e.credit),0) AS c FROM finance_accounts a
       LEFT JOIN finance_ledger_entries e ON e.account_id = a.id AND e.org_id = a.org_id AND e.entry_date <= $2::date WHERE a.org_id = $1 AND a.subtype IS NOT NULL GROUP BY a.subtype, a.normal_balance`, [c.org.orgId, today])).rows;
  const sub = (subs: string[], side: "debit" | "credit"): bigint => bal.filter((r: any) => subs.includes(r.subtype)).reduce<bigint>((x, r: any) => x + (side === "debit" ? fromDb(r.d) - fromDb(r.c) : fromDb(r.c) - fromDb(r.d)), 0n);
  const cash = sub(["cash", "bank", "mobile_money"], "debit"); const ar = sub(["accounts_receivable", "contra_receivable"], "debit"); const ap = sub(["accounts_payable"], "credit");
  const taxLiab = sub(["vat_payable", "nhil_payable", "getfund_payable", "wht_payable", "paye_payable", "cit_payable"], "credit");
  const monthly = (await c.q.query<any>(
    `SELECT p.id, p.name, p.start_date, COALESCE(SUM(e.credit - e.debit) FILTER (WHERE a.type = 'revenue'),0) AS rev, COALESCE(SUM(e.debit - e.credit) FILTER (WHERE a.type = 'expense'),0) AS exp
       FROM finance_periods p LEFT JOIN finance_ledger_entries e ON e.period_id = p.id AND e.org_id = p.org_id AND e.journal_type <> 'closing' LEFT JOIN finance_accounts a ON a.id = e.account_id AND a.org_id = e.org_id
      WHERE p.org_id = $1 AND p.fiscal_year_id = $2 GROUP BY p.id, p.name, p.start_date ORDER BY p.start_date`, [c.org.orgId, fy?.id ?? 0])).rows;
  const posted = Number((await c.q.query<any>("SELECT count(*)::int AS n FROM finance_ledger_entries WHERE org_id = $1", [c.org.orgId])).rows[0].n);
  const m = formatMoney;
  return ok({
    currency: org.functional_currency, as_of: today, fiscal_year: fy ? { id: fy.id, name: fy.name, from } : null, has_postings: posted > 0,
    kpis: {
      revenue: { value: m(revenue), formula: "Revenue accounts: credits - debits, fiscal year to date" },
      cost_of_sales: { value: m(cogs), formula: "Cost of goods sold accounts: debits - credits, fiscal year to date" },
      gross_profit: { value: m(revenue - cogs), formula: "Revenue - Cost of goods sold" },
      expenses: { value: m(expenses), formula: "All expense accounts (incl. cost of sales): debits - credits, fiscal year to date" },
      net_profit: { value: m(revenue - expenses), formula: "Revenue - All expenses" },
      cash_and_bank: { value: m(cash), formula: "Cash, bank and mobile-money accounts: debits - credits, all time to today" },
      receivables: { value: m(ar), formula: "Accounts receivable (net of allowance): debits - credits" },
      payables: { value: m(ap), formula: "Accounts payable: credits - debits" },
      tax_liabilities: { value: m(taxLiab), formula: "VAT, NHIL, GETFund, WHT, PAYE and CIT payable accounts: credits - debits" },
      gross_margin_pct: revenue > 0n ? { value: pct(revenue - cogs, revenue), formula: "(Revenue - Cost of goods sold) / Revenue x 100" } : null,
      net_margin_pct: revenue > 0n ? { value: pct(revenue - expenses, revenue), formula: "Net profit / Revenue x 100" } : null,
    },
    monthly: monthly.map((r: any) => ({ period_id: r.id, period: r.name, revenue: m(fromDb(r.rev)), expenses: m(fromDb(r.exp)), net: m(fromDb(r.rev) - fromDb(r.exp)) })),
  });
});

const auditList = route("GET", "/audit", { perm: "audit:read" }, async (c) => {
  const limit = Math.min(200, Math.max(1, Number(qstr(c.query.limit)) || 50)); const offset = Math.max(0, Number(qstr(c.query.offset)) || 0);
  const entity = qstr(c.query.entity_type); const p: unknown[] = [c.org.orgId]; let w = "org_id = $1"; if (entity) { p.push(entity); w += ` AND entity_type = $${p.length}`; }
  const total = Number((await c.q.query<any>(`SELECT count(*)::int AS n FROM finance_audit_events WHERE ${w}`, p)).rows[0].n);
  const items = (await c.q.query<any>(`SELECT id, seq, at, actor_id, actor_label, action, entity_type, entity_id, source_module, summary, before, after, request_id, hash FROM finance_audit_events WHERE ${w} ORDER BY seq DESC LIMIT ${limit} OFFSET ${offset}`, p)).rows;
  return ok({ items, total, limit, offset });
});
const auditVerify = route("GET", "/audit/verify", { perm: "audit:read" }, async (c) => ok(await verifyAuditChain(c.q, c.org.orgId)));

export const reportRoutes: Route[] = [tb, ledger, overview, dashboard, auditList, auditVerify];
