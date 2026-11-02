/** Financial Intelligence Phases 10–21: FX, board packs, comparatives, agents, notifications, health, payment bridge status. */
import { route, ok, type Route, type Ctx } from "../core/route";
import { audit } from "../core/audit";
import { V, asObject, qstr, todayIn, ymd } from "../core/validate";
import { badRequest, conflict, notFound, unprocessable } from "../core/errors";
import { formatMoney, fromDb } from "../core/money";
import { nextNumber } from "./journals";

const FX = "id, from_currency, to_currency, rate, as_of_date, source, notes, created_by, created_at";
const PACK = "id, code, title, as_of_date, period_from, period_to, status, include_pnl, include_balance_sheet, include_cash_flow, include_ratios, notes, published_at, created_by, created_at, updated_at";
const COMP = "id, code, label, base_from, base_to, compare_from, compare_to, metric_set, snapshot, created_by, created_at";
const AGENT = "id, code, category, severity, title, body, evidence, status, generated_at, decided_at, decided_by";
const NOTIF = "id, channel, event_type, title, body, payload, status, created_at, read_at";

// ── Phase 10: payment bridge status (read-only over integration events) ──

const paymentBridgeStatus = route("GET", "/intelligence/payment-bridge", { perm: "ledger:read" }, async (c) => {
  const byStatus = (await c.q.query<any>(
    `SELECT status, count(*)::int AS n FROM finance_integration_events
      WHERE (org_id = $1 OR org_id IS NULL)
        AND (event_type ILIKE '%payment%' OR source_entity_type ILIKE '%payment%')
      GROUP BY status`, [c.org.orgId])).rows;
  const recent = (await c.q.query<any>(
    `SELECT id, event_type, source_module, source_entity_type, source_entity_id, status, last_error, created_at, processed_at
       FROM finance_integration_events
      WHERE (org_id = $1 OR org_id IS NULL)
        AND (event_type ILIKE '%payment%' OR source_entity_type ILIKE '%payment%')
      ORDER BY id DESC LIMIT 50`, [c.org.orgId])).rows;
  const financePayments = Number((await c.q.query<any>(
    `SELECT count(*)::int AS n FROM finance_payments WHERE org_id = $1`, [c.org.orgId])).rows[0]?.n ?? 0);
  return ok({
    finance_payment_records: financePayments,
    events_by_status: Object.fromEntries(byStatus.map((r: any) => [r.status, r.n])),
    recent_events: recent,
    note: "Payment bridge status is derived from integration events and Finance payment rows. Unpaid Sales orders never post revenue.",
  });
});

// ── Phase 11: FX rates ───────────────────────────────────────────────────

const listFx = route("GET", "/fx/rates", { perm: "ledger:read" }, async (c) => {
  const items = (await c.q.query<any>(
    `SELECT ${FX} FROM finance_fx_rates WHERE org_id = $1 ORDER BY as_of_date DESC, from_currency, to_currency LIMIT 200`,
    [c.org.orgId])).rows.map((r: any) => ({ ...r, rate: String(r.rate) }));
  return ok({ items });
});

const createFx = route("POST", "/fx/rates", { perm: "finance:create" }, async (c) => {
  const b = asObject(c.body); const v = new V(b);
  const from_currency = (v.str("from_currency", { min: 3, max: 3 }) ?? "").toUpperCase();
  const to_currency = (v.str("to_currency", { min: 3, max: 3 }) ?? "").toUpperCase();
  const as_of_date = v.date("as_of_date");
  const source = v.str("source", { optional: true, max: 40 }) ?? "manual";
  const notes = v.str("notes", { optional: true, max: 500 });
  v.done();
  if (!/^\d+(\.\d{1,8})?$/.test(String(b.rate ?? "")) || Number(b.rate) <= 0) throw badRequest("rate must be a positive number");
  try {
    const r = (await c.q.query<any>(
      `INSERT INTO finance_fx_rates (org_id, from_currency, to_currency, rate, as_of_date, source, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${FX}`,
      [c.org.orgId, from_currency, to_currency, String(b.rate), as_of_date, source, notes ?? null, c.actor.sub],
    )).rows[0];
    await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "fx.create", entityType: "finance_fx_rate", entityId: r.id, summary: `${from_currency}/${to_currency} @ ${b.rate}`, after: r, requestId: c.reqId });
    return ok({ rate: { ...r, rate: String(r.rate) } }, 201);
  } catch (e: any) {
    if (e?.code === "23505") throw conflict("FX rate already exists for that pair and date", "duplicate_fx");
    throw e;
  }
});

