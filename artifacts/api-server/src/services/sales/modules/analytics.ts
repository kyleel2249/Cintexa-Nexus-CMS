import { v, parse } from "../core/validate";
import { created, noContent, csv, type Route } from "../core/router";
import { notFound, conflict, badRequest, validationFailed, forbidden, unprocessable } from "../core/errors";
import { audit } from "../core/audit";
import { can, scopeOf, isManagerial, assertOwnerAccess, ownerScopeSql } from "../core/rbac";
import { str, toCsv, d10 } from "../core/http";
import { rangeFor, previousRange, rangeFromDates, type Period, type Range } from "../core/time";
import { cmp, sub, add, sum, ratioPercent, money } from "../core/money";
import { computeForecast, accuracyOf, seasonalIndex, linearTrend, type ForecastOpp } from "../domain/forecast";
import { attainmentPercent } from "../domain/targets";
import { KPI_DEFINITIONS } from "../domain/kpi";
import { actualFor } from "./targets";
import { Where } from "./common";
import type { Actor, Queryable } from "../core/types";
import type { SalesSettings } from "../core/settings";

const PERIODS = ["today", "yesterday", "week", "last_week", "month", "last_month", "quarter", "last_quarter", "year", "last_year", "last_30_days", "last_90_days"] as const;
const periodOf = (query: Record<string, string | string[] | undefined>, def: Period = "month"): Period => {
  const p = str(query, "period") ?? def;
  if (!(PERIODS as readonly string[]).includes(p)) throw badRequest(`period must be one of: ${PERIODS.join(", ")}`);
  return p as Period;
};
function resolveRange(query: Record<string, string | string[] | undefined>, now: Date, s: SalesSettings, def: Period = "month"): Range {
  if (str(query, "from") && str(query, "to")) {
    const f = parse(v.date(), str(query, "from"));
    const t = parse(v.date(), str(query, "to"));
    if (t < f) throw badRequest("'to' is before 'from'");
    if (Date.parse(t) - Date.parse(f) > 3 * 366 * 86_400_000) throw badRequest("Choose a range of at most three years");
    return rangeFromDates(f, t, s.business.timezone);
  }
  return rangeFor(periodOf(query, def), now, s.business.timezone, s.business.weekStartsOn);
}

/** owner filter honouring role scope plus optional narrowing to a member/team the actor is allowed to see */
function ownerFilter(actor: Actor, col: string, query: Record<string, string | string[] | undefined>): string {
  let sql = ownerScopeSql(actor, col);
  const mid = str(query, "owner_id");
  if (mid) sql += ` AND ${col} = ${Number(parse(v.id(), mid))}`;
  const tid = str(query, "team_id");
  if (tid) sql += ` AND ${col} IN (SELECT id FROM sales_members WHERE team_id = ${Number(parse(v.id(), tid))})`;
  return sql;
}

interface Money { amount: string; orders: number }

async function revenue(q: Queryable, owner: string, range: Range, currency: string, extra = "TRUE"): Promise<Money & { otherCurrency: number }> {
  const r = await q.query<{ a: string; n: number; other: number }>(
    `SELECT COALESCE(sum(net_total - returned_total) FILTER (WHERE currency = $3),0)::numeric(18,2)::text a, count(*) FILTER (WHERE currency = $3)::int n, count(*) FILTER (WHERE currency <> $3)::int other
     FROM sales_orders o WHERE ${owner} AND ${extra} AND o.status <> 'cancelled' AND o.booked_at >= $1 AND o.booked_at < $2`, [range.from, range.to, currency]);
  return { amount: r.rows[0]!.a, orders: r.rows[0]!.n, otherCurrency: r.rows[0]!.other };
}

const delta = (cur: string, prev: string): number | null => ratioPercent(sub(cur, prev), prev);

