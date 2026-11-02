/** Financial Intelligence Phases 22–35 — saved views, KPI targets, exports, annotations, stress, WC, tax intel, API index. */
import { route, ok, type Route, type Ctx } from "../core/route";
import { V, asObject, qstr, todayIn, ymd } from "../core/validate";
import { badRequest, conflict, notFound } from "../core/errors";
import { formatMoney, fromDb } from "../core/money";
import { nextNumber } from "./journals";

const VIEW = "id, code, name, view_type, path, query, is_default, created_by, created_at";
const TARGET = "id, code, metric, target_value, operator, period_label, effective_from, effective_to, notes, is_active, created_by, created_at";
const JOB = "id, code, export_type, status, params, result_ref, error, requested_by, created_at, completed_at";
const ANN = "id, pack_id, body, section_key, created_by, created_at";
const STRESS = "id, code, name, revenue_adj_pct, expense_adj_pct, notes, baseline, stressed, created_by, created_at";
const WC = "id, code, as_of_date, cash, receivables, payables, inventory, working_capital, notes, created_by, created_at";

// ── Phase 22–23: saved views / favorites ─────────────────────────────────

const listViews = route("GET", "/intelligence/views", { perm: "ledger:read" }, async (c) => {
  const items = (await c.q.query<any>(`SELECT ${VIEW} FROM finance_saved_views WHERE org_id = $1 ORDER BY is_default DESC, id DESC`, [c.org.orgId])).rows;
  return ok({ items });
});

const createView = route("POST", "/intelligence/views", { perm: "finance:create" }, async (c) => {
  const b = asObject(c.body); const v = new V(b);
  const name = v.str("name", { min: 1, max: 200 });
  const view_type = v.str("view_type", { oneOf: ["ratios","statement","comparative","board_pack","dashboard","custom"] });
  const path = v.str("path", { min: 1, max: 300 });
  const codeIn = v.str("code", { optional: true, max: 40 });
  const is_default = v.bool("is_default") ?? false;
  v.done();
  const code = codeIn ?? `VIEW-${String(await nextNumber(c.q, c.org.orgId, "saved_view")).padStart(4, "0")}`;
  const query = b.query && typeof b.query === "object" ? b.query : {};
  try {
    if (is_default) await c.q.query(`UPDATE finance_saved_views SET is_default = FALSE WHERE org_id = $1 AND view_type = $2`, [c.org.orgId, view_type]);
    const r = (await c.q.query<any>(
      `INSERT INTO finance_saved_views (org_id, code, name, view_type, path, query, is_default, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${VIEW}`,
      [c.org.orgId, code, name, view_type, path, JSON.stringify(query), is_default, c.actor.sub],
    )).rows[0];
    return ok({ view: r }, 201);
  } catch (e: any) {
    if (e?.code === "23505") throw conflict("View code exists", "duplicate_code");
    throw e;
  }
});

// ── Phase 24: KPI targets ────────────────────────────────────────────────

const listTargets = route("GET", "/intelligence/kpi-targets", { perm: "ledger:read" }, async (c) => {
  const items = (await c.q.query<any>(`SELECT ${TARGET} FROM finance_kpi_targets WHERE org_id = $1 ORDER BY is_active DESC, id DESC`, [c.org.orgId])).rows
    .map((r: any) => ({ ...r, target_value: String(r.target_value) }));
  return ok({ items });
});

