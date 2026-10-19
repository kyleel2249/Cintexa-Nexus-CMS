import { v, parse } from "../core/validate";
import { created, type Route } from "../core/router";
import { notFound, conflict, badRequest, validationFailed, forbidden } from "../core/errors";
import { audit } from "../core/audit";
import { can, scopeOf } from "../core/rbac";
import { pageOf, str, d10 } from "../core/http";
import { add, sub, sum, cmp, proportion, neg } from "../core/money";
import { validateTiers, selectPlan, computeCommission, reversalFor, quotaBonus, type Plan, type Tier } from "../domain/commission";
import { assertTransition, COMMISSION_TRANSITIONS } from "../domain/state-machines";
import { attainmentPercent } from "../domain/targets";
import { Where, orderHooks, type OrderHookCtx } from "./common";
import type { Actor, Queryable } from "../core/types";

const tierIn = v.object({ from: v.money(), to: v.nullable(v.money()), rate: v.number({ min: 0, max: 100 }) });
const planFields = {
  name: v.string({ min: 2, max: 120 }), kind: v.enumOf(["percent", "fixed", "tiered"] as const), basis: v.withDefault(v.enumOf(["booked", "invoiced", "collected"] as const), "collected"),
  measure: v.withDefault(v.enumOf(["revenue", "gross_profit"] as const), "revenue"), rate: v.optional(v.number({ min: 0, max: 100 })), fixed_amount: v.optional(v.money()),
  tiers: v.withDefault(v.array(tierIn, { max: 20 }), []), product_id: v.optional(v.id()), category: v.optional(v.string({ max: 80 })), member_id: v.optional(v.id()),
  quota_bonus: v.optional(v.object({ threshold_percent: v.number({ min: 1, max: 1000 }), amount: v.money() })), effective_from: v.date(), effective_to: v.optional(v.date()),
};
const planCreate = v.object(planFields);

function planFromRow(r: any): Plan {
  const d = (x: unknown) => (x ? String(x).slice(0, 10) : null);
  return {
    id: r.id, version: r.version, kind: r.kind, basis: r.basis, measure: r.measure, rate: r.rate === null ? null : String(r.rate), fixedAmount: r.fixed_amount, tiers: (r.tiers ?? []) as Tier[], productId: r.product_id, category: r.category,
    memberId: r.member_id, effectiveFrom: d(r.effective_from)!, effectiveTo: d(r.effective_to), active: r.active,
    quotaBonus: r.quota_bonus ? { thresholdPercent: Number(r.quota_bonus.thresholdPercent ?? r.quota_bonus.threshold_percent), amount: r.quota_bonus.amount } : null,
  };
}

function checkPlan(b: PlanInput): void {
  const issues: Array<{ path: string; message: string }> = [];
  if (b.kind === "percent" && b.rate === undefined) issues.push({ path: "rate", message: "A percent plan needs a rate" });
  if (b.kind === "fixed" && b.fixed_amount === undefined) issues.push({ path: "fixed_amount", message: "A fixed plan needs an amount" });
  if (b.kind === "tiered") {
    const e = validateTiers(b.tiers.map((t) => ({ from: t.from, to: t.to ?? null, rate: String(t.rate) })));
    if (e) issues.push({ path: "tiers", message: e });
  }
  if (b.effective_to && b.effective_to < b.effective_from) issues.push({ path: "effective_to", message: "End date is before the start date" });
  if (issues.length) throw validationFailed(issues);
}
type PlanInput = { kind: "percent" | "fixed" | "tiered"; rate?: number; fixed_amount?: string; tiers: Array<{ from: string; to?: string | null; rate: number }>; effective_from: string; effective_to?: string };

/**
 * (Re)calculate commission for one order. Idempotent: an order/member/plan has one commission entry; entries that
 * are already approved or paid are never altered (the DB trigger enforces it) - later returns create adjustments.
 */