export async function buildDashboard(q: Queryable, actor: Actor, query: Record<string, string | string[] | undefined>, now: Date, s: SalesSettings) {
  const tz = s.business.timezone;
  const cur = s.business.currency;
  const range = resolveRange(query, now, s);
  const prev = previousRange(range);
  const today = rangeFor("today", now, tz, s.business.weekStartsOn);
  const oOwner = ownerFilter(actor, "o.owner_id", query);
  const lOwner = ownerFilter(actor, "l.owner_id", query);
  const opOwner = ownerFilter(actor, "op.owner_id", query);
  const aOwner = ownerFilter(actor, "a.owner_id", query);
  const xOwner = ownerFilter(actor, "x.owner_id", query);
  const canCost = can(actor, "cost:read");
  const nowIso = now.toISOString();

  const rev = await revenue(q, oOwner, range, cur);
  const revPrev = await revenue(q, oOwner, prev, cur);
  const todayRev = await revenue(q, oOwner, today, cur);

  const gp = (await q.query<{ gp: string; net: string; n: number }>(
    `SELECT COALESCE(sum(o.gross_profit),0)::numeric(18,2)::text gp, COALESCE(sum(o.net_total),0)::numeric(18,2)::text net, count(*)::int n FROM sales_orders o
     WHERE ${oOwner} AND o.status <> 'cancelled' AND o.currency = $3 AND o.booked_at >= $1 AND o.booked_at < $2 AND o.cost_total IS NOT NULL`, [range.from, range.to, cur])).rows[0]!;

  const leads = (await q.query<{ created: number; converted: number }>(
    `SELECT count(*)::int created, count(*) FILTER (WHERE l.status = 'converted')::int converted FROM sales_leads l WHERE ${lOwner} AND l.merged_into_id IS NULL AND l.archived_at IS NULL AND l.created_at >= $1 AND l.created_at < $2`, [range.from, range.to])).rows[0]!;

  const pipe = (await q.query<{ amount: string; weighted: string; n: number; qualified: number }>(
    `SELECT COALESCE(sum(op.amount),0)::numeric(18,2)::text amount, COALESCE(sum(op.amount * op.probability / 100),0)::numeric(18,2)::text weighted, count(*)::int n,
       count(*) FILTER (WHERE st.position > 1)::int qualified
     FROM sales_opportunities op JOIN sales_pipeline_stages st ON st.id = op.stage_id WHERE ${opOwner} AND op.status = 'open' AND op.archived_at IS NULL AND op.currency = $1`, [cur])).rows[0]!;

  const wl = (await q.query<{ won: number; lost: number; won_amount: string; cycle: string | null }>(
    `SELECT count(*) FILTER (WHERE op.status = 'won')::int won, count(*) FILTER (WHERE op.status = 'lost')::int lost,
       COALESCE(sum(op.amount) FILTER (WHERE op.status = 'won' AND op.currency = $3),0)::numeric(18,2)::text won_amount,
       avg(EXTRACT(EPOCH FROM (op.closed_at - op.created_at)) / 86400) FILTER (WHERE op.status = 'won')::numeric(10,1)::text cycle
     FROM sales_opportunities op WHERE ${opOwner} AND op.archived_at IS NULL AND op.status IN ('won','lost') AND op.closed_at >= $1 AND op.closed_at < $2`, [range.from, range.to, cur])).rows[0]!;

  const newCust = (await q.query<{ n: number }>(
    `SELECT count(*)::int n FROM (SELECT o.account_id, min(o.booked_at) f FROM sales_orders o WHERE ${oOwner} AND o.status <> 'cancelled' AND o.booked_at IS NOT NULL GROUP BY o.account_id) t WHERE t.f >= $1 AND t.f < $2`, [range.from, range.to])).rows[0]!.n;
  const repeat = (await q.query<{ a: string }>(
    `SELECT COALESCE(sum(o.net_total - o.returned_total),0)::numeric(18,2)::text a FROM sales_orders o WHERE ${oOwner} AND o.status <> 'cancelled' AND o.currency = $3 AND o.booked_at >= $1 AND o.booked_at < $2
       AND EXISTS (SELECT 1 FROM sales_orders p WHERE p.account_id = o.account_id AND p.status <> 'cancelled' AND p.booked_at < $1)`, [range.from, range.to, cur])).rows[0]!.a;

  const overdueFollow = (await q.query<{ n: number }>(`SELECT count(*)::int n FROM sales_activities x WHERE ${xOwner} AND x.status = 'open' AND COALESCE(x.due_at, x.start_at) < $1`, [nowIso])).rows[0]!.n;
  const quotes = (await q.query<{ overdue: number; accepted: number; final: number }>(
    `SELECT count(*) FILTER (WHERE x.status IN ('sent','viewed') AND x.validity_date < ($1::timestamptz AT TIME ZONE $2)::date)::int overdue,
       count(*) FILTER (WHERE x.status = 'accepted' AND x.accepted_at >= $3 AND x.accepted_at < $4)::int accepted,
       count(*) FILTER (WHERE (x.status IN ('accepted') AND x.accepted_at >= $3 AND x.accepted_at < $4) OR (x.status = 'rejected' AND x.rejected_at >= $3 AND x.rejected_at < $4) OR (x.status = 'expired' AND x.updated_at >= $3 AND x.updated_at < $4))::int final
     FROM sales_quotations x WHERE ${xOwner}`, [nowIso, tz, range.from, range.to])).rows[0]!;

  const financeLive = s.integrations.finance.enabled || (await q.query("SELECT 1 FROM sales_order_payments WHERE status = 'recorded' LIMIT 1")).rows.length > 0;
  let receivables: { available: boolean; amount?: string; overdue?: string; reason?: string } = { available: false, reason: "No finance system is connected and no payments have been recorded, so receivables cannot be stated." };
  if (financeLive && can(actor, "orders:read")) {
    const r = (await q.query<{ a: string; od: string }>(
      `SELECT COALESCE(sum(o.total - o.paid_total),0)::numeric(18,2)::text a, COALESCE(sum(o.total - o.paid_total) FILTER (WHERE o.invoice_due_on < ($1::timestamptz AT TIME ZONE $2)::date),0)::numeric(18,2)::text od
       FROM sales_orders o WHERE ${oOwner} AND o.status <> 'cancelled' AND o.currency = $3 AND o.payment_status IN ('unpaid','partial') AND o.status <> 'draft' AND o.status <> 'pending_approval'`, [nowIso, tz, cur])).rows[0]!;
    receivables = { available: true, amount: r.a, overdue: r.od };
  }

  // forecast for the same period (company view only when scoped to all)
  const fc = await forecastFor(q, actor, query, range, now, s);
  // target attainment: the actor's own or company target overlapping the range
  const tgt = (await q.query<any>(
    `SELECT t.* FROM sales_targets t JOIN sales_target_periods p ON p.id = t.period_id WHERE p.status IN ('approved','closed') AND t.metric = 'revenue' AND p.starts_on <= $1::date AND p.ends_on >= $1::date
       AND ((t.scope = 'member' AND t.scope_id = $2) OR ($3 AND t.scope = 'company')) ORDER BY (t.scope = 'member') DESC LIMIT 1`, [d10(range.from) ?? nowIso.slice(0, 10), actor.memberId || -1, scopeOf(actor) === "all"])).rows[0];
  let target: unknown = null;
  if (tgt) {
    const period = (await q.query<any>("SELECT starts_on, ends_on FROM sales_target_periods WHERE id = $1", [tgt.period_id])).rows[0];
    const pr = rangeFromDates(d10(period.starts_on)!, d10(period.ends_on)!, tz);
    const act = await actualFor(q, tgt, pr);
    target = { label: tgt.scope === "member" ? "Your revenue target" : "Company revenue target", target: tgt.amount, actual: act.actual, attainmentPercent: attainmentPercent(act.actual, tgt.amount), periodFrom: d10(period.starts_on), periodTo: d10(period.ends_on) };
  }

  const trend = (await q.query<{ d: string; a: string; n: number }>(
    `SELECT to_char(o.booked_at AT TIME ZONE $4, 'YYYY-MM-DD') d, COALESCE(sum(o.net_total - o.returned_total),0)::numeric(18,2)::text a, count(*)::int n FROM sales_orders o
     WHERE ${oOwner} AND o.status <> 'cancelled' AND o.currency = $3 AND o.booked_at >= $1 AND o.booked_at < $2 GROUP BY 1 ORDER BY 1`, [range.from, range.to, cur, tz])).rows;
  const leadFunnel = (await q.query<{ status: string; n: number }>(`SELECT l.status, count(*)::int n FROM sales_leads l WHERE ${lOwner} AND l.merged_into_id IS NULL AND l.archived_at IS NULL AND l.created_at >= $1 AND l.created_at < $2 GROUP BY l.status`, [range.from, range.to])).rows;
  const byStage = (await q.query<{ name: string; position: number; n: number; amount: string }>(
    `SELECT st.name, st.position, count(*)::int n, COALESCE(sum(op.amount),0)::numeric(18,2)::text amount FROM sales_opportunities op JOIN sales_pipeline_stages st ON st.id = op.stage_id WHERE ${opOwner} AND op.status = 'open' AND op.archived_at IS NULL AND op.currency = $1 GROUP BY st.name, st.position ORDER BY st.position`, [cur])).rows;
  const topProducts = (await q.query<{ name: string; qty: string; net: string }>(
    `SELECT COALESCE(p.name, l.description) AS name, sum(l.quantity)::text qty, sum(l.net)::numeric(18,2)::text net FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id LEFT JOIN sales_products p ON p.id = l.product_id
     WHERE ${oOwner} AND o.status <> 'cancelled' AND o.currency = $3 AND o.booked_at >= $1 AND o.booked_at < $2 GROUP BY 1 ORDER BY sum(l.net) DESC LIMIT 5`, [range.from, range.to, cur])).rows;

  const winRate = wl.won + wl.lost ? Math.round((wl.won / (wl.won + wl.lost)) * 1000) / 10 : null;
  const k = (key: string, value: unknown, extra: Record<string, unknown> = {}) => ({ key, value, ...extra });
  const kpis = [
    k("sales_today", todayRev.amount, { href: "/sales/orders?booked=today", orders: todayRev.orders }),
    k("revenue_mtd", rev.amount, { href: "/sales/orders", orders: rev.orders, previous: revPrev.amount, changePercent: delta(rev.amount, revPrev.amount), excludedOtherCurrency: rev.otherCurrency }),
    ...(canCost ? [k("gross_profit", gp.gp, { orders: gp.n, note: gp.n ? undefined : "No fully-costed orders in this period" }), k("gross_margin", gp.n ? ratioPercent(gp.gp, gp.net) : null)] : []),
    k("new_leads", leads.created, { href: "/sales/leads" }),
    k("lead_conversion", leads.created ? Math.round((leads.converted / leads.created) * 1000) / 10 : null),
    k("qualified_opps", pipe.qualified, { href: "/sales/pipeline" }),
    k("open_pipeline", pipe.amount, { href: "/sales/pipeline", count: pipe.n }),
    k("weighted_pipeline", pipe.weighted, { href: "/sales/pipeline" }),
    k("win_rate", winRate, { won: wl.won, lost: wl.lost }),
    k("avg_deal_size", wl.won ? sub(wl.won_amount, "0.00") === "0.00" ? "0.00" : String(Math.round(Number(wl.won_amount) / wl.won * 100) / 100) : null),
    k("sales_cycle", wl.cycle === null ? null : Number(wl.cycle)),
    k("new_customers", newCust, { href: "/sales/accounts" }),
    k("repeat_revenue", repeat),
    k("overdue_followups", overdueFollow, { href: "/sales/activities?overdue=true" }),
    k("overdue_quotes", quotes.overdue, { href: "/sales/quotations?status=sent" }),
    k("quote_conversion", quotes.final ? Math.round((quotes.accepted / quotes.final) * 1000) / 10 : null),
    k("receivables", receivables.available ? receivables.amount : null, { available: receivables.available, overdue: receivables.overdue, reason: receivables.reason, href: "/sales/orders?overdue=true" }),
    k("forecast", fc.baseCase, { href: "/sales/forecasting", reliability: fc.reliability.level }),
  ];
  return {
    range, previous: prev, currency: cur, kpis, target, trend, leadFunnel, pipelineByStage: byStage, topProducts,
    definitions: KPI_DEFINITIONS.filter((d) => kpis.some((x) => x.key === d.key)),
    generatedAt: nowIso, scope: scopeOf(actor),
  };
}

