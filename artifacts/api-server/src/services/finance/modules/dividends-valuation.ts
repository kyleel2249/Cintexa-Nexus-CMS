/** Financial Intelligence Phase 7 - dividends and valuation scenarios. */
import { route, ok, type Route } from "../core/route";
import { audit } from "../core/audit";
import { V, asObject, qstr, todayIn, ymd } from "../core/validate";
import { badRequest, conflict, notFound, unprocessable } from "../core/errors";
import { formatMoney, fromDb } from "../core/money";
import { nextNumber } from "./journals";

const DEC = "id, code, title, declaration_date, record_date, payment_date, share_class_id, amount_per_share, total_amount, currency, status, notes, approved_by, approved_at, paid_at, created_by, created_at, updated_at";
const LINE = "id, declaration_id, investor_id, shareholding_id, shares, amount, notes, created_at";
const VAL = "id, code, name, method, as_of_date, currency, equity_value, enterprise_value, multiple, base_metric, base_metric_label, assumptions, notes, is_primary, created_by, created_at, updated_at";

const parseShares = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return String(Math.round(v * 10000) / 10000);
  if (typeof v === "string" && /^\d+(\.\d{1,4})?$/.test(v.trim()) && Number(v) > 0) return v.trim();
  return null;
};

const listDividends = route("GET", "/dividends", { perm: "ledger:read" }, async (c) => {
  const status = qstr(c.query.status);
  const p: unknown[] = [c.org.orgId];
  const w = ["org_id = $1"];
  if (status) { p.push(status); w.push(`status = $${p.length}`); }
  const items = (await c.q.query<any>(`SELECT ${DEC} FROM finance_dividend_declarations WHERE ${w.join(" AND ")} ORDER BY declaration_date DESC, id DESC`, p)).rows.map((r: any) => ({
    ...r,
    total_amount: r.total_amount != null ? formatMoney(fromDb(r.total_amount)) : null,
    amount_per_share: r.amount_per_share != null ? String(r.amount_per_share) : null,
  }));
  return ok({ items });
});

const getDividend = route("GET", "/dividends/:id", { perm: "ledger:read" }, async (c) => {
  const r = (await c.q.query<any>(`SELECT ${DEC} FROM finance_dividend_declarations WHERE id = $1 AND org_id = $2`, [c.params.id, c.org.orgId])).rows[0];
  if (!r) throw notFound("Dividend declaration");
  const lines = (await c.q.query<any>(
    `SELECT l.id, l.declaration_id, l.investor_id, l.shareholding_id, l.shares, l.amount, l.notes, l.created_at,
            i.code AS investor_code, i.name AS investor_name
       FROM finance_dividend_lines l
       JOIN finance_investors i ON i.id = l.investor_id AND i.org_id = l.org_id
      WHERE l.org_id = $1 AND l.declaration_id = $2
      ORDER BY i.name`, [c.org.orgId, r.id])).rows.map((x: any) => ({ ...x, amount: formatMoney(fromDb(x.amount)), shares: String(x.shares) }));
  return ok({
    declaration: {
      ...r,
      total_amount: r.total_amount != null ? formatMoney(fromDb(r.total_amount)) : null,
      amount_per_share: r.amount_per_share != null ? String(r.amount_per_share) : null,
    },
    lines,
  });
});