export async function calculateOrder(q: Queryable, orderId: number, ctx: { now: Date; actor: Actor | null; requestId?: string }, opts: { splits?: Array<{ member_id: number; percent: number }> } = {}): Promise<number> {
  const o = (await q.query<any>("SELECT * FROM sales_orders WHERE id = $1 FOR UPDATE", [orderId])).rows[0];
  if (!o || o.status === "cancelled" || !o.booked_at || !o.owner_id) return 0;
  const plans = (await q.query<any>("SELECT * FROM sales_commission_plans WHERE active")).rows.map(planFromRow);
  if (!plans.length) return 0;
  const lines = (await q.query<any>("SELECT l.net::text, l.quantity::text, l.returned_quantity::text, l.unit_cost::text, l.product_id, p.category FROM sales_order_lines l LEFT JOIN sales_products p ON p.id = l.product_id WHERE l.order_id = $1", [orderId])).rows;
  const existing = (await q.query<any>("SELECT member_id, split_percent::text FROM sales_commission_entries WHERE order_id = $1 AND kind = 'commission' AND status <> 'void'", [orderId])).rows;
  let splits = opts.splits ?? (existing.length ? existing.map((e) => ({ member_id: e.member_id, percent: Number(e.split_percent) })) : [{ member_id: o.owner_id, percent: 100 }]);
  if (Math.abs(splits.reduce((a, s) => a + s.percent, 0) - 100) > 0.001) throw validationFailed([{ path: "splits", message: "Split percentages must add up to 100" }]);
  const on = d10(o.booked_at)!;
  const period = on.slice(0, 4);
  let written = 0;
  for (const s of splits) {
    // group lines by the plan that applies to them
    const byPlan = new Map<number, { plan: Plan; basis: string }>();
    for (const l of lines) {
      const plan = selectPlan(plans, { memberId: s.member_id, productId: l.product_id, category: l.category, on });
      if (!plan) continue;
      if (plan.basis === "invoiced" && o.invoice_status !== "issued") continue;
      if (plan.basis === "collected" && o.payment_status !== "paid") continue;
      const kept = Number(l.quantity) > 0 ? proportion(l.net, String(Number(l.quantity) - Number(l.returned_quantity)), l.quantity) : l.net;
      const keptCost = l.unit_cost === null ? null : proportion(String(Number(l.unit_cost) * Number(l.quantity)), String(Number(l.quantity) - Number(l.returned_quantity)), l.quantity);
      const amount = plan.measure === "gross_profit" ? (keptCost === null ? null : sub(kept, keptCost)) : kept;
      if (amount === null) continue; // unknown cost → cannot compute profit-based commission, never guess
      const cur = byPlan.get(plan.id) ?? { plan, basis: "0.00" };
      cur.basis = add(cur.basis, amount);
      byPlan.set(plan.id, cur);
    }
    for (const { plan, basis } of byPlan.values()) {
      const ex = (await q.query<any>("SELECT id, status FROM sales_commission_entries WHERE order_id = $1 AND member_id = $2 AND plan_id = $3 AND kind = 'commission' AND status <> 'void'", [orderId, s.member_id, plan.id])).rows[0];
      if (ex && ex.status !== "calculated") continue; // locked
      const cumulative = (await q.query<{ x: string }>("SELECT COALESCE(sum(basis_amount * split_percent / 100),0)::numeric(18,2)::text x FROM sales_commission_entries WHERE member_id = $1 AND plan_id = $2 AND kind = 'commission' AND status <> 'void' AND period_label = $3 AND order_id <> $4", [s.member_id, plan.id, period, orderId])).rows[0]!.x;
      const res = computeCommission(plan, basis, String(s.percent), cumulative);
      if (ex) {
        await q.query("UPDATE sales_commission_entries SET basis_amount = $2, split_percent = $3, amount = $4, breakdown = $5::text::jsonb, updated_at = now() WHERE id = $1", [ex.id, basis, s.percent, res.amount, JSON.stringify(res.breakdown)]);
      } else {
        await q.query("INSERT INTO sales_commission_entries (member_id, order_id, plan_id, plan_version, basis, basis_amount, split_percent, amount, breakdown, period_label, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text::jsonb,$10,$11)",
          [s.member_id, orderId, plan.id, plan.version, plan.basis, basis, s.percent, res.amount, JSON.stringify(res.breakdown), period, ctx.actor?.label ?? "system"]);
      }
      written++;
    }
  }
  return written;
}