export async function forecastFor(q: Queryable, actor: Actor, query: Record<string, string | string[] | undefined>, range: Range, now: Date, s: SalesSettings) {
  const opOwner = ownerFilter(actor, "op.owner_id", query);
  const cur = s.business.currency;
  const rows = (await q.query<any>(
    `SELECT op.id, op.amount::text, op.probability::float prob, op.forecast_category, op.expected_close_date, op.close_date_changes, op.owner_id FROM sales_opportunities op
     WHERE ${opOwner} AND op.status = 'open' AND op.archived_at IS NULL AND op.currency = $1`, [cur])).rows;
  const opps: ForecastOpp[] = rows.map((r) => ({ id: r.id, amount: r.amount, probability: r.prob, category: r.forecast_category, expectedCloseDate: d10(r.expected_close_date), closeDateChanges: r.close_date_changes, ownerId: r.owner_id }));
  const closed = (await q.query<{ a: string; n: number }>(`SELECT COALESCE(sum(op.amount),0)::numeric(18,2)::text a, count(*)::int n FROM sales_opportunities op WHERE ${opOwner} AND op.status = 'won' AND op.currency = $3 AND op.closed_at >= $1 AND op.closed_at < $2`, [range.from, range.to, cur])).rows[0]!;
  const history = (await q.query<{ n: number }>(`SELECT count(*)::int n FROM sales_opportunities op WHERE ${opOwner} AND op.status = 'won' AND op.closed_at >= $1::timestamptz - interval '24 months'`, [now.toISOString()])).rows[0]!.n;
  const t = (await q.query<{ amount: string }>(
    `SELECT t.amount::text FROM sales_targets t JOIN sales_target_periods p ON p.id = t.period_id WHERE p.status IN ('approved','closed') AND t.metric = 'revenue' AND p.starts_on <= $1::date AND p.ends_on >= $1::date
       AND ((t.scope = 'member' AND t.scope_id = $2) OR ($3 AND t.scope = 'company')) ORDER BY (t.scope = 'member') DESC LIMIT 1`, [d10(range.from)!, actor.memberId || -1, scopeOf(actor) === "all"])).rows[0];
  const today = d10(now)!;
  return computeForecast({ opps, closedAmount: closed.a, closedDeals: history, range, target: t?.amount ?? null, today, cfg: { minimumClosedDeals: s.forecast.minimumClosedDeals, worstCaseHaircut: s.forecast.worstCaseHaircut, bestCaseUplift: s.forecast.bestCaseUplift } });
}