const convertFx = route("GET", "/fx/convert", { perm: "ledger:read" }, async (c) => {
  const from = (qstr(c.query.from) ?? "").toUpperCase();
  const to = (qstr(c.query.to) ?? "").toUpperCase();
  const amount = qstr(c.query.amount);
  const asOf = qstr(c.query.as_of);
  if (!from || !to || !amount) throw badRequest("from, to, and amount are required");
  if (from === to) return ok({ from, to, amount, rate: "1", converted: amount, as_of: asOf ?? null });
  const params: unknown[] = [c.org.orgId, from, to];
  let sql = `SELECT rate, as_of_date FROM finance_fx_rates WHERE org_id = $1 AND from_currency = $2 AND to_currency = $3`;
  if (asOf) { params.push(asOf); sql += ` AND as_of_date <= $4::date`; }
  sql += ` ORDER BY as_of_date DESC LIMIT 1`;
  const row = (await c.q.query<any>(sql, params)).rows[0];
  if (!row) throw notFound("FX rate");
  const rate = Number(row.rate);
  const converted = (Math.round(Number(amount) * rate * 100) / 100).toFixed(2);
  return ok({ from, to, amount, rate: String(row.rate), converted, as_of: ymd(row.as_of_date) });
});

// ── Phase 12: board packs ────────────────────────────────────────────────

const listPacks = route("GET", "/board-packs", { perm: "ledger:read" }, async (c) => {
  const items = (await c.q.query<any>(`SELECT ${PACK} FROM finance_board_packs WHERE org_id = $1 ORDER BY as_of_date DESC, id DESC`, [c.org.orgId])).rows;
  return ok({ items });
});

const createPack = route("POST", "/board-packs", { perm: "finance:create" }, async (c) => {
  const b = asObject(c.body); const v = new V(b);
  const title = v.str("title", { min: 1, max: 200 });
  const as_of_date = v.date("as_of_date");
  const period_from = v.date("period_from", true);
  const period_to = v.date("period_to", true);
  const notes = v.str("notes", { optional: true, max: 2000 });
  const codeIn = v.str("code", { optional: true, max: 40 });
  const include_pnl = v.bool("include_pnl") ?? true;
  const include_balance_sheet = v.bool("include_balance_sheet") ?? true;
  const include_cash_flow = v.bool("include_cash_flow") ?? true;
  const include_ratios = v.bool("include_ratios") ?? true;
  v.done();
  const code = codeIn ?? `BP-${String(await nextNumber(c.q, c.org.orgId, "board_pack")).padStart(4, "0")}`;
  try {
    const r = (await c.q.query<any>(
      `INSERT INTO finance_board_packs (org_id, code, title, as_of_date, period_from, period_to, include_pnl, include_balance_sheet, include_cash_flow, include_ratios, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${PACK}`,
      [c.org.orgId, code, title, as_of_date, period_from ?? null, period_to ?? null, include_pnl, include_balance_sheet, include_cash_flow, include_ratios, notes ?? null, c.actor.sub],
    )).rows[0];
    return ok({ pack: r }, 201);
  } catch (e: any) {
    if (e?.code === "23505") throw conflict("Board pack code exists", "duplicate_code");
    throw e;
  }
});

const publishPack = route("POST", "/board-packs/:id/publish", { perm: "finance:approve" }, async (c) => {
  const before = (await c.q.query<any>(`SELECT ${PACK} FROM finance_board_packs WHERE id = $1 AND org_id = $2`, [c.params.id, c.org.orgId])).rows[0];
  if (!before) throw notFound("Board pack");
  if (before.status === "published") throw unprocessable("Already published", "already_published");
  const r = (await c.q.query<any>(
    `UPDATE finance_board_packs SET status = 'published', published_at = now(), updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING ${PACK}`,
    [c.params.id, c.org.orgId],
  )).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "board_pack.publish", entityType: "finance_board_pack", entityId: r.id, before, after: r, requestId: c.reqId });
  return ok({ pack: r });
});