const createDividend = route("POST", "/dividends", { perm: "finance:create" }, async (c) => {
  const b = asObject(c.body); const v = new V(b);
  const title = v.str("title", { min: 1, max: 200 });
  const declaration_date = v.date("declaration_date");
  const record_date = v.date("record_date", true);
  const payment_date = v.date("payment_date", true);
  const share_class_id = v.int("share_class_id", { optional: true, min: 1 });
  const notes = v.str("notes", { optional: true, max: 2000 });
  const codeIn = v.str("code", { optional: true, max: 40 });
  const currencyIn = v.str("currency", { optional: true, min: 3, max: 3 });
  v.done();
  const org = (await c.q.query<any>(`SELECT functional_currency FROM finance_organisations WHERE id = $1`, [c.org.orgId])).rows[0];
  const currency = currencyIn ?? org?.functional_currency ?? "GHS";
  const code = codeIn ?? `DIV-${String(await nextNumber(c.q, c.org.orgId, "dividend")).padStart(4, "0")}`;
  let amount_per_share: string | null = null;
  if (b.amount_per_share != null) {
    const s = String(b.amount_per_share);
    if (!/^\d+(\.\d{1,6})?$/.test(s) || Number(s) < 0) throw badRequest("amount_per_share must be non-negative");
    amount_per_share = s;
  }
  if (share_class_id && !(await c.q.query<any>(`SELECT id FROM finance_share_classes WHERE id = $1 AND org_id = $2`, [share_class_id, c.org.orgId])).rows[0]) throw notFound("Share class");
  try {
    const r = (await c.q.query<any>(
      `INSERT INTO finance_dividend_declarations (org_id, code, title, declaration_date, record_date, payment_date, share_class_id, amount_per_share, currency, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${DEC}`,
      [c.org.orgId, code, title, declaration_date, record_date ?? null, payment_date ?? null, share_class_id ?? null, amount_per_share, currency, notes ?? null, c.actor.sub],
    )).rows[0];
    await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "dividend.create", entityType: "finance_dividend_declaration", entityId: r.id, summary: `Dividend ${r.code} draft`, after: r, requestId: c.reqId });
    return ok({ declaration: { ...r, total_amount: null, amount_per_share } }, 201);
  } catch (e: any) {
    if (e?.code === "23505") throw conflict("Dividend code already exists", "duplicate_code");
    throw e;
  }
});

/** Build lines from current shareholdings (optionally filtered by share class). Draft only. */
const generateDividendLines = route("POST", "/dividends/:id/generate-lines", { perm: "finance:create" }, async (c) => {
  const decl = (await c.q.query<any>(`SELECT ${DEC} FROM finance_dividend_declarations WHERE id = $1 AND org_id = $2`, [c.params.id, c.org.orgId])).rows[0];
  if (!decl) throw notFound("Dividend declaration");
  if (decl.status !== "draft") throw unprocessable("Lines can only be generated while the declaration is draft", "not_draft");
  if (decl.amount_per_share == null) throw unprocessable("Set amount_per_share before generating lines", "missing_rate");

  const p: unknown[] = [c.org.orgId];
  let classFilter = "";
  if (decl.share_class_id) { p.push(decl.share_class_id); classFilter = ` AND h.share_class_id = $${p.length}`; }
  const holdings = (await c.q.query<any>(
    `SELECT h.id AS shareholding_id, h.investor_id, SUM(h.shares) AS shares
       FROM finance_shareholdings h
      WHERE h.org_id = $1${classFilter}
      GROUP BY h.id, h.investor_id
      HAVING SUM(h.shares) > 0`, p)).rows;
  if (!holdings.length) throw unprocessable("No shareholdings to distribute against. Issue shares first.", "no_holdings");

  await c.q.query(`DELETE FROM finance_dividend_lines WHERE org_id = $1 AND declaration_id = $2`, [c.org.orgId, decl.id]);
  const rate = Number(decl.amount_per_share);
  let totalMinor = 0n;
  const created = [];
  for (const h of holdings) {
    const shares = Number(h.shares);
    const amountStr = (Math.round(shares * rate * 100) / 100).toFixed(2);
    const amountMinor = fromDb(amountStr);
    totalMinor += amountMinor;
    const row = (await c.q.query<any>(
      `INSERT INTO finance_dividend_lines (org_id, declaration_id, investor_id, shareholding_id, shares, amount)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${LINE}`,
      [c.org.orgId, decl.id, h.investor_id, h.shareholding_id, String(h.shares), amountStr],
    )).rows[0];
    created.push({ ...row, amount: formatMoney(fromDb(row.amount)), shares: String(row.shares) });
  }
  const updated = (await c.q.query<any>(
    `UPDATE finance_dividend_declarations SET total_amount = $3, updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING ${DEC}`,
    [decl.id, c.org.orgId, formatMoney(totalMinor)],
  )).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "dividend.generate_lines", entityType: "finance_dividend_declaration", entityId: decl.id, summary: `Generated ${created.length} dividend lines`, after: updated, requestId: c.reqId });
  return ok({
    declaration: { ...updated, total_amount: formatMoney(fromDb(updated.total_amount)), amount_per_share: updated.amount_per_share != null ? String(updated.amount_per_share) : null },
    lines: created,
  });
});