const REPORTS: Record<string, { title: string; description: string; columns: string[]; money?: string[]; sql: (o: { owner: string; ownerOp: string; ownerL: string; ownerX: string }) => string; needs?: Parameters<typeof can>[1] }> = {
  sales_by_day: { title: "Sales by day", description: "Booked net revenue per day (business timezone).", columns: ["day", "orders", "net_revenue"], sql: ({ owner }) => `SELECT to_char(o.booked_at AT TIME ZONE $4, 'YYYY-MM-DD') AS day, count(*)::int AS orders, COALESCE(sum(o.net_total - o.returned_total),0)::numeric(18,2)::text AS net_revenue FROM sales_orders o WHERE ${owner} AND o.status <> 'cancelled' AND o.currency = $3 AND o.booked_at >= $1 AND o.booked_at < $2 GROUP BY 1 ORDER BY 1` },
  sales_by_rep: { title: "Sales by representative", description: "Booked net revenue and order count per owner.", columns: ["representative", "orders", "net_revenue"], sql: ({ owner }) => `SELECT COALESCE(m.display_name,'Unassigned') AS representative, count(*)::int AS orders, COALESCE(sum(o.net_total - o.returned_total),0)::numeric(18,2)::text AS net_revenue FROM sales_orders o LEFT JOIN sales_members m ON m.id = o.owner_id WHERE ${owner} AND o.status <> 'cancelled' AND o.currency = $3 AND o.booked_at >= $1 AND o.booked_at < $2 GROUP BY 1 ORDER BY sum(o.net_total - o.returned_total) DESC` , needs: "performance:read" },
  sales_by_product: { title: "Sales by product", description: "Quantity and net value by product (or free-text line).", columns: ["product", "sku", "quantity", "net_value"], sql: ({ owner }) => `SELECT COALESCE(p.name, l.description) AS product, p.sku AS sku, sum(l.quantity)::text AS quantity, sum(l.net)::numeric(18,2)::text AS net_value FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id LEFT JOIN sales_products p ON p.id = l.product_id WHERE ${owner} AND o.status <> 'cancelled' AND o.currency = $3 AND o.booked_at >= $1 AND o.booked_at < $2 GROUP BY 1, 2 ORDER BY sum(l.net) DESC` },
  sales_by_customer: { title: "Sales by customer", description: "Booked net revenue per account.", columns: ["customer", "orders", "net_revenue"], sql: ({ owner }) => `SELECT a.name AS customer, count(*)::int AS orders, COALESCE(sum(o.net_total - o.returned_total),0)::numeric(18,2)::text AS net_revenue FROM sales_orders o JOIN sales_accounts a ON a.id = o.account_id WHERE ${owner} AND o.status <> 'cancelled' AND o.currency = $3 AND o.booked_at >= $1 AND o.booked_at < $2 GROUP BY 1 ORDER BY sum(o.net_total - o.returned_total) DESC` },
  pipeline_by_stage: { title: "Pipeline by stage", description: "Open opportunities per stage (amount and weighted).", columns: ["stage", "opportunities", "amount", "weighted"], sql: ({ ownerOp }) => `SELECT st.name AS stage, count(*)::int AS opportunities, COALESCE(sum(op.amount),0)::numeric(18,2)::text AS amount, COALESCE(sum(op.amount*op.probability/100),0)::numeric(18,2)::text AS weighted FROM sales_opportunities op JOIN sales_pipeline_stages st ON st.id = op.stage_id WHERE ${ownerOp} AND op.status = 'open' AND op.archived_at IS NULL AND op.currency = $3 AND op.created_at < $2 AND $1::timestamptz IS NOT NULL GROUP BY st.name, st.position ORDER BY st.position` },
  lost_reasons: { title: "Lost deals by reason", description: "Why opportunities were lost in the period.", columns: ["reason", "deals", "amount"], sql: ({ ownerOp }) => `SELECT COALESCE(op.lost_reason,'(none)') AS reason, count(*)::int AS deals, COALESCE(sum(op.amount),0)::numeric(18,2)::text AS amount FROM sales_opportunities op WHERE ${ownerOp} AND op.status = 'lost' AND op.currency = $3 AND op.closed_at >= $1 AND op.closed_at < $2 GROUP BY 1 ORDER BY count(*) DESC` },
  lead_sources: { title: "Lead sources", description: "Leads created, converted and conversion rate by source.", columns: ["source", "leads", "converted", "conversion_percent"], sql: ({ ownerL }) => `SELECT l.source AS source, count(*)::int AS leads, count(*) FILTER (WHERE l.status = 'converted')::int AS converted, ROUND(100.0 * count(*) FILTER (WHERE l.status = 'converted') / NULLIF(count(*),0), 1)::text AS conversion_percent FROM sales_leads l WHERE ${ownerL} AND l.merged_into_id IS NULL AND l.archived_at IS NULL AND l.created_at >= $1 AND l.created_at < $2 AND $3::text IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC` },
  quotation_status: { title: "Quotation outcomes", description: "Quotations created in the period by status.", columns: ["status", "quotations", "total_value"], sql: ({ ownerX }) => `SELECT x.status AS status, count(*)::int AS quotations, COALESCE(sum(x.total),0)::numeric(18,2)::text AS total_value FROM sales_quotations x WHERE ${ownerX} AND x.currency = $3 AND x.created_at >= $1 AND x.created_at < $2 GROUP BY 1 ORDER BY count(*) DESC` },
  receivables_aging: { title: "Receivables aging", description: "Unpaid order balances by days past due. Requires payments to be tracked.", columns: ["bucket", "orders", "outstanding"], needs: "orders:read", sql: ({ owner }) => `SELECT CASE WHEN o.invoice_due_on IS NULL OR o.invoice_due_on >= ($2::timestamptz AT TIME ZONE $4)::date THEN 'Current' WHEN ($2::timestamptz AT TIME ZONE $4)::date - o.invoice_due_on <= 30 THEN '1-30 days' WHEN ($2::timestamptz AT TIME ZONE $4)::date - o.invoice_due_on <= 60 THEN '31-60 days' WHEN ($2::timestamptz AT TIME ZONE $4)::date - o.invoice_due_on <= 90 THEN '61-90 days' ELSE 'Over 90 days' END AS bucket, count(*)::int AS orders, sum(o.total - o.paid_total)::numeric(18,2)::text AS outstanding FROM sales_orders o WHERE ${owner} AND o.status NOT IN ('cancelled','draft','pending_approval') AND o.currency = $3 AND o.payment_status IN ('unpaid','partial') AND $1::timestamptz IS NOT NULL GROUP BY 1 ORDER BY min(o.invoice_due_on) NULLS LAST` },
  activity_summary: { title: "Activity summary", description: "Completed activities per representative and type.", columns: ["representative", "type", "completed"], sql: ({ ownerX }) => `SELECT COALESCE(m.display_name,'Unassigned') AS representative, x.type AS type, count(*)::int AS completed FROM sales_activities x LEFT JOIN sales_members m ON m.id = x.owner_id WHERE ${ownerX} AND x.status = 'done' AND x.completed_at >= $1 AND x.completed_at < $2 AND $3::text IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2` },
  competitor_outcomes: { title: "Competitor win/loss", description: "Outcomes on opportunities where a competitor was recorded.", columns: ["competitor", "present", "won_against", "lost_to"], needs: "competitors:read", sql: ({ ownerOp }) => `SELECT c.name AS competitor, count(*)::int AS present, count(*) FILTER (WHERE oc.outcome = 'won_against')::int AS won_against, count(*) FILTER (WHERE oc.outcome = 'lost_to')::int AS lost_to FROM sales_opportunity_competitors oc JOIN sales_competitors c ON c.id = oc.competitor_id JOIN sales_opportunities op ON op.id = oc.opportunity_id WHERE ${ownerOp} AND op.created_at >= $1 AND op.created_at < $2 AND $3::text IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC` },
};