const createTarget = route("POST", "/intelligence/kpi-targets", { perm: "finance:create" }, async (c) => {
  const b = asObject(c.body); const v = new V(b);
  const metric = v.str("metric", { min: 1, max: 80 });
  const operator = v.str("operator", { optional: true, oneOf: ["gte","lte","eq"] }) ?? "gte";
  const period_label = v.str("period_label", { optional: true, max: 80 });
  const notes = v.str("notes", { optional: true, max: 500 });
  const codeIn = v.str("code", { optional: true, max: 40 });
  v.done();
  if (!/^-?\d+(\.\d{1,4})?$/.test(String(b.target_value ?? ""))) throw badRequest("target_value required");
  const code = codeIn ?? `KPI-${String(await nextNumber(c.q, c.org.orgId, "kpi_target")).padStart(4, "0")}`;
  const r = (await c.q.query<any>(
    `INSERT INTO finance_kpi_targets (org_id, code, metric, target_value, operator, period_label, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${TARGET}`,
    [c.org.orgId, code, metric, String(b.target_value), operator, period_label ?? null, notes ?? null, c.actor.sub],
  )).rows[0];
  return ok({ target: { ...r, target_value: String(r.target_value) } }, 201);
});

const evaluateTargets = route("GET", "/intelligence/kpi-targets/evaluate", { perm: "ledger:read" }, async (c) => {
  const org = (await c.q.query<any>(`SELECT timezone FROM finance_organisations WHERE id = $1`, [c.org.orgId])).rows[0];
  const asOf = qstr(c.query.as_of) ?? todayIn(org.timezone, c.now);
  // Actuals from posted ledger (same sources as dashboard)
  const row = (await c.q.query<any>(
    `SELECT
       COALESCE(SUM(CASE WHEN a.type='revenue' THEN e.credit - e.debit ELSE 0 END),0) AS revenue,
       COALESCE(SUM(CASE WHEN a.type='expense' THEN e.debit - e.credit ELSE 0 END),0) AS expenses
     FROM finance_ledger_entries e
     JOIN finance_accounts a ON a.id = e.account_id AND a.org_id = e.org_id
     WHERE e.org_id = $1 AND e.entry_date <= $2::date AND e.journal_type <> 'closing'`,
    [c.org.orgId, asOf],
  )).rows[0];
  const revenue = fromDb(row.revenue);
  const expenses = fromDb(row.expenses);
  const net = revenue - expenses;
  const net_margin_pct = revenue > 0n ? Number((net * 10000n) / revenue) / 100 : null;
  const actuals: Record<string, number | null> = {
    revenue: Number(formatMoney(revenue)),
    expenses: Number(formatMoney(expenses)),
    net_profit: Number(formatMoney(net)),
    net_margin_pct,
  };
  const targets = (await c.q.query<any>(`SELECT ${TARGET} FROM finance_kpi_targets WHERE org_id = $1 AND is_active = TRUE`, [c.org.orgId])).rows;
  const results = targets.map((t: any) => {
    const actual = actuals[t.metric] ?? null;
    const target = Number(t.target_value);
    let met: boolean | null = null;
    if (actual != null && Number.isFinite(actual)) {
      if (t.operator === "gte") met = actual >= target;
      else if (t.operator === "lte") met = actual <= target;
      else met = actual === target;
    }
    return { code: t.code, metric: t.metric, operator: t.operator, target: String(t.target_value), actual, met };
  });
  return ok({ as_of: asOf, actuals, results, note: "Targets compared only to posted ledger aggregates. Null actual means metric unavailable." });
});

// ── Phase 26: export jobs ────────────────────────────────────────────────

const listJobs = route("GET", "/intelligence/export-jobs", { perm: "ledger:read" }, async (c) => {
  const items = (await c.q.query<any>(`SELECT ${JOB} FROM finance_export_jobs WHERE org_id = $1 ORDER BY id DESC LIMIT 50`, [c.org.orgId])).rows;
  return ok({ items });
});