const approveDividend = route("POST", "/dividends/:id/approve", { perm: "finance:approve" }, async (c) => {
  const before = (await c.q.query<any>(`SELECT ${DEC} FROM finance_dividend_declarations WHERE id = $1 AND org_id = $2`, [c.params.id, c.org.orgId])).rows[0];
  if (!before) throw notFound("Dividend declaration");
  if (before.status !== "draft") throw unprocessable("Only draft declarations can be approved", "not_draft");
  const lineCount = Number((await c.q.query<any>(`SELECT count(*)::int AS n FROM finance_dividend_lines WHERE org_id = $1 AND declaration_id = $2`, [c.org.orgId, before.id])).rows[0].n);
  if (lineCount === 0) throw unprocessable("Generate dividend lines before approval", "no_lines");
  const r = (await c.q.query<any>(
    `UPDATE finance_dividend_declarations SET status = 'approved', approved_by = $3, approved_at = now(), updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING ${DEC}`,
    [c.params.id, c.org.orgId, c.actor.sub],
  )).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "dividend.approve", entityType: "finance_dividend_declaration", entityId: r.id, before, after: r, requestId: c.reqId });
  return ok({ declaration: { ...r, total_amount: r.total_amount != null ? formatMoney(fromDb(r.total_amount)) : null } });
});

const markPaidDividend = route("POST", "/dividends/:id/mark-paid", { perm: "finance:update" }, async (c) => {
  const before = (await c.q.query<any>(`SELECT ${DEC} FROM finance_dividend_declarations WHERE id = $1 AND org_id = $2`, [c.params.id, c.org.orgId])).rows[0];
  if (!before) throw notFound("Dividend declaration");
  if (before.status !== "approved") throw unprocessable("Only approved declarations can be marked paid", "not_approved");
  const r = (await c.q.query<any>(
    `UPDATE finance_dividend_declarations SET status = 'paid', paid_at = now(), updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING ${DEC}`,
    [c.params.id, c.org.orgId],
  )).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "dividend.mark_paid", entityType: "finance_dividend_declaration", entityId: r.id, before, after: r, requestId: c.reqId });
  return ok({ declaration: { ...r, total_amount: r.total_amount != null ? formatMoney(fromDb(r.total_amount)) : null } });
});

const voidDividend = route("POST", "/dividends/:id/void", { perm: "finance:update" }, async (c) => {
  const before = (await c.q.query<any>(`SELECT ${DEC} FROM finance_dividend_declarations WHERE id = $1 AND org_id = $2`, [c.params.id, c.org.orgId])).rows[0];
  if (!before) throw notFound("Dividend declaration");
  if (before.status === "paid") throw unprocessable("Paid declarations cannot be voided", "already_paid");
  if (before.status === "void") throw unprocessable("Already void", "already_void");
  const r = (await c.q.query<any>(
    `UPDATE finance_dividend_declarations SET status = 'void', updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING ${DEC}`,
    [c.params.id, c.org.orgId],
  )).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "dividend.void", entityType: "finance_dividend_declaration", entityId: r.id, before, after: r, requestId: c.reqId });
  return ok({ declaration: { ...r, total_amount: r.total_amount != null ? formatMoney(fromDb(r.total_amount)) : null } });
});

