import { v, parse } from "../core/validate";
import { created, noContent, type Route } from "../core/router";
import { notFound, conflict, badRequest, validationFailed, forbidden } from "../core/errors";
import { audit } from "../core/audit";
import { can, scopeOf } from "../core/rbac";
import { str } from "../core/http";
import { pacing, attainmentPercent, allocationGap } from "../domain/targets";
import { cmp, sum } from "../core/money";
import { assertTransition, TARGET_PERIOD_TRANSITIONS } from "../domain/state-machines";
import { rangeFromDates } from "../core/time";
import type { Actor, Queryable } from "../core/types";

const SCOPES = ["company", "department", "team", "member", "product", "category", "territory", "branch", "channel"] as const;
const METRICS = ["revenue", "units", "gross_profit", "new_customers", "deals_won"] as const;
const BASES = ["booked", "invoiced", "collected"] as const;

/**
 * Actual result for one target. Booked = confirmed orders (booked_at in range) net of cancellations and returns;
 * invoiced/collected rely on facts recorded by the finance provider or authorised staff (never assumed).
 */
export async function actualFor(q: Queryable, t: { scope: string; scope_id: number | null; scope_key: string; metric: string; basis: string }, range: { from: string; to: string }, teamMembers?: number[]): Promise<{ actual: string; sources: number }> {
  const p: unknown[] = [range.from, range.to];
  const conds: string[] = ["o.status <> 'cancelled'"];
  const arg = (x: unknown) => { p.push(x); return `$${p.length}`; };
  switch (t.scope) {
    case "member": conds.push(`o.owner_id = ${arg(t.scope_id)}`); break;
    case "team": conds.push(`o.team_id = ${arg(t.scope_id)}`); break;
    case "territory": conds.push(`o.territory_id = ${arg(t.scope_id)}`); break;
    case "channel": conds.push(`o.channel = ${arg(t.scope_key)}`); break;
    case "branch": conds.push(`o.owner_id IN (SELECT id FROM sales_members WHERE branch = ${arg(t.scope_key)})`); break;
    case "product": conds.push(`EXISTS (SELECT 1 FROM sales_order_lines l WHERE l.order_id = o.id AND l.product_id = ${arg(t.scope_id)})`); break;
    case "category": conds.push(`EXISTS (SELECT 1 FROM sales_order_lines l JOIN sales_products pr ON pr.id = l.product_id WHERE l.order_id = o.id AND pr.category = ${arg(t.scope_key)})`); break;
    default: break;
  }
  if (teamMembers) conds.push(`o.owner_id IN (${teamMembers.length ? teamMembers.map(Number).join(",") : "NULL"})`);
  if (t.metric === "deals_won") {
    const r = await q.query<{ n: number }>(`SELECT count(*)::int n FROM sales_opportunities op WHERE op.status = 'won' AND op.closed_at >= $1 AND op.closed_at < $2 ${t.scope === "member" ? "AND op.owner_id = $3" : t.scope === "team" ? "AND op.team_id = $3" : ""}`, t.scope === "member" || t.scope === "team" ? [range.from, range.to, t.scope_id] : [range.from, range.to]);
    return { actual: String(r.rows[0]!.n) + ".00", sources: r.rows[0]!.n };
  }
  if (t.metric === "new_customers") {
    const r = await q.query<{ n: number }>(`SELECT count(*)::int n FROM (SELECT o.account_id, min(o.booked_at) first FROM sales_orders o WHERE o.status <> 'cancelled' AND o.booked_at IS NOT NULL GROUP BY o.account_id) f WHERE f.first >= $1 AND f.first < $2`, [range.from, range.to]);
    return { actual: String(r.rows[0]!.n) + ".00", sources: r.rows[0]!.n };
  }
  const valueExpr = t.metric === "units" ? "(SELECT COALESCE(sum(l.quantity),0) FROM sales_order_lines l WHERE l.order_id = o.id)" : t.metric === "gross_profit" ? "COALESCE(o.gross_profit,0)" : "(o.net_total - o.returned_total)";
  let dateFilter = "o.booked_at >= $1 AND o.booked_at < $2";
  if (t.basis === "collected" && t.metric === "revenue") {
    // cash actually recorded in the period (by finance or authorised staff), net of reversals
    const rc = await q.query<{ total: string; n: number }>(
      `SELECT COALESCE(sum(pay.amount),0)::numeric(18,2)::text AS total, count(*)::int n FROM sales_order_payments pay JOIN sales_orders o ON o.id = pay.order_id
       WHERE pay.status = 'recorded' AND pay.received_on >= ($1::timestamptz AT TIME ZONE 'UTC')::date AND pay.received_on < ($2::timestamptz AT TIME ZONE 'UTC')::date AND ${conds.join(" AND ")}`, p);
    return { actual: rc.rows[0]!.total, sources: rc.rows[0]!.n };
  }
  if (t.basis === "collected") dateFilter = `o.payment_status = 'paid' AND o.booked_at >= $1 AND o.booked_at < $2`;
  if (t.basis === "invoiced") dateFilter = "o.invoice_status = 'issued' AND o.booked_at >= $1 AND o.booked_at < $2";
  const r = await q.query<{ total: string; n: number }>(`SELECT COALESCE(sum(${valueExpr}),0)::numeric(18,2)::text AS total, count(*)::int n FROM sales_orders o WHERE ${conds.join(" AND ")} AND o.booked_at IS NOT NULL AND ${dateFilter}`, p);
  return { actual: r.rows[0]!.total, sources: r.rows[0]!.n };
}