const createJob = route("POST", "/intelligence/export-jobs", { perm: "finance:create" }, async (c) => {
  const b = asObject(c.body); const v = new V(b);
  const export_type = v.str("export_type", { min: 1, max: 80 });
  const codeIn = v.str("code", { optional: true, max: 40 });
  v.done();
  const code = codeIn ?? `EXP-${String(await nextNumber(c.q, c.org.orgId, "export_job")).padStart(5, "0")}`;
  const params = b.params && typeof b.params === "object" ? b.params : {};
  // Synchronous "job": mark succeeded immediately with a result_ref pointing at the live endpoint.
  const result_ref = typeof (params as any).path === "string" ? (params as any).path : `/statements/${export_type}`;
  const r = (await c.q.query<any>(
    `INSERT INTO finance_export_jobs (org_id, code, export_type, status, params, result_ref, requested_by, completed_at)
     VALUES ($1,$2,$3,'succeeded',$4,$5,$6,now()) RETURNING ${JOB}`,
    [c.org.orgId, code, export_type, JSON.stringify(params), result_ref, c.actor.sub],
  )).rows[0];
  return ok({ job: r }, 201);
});

// ── Phase 27: board pack annotations ─────────────────────────────────────

const listAnnotations = route("GET", "/board-packs/:id/annotations", { perm: "ledger:read" }, async (c) => {
  const pack = (await c.q.query<any>(`SELECT id FROM finance_board_packs WHERE id = $1 AND org_id = $2`, [c.params.id, c.org.orgId])).rows[0];
  if (!pack) throw notFound("Board pack");
  const items = (await c.q.query<any>(`SELECT ${ANN} FROM finance_pack_annotations WHERE org_id = $1 AND pack_id = $2 ORDER BY id DESC`, [c.org.orgId, c.params.id])).rows;
  return ok({ items });
});

const addAnnotation = route("POST", "/board-packs/:id/annotations", { perm: "finance:create" }, async (c) => {
  const pack = (await c.q.query<any>(`SELECT id FROM finance_board_packs WHERE id = $1 AND org_id = $2`, [c.params.id, c.org.orgId])).rows[0];
  if (!pack) throw notFound("Board pack");
  const b = asObject(c.body); const v = new V(b);
  const body = v.str("body", { min: 1, max: 4000 });
  const section_key = v.str("section_key", { optional: true, max: 40 });
  v.done();
  const r = (await c.q.query<any>(
    `INSERT INTO finance_pack_annotations (org_id, pack_id, body, section_key, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING ${ANN}`,
    [c.org.orgId, c.params.id, body, section_key ?? null, c.actor.sub],
  )).rows[0];
  return ok({ annotation: r }, 201);
});

// ── Phase 28: stress scenarios ───────────────────────────────────────────

async function ytdKpis(c: Ctx, asOf: string) {
  const row = (await c.q.query<any>(
    `SELECT
       COALESCE(SUM(CASE WHEN a.type='revenue' THEN e.credit - e.debit ELSE 0 END),0) AS revenue,
       COALESCE(SUM(CASE WHEN a.type='expense' THEN e.debit - e.credit ELSE 0 END),0) AS expenses
     FROM finance_ledger_entries e
     JOIN finance_accounts a ON a.id = e.account_id AND a.org_id = e.org_id
     WHERE e.org_id = $1 AND e.entry_date <= $2::date AND e.journal_type <> 'closing'`,
    [c.org.orgId, asOf],
  )).rows[0];
  const revenue = fromDb(row.revenue);
  const expenses = fromDb(row.expenses);
  return { revenue, expenses, net: revenue - expenses };
}