const getPackBundle = route("GET", "/board-packs/:id/bundle", { perm: "ledger:read" }, async (c) => {
  const pack = (await c.q.query<any>(`SELECT ${PACK} FROM finance_board_packs WHERE id = $1 AND org_id = $2`, [c.params.id, c.org.orgId])).rows[0];
  if (!pack) throw notFound("Board pack");
  // Bundle is a manifest of links/sections; live figures come from existing statement endpoints.
  return ok({
    pack,
    sections: [
      pack.include_pnl && { key: "pnl", path: "/statements/profit-loss", query: { as_of: ymd(pack.as_of_date) } },
      pack.include_balance_sheet && { key: "balance_sheet", path: "/statements/balance-sheet", query: { as_of: ymd(pack.as_of_date) } },
      pack.include_cash_flow && { key: "cash_flow", path: "/statements/cash-flow", query: { as_of: ymd(pack.as_of_date) } },
      pack.include_ratios && { key: "ratios", path: "/ratios", query: { as_of: ymd(pack.as_of_date) } },
    ].filter(Boolean),
    note: "Board pack bundles reference live posted-ledger endpoints. No sample figures are embedded.",
  });
});

// ── Phase 14: comparative analysis ───────────────────────────────────────

async function periodKpis(c: Ctx, from: string, to: string) {
  const rows = (await c.q.query<any>(
    `SELECT a.type, a.category, COALESCE(SUM(e.debit),0) AS d, COALESCE(SUM(e.credit),0) AS c
       FROM finance_ledger_entries e
       JOIN finance_accounts a ON a.id = e.account_id AND a.org_id = e.org_id
      WHERE e.org_id = $1 AND e.entry_date BETWEEN $2::date AND $3::date AND e.journal_type <> 'closing' AND a.type IN ('revenue','expense')
      GROUP BY a.type, a.category`, [c.org.orgId, from, to])).rows;
  let revenue = 0n, expenses = 0n, cogs = 0n;
  for (const r of rows) {
    const d = fromDb(r.d); const cr = fromDb(r.c);
    if (r.type === "revenue") revenue += cr - d;
    else {
      expenses += d - cr;
      if (r.category === "cost_of_goods_sold") cogs += d - cr;
    }
  }
  return {
    revenue: formatMoney(revenue),
    expenses: formatMoney(expenses),
    cogs: formatMoney(cogs),
    gross_profit: formatMoney(revenue - cogs),
    net_profit: formatMoney(revenue - expenses),
  };
}

const runComparative = route("POST", "/comparatives", { perm: "finance:create" }, async (c) => {
  const b = asObject(c.body); const v = new V(b);
  const label = v.str("label", { min: 1, max: 200 });
  const base_from = v.date("base_from");
  const base_to = v.date("base_to");
  const compare_from = v.date("compare_from");
  const compare_to = v.date("compare_to");
  const metric_set = v.str("metric_set", { optional: true, oneOf: ["kpis","ratios","both"] }) ?? "kpis";
  const codeIn = v.str("code", { optional: true, max: 40 });
  v.done();
  if (base_to! < base_from! || compare_to! < compare_from!) throw badRequest("period end must be on or after start");
  const base = await periodKpis(c, base_from!, base_to!);
  const compare = await periodKpis(c, compare_from!, compare_to!);
  const variance = (a: string, b: string) => formatMoney(fromDb(a) - fromDb(b));
  const snapshot = {
    base, compare,
    variance: {
      revenue: variance(compare.revenue, base.revenue),
      expenses: variance(compare.expenses, base.expenses),
      net_profit: variance(compare.net_profit, base.net_profit),
    },
    metric_set,
  };
  const code = codeIn ?? `CMP-${String(await nextNumber(c.q, c.org.orgId, "comparative")).padStart(4, "0")}`;
  const r = (await c.q.query<any>(
    `INSERT INTO finance_comparative_runs (org_id, code, label, base_from, base_to, compare_from, compare_to, metric_set, snapshot, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${COMP}`,
    [c.org.orgId, code, label, base_from, base_to, compare_from, compare_to, metric_set, JSON.stringify(snapshot), c.actor.sub],
  )).rows[0];
  return ok({ comparative: { ...r, snapshot } }, 201);
});