/** After a return: create proportional negative adjustments. After a cancel: void unpaid entries, claw back paid ones. */
export async function reverseForOrder(q: Queryable, orderId: number, mode: "return" | "cancel", ctx: { now: Date; actor: Actor | null }): Promise<number> {
  const o = (await q.query<any>("SELECT net_total::text, returned_total::text FROM sales_orders WHERE id = $1", [orderId])).rows[0];
  if (!o) return 0;
  const entries = (await q.query<any>("SELECT * FROM sales_commission_entries WHERE order_id = $1 AND kind = 'commission' AND status <> 'void'", [orderId])).rows;
  let n = 0;
  for (const e of entries) {
    const adj = (await q.query<{ x: string }>("SELECT COALESCE(sum(amount),0)::numeric(18,2)::text x FROM sales_commission_entries WHERE parent_entry_id = $1 AND kind = 'adjustment' AND status <> 'void'", [e.id])).rows[0]!.x;
    if (mode === "cancel" && e.status === "calculated") {
      await q.query("UPDATE sales_commission_entries SET status = 'void', updated_at = now() WHERE id = $1", [e.id]);
      await q.query("UPDATE sales_commission_entries SET status = 'void', updated_at = now() WHERE parent_entry_id = $1 AND status = 'calculated'", [e.id]);
      n++;
      continue;
    }
    let target: string;
    if (mode === "cancel") target = neg(e.amount);
    else {
      if (cmp(o.net_total, "0.00") <= 0) continue;
      const returnedBasis = proportion(e.basis_amount, o.returned_total, o.net_total);
      target = reversalFor(e.amount, e.basis_amount, returnedBasis);
    }
    const delta = sub(target, adj);
    if (cmp(delta, "0.00") === 0) continue;
    // never claw back more than the entry paid out
    if (cmp(add(adj, delta), neg(e.amount)) < 0) continue;
    await q.query("INSERT INTO sales_commission_entries (member_id, order_id, plan_id, plan_version, kind, basis, basis_amount, split_percent, amount, status, parent_entry_id, adjustment_reason, period_label, created_by) VALUES ($1,$2,$3,$4,'adjustment',$5,'0.00',$6,$7,'calculated',$8,$9,$10,$11)",
      [e.member_id, orderId, e.plan_id, e.plan_version, e.basis, e.split_percent, delta, e.id, mode === "cancel" ? "Order cancelled" : "Goods returned", e.period_label, ctx.actor?.label ?? "system"]);
    n++;
  }
  return n;
}

orderHooks.booked.push(async (q, id, c: OrderHookCtx) => { await calculateOrder(q, id, c); });
orderHooks.paid.push(async (q, id, c: OrderHookCtx) => { await calculateOrder(q, id, c); });
orderHooks.returned.push(async (q, id, c: OrderHookCtx) => { await reverseForOrder(q, id, "return", c); });
orderHooks.cancelled.push(async (q, id, c: OrderHookCtx) => { await reverseForOrder(q, id, "cancel", c); });

function entryScope(actor: Actor, col: string): string {
  const s = scopeOf(actor);
  if (s === "all") return "TRUE";
  if (s === "team") return `${col} IN (${[actor.memberId, ...actor.teamMemberIds].filter(Boolean).map(Number).join(",") || "NULL"})`;
  return `${col} = ${Number(actor.memberId) || -1}`;
}