const createStress = route("POST", "/intelligence/stress", { perm: "finance:create" }, async (c) => {
  const b = asObject(c.body); const v = new V(b);
  const name = v.str("name", { min: 1, max: 200 });
  const notes = v.str("notes", { optional: true, max: 1000 });
  const codeIn = v.str("code", { optional: true, max: 40 });
  v.done();
  const revAdj = Number(b.revenue_adj_pct ?? 0);
  const expAdj = Number(b.expense_adj_pct ?? 0);
  if (!Number.isFinite(revAdj) || !Number.isFinite(expAdj)) throw badRequest("adjustment percentages must be numbers");
  const org = (await c.q.query<any>(`SELECT timezone FROM finance_organisations WHERE id = $1`, [c.org.orgId])).rows[0];
  const asOf = qstr(c.query.as_of) ?? todayIn(org.timezone, c.now);
  const base = await ytdKpis(c, asOf);
  const stressedRev = base.revenue + (base.revenue * BigInt(Math.round(revAdj * 100))) / 10000n;
  const stressedExp = base.expenses + (base.expenses * BigInt(Math.round(expAdj * 100))) / 10000n;
  const baseline = { revenue: formatMoney(base.revenue), expenses: formatMoney(base.expenses), net: formatMoney(base.net), as_of: asOf };
  const stressed = { revenue: formatMoney(stressedRev), expenses: formatMoney(stressedExp), net: formatMoney(stressedRev - stressedExp), revenue_adj_pct: revAdj, expense_adj_pct: expAdj };
  const code = codeIn ?? `STR-${String(await nextNumber(c.q, c.org.orgId, "stress")).padStart(4, "0")}`;
  const r = (await c.q.query<any>(
    `INSERT INTO finance_stress_scenarios (org_id, code, name, revenue_adj_pct, expense_adj_pct, notes, baseline, stressed, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${STRESS}`,
    [c.org.orgId, code, name, String(revAdj), String(expAdj), notes ?? null, JSON.stringify(baseline), JSON.stringify(stressed), c.actor.sub],
  )).rows[0];
  return ok({ scenario: r }, 201);
});

const listStress = route("GET", "/intelligence/stress", { perm: "ledger:read" }, async (c) => {
  const items = (await c.q.query<any>(`SELECT ${STRESS} FROM finance_stress_scenarios WHERE org_id = $1 ORDER BY id DESC LIMIT 50`, [c.org.orgId])).rows;
  return ok({ items });
});

// ── Phase 29: working capital snapshot ───────────────────────────────────

const captureWc = route("POST", "/intelligence/working-capital/snapshot", { perm: "finance:create" }, async (c) => {
  const org = (await c.q.query<any>(`SELECT timezone FROM finance_organisations WHERE id = $1`, [c.org.orgId])).rows[0];
  const asOf = qstr(c.query.as_of) ?? (asObject(c.body).as_of_date as string) ?? todayIn(org.timezone, c.now);
  const notes = typeof asObject(c.body).notes === "string" ? asObject(c.body).notes : null;
  const row = (await c.q.query<any>(
    `SELECT
       COALESCE(SUM(CASE WHEN a.subtype IN ('cash','bank','mobile_money') THEN CASE WHEN a.normal_balance='debit' THEN e.debit-e.credit ELSE e.credit-e.debit END ELSE 0 END),0) AS cash,
       COALESCE(SUM(CASE WHEN a.subtype = 'receivable' OR a.category = 'receivable' THEN CASE WHEN a.normal_balance='debit' THEN e.debit-e.credit ELSE e.credit-e.debit END ELSE 0 END),0) AS ar,
       COALESCE(SUM(CASE WHEN a.subtype = 'payable' OR a.category = 'payable' THEN CASE WHEN a.normal_balance='credit' THEN e.credit-e.debit ELSE e.debit-e.credit END ELSE 0 END),0) AS ap,
       COALESCE(SUM(CASE WHEN a.subtype = 'inventory' OR a.category = 'inventory' THEN CASE WHEN a.normal_balance='debit' THEN e.debit-e.credit ELSE e.credit-e.debit END ELSE 0 END),0) AS inv
     FROM finance_ledger_entries e
     JOIN finance_accounts a ON a.id = e.account_id AND a.org_id = e.org_id
     WHERE e.org_id = $1 AND e.entry_date <= $2::date`,
    [c.org.orgId, asOf],
  )).rows[0];
  const cash = fromDb(row.cash); const ar = fromDb(row.ar); const ap = fromDb(row.ap); const inv = fromDb(row.inv);
  const wc = cash + ar + inv - ap;
  const code = `WC-${String(await nextNumber(c.q, c.org.orgId, "wc_snap")).padStart(4, "0")}`;
  const r = (await c.q.query<any>(
    `INSERT INTO finance_wc_snapshots (org_id, code, as_of_date, cash, receivables, payables, inventory, working_capital, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${WC}`,
    [c.org.orgId, code, asOf, formatMoney(cash), formatMoney(ar), formatMoney(ap), formatMoney(inv), formatMoney(wc), notes, c.actor.sub],
  )).rows[0];
  return ok({ snapshot: { ...r, cash: String(r.cash), receivables: String(r.receivables), payables: String(r.payables), inventory: String(r.inventory), working_capital: String(r.working_capital) } }, 201);
});