const listComparatives = route("GET", "/comparatives", { perm: "ledger:read" }, async (c) => {
  const items = (await c.q.query<any>(`SELECT ${COMP} FROM finance_comparative_runs WHERE org_id = $1 ORDER BY id DESC LIMIT 50`, [c.org.orgId])).rows;
  return ok({ items });
});

// ── Phase 15: intelligence agents (rule-based recommendations) ───────────

const generateAgents = route("POST", "/agents/generate", { perm: "finance:create" }, async (c) => {
  const org = (await c.q.query<any>(`SELECT timezone, functional_currency FROM finance_organisations WHERE id = $1`, [c.org.orgId])).rows[0];
  const asOf = qstr(c.query.as_of) ?? todayIn(org.timezone, c.now);
  const dash = (await c.q.query<any>(
    `SELECT COALESCE(SUM(CASE WHEN a.type='revenue' THEN e.credit - e.debit ELSE 0 END),0) AS rev,
            COALESCE(SUM(CASE WHEN a.type='expense' THEN e.debit - e.credit ELSE 0 END),0) AS exp
       FROM finance_ledger_entries e JOIN finance_accounts a ON a.id = e.account_id AND a.org_id = e.org_id
      WHERE e.org_id = $1 AND e.entry_date <= $2::date AND e.journal_type <> 'closing'`, [c.org.orgId, asOf])).rows[0];
  const cash = (await c.q.query<any>(
    `SELECT COALESCE(SUM(CASE WHEN a.normal_balance='debit' THEN e.debit-e.credit ELSE e.credit-e.debit END),0) AS bal
       FROM finance_ledger_entries e JOIN finance_accounts a ON a.id=e.account_id AND a.org_id=e.org_id
      WHERE e.org_id=$1 AND e.entry_date<=$2::date AND a.subtype IN ('cash','bank','mobile_money')`, [c.org.orgId, asOf])).rows[0];
  const openAlerts = Number((await c.q.query<any>(
    `SELECT count(*)::int AS n FROM finance_alert_events WHERE org_id=$1 AND status='open'`, [c.org.orgId])).rows[0]?.n ?? 0);

  const recs: { category: string; severity: string; title: string; body: string; evidence: object }[] = [];
  const rev = fromDb(dash.rev); const exp = fromDb(dash.exp); const cashBal = fromDb(cash.bal);
  if (rev > 0n && exp > rev) {
    recs.push({ category: "profitability", severity: "critical", title: "Expenses exceed revenue", body: "Posted expenses are higher than posted revenue for the year to date. Review cost centres and pricing.", evidence: { revenue: formatMoney(rev), expenses: formatMoney(exp), as_of: asOf } });
  }
  if (cashBal <= 0n) {
    recs.push({ category: "liquidity", severity: "critical", title: "Cash & bank not positive", body: "Cash and bank balances from posted ledger are zero or negative. Prioritise collections and payment timing.", evidence: { cash: formatMoney(cashBal), as_of: asOf } });
  }
  if (openAlerts > 0) {
    recs.push({ category: "other", severity: "warning", title: `${openAlerts} open financial alert(s)`, body: "Review open alert events and acknowledge or resolve threshold breaches.", evidence: { open_alerts: openAlerts } });
  }
  if (recs.length === 0) {
    recs.push({ category: "other", severity: "info", title: "No automatic recommendations", body: "Posted KPIs do not trigger standard agent rules. Configure alert thresholds for closer monitoring.", evidence: { as_of: asOf } });
  }

  const created = [];
  for (const rec of recs) {
    const code = `AG-${String(await nextNumber(c.q, c.org.orgId, "agent_rec")).padStart(5, "0")}`;
    const row = (await c.q.query<any>(
      `INSERT INTO finance_agent_recommendations (org_id, code, category, severity, title, body, evidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${AGENT}`,
      [c.org.orgId, code, rec.category, rec.severity, rec.title, rec.body, JSON.stringify(rec.evidence)],
    )).rows[0];
    created.push(row);
  }
  return ok({ as_of: asOf, generated: created.length, items: created });
});

