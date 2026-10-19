import { v, parse } from "../core/validate";
import { created, type Route } from "../core/router";
import { notFound, conflict, badRequest } from "../core/errors";
import { audit } from "../core/audit";
import { can } from "../core/rbac";
import { pageOf, str, d10 } from "../core/http";
import { businessDate } from "../core/time";
import { Where, scopeSql, loadOwned, buildUpdate } from "./common";
import { accountHealth } from "./health-data";
import { notify } from "./activities";
import type { Queryable, Actor } from "../core/types";

const KINDS = ["survey", "complaint", "feedback", "service_request"] as const;
const FB_STATUS = ["open", "in_progress", "resolved", "closed"] as const;

async function scopedAccount(q: Queryable, actor: Actor, id: number) {
  return loadOwned<{ id: number; owner_id: number | null; name: string }>(q, actor, "sales_accounts", id, "Account");
}

export const retentionRoutes: Route[] = [
  // ───── health
  {
    method: "GET", path: "/retention/overview", permission: "retention:read", tx: false,
    async handler({ q, actor, now, settings }) {
      const accounts = (await q.query<{ id: number; name: string; owner_id: number | null }>(`SELECT a.id, a.name, a.owner_id FROM sales_accounts a WHERE ${scopeSql(actor, "a.owner_id")} AND a.archived_at IS NULL AND a.status IN ('active','inactive') ORDER BY a.updated_at DESC LIMIT 500`)).rows;
      const bands: Record<string, number> = { healthy: 0, watch: 0, at_risk: 0, churned: 0, unknown: 0 };
      const atRisk: unknown[] = [];
      for (const a of accounts) {
        const h = await accountHealth(q, a.id, settings.retention, now);
        bands[h.band] = (bands[h.band] ?? 0) + 1;
        if (h.band === "at_risk") atRisk.push({ account_id: a.id, name: a.name, score: h.score, reasons: h.reasons });
      }
      const complaints = (await q.query<{ n: number }>(`SELECT count(*)::int n FROM sales_feedback f JOIN sales_accounts a ON a.id = f.account_id WHERE ${scopeSql(actor, "a.owner_id")} AND f.kind = 'complaint' AND f.status IN ('open','in_progress')`)).rows[0]!.n;
      const renewals = (await q.query<{ n: number; amount: string }>(`SELECT count(*)::int n, COALESCE(sum(r.expected_amount),0)::numeric(18,2)::text amount FROM sales_renewals r JOIN sales_accounts a ON a.id = r.account_id WHERE ${scopeSql(actor, "a.owner_id")} AND r.status = 'upcoming' AND r.renewal_on <= ($1::timestamptz AT TIME ZONE $2)::date + 90`, [now.toISOString(), settings.business.timezone])).rows[0]!;
      return { bands, assessed: accounts.length, capped: accounts.length >= 500, atRisk, openComplaints: complaints, renewalsNext90Days: renewals, note: "Health is rated only from recorded orders, complaints and activities; accounts without that history show as 'unknown' rather than guessed." };
    },
  },
  {
    method: "GET", path: "/accounts/:id/health", permission: "retention:read", tx: false,
    async handler({ q, actor, params, now, settings }) {
      const id = parse(v.id(), params.id);
      await scopedAccount(q, actor, id);
      return accountHealth(q, id, settings.retention, now);
    },
  },
  // ───── feedback & complaints
  {
    method: "GET", path: "/feedback", permission: "retention:read", tx: false,
    async handler({ q, actor, query }) {
      const pg = pageOf(query);
      const w = new Where().raw(scopeSql(actor, "a.owner_id"));
      if (str(query, "kind")) w.and("f.kind = ?", parse(v.enumOf(KINDS), str(query, "kind")));
      if (str(query, "status")) w.and("f.status = ?", parse(v.enumOf(FB_STATUS), str(query, "status")));
      if (str(query, "account_id")) w.and("f.account_id = ?", parse(v.id(), str(query, "account_id")));
      const total = (await q.query<{ n: number }>(`SELECT count(*)::int n FROM sales_feedback f JOIN sales_accounts a ON a.id = f.account_id WHERE ${w.sql}`, w.params)).rows[0]!.n;
      const items = (await q.query(`SELECT f.*, a.name AS account_name FROM sales_feedback f JOIN sales_accounts a ON a.id = f.account_id WHERE ${w.sql} ORDER BY f.created_at DESC LIMIT $${w.next()} OFFSET $${w.next() + 1}`, [...w.params, pg.pageSize, pg.offset])).rows;
      return { items, total, page: pg.page, pageSize: pg.pageSize };
    },
  },
  {
    method: "POST", path: "/feedback", permission: "retention:write", idempotent: true,
    async handler({ q, actor, body, requestId }) {
      const b = parse(v.object({ account_id: v.id(), contact_id: v.optional(v.id()), kind: v.enumOf(KINDS), rating: v.optional(v.int({ min: 1, max: 10 })), subject: v.string({ min: 2, max: 200 }), body: v.optional(v.string({ max: 4000, raw: true })) }), body);
      const acc = await scopedAccount(q, actor, b.account_id);
      if (b.contact_id) {
        const c = await q.query("SELECT 1 FROM sales_contacts WHERE id = $1 AND account_id = $2", [b.contact_id, b.account_id]);
        if (!c.rows[0]) throw badRequest("The contact does not belong to this account");
      }
      if (b.kind === "survey" && b.rating === undefined) throw badRequest("A survey response needs a rating");
      const r = await q.query<{ id: number }>("INSERT INTO sales_feedback (account_id, contact_id, kind, rating, subject, body, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id", [b.account_id, b.contact_id ?? null, b.kind, b.rating ?? null, b.subject, b.body ?? null, actor.label]);
      await audit(q, actor, { action: "feedback.create", entityType: "feedback", entityId: r.rows[0]!.id, summary: `${b.kind} recorded for ${acc.name}` }, requestId);
      if (b.kind === "complaint" && acc.owner_id && acc.owner_id !== actor.memberId) {
        await notify(q, acc.owner_id, { kind: "complaint", title: `New complaint: ${acc.name}`, body: b.subject, link: `/sales/retention?account=${b.account_id}`, severity: "warning", dedupeKey: `complaint:${r.rows[0]!.id}` });
      }
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "PATCH", path: "/feedback/:id", permission: "retention:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ status: v.optional(v.enumOf(FB_STATUS)), resolution: v.optional(v.string({ max: 4000, raw: true })) }), body);
      const row = (await q.query<any>("SELECT f.*, a.owner_id FROM sales_feedback f JOIN sales_accounts a ON a.id = f.account_id WHERE f.id = $1 FOR UPDATE OF f", [id])).rows[0];
      if (!row) throw notFound("Feedback");
      await scopedAccount(q, actor, row.account_id);
      const status = b.status ?? row.status;
      if ((status === "resolved" || status === "closed") && !(b.resolution ?? row.resolution)) throw badRequest("Add a resolution before resolving or closing");
      await q.query("UPDATE sales_feedback SET status = $2, resolution = COALESCE($3, resolution), resolved_at = CASE WHEN $2 IN ('resolved','closed') THEN COALESCE(resolved_at, now()) ELSE NULL END, updated_at = now() WHERE id = $1", [id, status, b.resolution ?? null]);
      await audit(q, actor, { action: "feedback.update", entityType: "feedback", entityId: id, summary: `Feedback ${row.status} → ${status}` }, requestId);
      return { ok: true, status };
    },
  },
  // ───── referrals
  {
    method: "GET", path: "/referrals", permission: "retention:read", tx: false,
    async handler({ q, actor }) {
      const items = (await q.query(`SELECT r.*, a.name AS referrer_name, l.first_name AS lead_first_name, l.last_name AS lead_last_name FROM sales_referrals r JOIN sales_accounts a ON a.id = r.referrer_account_id LEFT JOIN sales_leads l ON l.id = r.lead_id WHERE ${scopeSql(actor, "a.owner_id")} ORDER BY r.created_at DESC LIMIT 200`)).rows;
      return { items };
    },
  },
  {
    method: "POST", path: "/referrals", permission: "retention:write", idempotent: true,
    async handler({ q, actor, body, requestId }) {
      const b = parse(v.object({ referrer_account_id: v.id(), lead_id: v.optional(v.id()), referred_account_id: v.optional(v.id()), notes: v.optional(v.string({ max: 2000, raw: true })) }), body);
      await scopedAccount(q, actor, b.referrer_account_id);
      if (b.referred_account_id === b.referrer_account_id) throw badRequest("An account cannot refer itself");
      const r = await q.query<{ id: number }>("INSERT INTO sales_referrals (referrer_account_id, lead_id, referred_account_id, notes) VALUES ($1,$2,$3,$4) RETURNING id", [b.referrer_account_id, b.lead_id ?? null, b.referred_account_id ?? null, b.notes ?? null]);
      await audit(q, actor, { action: "referral.create", entityType: "referral", entityId: r.rows[0]!.id, summary: "Referral recorded" }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "PATCH", path: "/referrals/:id", permission: "retention:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ status: v.enumOf(["received", "qualified", "won", "lost"] as const), notes: v.optional(v.string({ max: 2000, raw: true })) }), body);
      const row = (await q.query<any>("SELECT referrer_account_id FROM sales_referrals WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!row) throw notFound("Referral");
      await scopedAccount(q, actor, row.referrer_account_id);
      await q.query("UPDATE sales_referrals SET status = $2, notes = COALESCE($3, notes), updated_at = now() WHERE id = $1", [id, b.status, b.notes ?? null]);
      await audit(q, actor, { action: "referral.update", entityType: "referral", entityId: id, summary: `Referral → ${b.status}` }, requestId);
      return { ok: true };
    },
  },
  // ───── account plans
  {
    method: "GET", path: "/account-plans", permission: "retention:read", tx: false,
    async handler({ q, actor, query }) {
      const w = new Where().raw(scopeSql(actor, "a.owner_id"));
      if (str(query, "account_id")) w.and("p.account_id = ?", parse(v.id(), str(query, "account_id")));
      if (str(query, "status")) w.and("p.status = ?", parse(v.enumOf(["draft", "active", "completed", "archived"] as const), str(query, "status")));
      return { items: (await q.query(`SELECT p.*, a.name AS account_name FROM sales_account_plans p JOIN sales_accounts a ON a.id = p.account_id WHERE ${w.sql} ORDER BY p.review_on NULLS LAST, p.id DESC LIMIT 200`, w.params)).rows };
    },
  },
  {
    method: "POST", path: "/account-plans", permission: "retention:write", idempotent: true,
    async handler({ q, actor, body, requestId }) {
      const b = parse(planBody, body);
      const acc = await scopedAccount(q, actor, b.account_id as number);
      const r = await q.query<{ id: number }>("INSERT INTO sales_account_plans (account_id, title, objectives, stakeholders, growth_opportunities, risks, actions, review_on, owner_id, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id", [b.account_id, b.title, b.objectives ?? null, b.stakeholders ?? null, b.growth_opportunities ?? null, b.risks ?? null, b.actions ?? null, b.review_on ?? null, b.owner_id ?? actor.memberId ?? acc.owner_id, b.status]);
      await audit(q, actor, { action: "account_plan.create", entityType: "account_plan", entityId: r.rows[0]!.id, summary: `Account plan "${b.title}" for ${acc.name}` }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "PATCH", path: "/account-plans/:id", permission: "retention:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object(Object.fromEntries(Object.entries(planFields).map(([k, s]) => [k, v.optional(s as any)])) as any), body) as Record<string, unknown>;
      delete b.account_id;
      const row = (await q.query<any>("SELECT account_id FROM sales_account_plans WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!row) throw notFound("Account plan");
      await scopedAccount(q, actor, row.account_id);
      const upd = buildUpdate(b, { title: "title", objectives: "objectives", stakeholders: "stakeholders", growth_opportunities: "growth_opportunities", risks: "risks", actions: "actions", review_on: "review_on", owner_id: "owner_id", status: "status" });
      if (!upd) return { ok: true };
      await q.query(`UPDATE sales_account_plans SET ${upd.set}, updated_at = now() WHERE id = $1`, [id, ...upd.params]);
      await audit(q, actor, { action: "account_plan.update", entityType: "account_plan", entityId: id, summary: "Account plan updated" }, requestId);
      return { ok: true };
    },
  },
  // ───── renewals
  {
    method: "GET", path: "/renewals", permission: "retention:read", tx: false,
    async handler({ q, actor, query, now, settings }) {
      const w = new Where().raw(scopeSql(actor, "a.owner_id"));
      w.and("r.status = ?", parse(v.enumOf(["upcoming", "renewed", "lost", "cancelled"] as const), str(query, "status") ?? "upcoming"));
      const today = businessDate(now, settings.business.timezone);
      const items = (await q.query(`SELECT r.*, a.name AS account_name, (r.renewal_on - $${w.next()}::date)::int AS days_until FROM sales_renewals r JOIN sales_accounts a ON a.id = r.account_id WHERE ${w.sql} ORDER BY r.renewal_on LIMIT 300`, [...w.params, today])).rows;
      return { items, today };
    },
  },
  {
    method: "POST", path: "/renewals", permission: "retention:write", idempotent: true,
    async handler({ q, actor, body, requestId }) {
      const b = parse(v.object({ account_id: v.id(), product_id: v.optional(v.id()), description: v.string({ min: 2, max: 200 }), renewal_on: v.date(), expected_amount: v.optional(v.money({ min: "0" })) }), body);
      const acc = await scopedAccount(q, actor, b.account_id);
      const r = await q.query<{ id: number }>("INSERT INTO sales_renewals (account_id, product_id, description, renewal_on, expected_amount, owner_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [b.account_id, b.product_id ?? null, b.description, b.renewal_on, b.expected_amount ?? null, acc.owner_id ?? actor.memberId]);
      await audit(q, actor, { action: "renewal.create", entityType: "renewal", entityId: r.rows[0]!.id, summary: `Renewal tracked for ${acc.name} on ${b.renewal_on}` }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "POST", path: "/renewals/:id/resolve", permission: "retention:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ outcome: v.enumOf(["renewed", "lost", "cancelled"] as const) }), body);
      const row = (await q.query<any>("SELECT * FROM sales_renewals WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!row) throw notFound("Renewal");
      await scopedAccount(q, actor, row.account_id);
      if (row.status !== "upcoming") throw conflict(`Renewal is already ${row.status}`, "already_resolved");
      await q.query("UPDATE sales_renewals SET status = $2, updated_at = now() WHERE id = $1", [id, b.outcome]);
      await audit(q, actor, { action: `renewal.${b.outcome}`, entityType: "renewal", entityId: id, summary: `Renewal marked ${b.outcome}. This records the outcome only; it does not create an order or invoice.` }, requestId);
      return { ok: true, status: b.outcome, note: "Outcome recorded only. Create an order to record the renewed revenue." };
    },
  },
];

const planFields = {
  account_id: v.id(), title: v.string({ min: 2, max: 200 }), objectives: v.string({ max: 4000, raw: true }), stakeholders: v.string({ max: 4000, raw: true }),
  growth_opportunities: v.string({ max: 4000, raw: true }), risks: v.string({ max: 4000, raw: true }), actions: v.string({ max: 4000, raw: true }), review_on: v.date(), owner_id: v.id(),
  status: v.enumOf(["draft", "active", "completed", "archived"] as const),
};
const planBody = v.object({
  account_id: planFields.account_id, title: planFields.title, objectives: v.optional(planFields.objectives), stakeholders: v.optional(planFields.stakeholders), growth_opportunities: v.optional(planFields.growth_opportunities),
  risks: v.optional(planFields.risks), actions: v.optional(planFields.actions), review_on: v.optional(planFields.review_on), owner_id: v.optional(planFields.owner_id), status: v.withDefault(planFields.status, "active"),
});
void can; void d10;