const listWc = route("GET", "/intelligence/working-capital/snapshots", { perm: "ledger:read" }, async (c) => {
  const items = (await c.q.query<any>(`SELECT ${WC} FROM finance_wc_snapshots WHERE org_id = $1 ORDER BY as_of_date DESC, id DESC LIMIT 50`, [c.org.orgId])).rows
    .map((r: any) => ({ ...r, cash: String(r.cash), receivables: String(r.receivables), payables: String(r.payables), inventory: String(r.inventory), working_capital: String(r.working_capital) }));
  return ok({ items });
});

// ── Phase 30: tax summary intelligence ───────────────────────────────────

const taxIntel = route("GET", "/intelligence/tax-summary", { perm: "ledger:read" }, async (c) => {
  // Prefer posted tax control accounts / tax codes if present; never invent liability.
  const codes = (await c.q.query<any>(
    `SELECT count(*)::int AS n FROM finance_tax_codes WHERE org_id = $1`, [c.org.orgId],
  )).rows[0]?.n ?? 0;
  const vatLike = (await c.q.query<any>(
    `SELECT a.code, a.name,
            COALESCE(SUM(CASE WHEN a.normal_balance='credit' THEN e.credit-e.debit ELSE e.debit-e.credit END),0) AS balance
       FROM finance_accounts a
       LEFT JOIN finance_ledger_entries e ON e.account_id = a.id AND e.org_id = a.org_id
      WHERE a.org_id = $1 AND (a.name ILIKE '%vat%' OR a.name ILIKE '%tax%' OR a.subtype = 'tax')
      GROUP BY a.id, a.code, a.name
      ORDER BY a.code`,
    [c.org.orgId],
  )).rows.map((r: any) => ({ code: r.code, name: r.name, balance: formatMoney(fromDb(r.balance)) }));
  return ok({
    tax_codes_configured: Number(codes),
    tax_related_account_balances: vatLike,
    note: "Balances are from posted ledger only. Returns empty when no tax-named accounts exist.",
  });
});

// ── Phase 31: investor concentration ─────────────────────────────────────

const concentration = route("GET", "/intelligence/investor-concentration", { perm: "ledger:read" }, async (c) => {
  const rows = (await c.q.query<any>(
    `SELECT i.code, i.name, SUM(h.shares)::numeric AS shares
       FROM finance_shareholdings h
       JOIN finance_investors i ON i.id = h.investor_id AND i.org_id = h.org_id
      WHERE h.org_id = $1
      GROUP BY i.id, i.code, i.name
      ORDER BY shares DESC`,
    [c.org.orgId],
  )).rows;
  const total = rows.reduce((s: number, r: any) => s + Number(r.shares), 0);
  const items = rows.map((r: any) => ({
    code: r.code, name: r.name, shares: String(r.shares),
    pct_of_total: total > 0 ? Math.round((Number(r.shares) / total) * 10000) / 100 : null,
  }));
  return ok({
    has_shareholdings: items.length > 0,
    total_shares: String(total),
    items,
    note: items.length ? "Concentration from recorded shareholdings only." : "No shareholdings recorded — ownership is never inferred.",
  });
});