const listAgents = route("GET", "/agents/recommendations", { perm: "ledger:read" }, async (c) => {
  const status = qstr(c.query.status);
  const p: unknown[] = [c.org.orgId];
  const w = ["org_id = $1"];
  if (status) { p.push(status); w.push(`status = $${p.length}`); }
  const items = (await c.q.query<any>(`SELECT ${AGENT} FROM finance_agent_recommendations WHERE ${w.join(" AND ")} ORDER BY generated_at DESC LIMIT 100`, p)).rows;
  return ok({ items });
});

const decideAgent = route("POST", "/agents/recommendations/:id/decide", { perm: "finance:update" }, async (c) => {
  const b = asObject(c.body); const v = new V(b);
  const decision = v.str("decision", { oneOf: ["accepted", "dismissed"] });
  v.done();
  const r = (await c.q.query<any>(
    `UPDATE finance_agent_recommendations SET status = $3, decided_at = now(), decided_by = $4
     WHERE id = $1 AND org_id = $2 AND status = 'open' RETURNING ${AGENT}`,
    [c.params.id, c.org.orgId, decision, c.actor.sub],
  )).rows[0];
  if (!r) throw notFound("Open recommendation");
  return ok({ recommendation: r });
});

// ── Phase 18: notifications ──────────────────────────────────────────────