/** Net asset value from posted equity + unclosed P&L. */
const valuationNav = route("GET", "/valuation/nav", { perm: "ledger:read" }, async (c) => {
  const org = (await c.q.query<any>(`SELECT timezone, functional_currency FROM finance_organisations WHERE id = $1`, [c.org.orgId])).rows[0];
  if (!org) throw badRequest("Organisation not found");
  const asOf = qstr(c.query.as_of) ?? todayIn(org.timezone, c.now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw badRequest("as_of must be YYYY-MM-DD");
  const fy = (await c.q.query<any>(`SELECT start_date FROM finance_fiscal_years WHERE org_id = $1 AND $2::date BETWEEN start_date AND end_date`, [c.org.orgId, asOf])).rows[0];
  const fyStart = fy ? ymd(fy.start_date) : asOf;

  const equityRows = (await c.q.query<any>(
    `SELECT a.subtype, a.normal_balance, COALESCE(SUM(e.debit),0) AS d, COALESCE(SUM(e.credit),0) AS c
       FROM finance_accounts a
       LEFT JOIN finance_ledger_entries e ON e.account_id = a.id AND e.org_id = a.org_id AND e.entry_date <= $2::date
      WHERE a.org_id = $1 AND a.type = 'equity'
      GROUP BY a.subtype, a.normal_balance`, [c.org.orgId, asOf])).rows;
  let equity = 0n;
  for (const r of equityRows) {
    const d = fromDb(r.d); const cr = fromDb(r.c);
    equity += (r.normal_balance === "debit" ? d - cr : cr - d);
  }
  const pl = (await c.q.query<any>(
    `SELECT a.type, COALESCE(SUM(e.debit),0) AS d, COALESCE(SUM(e.credit),0) AS c
       FROM finance_ledger_entries e
       JOIN finance_accounts a ON a.id = e.account_id AND a.org_id = e.org_id
      WHERE e.org_id = $1 AND e.entry_date BETWEEN $2::date AND $3::date AND e.journal_type <> 'closing' AND a.type IN ('revenue','expense')
      GROUP BY a.type`, [c.org.orgId, fyStart, asOf])).rows;
  let rev = 0n, exp = 0n;
  for (const r of pl) {
    const d = fromDb(r.d); const cr = fromDb(r.c);
    if (r.type === "revenue") rev += cr - d;
    else exp += d - cr;
  }
  const currentProfit = rev - exp;
  const nav = equity + currentProfit;

  const assets = (await c.q.query<any>(
    `SELECT COALESCE(SUM(CASE WHEN a.normal_balance = 'debit' THEN e.debit - e.credit ELSE e.credit - e.debit END),0) AS bal
       FROM finance_ledger_entries e JOIN finance_accounts a ON a.id = e.account_id AND a.org_id = e.org_id
      WHERE e.org_id = $1 AND e.entry_date <= $2::date AND a.type = 'asset'`, [c.org.orgId, asOf])).rows[0];
  const liab = (await c.q.query<any>(
    `SELECT COALESCE(SUM(CASE WHEN a.normal_balance = 'credit' THEN e.credit - e.debit ELSE e.debit - e.credit END),0) AS bal
       FROM finance_ledger_entries e JOIN finance_accounts a ON a.id = e.account_id AND a.org_id = e.org_id
      WHERE e.org_id = $1 AND e.entry_date <= $2::date AND a.type = 'liability'`, [c.org.orgId, asOf])).rows[0];

  return ok({
    currency: org.functional_currency,
    as_of: asOf,
    method: "nav",
    book_equity: formatMoney(equity),
    current_year_profit: formatMoney(currentProfit),
    net_asset_value: formatMoney(nav),
    total_assets: formatMoney(fromDb(assets.bal)),
    total_liabilities: formatMoney(fromDb(liab.bal)),
    note: "NAV equals posted equity plus unclosed current-year profit. Not a market valuation.",
  });
});

const listValuations = route("GET", "/valuation/scenarios", { perm: "ledger:read" }, async (c) => {
  const items = (await c.q.query<any>(`SELECT ${VAL} FROM finance_valuation_scenarios WHERE org_id = $1 ORDER BY is_primary DESC, as_of_date DESC, id DESC`, [c.org.orgId])).rows.map((r: any) => ({
    ...r,
    equity_value: r.equity_value != null ? formatMoney(fromDb(r.equity_value)) : null,
    enterprise_value: r.enterprise_value != null ? formatMoney(fromDb(r.enterprise_value)) : null,
    base_metric: r.base_metric != null ? formatMoney(fromDb(r.base_metric)) : null,
    multiple: r.multiple != null ? String(r.multiple) : null,
  }));
  return ok({ items });
});

const createValuation = route("POST", "/valuation/scenarios", { perm: "finance:create" }, async (c) => {
  const b = asObject(c.body); const v = new V(b);
  const name = v.str("name", { min: 1, max: 200 });
  const method = v.str("method", { optional: true, oneOf: ["nav","earnings_multiple","revenue_multiple","dcf","transaction","other"] }) ?? "nav";
  const as_of_date = v.date("as_of_date");
  const notes = v.str("notes", { optional: true, max: 2000 });
  const base_metric_label = v.str("base_metric_label", { optional: true, max: 100 });
  const codeIn = v.str("code", { optional: true, max: 40 });
  const currencyIn = v.str("currency", { optional: true, min: 3, max: 3 });
  const is_primary = v.bool("is_primary") ?? false;
  v.done();
  const org = (await c.q.query<any>(`SELECT functional_currency FROM finance_organisations WHERE id = $1`, [c.org.orgId])).rows[0];
  const currency = currencyIn ?? org?.functional_currency ?? "GHS";
  const code = codeIn ?? `VAL-${String(await nextNumber(c.q, c.org.orgId, "valuation")).padStart(4, "0")}`;

  const moneyOrNull = (key: string): string | null => {
    if (b[key] == null || b[key] === "") return null;
    try {
      const m = new V({ [key]: b[key] }).money(key);
      return m != null ? formatMoney(m) : null;
    } catch { throw badRequest(`${key} must be a valid money amount`); }
  };
  const equity_value = moneyOrNull("equity_value");
  const enterprise_value = moneyOrNull("enterprise_value");
  const base_metric = moneyOrNull("base_metric");
  let multiple: string | null = null;
  if (b.multiple != null && b.multiple !== "") {
    const s = String(b.multiple);
    if (!/^\d+(\.\d{1,4})?$/.test(s)) throw badRequest("multiple must be a non-negative number");
    multiple = s;
  }
  let assumptions = {};
  if (b.assumptions != null) {
    if (typeof b.assumptions !== "object" || Array.isArray(b.assumptions)) throw badRequest("assumptions must be an object");
    assumptions = b.assumptions;
  }

  if (is_primary) {
    await c.q.query(`UPDATE finance_valuation_scenarios SET is_primary = FALSE WHERE org_id = $1 AND is_primary = TRUE`, [c.org.orgId]);
  }
  try {
    const r = (await c.q.query<any>(
      `INSERT INTO finance_valuation_scenarios (org_id, code, name, method, as_of_date, currency, equity_value, enterprise_value, multiple, base_metric, base_metric_label, assumptions, notes, is_primary, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${VAL}`,
      [c.org.orgId, code, name, method, as_of_date, currency, equity_value, enterprise_value, multiple, base_metric, base_metric_label ?? null, JSON.stringify(assumptions), notes ?? null, is_primary, c.actor.sub],
    )).rows[0];
    await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "valuation.create", entityType: "finance_valuation_scenario", entityId: r.id, summary: `Valuation ${r.code}`, after: r, requestId: c.reqId });
    return ok({
      scenario: {
        ...r,
        equity_value: r.equity_value != null ? formatMoney(fromDb(r.equity_value)) : null,
        enterprise_value: r.enterprise_value != null ? formatMoney(fromDb(r.enterprise_value)) : null,
        base_metric: r.base_metric != null ? formatMoney(fromDb(r.base_metric)) : null,
        multiple: r.multiple != null ? String(r.multiple) : null,
      },
    }, 201);
  } catch (e: any) {
    if (e?.code === "23505") throw conflict("Valuation code already exists", "duplicate_code");
    throw e;
  }
});

const deleteValuation = route("DELETE", "/valuation/scenarios/:id", { perm: "finance:update" }, async (c) => {
  const r = (await c.q.query<any>(`DELETE FROM finance_valuation_scenarios WHERE id = $1 AND org_id = $2 RETURNING id, code`, [c.params.id, c.org.orgId])).rows[0];
  if (!r) throw notFound("Valuation scenario");
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "valuation.delete", entityType: "finance_valuation_scenario", entityId: r.id, summary: `Deleted valuation ${r.code}`, requestId: c.reqId });
  return ok({ deleted: true, id: r.id });
});

export const dividendValuationRoutes: Route[] = [
  listDividends, getDividend, createDividend, generateDividendLines, approveDividend, markPaidDividend, voidDividend,
  valuationNav, listValuations, createValuation, deleteValuation,
];