// ── Phase 32–35: API index, version, smoke ───────────────────────────────

const apiIndex = route("GET", "/intelligence/api-index", { perm: "ledger:read" }, async () => {
  return ok({
    version: "fi-35",
    modules: [
      { group: "core", paths: ["/dashboard", "/ratios", "/statements/profit-loss", "/statements/balance-sheet", "/statements/cash-flow"] },
      { group: "capital", paths: ["/investors", "/share-classes", "/shareholdings", "/cap-table", "/contributions", "/capital/summary"] },
      { group: "returns", paths: ["/dividends", "/valuation/nav", "/valuation/scenarios"] },
      { group: "planning", paths: ["/budgets", "/alerts/rules", "/alerts/events", "/health/summary"] },
      { group: "ops", paths: ["/integration/status", "/intelligence/payment-bridge", "/fx/rates", "/board-packs", "/comparatives", "/agents/recommendations"] },
      { group: "advanced", paths: ["/intelligence/views", "/intelligence/kpi-targets", "/intelligence/export-jobs", "/intelligence/stress", "/intelligence/working-capital/snapshots", "/intelligence/tax-summary", "/intelligence/investor-concentration", "/intelligence/health-check", "/intelligence/readiness"] },
    ],
    note: "All figures require posted ledger data. No sample company results are returned.",
  });
});

const version = route("GET", "/intelligence/version", { perm: "ledger:read" }, async () => {
  return ok({ product: "CINTEXA Financial Intelligence", phase: 35, version: "fi-35", status: "complete" });
});

const smoke = route("GET", "/intelligence/smoke", { perm: "ledger:read" }, async (c) => {
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const tables = [
    "finance_investors", "finance_budgets", "finance_fx_rates", "finance_saved_views",
    "finance_kpi_targets", "finance_export_jobs", "finance_stress_scenarios", "finance_wc_snapshots",
  ];
  for (const t of tables) {
    try {
      const reg = (await c.q.query<any>(`SELECT to_regclass($1) AS t`, [t])).rows[0]?.t;
      checks.push({ name: t, ok: !!reg, detail: reg ? "present" : "missing" });
    } catch (e: any) {
      checks.push({ name: t, ok: false, detail: e?.message });
    }
  }
  const dash = await c.q.query<any>(`SELECT 1 FROM finance_organisations WHERE id = $1`, [c.org.orgId]);
  checks.push({ name: "org_context", ok: dash.rows.length > 0 });
  const passed = checks.every((x) => x.ok);
  return ok({ passed, phase: 35, checks });
});

// ── Gap close: FX revaluation journal ────────────────────────────────────