const listNotifications = route("GET", "/intelligence/notifications", { perm: "ledger:read" }, async (c) => {
  const items = (await c.q.query<any>(
    `SELECT ${NOTIF} FROM finance_fi_notifications WHERE org_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [c.org.orgId])).rows;
  return ok({ items });
});

const markNotifRead = route("POST", "/intelligence/notifications/:id/read", { perm: "finance:update" }, async (c) => {
  const r = (await c.q.query<any>(
    `UPDATE finance_fi_notifications SET status = 'read', read_at = now() WHERE id = $1 AND org_id = $2 RETURNING ${NOTIF}`,
    [c.params.id, c.org.orgId],
  )).rows[0];
  if (!r) throw notFound("Notification");
  return ok({ notification: r });
});

const digestNotifications = route("POST", "/intelligence/notifications/digest", { perm: "finance:create" }, async (c) => {
  const open = Number((await c.q.query<any>(`SELECT count(*)::int AS n FROM finance_alert_events WHERE org_id=$1 AND status='open'`, [c.org.orgId])).rows[0]?.n ?? 0);
  const title = open > 0 ? `${open} open financial alert(s)` : "Financial posture clear";
  const body = open > 0
    ? "There are open threshold alerts. Review Financial Health & Risk."
    : "No open alert events. Continue monitoring KPIs from posted ledger data.";
  const r = (await c.q.query<any>(
    `INSERT INTO finance_fi_notifications (org_id, channel, event_type, title, body, payload, status)
     VALUES ($1,'in_app','alert_digest',$2,$3,$4,'pending') RETURNING ${NOTIF}`,
    [c.org.orgId, title, body, JSON.stringify({ open_alerts: open })],
  )).rows[0];
  return ok({ notification: r }, 201);
});

// ── Phase 16/17/20/21: permissions matrix, audit slice, module health ─────

const fiPermissions = route("GET", "/intelligence/permissions", { perm: "ledger:read" }, async (c) => {
  const me = (await c.q.query<any>(
    `SELECT role FROM finance_members WHERE org_id = $1 AND user_sub = $2`,
    [c.org.orgId, c.actor.sub],
  )).rows[0];
  return ok({
    role: me?.role ?? c.org.role,
    matrix: {
      "ledger:read": ["overview", "ratios", "statements", "capital", "dividends", "budgets", "health", "integration", "agents", "board_packs", "fx"],
      "finance:create": ["budgets", "investors", "dividends_draft", "fx_rates", "board_packs", "agents_generate", "comparatives", "notifications"],
      "finance:approve": ["dividends_approve", "budget_activate", "board_pack_publish"],
      "finance:update": ["alerts_ack", "agent_decide", "notification_read"],
      "finance:admin": ["integration_reconcile"],
    },
    note: "Permissions are enforced by the Finance RBAC layer. This matrix documents FI surface area only.",
  });
});

const fiAudit = route("GET", "/intelligence/audit", { perm: "audit:read" }, async (c) => {
  const items = (await c.q.query<any>(
    `SELECT id, action, entity_type, entity_id, summary, actor_id, actor_label, created_at
       FROM finance_audit_events
      WHERE org_id = $1 AND (
        action LIKE 'dividend.%' OR action LIKE 'budget.%' OR action LIKE 'valuation.%' OR
        action LIKE 'alert%' OR action LIKE 'fx.%' OR action LIKE 'board_pack.%' OR
        action LIKE 'agent%' OR entity_type LIKE 'finance_%investor%' OR entity_type LIKE 'finance_share%' OR
        entity_type LIKE 'finance_budget%' OR entity_type LIKE 'finance_dividend%' OR entity_type LIKE 'finance_valuation%'
      )
      ORDER BY id DESC LIMIT 100`, [c.org.orgId])).rows;
  return ok({ items });
});

const moduleHealth = route("GET", "/intelligence/health-check", { perm: "ledger:read" }, async (c) => {
  const modules = [
    { key: "dashboard", path: "finance_ledger_entries" },
    { key: "ratios", path: "finance_accounts" },
    { key: "capital", path: "finance_investors" },
    { key: "dividends", path: "finance_dividend_declarations" },
    { key: "budgets", path: "finance_budgets" },
    { key: "alerts", path: "finance_alert_rules" },
    { key: "fx", path: "finance_fx_rates" },
    { key: "integration", path: "finance_integration_events" },
  ];
  const results = [];
  for (const m of modules) {
    try {
      const sql = m.path === "finance_integration_events"
        ? `SELECT count(*)::int AS n FROM finance_integration_events WHERE org_id = $1 OR org_id IS NULL`
        : `SELECT count(*)::int AS n FROM ${m.path} WHERE org_id = $1`;
      const n = Number((await c.q.query<any>(sql, [c.org.orgId])).rows[0]?.n ?? 0);
      const status = "ok";
      await c.q.query(
        `INSERT INTO finance_module_health (org_id, module_key, status, detail, checked_at)
         VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (org_id, module_key) DO UPDATE SET status = EXCLUDED.status, detail = EXCLUDED.detail, checked_at = now()`,
        [c.org.orgId, m.key, status, `rows=${n}`],
      );
      results.push({ module: m.key, status, detail: `rows=${n}` });
    } catch (e: any) {
      results.push({ module: m.key, status: "error", detail: e?.message ?? "check failed" });
    }
  }
  const overall = results.every((r) => r.status === "ok") ? "ok" : results.some((r) => r.status === "error") ? "error" : "degraded";
  return ok({ overall, checked_at: new Date().toISOString(), modules: results, phase: "10-21", ready: overall === "ok" });
});

const readiness = route("GET", "/intelligence/readiness", { perm: "ledger:read" }, async (c) => {
  const checks = {
    schema_phase6: !!(await c.q.query<any>(`SELECT to_regclass('finance_investors') AS t`)).rows[0]?.t,
    schema_phase7: !!(await c.q.query<any>(`SELECT to_regclass('finance_dividend_declarations') AS t`)).rows[0]?.t,
    schema_phase8: !!(await c.q.query<any>(`SELECT to_regclass('finance_budgets') AS t`)).rows[0]?.t,
    schema_phase10_21: !!(await c.q.query<any>(`SELECT to_regclass('finance_fx_rates') AS t`)).rows[0]?.t,
    schema_phase22_35: !!(await c.q.query<any>(`SELECT to_regclass('finance_kpi_targets') AS t`)).rows[0]?.t,
    integration: !!(await c.q.query<any>(`SELECT to_regclass('finance_integration_events') AS t`)).rows[0]?.t,
  };
  const ready = Object.values(checks).every(Boolean);
  return ok({ ready, checks, note: ready ? "Financial Intelligence phases 1–35 schema present." : "Some schema components missing — run bootstrap." });
});

export const intelligenceOpsRoutes: Route[] = [
  paymentBridgeStatus,
  listFx, createFx, convertFx,
  listPacks, createPack, publishPack, getPackBundle,
  runComparative, listComparatives,
  generateAgents, listAgents, decideAgent,
  listNotifications, markNotifRead, digestNotifications,
  fiPermissions, fiAudit, moduleHealth, readiness,
];