/** Run a catalogue report for a given actor scope (used by scheduled delivery). */
export async function runReportRows(q: Queryable, actor: Actor, key: string, range: Range, settings: SalesSettings): Promise<{ title: string; columns: string[]; rows: Array<Record<string, unknown>> } | null> {
  const rep = REPORTS[key];
  if (!rep || (rep.needs && !can(actor, rep.needs))) return null;
  const sql = rep.sql({ owner: ownerFilter(actor, "o.owner_id", {}), ownerOp: ownerFilter(actor, "op.owner_id", {}), ownerL: ownerFilter(actor, "l.owner_id", {}), ownerX: ownerFilter(actor, "x.owner_id", {}) });
  const all = [range.from, range.to, settings.business.currency, settings.business.timezone];
  const used = Math.max(...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  return { title: rep.title, columns: rep.columns, rows: (await q.query(`${sql} LIMIT 5000`, all.slice(0, used))).rows };
}

export const analyticsRoutes: Route[] = [
  {
    method: "GET", path: "/dashboard", permission: "dashboard:read", tx: false,
    async handler({ q, actor, query, now, settings }) { return buildDashboard(q, actor, query, now, settings); },
  },
  {
    method: "GET", path: "/kpi-definitions", permission: "dashboard:read", tx: false,
    async handler() { return { items: KPI_DEFINITIONS }; },
  },
  // ───── forecasting
  {
    method: "GET", path: "/forecast", permission: "forecast:read", tx: false,
    async handler({ q, actor, query, now, settings }) {
      const range = resolveRange(query, now, settings, "quarter");
      const f = await forecastFor(q, actor, query, range, now, settings);
      const ov = (await q.query<any>("SELECT * FROM sales_forecast_overrides WHERE superseded_at IS NULL AND scope = 'company' AND range_from = $1 AND range_to = $2", [range.from, range.to])).rows[0] ?? null;
      const monthly = (await q.query<{ month: string; amount: string }>(
        `SELECT to_char(date_trunc('month', op.closed_at AT TIME ZONE $2), 'YYYY-MM') AS month, sum(op.amount)::numeric(18,2)::text AS amount FROM sales_opportunities op WHERE ${ownerFilter(actor, "op.owner_id", query)} AND op.status = 'won' AND op.currency = $1 GROUP BY 1 ORDER BY 1`, [settings.business.currency, settings.business.timezone])).rows.map((r) => ({ month: r.month, amount: Number(r.amount) }));
      const trend = linearTrend(monthly.map((m) => m.amount));
      const seasonal = seasonalIndex(monthly, settings.forecast.seasonalityMinMonths);
      const byOwner = isManagerial(actor) || scopeOf(actor) === "all"
        ? (await q.query(`SELECT m.display_name AS owner, count(*)::int AS deals, COALESCE(sum(op.amount),0)::numeric(18,2)::text AS amount, COALESCE(sum(op.amount*op.probability/100),0)::numeric(18,2)::text AS weighted FROM sales_opportunities op LEFT JOIN sales_members m ON m.id = op.owner_id WHERE ${ownerFilter(actor, "op.owner_id", query)} AND op.status = 'open' AND op.archived_at IS NULL AND op.expected_close_date >= $1::date AND op.expected_close_date < $2::date GROUP BY 1 ORDER BY sum(op.amount) DESC`, [d10(range.from), d10(range.to)])).rows
        : [];
      return {
        range, forecast: f, override: ov ? { amount: money(ov.amount), calculated: money(ov.calculated_amount), reason: ov.reason, set_by: ov.set_by, set_at: ov.set_at, note: "Manual override. The calculated figure is shown alongside and is unchanged." } : null,
        history: { months: monthly.length, trend: trend ? { ...trend, note: trend.r2 < 0.3 ? "Weak fit - treat as indicative only" : "Linear trend of monthly won revenue" } : null, seasonality: seasonal, seasonalityNote: seasonal ? "Month-of-year index (1.0 = average)" : `Seasonality needs at least ${settings.forecast.seasonalityMinMonths} months with two cycles of history; not shown.` },
        byOwner, currency: settings.business.currency,
      };
    },
  },
  {
    method: "POST", path: "/forecast/snapshots", permission: "forecast:override",
    async handler({ q, actor, body, now, settings, requestId }) {
      const b = parse(v.object({ period: v.optional(v.enumOf(PERIODS)), label: v.optional(v.string({ min: 2, max: 80 })) }), body ?? {});
      const range = rangeFor(b.period ?? "quarter", now, settings.business.timezone, settings.business.weekStartsOn);
      const f = await forecastFor(q, actor, {}, range, now, settings);
      const r = await q.query<{ id: number }>("INSERT INTO sales_forecast_snapshots (label, range_from, range_to, committed, weighted, best_case, worst_case, closed, assumptions, taken_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text::jsonb,$10) RETURNING id",
        [b.label ?? `${range.label} forecast ${d10(now)}`, range.from, range.to, f.commit, f.baseCase, f.bestCase, f.worstCase, f.closed, JSON.stringify({ assumptions: f.assumptions, reliability: f.reliability }), actor.label]);
      await audit(q, actor, { action: "forecast.snapshot", entityType: "forecast", entityId: r.rows[0]!.id, summary: `Saved forecast snapshot for ${range.label}` }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "GET", path: "/forecast/accuracy", permission: "forecast:read", tx: false,
    async handler({ q, settings, now }) {
      const snaps = (await q.query<any>("SELECT * FROM sales_forecast_snapshots WHERE range_to <= $1 ORDER BY range_from DESC LIMIT 24", [now.toISOString()])).rows;
      const pairs = [];
      for (const s of snaps) {
        const a = (await q.query<{ a: string }>("SELECT COALESCE(sum(op.amount),0)::numeric(18,2)::text a FROM sales_opportunities op WHERE op.status = 'won' AND op.currency = $3 AND op.closed_at >= $1 AND op.closed_at < $2", [s.range_from, s.range_to, settings.business.currency])).rows[0]!.a;
        pairs.push({ id: s.id, label: s.label, forecast: s.weighted, actual: a, errorPercent: ratioPercent(sub(s.weighted, a), a) });
      }
      return { items: pairs, summary: accuracyOf(pairs), note: pairs.length ? undefined : "No completed forecast periods have a snapshot yet. Save snapshots during a period to measure accuracy afterwards." };
    },
  },
  {
    method: "PUT", path: "/forecast/override", permission: "forecast:override",
    async handler({ q, actor, body, now, settings, requestId }) {
      const b = parse(v.object({ period: v.enumOf(PERIODS), amount: v.money(), reason: v.string({ min: 5, max: 500 }) }), body);
      const range = rangeFor(b.period, now, settings.business.timezone, settings.business.weekStartsOn);
      const f = await forecastFor(q, actor, {}, range, now, settings);
      await q.query("UPDATE sales_forecast_overrides SET superseded_at = now() WHERE superseded_at IS NULL AND scope = 'company' AND range_from = $1 AND range_to = $2", [range.from, range.to]);
      await q.query("INSERT INTO sales_forecast_overrides (range_from, range_to, amount, calculated_amount, reason, set_by) VALUES ($1,$2,$3,$4,$5,$6)", [range.from, range.to, b.amount, f.baseCase, b.reason, actor.label]);
      await audit(q, actor, { action: "forecast.override", entityType: "forecast", summary: `Override ${b.amount} (calculated ${f.baseCase}) for ${range.label}: ${b.reason}` }, requestId);
      return { ok: true, calculated: f.baseCase };
    },
  },
  // ───── performance
  {
    method: "GET", path: "/performance/leaderboard", permission: "leaderboard:read", tx: false,
    async handler({ q, actor, query, now, settings }) {
      const range = resolveRange(query, now, settings);
      const cur = settings.business.currency;
      const managerial = isManagerial(actor) || scopeOf(actor) === "all";
      const rows = (await q.query<any>(
        `SELECT m.id, m.display_name, m.team_id, t.name AS team_name,
           COALESCE((SELECT sum(o.net_total - o.returned_total) FROM sales_orders o WHERE o.owner_id = m.id AND o.status <> 'cancelled' AND o.currency = $3 AND o.booked_at >= $1 AND o.booked_at < $2),0)::numeric(18,2)::text AS revenue,
           (SELECT count(*)::int FROM sales_opportunities op WHERE op.owner_id = m.id AND op.status = 'won' AND op.closed_at >= $1 AND op.closed_at < $2) AS won,
           (SELECT count(*)::int FROM sales_opportunities op WHERE op.owner_id = m.id AND op.status = 'lost' AND op.closed_at >= $1 AND op.closed_at < $2) AS lost,
           (SELECT count(*)::int FROM sales_activities x WHERE x.owner_id = m.id AND x.status = 'done' AND x.completed_at >= $1 AND x.completed_at < $2) AS activities,
           (SELECT count(*)::int FROM sales_leads l WHERE l.owner_id = m.id AND l.created_at >= $1 AND l.created_at < $2 AND l.merged_into_id IS NULL) AS leads,
           (SELECT count(*)::int FROM sales_activities x WHERE x.owner_id = m.id AND x.status = 'open' AND COALESCE(x.due_at, x.start_at) < $4) AS overdue
         FROM sales_members m LEFT JOIN sales_teams t ON t.id = m.team_id WHERE m.active AND m.role IN ('sales_rep','sales_manager','sales_director')`, [range.from, range.to, cur, now.toISOString()])).rows;
      const tg = (await q.query<any>("SELECT t.scope_id, t.amount::text FROM sales_targets t JOIN sales_target_periods p ON p.id = t.period_id WHERE t.scope = 'member' AND t.metric = 'revenue' AND p.status IN ('approved','closed') AND p.starts_on <= $1::date AND p.ends_on >= $1::date", [d10(range.from)!])).rows;
      const items = rows.map((r) => {
        const target = tg.find((t) => t.scope_id === r.id)?.amount ?? null;
        return { ...r, winRate: r.won + r.lost ? Math.round((r.won / (r.won + r.lost)) * 1000) / 10 : null, attainmentPercent: target ? attainmentPercent(r.revenue, target) : null, target };
      }).sort((a, b) => Number(b.revenue) - Number(a.revenue) || b.won - a.won).map((r, i) => ({ ...r, rank: i + 1 }));
      // Colleagues' money figures are management information: reps see their own amounts and everyone's rank/attainment.
      const shown = items.map((r) => (managerial || r.id === actor.memberId ? r : { ...r, revenue: null, target: null }));
      return { range, items: shown, currency: cur, note: managerial ? undefined : "Revenue amounts for other people are visible to managers only." };
    },
  },
  {
    method: "GET", path: "/performance/members/:id", permission: "performance:read", tx: false,
    async handler({ q, actor, params, query, now, settings }) {
      const id = parse(v.id(), params.id);
      assertOwnerAccess(actor, id, "Member");
      const m = (await q.query<any>("SELECT id, display_name, email, role, team_id, hire_date, coaching_notes FROM sales_members WHERE id = $1", [id])).rows[0];
      if (!m) throw notFound("Member");
      const range = resolveRange(query, now, settings);
      const cur = settings.business.currency;
      const months = (await q.query(`SELECT to_char(date_trunc('month', o.booked_at AT TIME ZONE $3), 'YYYY-MM') AS month, COALESCE(sum(o.net_total - o.returned_total),0)::numeric(18,2)::text AS revenue, count(*)::int AS orders FROM sales_orders o WHERE o.owner_id = $1 AND o.status <> 'cancelled' AND o.currency = $2 AND o.booked_at >= now() - interval '12 months' GROUP BY 1 ORDER BY 1`, [id, cur, settings.business.timezone])).rows;
      const acts = (await q.query(`SELECT type, count(*)::int n FROM sales_activities WHERE owner_id = $1 AND status = 'done' AND completed_at >= $2 AND completed_at < $3 GROUP BY type ORDER BY type`, [id, range.from, range.to])).rows;
      const openPipe = (await q.query<any>(`SELECT count(*)::int n, COALESCE(sum(amount),0)::numeric(18,2)::text amount, COALESCE(sum(amount*probability/100),0)::numeric(18,2)::text weighted FROM sales_opportunities WHERE owner_id = $1 AND status = 'open' AND archived_at IS NULL AND currency = $2`, [id, cur])).rows[0];
      const rev = await revenue(q, `o.owner_id = ${id}`, range, cur);
      const out: Record<string, unknown> = { member: { id: m.id, display_name: m.display_name, email: m.email, role: m.role, team_id: m.team_id }, range, revenue: rev, monthly: months, activities: acts, openPipeline: openPipe };
      if (isManagerial(actor) && id !== actor.memberId) out.coachingNotes = m.coaching_notes;
      return out;
    },
  },
  {
    method: "GET", path: "/performance/teams", permission: "performance:read", tx: false,
    async handler({ q, actor, query, now, settings }) {
      const range = resolveRange(query, now, settings);
      const cur = settings.business.currency;
      const own = ownerScopeSql(actor, "o.owner_id");
      const rows = (await q.query(`SELECT COALESCE(t.name,'No team') AS team, count(DISTINCT o.id)::int AS orders, COALESCE(sum(o.net_total - o.returned_total),0)::numeric(18,2)::text AS revenue FROM sales_orders o LEFT JOIN sales_members m ON m.id = o.owner_id LEFT JOIN sales_teams t ON t.id = m.team_id WHERE ${own} AND o.status <> 'cancelled' AND o.currency = $3 AND o.booked_at >= $1 AND o.booked_at < $2 GROUP BY 1 ORDER BY sum(o.net_total - o.returned_total) DESC`, [range.from, range.to, cur])).rows;
      return { range, items: rows, currency: cur };
    },
  },
  // ───── reports
  {
    method: "GET", path: "/reports", permission: "reports:read", tx: false,
    async handler({ actor }) {
      return { items: Object.entries(REPORTS).filter(([, r]) => !r.needs || can(actor, r.needs)).map(([key, r]) => ({ key, title: r.title, description: r.description, columns: r.columns })), canExport: can(actor, "reports:export") };
    },
  },
  {
    method: "GET", path: "/reports/:key", permission: "reports:read", tx: false,
    async handler({ q, actor, params, query, now, settings, requestId }) {
      const rep = REPORTS[params.key!];
      if (!rep || (rep.needs && !can(actor, rep.needs))) throw notFound("Report");
      const range = resolveRange(query, now, settings);
      const sql = rep.sql({ owner: ownerFilter(actor, "o.owner_id", query), ownerOp: ownerFilter(actor, "op.owner_id", query), ownerL: ownerFilter(actor, "l.owner_id", query), ownerX: ownerFilter(actor, "x.owner_id", query) });
      const all = [range.from, range.to, settings.business.currency, settings.business.timezone];
      const used = Math.max(...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
      const rows = (await q.query(`${sql} LIMIT 5000`, all.slice(0, used))).rows;
      if (str(query, "format") === "csv") {
        if (!can(actor, "reports:export")) throw forbidden("You cannot export reports");
        await audit(q, actor, { action: "report.export", entityType: "report", entityId: params.key, summary: `Exported ${rep.title} (${rows.length} rows, ${range.label})` }, requestId);
        return csv(`${params.key}.csv`, toCsv(rep.columns, rows));
      }
      return { key: params.key, title: rep.title, description: rep.description, range, columns: rep.columns, rows, truncated: rows.length >= 5000, currency: settings.business.currency };
    },
  },
  // ───── saved views
  {
    method: "GET", path: "/saved-views", permission: null, tx: false,
    async handler({ q, actor, query }) {
      const w = new Where().raw(`(m.member_id = ${Number(actor.memberId) || -1} OR m.shared)`);
      if (str(query, "scope")) w.and("m.scope = ?", str(query, "scope"));
      return { items: (await q.query(`SELECT m.id, m.scope, m.name, m.filters, m.shared, m.member_id = ${Number(actor.memberId) || -1} AS mine FROM sales_saved_views m WHERE ${w.sql} ORDER BY m.name`, w.params)).rows };
    },
  },
  {
    method: "POST", path: "/saved-views", permission: null,
    async handler({ q, actor, body }) {
      if (!actor.memberId) throw forbidden("Only sales members can save views");
      const b = parse(v.object({ scope: v.enumOf(["leads", "accounts", "opportunities", "quotations", "orders", "activities", "reports"] as const), name: v.string({ min: 2, max: 60 }), filters: v.record(v.string({ max: 200 })), shared: v.withDefault(v.boolean(), false) }), body);
      if (b.shared && !isManagerial(actor)) throw forbidden("Only managers can share views");
      const r = await q.query<{ id: number }>("INSERT INTO sales_saved_views (member_id, scope, name, filters, shared) VALUES ($1,$2,$3,$4::text::jsonb,$5) ON CONFLICT (member_id, scope, lower(name)) DO UPDATE SET filters = EXCLUDED.filters, shared = EXCLUDED.shared, updated_at = now() RETURNING id", [actor.memberId, b.scope, b.name, JSON.stringify(b.filters), b.shared]);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "DELETE", path: "/saved-views/:id", permission: null,
    async handler({ q, actor, params }) {
      const r = await q.query("DELETE FROM sales_saved_views WHERE id = $1 AND member_id = $2 RETURNING id", [parse(v.id(), params.id), actor.memberId || -1]);
      if (!r.rows[0]) throw notFound("Saved view");
      return noContent();
    },
  },
  // ───── report schedules (stored; delivered only when an email provider is connected)
  {
    method: "GET", path: "/report-schedules", permission: "reports:schedule", tx: false,
    async handler({ q, settings }) {
      const items = (await q.query("SELECT id, report, params, cadence, recipients, format, active, next_run_at, last_run_at FROM sales_report_schedules ORDER BY id DESC")).rows;
      return { items, delivery: settings.integrations.email.enabled ? "email" : "not_connected", note: settings.integrations.email.enabled ? undefined : "Email is not connected. Schedules are saved but nothing is sent until an email provider is connected." };
    },
  },
  {
    method: "POST", path: "/report-schedules", permission: "reports:schedule",
    async handler({ q, actor, body, now, requestId }) {
      const b = parse(v.object({ report: v.string({ min: 2, max: 60 }), period: v.withDefault(v.enumOf(PERIODS), "last_month"), cadence: v.enumOf(["daily", "weekly", "monthly"] as const), recipients: v.array(v.email(), { min: 1, max: 20 }), format: v.withDefault(v.enumOf(["csv", "html"] as const), "csv") }), body);
      if (!REPORTS[b.report] || (REPORTS[b.report]!.needs && !can(actor, REPORTS[b.report]!.needs!))) throw notFound("Report");
      const days = b.cadence === "daily" ? 1 : b.cadence === "weekly" ? 7 : 30;
      const r = await q.query<{ id: number }>("INSERT INTO sales_report_schedules (report, params, cadence, recipients, format, next_run_at, created_by) VALUES ($1,$2::text::jsonb,$3,ARRAY(SELECT jsonb_array_elements_text($4::text::jsonb)),$5,$6,$7) RETURNING id", [b.report, JSON.stringify({ period: b.period }), b.cadence, JSON.stringify(b.recipients), b.format, new Date(now.getTime() + days * 86_400_000).toISOString(), actor.label]);
      await audit(q, actor, { action: "report_schedule.create", entityType: "report_schedule", entityId: r.rows[0]!.id, summary: `Scheduled ${b.report} ${b.cadence}` }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "DELETE", path: "/report-schedules/:id", permission: "reports:schedule",
    async handler({ q, actor, params, requestId }) {
      const id = parse(v.id(), params.id);
      const r = await q.query("DELETE FROM sales_report_schedules WHERE id = $1 RETURNING id", [id]);
      if (!r.rows[0]) throw notFound("Schedule");
      await audit(q, actor, { action: "report_schedule.delete", entityType: "report_schedule", entityId: id, summary: "Deleted report schedule" }, requestId);
      return noContent();
    },
  },
];
void cmp; void add; void sum; void conflict; void validationFailed; void unprocessable;