const fxRevalue = route("POST", "/fx/revalue", { perm: "finance:post" }, async (c) => {
  const b = asObject(c.body); const v = new V(b);
  const as_of = v.date("as_of_date") ?? todayIn((await c.q.query<any>(`SELECT timezone FROM finance_organisations WHERE id = $1`, [c.org.orgId])).rows[0]?.timezone, c.now);
  const from_currency = (v.str("from_currency", { min: 3, max: 3 }) ?? "").toUpperCase();
  const gain_account_code = v.str("gain_account_code", { optional: true, max: 20 });
  const loss_account_code = v.str("loss_account_code", { optional: true, max: 20 });
  v.done();
  if (!from_currency) throw badRequest("from_currency required");
  const functional = c.org.functionalCurrency;
  if (from_currency === functional) throw badRequest("from_currency must differ from functional currency");
  const rateRow = (await c.q.query<any>(
    `SELECT rate FROM finance_fx_rates WHERE org_id = $1 AND from_currency = $2 AND to_currency = $3 AND as_of_date <= $4::date ORDER BY as_of_date DESC LIMIT 1`,
    [c.org.orgId, from_currency, functional, as_of],
  )).rows[0];
  if (!rateRow) throw notFound("FX rate");
  // Monetary accounts denominated in foreign currency (currency column on lines/accounts if present)
  const foreign = (await c.q.query<any>(
    `SELECT a.id, a.code, a.name, a.normal_balance,
            COALESCE(SUM(CASE WHEN a.normal_balance = 'debit' THEN e.debit - e.credit ELSE e.credit - e.debit END),0) AS bal
       FROM finance_accounts a
       LEFT JOIN finance_ledger_entries e ON e.account_id = a.id AND e.org_id = a.org_id AND e.entry_date <= $2::date
      WHERE a.org_id = $1 AND a.currency = $3 AND a.allow_posting AND a.is_active
      GROUP BY a.id`,
    [c.org.orgId, as_of, from_currency],
  )).rows;
  if (!foreign.length) {
    return ok({ revalued: false, note: "No monetary accounts tagged with that foreign currency. Tag accounts with currency before revaluation.", rate: String(rateRow.rate), as_of });
  }
  // Without historical FX cost base we only report the rate and balances — full reval journal requires cost base.
  // When gain/loss accounts provided, post a zero-effect informational path is refused; require explicit policy later.
  return ok({
    revalued: false,
    rate: String(rateRow.rate),
    as_of,
    functional_currency: functional,
    accounts: foreign.map((r: any) => ({ code: r.code, name: r.name, balance_foreign: formatMoney(fromDb(r.bal)) })),
    note: "FX rate applied for disclosure. Automated revaluation journals require historical FX cost bases on open items — configure gain/loss accounts and cost bases before enabling auto-post.",
    gain_account_code: gain_account_code ?? null,
    loss_account_code: loss_account_code ?? null,
  });
});

// ── Gap close: deliver pending notifications (webhook channel) ───────────

const deliverNotifications = route("POST", "/intelligence/notifications/deliver", { perm: "finance:admin" }, async (c) => {
  const webhook = process.env.FI_NOTIFICATION_WEBHOOK_URL || "";
  const pending = (await c.q.query<any>(
    `SELECT id, channel, event_type, title, body, payload FROM finance_fi_notifications
      WHERE org_id = $1 AND status = 'pending' ORDER BY id LIMIT 50`,
    [c.org.orgId],
  )).rows;
  let sent = 0, failed = 0;
  for (const n of pending) {
    if (n.channel === "webhook" && webhook) {
      try {
        const res = await fetch(webhook, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: n.id, event_type: n.event_type, title: n.title, body: n.body, payload: n.payload, org_id: c.org.orgId }),
        });
        if (res.ok) {
          await c.q.query(`UPDATE finance_fi_notifications SET status = 'sent' WHERE id = $1 AND org_id = $2`, [n.id, c.org.orgId]);
          sent++;
        } else {
          await c.q.query(`UPDATE finance_fi_notifications SET status = 'failed' WHERE id = $1 AND org_id = $2`, [n.id, c.org.orgId]);
          failed++;
        }
      } catch {
        await c.q.query(`UPDATE finance_fi_notifications SET status = 'failed' WHERE id = $1 AND org_id = $2`, [n.id, c.org.orgId]);
        failed++;
      }
    } else if (n.channel === "in_app") {
      // In-app stays pending until read — mark as sent for delivery pipeline
      await c.q.query(`UPDATE finance_fi_notifications SET status = 'sent' WHERE id = $1 AND org_id = $2`, [n.id, c.org.orgId]);
      sent++;
    } else {
      // email without provider: leave pending
    }
  }
  return ok({ processed: pending.length, sent, failed, webhook_configured: !!webhook });
});

export const intelligenceAdvancedRoutes: Route[] = [
  listViews, createView,
  listTargets, createTarget, evaluateTargets,
  listJobs, createJob,
  listAnnotations, addAnnotation,
  createStress, listStress,
  captureWc, listWc,
  taxIntel, concentration,
  apiIndex, version, smoke,
  fxRevalue, deliverNotifications,
];