const E_LIST = `e.id, e.member_id, m.display_name AS member_name, e.order_id, o.number AS order_number, e.plan_id, p.name AS plan_name, e.kind, e.basis, e.basis_amount, e.split_percent, e.amount, e.status, e.period_label, e.parent_entry_id, e.adjustment_reason, e.approved_by, e.approved_at, e.paid_at, e.payout_reference, e.created_at`;
const E_FROM = `FROM sales_commission_entries e JOIN sales_members m ON m.id = e.member_id JOIN sales_orders o ON o.id = e.order_id JOIN sales_commission_plans p ON p.id = e.plan_id`;

export const commissionRoutes: Route[] = [
  {
    method: "GET", path: "/commission-plans", permission: "commissions:write", tx: false,
    async handler({ q }) {
      const r = await q.query("SELECT p.*, m.display_name AS member_name, pr.name AS product_name FROM sales_commission_plans p LEFT JOIN sales_members m ON m.id = p.member_id LEFT JOIN sales_products pr ON pr.id = p.product_id ORDER BY p.active DESC, p.name, p.version DESC");
      return { items: r.rows };
    },
  },
  {
    method: "POST", path: "/commission-plans", permission: "commissions:write",
    async handler({ q, actor, body, requestId }) {
      const b = parse(planCreate, body);
      checkPlan(b);
      const r = await q.query<{ id: number }>(
        `INSERT INTO sales_commission_plans (name, kind, basis, measure, rate, fixed_amount, tiers, product_id, category, member_id, quota_bonus, effective_from, effective_to, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7::text::jsonb,$8,$9,$10,$11::text::jsonb,$12,$13,$14) RETURNING id`,
        [b.name, b.kind, b.basis, b.measure, b.kind === "percent" ? b.rate : null, b.kind === "fixed" ? b.fixed_amount : null, JSON.stringify(b.kind === "tiered" ? b.tiers.map((t) => ({ from: t.from, to: t.to ?? null, rate: String(t.rate) })) : []),
          b.product_id ?? null, b.category ?? null, b.member_id ?? null, b.quota_bonus ? JSON.stringify({ thresholdPercent: b.quota_bonus.threshold_percent, amount: b.quota_bonus.amount }) : null, b.effective_from, b.effective_to ?? null, actor.label],
      );
      await audit(q, actor, { action: "commission_plan.create", entityType: "commission_plan", entityId: r.rows[0]!.id, summary: `Created commission plan ${b.name}`, after: b }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "POST", path: "/commission-plans/:id/revise", permission: "commissions:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(planCreate, body);
      checkPlan(b);
      const cur = (await q.query<any>("SELECT * FROM sales_commission_plans WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!cur) throw notFound("Commission plan");
      if (d10(cur.effective_from)! >= b.effective_from) throw validationFailed([{ path: "effective_from", message: "The new version must start after the current version began" }]);
      const prevEnd = d10(new Date(Date.parse(b.effective_from + "T00:00:00Z") - 86_400_000))!;
      await q.query("UPDATE sales_commission_plans SET effective_to = $2, updated_at = now() WHERE id = $1", [id, prevEnd]);
      const r = await q.query<{ id: number }>(
        `INSERT INTO sales_commission_plans (name, version, kind, basis, measure, rate, fixed_amount, tiers, product_id, category, member_id, quota_bonus, effective_from, effective_to, supersedes_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text::jsonb,$9,$10,$11,$12::text::jsonb,$13,$14,$15,$16) RETURNING id`,
        [b.name, cur.version + 1, b.kind, b.basis, b.measure, b.kind === "percent" ? b.rate : null, b.kind === "fixed" ? b.fixed_amount : null, JSON.stringify(b.kind === "tiered" ? b.tiers.map((t) => ({ from: t.from, to: t.to ?? null, rate: String(t.rate) })) : []),
          b.product_id ?? null, b.category ?? null, b.member_id ?? null, b.quota_bonus ? JSON.stringify({ thresholdPercent: b.quota_bonus.threshold_percent, amount: b.quota_bonus.amount }) : null, b.effective_from, b.effective_to ?? null, id, actor.label],
      );
      await audit(q, actor, { action: "commission_plan.revise", entityType: "commission_plan", entityId: r.rows[0]!.id, summary: `Plan ${b.name} v${cur.version + 1} supersedes v${cur.version}; past entries keep the version they used` }, requestId);
      return created({ id: r.rows[0]!.id, version: cur.version + 1 });
    },
  },
  {
    method: "POST", path: "/commission-plans/:id/deactivate", permission: "commissions:write",
    async handler({ q, actor, params, requestId }) {
      const id = parse(v.id(), params.id);
      const r = await q.query("UPDATE sales_commission_plans SET active = FALSE, updated_at = now() WHERE id = $1 RETURNING id", [id]);
      if (!r.rows[0]) throw notFound("Commission plan");
      await audit(q, actor, { action: "commission_plan.deactivate", entityType: "commission_plan", entityId: id, summary: "Deactivated plan (existing entries are unaffected)" }, requestId);
      return { ok: true };
    },
  },
  {
    method: "GET", path: "/commissions", permission: "commissions:read",
    async handler({ q, actor, query }) {
      const w = new Where().raw(entryScope(actor, "e.member_id"));
      if (str(query, "member_id")) w.and("e.member_id = ?", parse(v.id(), str(query, "member_id")));
      if (str(query, "status")) w.and("e.status = ?", str(query, "status"));
      if (str(query, "period")) w.and("e.period_label = ?", str(query, "period"));
      if (str(query, "order_id")) w.and("e.order_id = ?", parse(v.id(), str(query, "order_id")));
      const { page, pageSize, offset } = pageOf(query);
      const total = (await q.query<{ n: number }>(`SELECT count(*)::int n ${E_FROM} WHERE ${w.sql}`, w.params)).rows[0]!.n;
      const items = (await q.query(`SELECT ${E_LIST} ${E_FROM} WHERE ${w.sql} ORDER BY e.created_at DESC, e.id DESC LIMIT ${pageSize} OFFSET ${offset}`, w.params)).rows;
      const sums = (await q.query<{ status: string; amount: string }>(`SELECT e.status, COALESCE(sum(e.amount),0)::numeric(18,2)::text amount ${E_FROM} WHERE ${w.sql} GROUP BY e.status`, w.params)).rows;
      return { items, total, page, pageSize, totals: Object.fromEntries(sums.map((s) => [s.status, s.amount])) };
    },
  },
  {
    method: "GET", path: "/commissions/statement", permission: "commissions:read",
    async handler({ q, actor, query, now }) {
      const memberId = str(query, "member_id") ? parse(v.id(), str(query, "member_id")) : actor.memberId;
      if (!memberId) throw badRequest("Choose a member");
      const w = new Where().raw(entryScope(actor, "e.member_id")).and("e.member_id = ?", memberId).raw("e.status <> 'void'");
      const period = str(query, "period") ?? String(now.getUTCFullYear());
      w.and("e.period_label = ?", period);
      const rows = (await q.query<any>(`SELECT ${E_LIST} ${E_FROM} WHERE ${w.sql} ORDER BY e.created_at`, w.params)).rows;
      if (!rows.length && scopeOf(actor) === "own" && memberId !== actor.memberId) throw notFound("Member");
      const by = (s: string) => sum(rows.filter((r) => r.status === s).map((r) => r.amount));
      const plan = (await q.query<any>("SELECT * FROM sales_commission_plans WHERE active AND (member_id = $1 OR member_id IS NULL) AND quota_bonus IS NOT NULL ORDER BY member_id NULLS LAST LIMIT 1", [memberId])).rows[0];
      let bonus: unknown = null;
      if (plan) {
        const t = (await q.query<any>("SELECT t.amount::text, t.id FROM sales_targets t JOIN sales_target_periods p ON p.id = t.period_id WHERE t.scope = 'member' AND t.scope_id = $1 AND t.metric = 'revenue' AND p.kind = 'year' AND p.starts_on <= $2::date AND p.ends_on >= $2::date LIMIT 1", [memberId, `${period}-06-30`])).rows[0];
        if (t) {
          const { actualFor } = await import("./targets");
          const actual = await actualFor(q, { scope: "member", scope_id: memberId, scope_key: "", metric: "revenue", basis: "booked" }, { from: `${period}-01-01T00:00:00Z`, to: `${Number(period) + 1}-01-01T00:00:00Z` });
          const att = attainmentPercent(actual.actual, t.amount);
          const pl = planFromRow(plan);
          const paid = (await q.query("SELECT 1 FROM sales_commission_entries WHERE member_id = $1 AND kind = 'adjustment' AND adjustment_reason = 'Quota bonus' AND period_label = $2", [memberId, period])).rows.length > 0;
          bonus = { attainmentPercent: att, eligibleAmount: quotaBonus(pl, att, paid), note: "Informational. A quota bonus is added by an approver as an adjustment; it is not created automatically." };
        }
      }
      return { member_id: memberId, period, entries: rows, totals: { calculated: by("calculated"), approved: by("approved"), paid: by("paid"), outstanding: add(by("calculated"), by("approved")) }, quotaBonus: bonus };
    },
  },
  {
    method: "POST", path: "/commissions/recalculate/:orderId", permission: "commissions:write",
    async handler({ q, actor, params, body, now, requestId }) {
      const orderId = parse(v.id(), params.orderId);
      const b = parse(v.object({ splits: v.optional(v.array(v.object({ member_id: v.id(), percent: v.number({ min: 0.01, max: 100 }) }), { min: 1, max: 10 })) }), body ?? {});
      if (b.splits) for (const s of b.splits) if (!(await q.query("SELECT 1 FROM sales_members WHERE id = $1 AND active", [s.member_id])).rows[0]) throw badRequest(`Member ${s.member_id} is not active`);
      if (b.splits && new Set(b.splits.map((s) => s.member_id)).size !== b.splits.length) throw badRequest("A member can appear once");
      const n = await calculateOrder(q, orderId, { now, actor, requestId }, { splits: b.splits });
      await audit(q, actor, { action: "commission.recalculate", entityType: "order", entityId: orderId, summary: `Recalculated commission (${n} entr${n === 1 ? "y" : "ies"})${b.splits ? " with split credit" : ""}`, after: b.splits }, requestId);
      return { ok: true, entries: n };
    },
  },
  {
    method: "POST", path: "/commissions/approve", permission: "commissions:approve", idempotent: true,
    async handler({ q, actor, body, now, requestId }) {
      const b = parse(v.object({ ids: v.array(v.id(), { min: 1, max: 500 }) }), body);
      let approved = 0;
      for (const id of b.ids) {
        const e = (await q.query<any>("SELECT * FROM sales_commission_entries WHERE id = $1 FOR UPDATE", [id])).rows[0];
        if (!e) throw notFound(`Commission entry ${id}`);
        if (e.status === "approved") continue;
        assertTransition("commission entry", COMMISSION_TRANSITIONS, e.status, "approved");
        const mem = (await q.query<{ user_sub: string | null }>("SELECT user_sub FROM sales_members WHERE id = $1", [e.member_id])).rows[0];
        if (mem?.user_sub && mem.user_sub === actor.userSub) throw forbidden("You cannot approve your own commission", "self_approval");
        await q.query("UPDATE sales_commission_entries SET status = 'approved', approved_by = $2, approved_at = $3, updated_at = now() WHERE id = $1", [id, actor.label, now.toISOString()]);
        approved++;
      }
      await audit(q, actor, { action: "commission.approve", entityType: "commission", summary: `Approved ${approved} commission entr${approved === 1 ? "y" : "ies"}`, after: { ids: b.ids } }, requestId);
      return { ok: true, approved };
    },
  },
  {
    method: "POST", path: "/commissions/pay", permission: "commissions:pay", idempotent: true,
    async handler({ q, actor, body, now, requestId }) {
      const b = parse(v.object({ ids: v.array(v.id(), { min: 1, max: 500 }), payout_reference: v.string({ min: 2, max: 120 }) }), body);
      let paid = 0;
      for (const id of b.ids) {
        const e = (await q.query<any>("SELECT * FROM sales_commission_entries WHERE id = $1 FOR UPDATE", [id])).rows[0];
        if (!e) throw notFound(`Commission entry ${id}`);
        if (e.status === "paid") continue;
        assertTransition("commission entry", COMMISSION_TRANSITIONS, e.status, "paid");
        await q.query("UPDATE sales_commission_entries SET status = 'paid', paid_at = $2, payout_reference = $3, updated_at = now() WHERE id = $1", [id, now.toISOString(), b.payout_reference]);
        paid++;
      }
      await audit(q, actor, { action: "commission.pay", entityType: "commission", summary: `Marked ${paid} entr${paid === 1 ? "y" : "ies"} paid (ref ${b.payout_reference}); this records a payout made elsewhere and does not move money`, after: { ids: b.ids } }, requestId);
      return { ok: true, paid };
    },
  },
  {
    method: "POST", path: "/commissions/:id/void", permission: "commissions:approve",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ reason: v.string({ min: 3, max: 300 }) }), body);
      const e = (await q.query<any>("SELECT * FROM sales_commission_entries WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!e) throw notFound("Commission entry");
      assertTransition("commission entry", COMMISSION_TRANSITIONS, e.status, "void");
      await q.query("UPDATE sales_commission_entries SET status = 'void', updated_at = now() WHERE id = $1", [id]);
      await audit(q, actor, { action: "commission.void", entityType: "commission", entityId: id, summary: `Voided commission entry: ${b.reason}` }, requestId);
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/commissions/:id/adjust", permission: "commissions:approve",
    async handler({ q, actor, params, body, now, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ amount: v.money({ min: "-100000000" }), reason: v.string({ min: 3, max: 300 }) }), body);
      const e = (await q.query<any>("SELECT * FROM sales_commission_entries WHERE id = $1 AND kind = 'commission' AND status <> 'void' FOR UPDATE", [id])).rows[0];
      if (!e) throw notFound("Commission entry");
      if (cmp(b.amount, "0.00") === 0) throw validationFailed([{ path: "amount", message: "An adjustment cannot be zero" }]);
      const adj = (await q.query<{ x: string }>("SELECT COALESCE(sum(amount),0)::numeric(18,2)::text x FROM sales_commission_entries WHERE parent_entry_id = $1 AND status <> 'void'", [id])).rows[0]!.x;
      if (cmp(add(add(e.amount, adj), b.amount), "0.00") < 0) throw conflict("The adjustment would make the commission negative", "over_clawback");
      const r = await q.query<{ id: number }>("INSERT INTO sales_commission_entries (member_id, order_id, plan_id, plan_version, kind, basis, basis_amount, split_percent, amount, status, parent_entry_id, adjustment_reason, period_label, created_by, approved_by, approved_at) VALUES ($1,$2,$3,$4,'adjustment',$5,'0.00',$6,$7,'approved',$8,$9,$10,$11,$11,$12) RETURNING id",
        [e.member_id, e.order_id, e.plan_id, e.plan_version, e.basis, e.split_percent, b.amount, id, b.reason, e.period_label, actor.label, now.toISOString()]);
      await audit(q, actor, { action: "commission.adjust", entityType: "commission", entityId: r.rows[0]!.id, summary: `Adjustment ${b.amount} on entry ${id}: ${b.reason}` }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
];
void can;