function visibleTarget(actor: Actor, t: { scope: string; scope_id: number | null }): boolean {
  const s = scopeOf(actor);
  if (s === "all") return true;
  if (t.scope === "member") return t.scope_id === actor.memberId || (s === "team" && actor.teamMemberIds.includes(t.scope_id ?? -1));
  if (t.scope === "team") return s === "team" && actor.teamId === t.scope_id;
  return s === "team";
}

export const targetRoutes: Route[] = [
  {
    method: "GET", path: "/target-periods", permission: "targets:read", tx: false,
    async handler({ q }) {
      return { items: (await q.query("SELECT p.*, (SELECT count(*)::int FROM sales_targets t WHERE t.period_id = p.id) AS targets FROM sales_target_periods p ORDER BY p.starts_on DESC")).rows };
    },
  },
  {
    method: "POST", path: "/target-periods", permission: "targets:write",
    async handler({ q, actor, body, requestId }) {
      const b = parse(v.object({ name: v.string({ min: 2, max: 80 }), kind: v.enumOf(["month", "quarter", "year", "custom"] as const), starts_on: v.date(), ends_on: v.date() }), body);
      if (b.ends_on < b.starts_on) throw validationFailed([{ path: "ends_on", message: "End date is before the start date" }]);
      const overlap = (await q.query<{ name: string }>("SELECT name FROM sales_target_periods WHERE kind = $1 AND status <> 'closed' AND starts_on <= $3::date AND ends_on >= $2::date LIMIT 1", [b.kind, b.starts_on, b.ends_on])).rows[0];
      if (overlap) throw conflict(`This overlaps the existing ${b.kind} period "${overlap.name}"`, "period_overlap");
      const r = await q.query<{ id: number }>("INSERT INTO sales_target_periods (name, kind, starts_on, ends_on) VALUES ($1,$2,$3,$4) RETURNING id", [b.name, b.kind, b.starts_on, b.ends_on]);
      await audit(q, actor, { action: "target_period.create", entityType: "target_period", entityId: r.rows[0]!.id, summary: `Created period ${b.name}` }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "POST", path: "/target-periods/:id/status", permission: "targets:approve",
    async handler({ q, actor, params, body, now, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ status: v.enumOf(["draft", "pending_approval", "approved", "closed"] as const) }), body);
      const cur = (await q.query<any>("SELECT * FROM sales_target_periods WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!cur) throw notFound("Target period");
      assertTransition("target period", TARGET_PERIOD_TRANSITIONS, cur.status, b.status);
      if (b.status === "approved") {
        const n = (await q.query<{ n: number }>("SELECT count(*)::int n FROM sales_targets WHERE period_id = $1", [id])).rows[0]!.n;
        if (!n) throw conflict("Add at least one target before approving the period", "no_targets");
      }
      await q.query("UPDATE sales_target_periods SET status = $2, approved_by = CASE WHEN $2 = 'approved' THEN $3 ELSE approved_by END, approved_at = CASE WHEN $2 = 'approved' THEN $4::timestamptz ELSE approved_at END, updated_at = now() WHERE id = $1", [id, b.status, actor.label, now.toISOString()]);
      await audit(q, actor, { action: "target_period.status", entityType: "target_period", entityId: id, summary: `${cur.name}: ${cur.status} → ${b.status}` }, requestId);
      return { ok: true };
    },
  },
  {
    method: "GET", path: "/targets", permission: "targets:read",
    async handler({ q, actor, query, now, settings }) {
      const periodId = str(query, "period_id") ? parse(v.id(), str(query, "period_id")) : (await q.query<{ id: number }>("SELECT id FROM sales_target_periods WHERE starts_on <= $1::date AND ends_on >= $1::date ORDER BY starts_on DESC LIMIT 1", [now.toISOString().slice(0, 10)])).rows[0]?.id;
      if (!periodId) return { period: null, items: [] };
      const period = (await q.query<any>("SELECT * FROM sales_target_periods WHERE id = $1", [periodId])).rows[0];
      if (!period) throw notFound("Target period");
      const range = rangeFromDates(String(period.starts_on).slice(0, 10), String(period.ends_on).slice(0, 10), settings.business.timezone);
      const rows = (await q.query<any>("SELECT t.*, m.display_name AS member_name, tm.name AS team_name, tr.name AS territory_name FROM sales_targets t LEFT JOIN sales_members m ON t.scope = 'member' AND m.id = t.scope_id LEFT JOIN sales_teams tm ON t.scope = 'team' AND tm.id = t.scope_id LEFT JOIN sales_territories tr ON t.scope = 'territory' AND tr.id = t.scope_id WHERE t.period_id = $1 ORDER BY t.scope, t.id", [periodId])).rows;
      const items = [];
      for (const t of rows) {
        if (!visibleTarget(actor, t)) continue;
        const { actual, sources } = await actualFor(q, t, range);
        const money = t.metric === "revenue" || t.metric === "gross_profit";
        items.push({ ...t, label: t.member_name ?? t.team_name ?? t.territory_name ?? (t.scope_key || "Company"), actual, sources, attainmentPercent: attainmentPercent(actual, t.amount), pacing: period.status === "approved" || period.status === "closed" ? pacing({ target: t.amount, actual, range, now, alertThresholdPercent: Number(t.alert_threshold_percent) }) : null, isMoney: money });
      }
      return { period, items, basisNote: "Booked actuals use confirmed orders net of returns and cancellations. Collected revenue counts payments recorded by finance or authorised staff; invoiced counts orders whose invoice a finance system confirmed. Nothing is assumed." };
    },
  },
  {
    method: "POST", path: "/targets", permission: "targets:write",
    async handler({ q, actor, body, requestId }) {
      const b = parse(v.object({
        period_id: v.id(), scope: v.enumOf(SCOPES), scope_id: v.optional(v.id()), scope_key: v.withDefault(v.string({ max: 80 }), ""), metric: v.withDefault(v.enumOf(METRICS), "revenue"), basis: v.withDefault(v.enumOf(BASES), "booked"),
        amount: v.money(), parent_id: v.optional(v.id()), alert_threshold_percent: v.withDefault(v.number({ min: 0, max: 100 }), 70), notes: v.optional(v.string({ max: 500 })),
      }), body);
      const period = (await q.query<any>("SELECT status FROM sales_target_periods WHERE id = $1 FOR UPDATE", [b.period_id])).rows[0];
      if (!period) throw notFound("Target period");
      if (period.status === "closed") throw conflict("This period is closed", "period_closed");
      if (["member", "team", "territory", "product"].includes(b.scope) && !b.scope_id) throw validationFailed([{ path: "scope_id", message: `A ${b.scope} target needs a ${b.scope}` }]);
      if (["category", "channel", "branch"].includes(b.scope) && !b.scope_key) throw validationFailed([{ path: "scope_key", message: `A ${b.scope} target needs a name` }]);
      if (b.scope === "member" && !(await q.query("SELECT 1 FROM sales_members WHERE id = $1 AND active", [b.scope_id])).rows[0]) throw badRequest("Member not found or inactive");
      if (b.parent_id) {
        const parent = (await q.query<any>("SELECT period_id, metric, amount::text FROM sales_targets WHERE id = $1", [b.parent_id])).rows[0];
        if (!parent || parent.period_id !== b.period_id || parent.metric !== b.metric) throw badRequest("The parent target must be in the same period and metric");
        const siblings = (await q.query<{ amount: string }>("SELECT amount::text FROM sales_targets WHERE parent_id = $1", [b.parent_id])).rows.map((x) => x.amount);
        if (cmp(sum([...siblings, b.amount]), parent.amount) > 0) throw conflict(`Child targets would exceed the parent target of ${parent.amount}`, "over_allocated");
      }
      const r = await q.query<{ id: number }>("INSERT INTO sales_targets (period_id, scope, scope_id, scope_key, metric, basis, amount, parent_id, alert_threshold_percent, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
        [b.period_id, b.scope, b.scope_id ?? null, b.scope_key, b.metric, b.basis, b.amount, b.parent_id ?? null, b.alert_threshold_percent, b.notes ?? null]).catch((e: any) => { if (e?.code === "23505") throw conflict("A target already exists for this period, scope and metric", "duplicate_target"); throw e; });
      await audit(q, actor, { action: "target.create", entityType: "target", entityId: r.rows[0]!.id, summary: `Set ${b.metric} target ${b.amount} for ${b.scope}`, after: b }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "PATCH", path: "/targets/:id", permission: "targets:write",
    async handler({ q, actor, params, body, now, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ amount: v.optional(v.money()), reason: v.optional(v.string({ min: 3, max: 300 })), alert_threshold_percent: v.optional(v.number({ min: 0, max: 100 })), notes: v.nullable(v.string({ max: 500 })) }), body);
      const cur = (await q.query<any>("SELECT t.*, p.status AS period_status FROM sales_targets t JOIN sales_target_periods p ON p.id = t.period_id WHERE t.id = $1 FOR UPDATE OF t", [id])).rows[0];
      if (!cur) throw notFound("Target");
      if (cur.period_status === "closed") throw conflict("This period is closed", "period_closed");
      if (b.amount !== undefined && cmp(b.amount, cur.amount) !== 0) {
        if (cur.period_status === "approved" && !can(actor, "targets:approve")) throw forbidden("Changing an approved target needs an approver");
        if (cur.period_status === "approved" && !b.reason) throw validationFailed([{ path: "reason", message: "A reason is required to change an approved target" }]);
        if (cur.parent_id) {
          const parent = (await q.query<{ amount: string }>("SELECT amount::text FROM sales_targets WHERE id = $1", [cur.parent_id])).rows[0]!;
          const sibs = (await q.query<{ amount: string }>("SELECT amount::text FROM sales_targets WHERE parent_id = $1 AND id <> $2", [cur.parent_id, id])).rows.map((x) => x.amount);
          if (cmp(sum([...sibs, b.amount]), parent.amount) > 0) throw conflict(`Child targets would exceed the parent target of ${parent.amount}`, "over_allocated");
        }
        await q.query("INSERT INTO sales_target_adjustments (target_id, old_amount, new_amount, reason, changed_by, at) VALUES ($1,$2,$3,$4,$5,$6)", [id, cur.amount, b.amount, b.reason ?? "Draft revision", actor.label, now.toISOString()]);
        await q.query("UPDATE sales_targets SET amount = $2 WHERE id = $1", [id, b.amount]);
      }
      if (b.alert_threshold_percent !== undefined) await q.query("UPDATE sales_targets SET alert_threshold_percent = $2 WHERE id = $1", [id, b.alert_threshold_percent]);
      if (b.notes !== undefined) await q.query("UPDATE sales_targets SET notes = $2 WHERE id = $1", [id, b.notes]);
      await q.query("UPDATE sales_targets SET updated_at = now() WHERE id = $1", [id]);
      await audit(q, actor, { action: "target.update", entityType: "target", entityId: id, summary: `Updated target ${id}`, before: { amount: cur.amount }, after: b }, requestId);
      return { ok: true };
    },
  },
  {
    method: "DELETE", path: "/targets/:id", permission: "targets:write",
    async handler({ q, actor, params, requestId }) {
      const id = parse(v.id(), params.id);
      const cur = (await q.query<any>("SELECT t.id, p.status FROM sales_targets t JOIN sales_target_periods p ON p.id = t.period_id WHERE t.id = $1 FOR UPDATE OF t", [id])).rows[0];
      if (!cur) throw notFound("Target");
      if (cur.status !== "draft") throw conflict("Only targets in a draft period can be deleted", "period_locked");
      await q.query("DELETE FROM sales_targets WHERE id = $1", [id]);
      await audit(q, actor, { action: "target.delete", entityType: "target", entityId: id, summary: `Deleted target ${id}` }, requestId);
      return noContent();
    },
  },
  {
    method: "POST", path: "/targets/:id/allocate", permission: "targets:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ members: v.array(v.object({ member_id: v.id(), weight: v.number({ min: 0.01, max: 1000 }) }), { min: 1, max: 100 }) }), body);
      const t = (await q.query<any>("SELECT t.*, p.status FROM sales_targets t JOIN sales_target_periods p ON p.id = t.period_id WHERE t.id = $1 FOR UPDATE OF t", [id])).rows[0];
      if (!t) throw notFound("Target");
      if (t.status !== "draft") throw conflict("Allocate targets while the period is still a draft", "period_locked");
      const { allocateTarget } = await import("../domain/targets");
      const parts = allocateTarget(t.amount, b.members.map((m) => m.weight));
      await q.query("DELETE FROM sales_targets WHERE parent_id = $1", [id]);
      for (let i = 0; i < b.members.length; i++) {
        if (!(await q.query("SELECT 1 FROM sales_members WHERE id = $1 AND active", [b.members[i]!.member_id])).rows[0]) throw badRequest(`Member ${b.members[i]!.member_id} is not active`);
        await q.query("INSERT INTO sales_targets (period_id, scope, scope_id, metric, basis, amount, parent_id, alert_threshold_percent) VALUES ($1,'member',$2,$3,$4,$5,$6,$7)", [t.period_id, b.members[i]!.member_id, t.metric, t.basis, parts[i], id, t.alert_threshold_percent])
          .catch((e: any) => { if (e?.code === "23505") throw conflict(`Member ${b.members[i]!.member_id} already has a ${t.metric} target in this period`, "duplicate_target"); throw e; });
      }
      await audit(q, actor, { action: "target.allocate", entityType: "target", entityId: id, summary: `Allocated ${t.amount} across ${b.members.length} members` }, requestId);
      return { ok: true, allocations: b.members.map((m, i) => ({ member_id: m.member_id, amount: parts[i] })), gap: allocationGap(t.amount, parts) };
    },
  },
];
