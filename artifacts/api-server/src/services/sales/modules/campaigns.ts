import { v, parse } from "../core/validate";
import { created, noContent, type Route } from "../core/router";
import { notFound, conflict, badRequest } from "../core/errors";
import { audit } from "../core/audit";
import { pageOf, str, d10 } from "../core/http";
import { add, allocate, ratioPercent, sub } from "../core/money";
import { Where, loadOwned, buildUpdate } from "./common";
import { enqueue } from "../integrations/outbox";
import { ownerScopeSql } from "../core/rbac";
import type { Queryable } from "../core/types";
import type { SalesSettings } from "../core/settings";

const STATUS = ["planned", "active", "paused", "completed", "cancelled"] as const;
const CHANNELS = ["email", "whatsapp", "social", "event", "webinar", "referral", "paid_ads", "content", "partner", "other"] as const;
const fields = {
  name: v.string({ min: 2, max: 120 }), objective: v.string({ max: 1000, raw: true }), channel: v.enumOf(CHANNELS), status: v.enumOf(STATUS),
  budget: v.money({ min: "0" }), spend: v.money({ min: "0" }), starts_on: v.date(), ends_on: v.date(), target_segment: v.string({ max: 300 }), utm_campaign: v.string({ min: 2, max: 80, pattern: /^[A-Za-z0-9_.-]+$/, patternMessage: "Use letters, digits, dot, dash or underscore" }),
  owner_id: v.id(),
};
const colMap = { name: "name", objective: "objective", channel: "channel", status: "status", budget: "budget", spend: "spend", starts_on: "starts_on", ends_on: "ends_on", target_segment: "target_segment", utm_campaign: "utm_campaign", owner_id: "owner_id" };
const createBody = v.object({
  name: fields.name, objective: v.optional(fields.objective), channel: v.withDefault(fields.channel, "other"), budget: v.optional(fields.budget), spend: v.optional(fields.spend), starts_on: v.optional(fields.starts_on),
  ends_on: v.optional(fields.ends_on), target_segment: v.optional(fields.target_segment), utm_campaign: v.optional(fields.utm_campaign), owner_id: v.optional(fields.owner_id),
});
const patchBody = v.object({ name: v.optional(fields.name), objective: v.optional(v.nullable(fields.objective)), channel: v.optional(fields.channel), status: v.optional(fields.status), budget: v.optional(v.nullable(fields.budget)), spend: v.optional(v.nullable(fields.spend)), starts_on: v.optional(v.nullable(fields.starts_on)), ends_on: v.optional(v.nullable(fields.ends_on)), target_segment: v.optional(v.nullable(fields.target_segment)), utm_campaign: v.optional(v.nullable(fields.utm_campaign)), owner_id: v.optional(v.nullable(fields.owner_id)) });

const TRANSITIONS: Record<string, string[]> = { planned: ["active", "cancelled"], active: ["paused", "completed", "cancelled"], paused: ["active", "completed", "cancelled"], completed: [], cancelled: [] };

interface Touch { campaign_id: number; at: string }
/** Split `amount` across touches by model. Returns campaignId → share. No touches → null (reported as unattributed, never guessed). */
export function attribute(amount: string, touches: Touch[], model: SalesSettings["attribution"]["model"]): Map<number, string> | null {
  if (!touches.length) return null;
  const sorted = [...touches].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const out = new Map<number, string>();
  if (model === "first_touch") out.set(sorted[0]!.campaign_id, amount);
  else if (model === "last_touch") out.set(sorted[sorted.length - 1]!.campaign_id, amount);
  else {
    const ids = [...new Set(sorted.map((t) => t.campaign_id))];
    const parts = allocate(amount, ids.map(() => 1));
    ids.forEach((id, i) => out.set(id, parts[i]!));
  }
  return out;
}

export async function campaignAttribution(q: Queryable, settings: SalesSettings, range: { from: string; to: string }, onlyCampaign?: number) {
  const win = settings.attribution.windowDays;
  const cur = settings.business.currency;
  const won = (await q.query<{ id: number; amount: string; closed_at: string; lead_id: number | null; account_id: number; campaign_id: number | null }>(
    "SELECT id, amount::text, closed_at, lead_id, account_id, campaign_id FROM sales_opportunities WHERE status = 'won' AND currency = $3 AND closed_at >= $1 AND closed_at < $2", [range.from, range.to, cur])).rows;
  const byCampaign = new Map<number, string>();
  let unattributed = "0.00", unattributedDeals = 0;
  for (const o of won) {
    const closed = new Date(o.closed_at).toISOString();
    const touches = (await q.query<Touch>(
      `SELECT campaign_id, at FROM sales_touches WHERE (lead_id = $1 OR account_id = $2) AND at <= $3::timestamptz AND at >= $3::timestamptz - ($4 || ' days')::interval`, [o.lead_id, o.account_id, closed, String(win)])).rows;
    if (o.campaign_id) touches.push({ campaign_id: o.campaign_id, at: closed });
    const shares = attribute(o.amount, touches, settings.attribution.model);
    if (!shares) { unattributed = add(unattributed, o.amount); unattributedDeals++; continue; }
    for (const [cid, amt] of shares) byCampaign.set(cid, add(byCampaign.get(cid) ?? "0.00", amt));
  }
  const rows = [...byCampaign.entries()].filter(([id]) => !onlyCampaign || id === onlyCampaign).map(([campaign_id, revenue]) => ({ campaign_id, revenue }));
  return { model: settings.attribution.model, windowDays: win, rows, unattributed, unattributedDeals, dealsConsidered: won.length, note: "Attribution uses only recorded touches and campaign links within the window. Deals with none are reported as unattributed." };
}

export const campaignRoutes: Route[] = [
  {
    method: "GET", path: "/campaigns", permission: "campaigns:read", tx: false,
    async handler({ q, query }) {
      const pg = pageOf(query);
      const w = new Where().raw("c.archived_at IS NULL");
      if (str(query, "status")) w.and("c.status = ?", parse(v.enumOf(STATUS), str(query, "status")));
      if (str(query, "channel")) w.and("c.channel = ?", parse(v.enumOf(CHANNELS), str(query, "channel")));
      w.search(str(query, "q"), ["c.name", "c.utm_campaign"]);
      const total = (await q.query<{ n: number }>(`SELECT count(*)::int n FROM sales_campaigns c WHERE ${w.sql}`, w.params)).rows[0]!.n;
      const items = (await q.query(
        `SELECT c.*, m.display_name AS owner_name,
           (SELECT count(*)::int FROM sales_campaign_members x WHERE x.campaign_id = c.id) AS members,
           (SELECT count(*)::int FROM sales_leads l WHERE l.campaign_id = c.id AND l.merged_into_id IS NULL) AS leads,
           (SELECT count(*)::int FROM sales_opportunities o WHERE o.campaign_id = c.id) AS opportunities
         FROM sales_campaigns c LEFT JOIN sales_members m ON m.id = c.owner_id WHERE ${w.sql} ORDER BY c.created_at DESC LIMIT $${w.next()} OFFSET $${w.next() + 1}`, [...w.params, pg.pageSize, pg.offset])).rows;
      return { items, total, page: pg.page, pageSize: pg.pageSize };
    },
  },
  {
    method: "POST", path: "/campaigns", permission: "campaigns:write", idempotent: true,
    async handler({ q, actor, body, settings, requestId }) {
      const b = parse(createBody, body);
      if (b.starts_on && b.ends_on && b.ends_on < b.starts_on) throw badRequest("The end date is before the start date");
      const r = await q.query<{ id: number }>("INSERT INTO sales_campaigns (name, objective, channel, budget, spend, currency, starts_on, ends_on, target_segment, utm_campaign, owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id",
        [b.name, b.objective ?? null, b.channel, b.budget ?? null, b.spend ?? null, settings.business.currency, b.starts_on ?? null, b.ends_on ?? null, b.target_segment ?? null, b.utm_campaign ?? null, b.owner_id ?? actor.memberId]);
      await audit(q, actor, { action: "campaign.create", entityType: "campaign", entityId: r.rows[0]!.id, summary: `Created campaign ${b.name}` }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "GET", path: "/campaigns/attribution", permission: "campaigns:read", tx: false,
    async handler({ q, query, now, settings }) {
      const from = str(query, "from") ? parse(v.date(), str(query, "from")) : d10(new Date(now.getTime() - 90 * 86_400_000))!;
      const to = str(query, "to") ? parse(v.date(), str(query, "to")) : d10(now)!;
      const a = await campaignAttribution(q, settings, { from: `${from}T00:00:00Z`, to: new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString() });
      const names = (await q.query<{ id: number; name: string; spend: string | null }>("SELECT id, name, spend::text FROM sales_campaigns")).rows;
      return { ...a, rows: a.rows.map((r) => { const c = names.find((n) => n.id === r.campaign_id); return { ...r, name: c?.name ?? "(deleted)", spend: c?.spend ?? null, roiPercent: c?.spend && c.spend !== "0.00" && c.spend !== "0" ? ratioPercent(sub(r.revenue, c.spend), c.spend) : null }; }) };
    },
  },
  {
    method: "GET", path: "/campaigns/:id", permission: "campaigns:read", tx: false,
    async handler({ q, params, now, settings }) {
      const id = parse(v.id(), params.id);
      const c = (await q.query<any>("SELECT c.*, m.display_name AS owner_name FROM sales_campaigns c LEFT JOIN sales_members m ON m.id = c.owner_id WHERE c.id = $1", [id])).rows[0];
      if (!c) throw notFound("Campaign");
      const stats = (await q.query<any>(`SELECT count(*)::int members, count(*) FILTER (WHERE status = 'sent')::int sent, count(*) FILTER (WHERE status = 'responded')::int responded, count(*) FILTER (WHERE status = 'converted')::int converted, count(*) FILTER (WHERE status = 'unsubscribed')::int unsubscribed FROM sales_campaign_members WHERE campaign_id = $1`, [id])).rows[0];
      const funnel = (await q.query<any>(`SELECT (SELECT count(*)::int FROM sales_leads WHERE campaign_id = $1 AND merged_into_id IS NULL) leads, (SELECT count(*)::int FROM sales_opportunities WHERE campaign_id = $1) opportunities, (SELECT count(*)::int FROM sales_opportunities WHERE campaign_id = $1 AND status = 'won') won, (SELECT COALESCE(sum(amount),0)::numeric(18,2)::text FROM sales_opportunities WHERE campaign_id = $1 AND status = 'won') won_amount`, [id])).rows[0];
      const attr = await campaignAttribution(q, settings, { from: "1970-01-01T00:00:00Z", to: new Date(now.getTime() + 86_400_000).toISOString() }, id);
      const revenue = attr.rows[0]?.revenue ?? "0.00";
      const spend = c.spend as string | null;
      return { campaign: c, stats, funnel, attributedRevenue: revenue, attributionModel: attr.model, spend, costPerLead: spend && funnel.leads ? String(Math.round((Number(spend) / funnel.leads) * 100) / 100) : null, roiPercent: spend && Number(spend) > 0 ? ratioPercent(sub(revenue, spend), spend) : null, note: spend ? undefined : "Spend has not been entered, so cost and ROI cannot be stated." };
    },
  },
  {
    method: "PATCH", path: "/campaigns/:id", permission: "campaigns:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(patchBody, body) as Record<string, unknown>;
      const cur = (await q.query<any>("SELECT * FROM sales_campaigns WHERE id = $1 AND archived_at IS NULL FOR UPDATE", [id])).rows[0];
      if (!cur) throw notFound("Campaign");
      if (b.status && b.status !== cur.status && !(TRANSITIONS[cur.status] ?? []).includes(b.status as string)) throw conflict(`A ${cur.status} campaign cannot become ${b.status}`, "invalid_state");
      const s = (b.starts_on === undefined ? d10(cur.starts_on) : b.starts_on) as string | null;
      const e = (b.ends_on === undefined ? d10(cur.ends_on) : b.ends_on) as string | null;
      if (s && e && e < s) throw badRequest("The end date is before the start date");
      const upd = buildUpdate(b, colMap);
      if (!upd) return { ok: true };
      await q.query(`UPDATE sales_campaigns SET ${upd.set}, updated_at = now() WHERE id = $1`, [id, ...upd.params]);
      await audit(q, actor, { action: "campaign.update", entityType: "campaign", entityId: id, summary: `Updated campaign ${cur.name}`, after: b }, requestId);
      return { ok: true };
    },
  },
  {
    method: "DELETE", path: "/campaigns/:id", permission: "campaigns:write",
    async handler({ q, actor, params, requestId }) {
      const id = parse(v.id(), params.id);
      const r = await q.query("UPDATE sales_campaigns SET archived_at = now(), updated_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING name", [id]);
      if (!r.rows[0]) throw notFound("Campaign");
      await audit(q, actor, { action: "campaign.archive", entityType: "campaign", entityId: id, summary: "Archived campaign" }, requestId);
      return noContent();
    },
  },
  {
    method: "GET", path: "/campaigns/:id/members", permission: "campaigns:read", tx: false,
    async handler({ q, actor, params }) {
      const id = parse(v.id(), params.id);
      const items = (await q.query(
        `SELECT cm.id, cm.status, cm.added_at, cm.lead_id, cm.contact_id, cm.account_id, l.first_name, l.last_name, l.company AS lead_company, a.name AS account_name
         FROM sales_campaign_members cm LEFT JOIN sales_leads l ON l.id = cm.lead_id LEFT JOIN sales_accounts a ON a.id = cm.account_id
         WHERE cm.campaign_id = $1 AND (cm.lead_id IS NULL OR ${ownerScopeSql(actor, "l.owner_id")}) AND (cm.account_id IS NULL OR ${ownerScopeSql(actor, "a.owner_id")}) ORDER BY cm.added_at DESC LIMIT 500`, [id])).rows;
      return { items };
    },
  },
  {
    method: "POST", path: "/campaigns/:id/members", permission: "campaigns:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ lead_ids: v.withDefault(v.array(v.id(), { max: 500 }), []), account_ids: v.withDefault(v.array(v.id(), { max: 500 }), []) }), body);
      if (!b.lead_ids.length && !b.account_ids.length) throw badRequest("Provide lead_ids or account_ids");
      if (!(await q.query("SELECT 1 FROM sales_campaigns WHERE id = $1 AND archived_at IS NULL", [id])).rows[0]) throw notFound("Campaign");
      let added = 0;
      for (const lid of b.lead_ids) {
        const l = (await q.query(`SELECT 1 FROM sales_leads l WHERE l.id = $1 AND ${ownerScopeSql(actor, "l.owner_id")}`, [lid])).rows[0];
        if (!l) continue;
        added += (await q.query("INSERT INTO sales_campaign_members (campaign_id, lead_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id", [id, lid])).rows.length;
      }
      for (const aid of b.account_ids) {
        const a = (await q.query(`SELECT 1 FROM sales_accounts a WHERE a.id = $1 AND ${ownerScopeSql(actor, "a.owner_id")}`, [aid])).rows[0];
        if (!a) continue;
        if ((await q.query("SELECT 1 FROM sales_campaign_members WHERE campaign_id = $1 AND account_id = $2", [id, aid])).rows[0]) continue;
        await q.query("INSERT INTO sales_campaign_members (campaign_id, account_id) VALUES ($1,$2)", [id, aid]); added++;
      }
      await audit(q, actor, { action: "campaign.members_add", entityType: "campaign", entityId: id, summary: `Added ${added} member(s)` }, requestId);
      return { ok: true, added, skipped: b.lead_ids.length + b.account_ids.length - added };
    },
  },
  {
    method: "POST", path: "/campaigns/:id/touches", permission: "campaigns:write",
    async handler({ q, actor, params, body, now }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ lead_id: v.optional(v.id()), account_id: v.optional(v.id()), kind: v.withDefault(v.string({ min: 2, max: 40 }), "touch"), at: v.optional(v.timestamp()) }), body);
      if (!b.lead_id && !b.account_id) throw badRequest("A touch needs a lead or an account");
      if (!(await q.query("SELECT 1 FROM sales_campaigns WHERE id = $1", [id])).rows[0]) throw notFound("Campaign");
      if (b.lead_id) await loadOwned(q, actor, "sales_leads", b.lead_id, "Lead");
      if (b.account_id) await loadOwned(q, actor, "sales_accounts", b.account_id, "Account");
      const at = b.at ?? now.toISOString();
      if (Date.parse(at) > now.getTime() + 60_000) throw badRequest("A touch cannot be in the future");
      const r = await q.query<{ id: number }>("INSERT INTO sales_touches (campaign_id, lead_id, account_id, kind, at) VALUES ($1,$2,$3,$4,$5) RETURNING id", [id, b.lead_id ?? null, b.account_id ?? null, b.kind, at]);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "POST", path: "/campaigns/:id/send-email", permission: "campaigns:send", idempotent: true,
    async handler({ q, actor, params, body, settings, deps, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ subject: v.string({ min: 3, max: 150 }), message: v.string({ min: 3, max: 5000, raw: true }) }), body);
      if (!settings.integrations.email.enabled || !deps.integrations.email) throw conflict("Email is not connected. Connect an email provider in Sales Settings before sending campaign email.", "email_not_connected");
      const c = (await q.query<any>("SELECT * FROM sales_campaigns WHERE id = $1 AND archived_at IS NULL", [id])).rows[0];
      if (!c) throw notFound("Campaign");
      if (c.status !== "active") throw conflict("Only an active campaign can send email", "invalid_state");
      const rows = (await q.query<any>(`SELECT cm.id, l.email, l.consent_email, l.first_name FROM sales_campaign_members cm JOIN sales_leads l ON l.id = cm.lead_id WHERE cm.campaign_id = $1 AND cm.status = 'targeted' AND ${ownerScopeSql(actor, "l.owner_id")}`, [id])).rows;
      let queued = 0, skippedNoConsent = 0, skippedNoEmail = 0;
      for (const r of rows) {
        if (!r.consent_email) { skippedNoConsent++; continue; }
        if (!r.email) { skippedNoEmail++; continue; }
        const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
        await enqueue(q, { kind: "email.send", entityType: "campaign_member", entityId: r.id, idempotencyKey: `campaign-email:${id}:${r.id}`, payload: { message: { to: r.email, subject: b.subject, html: `<p>${esc(b.message).replace(/\n/g, "<br>")}</p>`, text: b.message } } });
        queued++;
      }
      await audit(q, actor, { action: "campaign.send_email", entityType: "campaign", entityId: id, summary: `Queued ${queued} email(s); skipped ${skippedNoConsent} without consent and ${skippedNoEmail} without an address` }, requestId);
      return { ok: true, queued, skippedNoConsent, skippedNoEmail, note: "Members show as 'sent' only after the email provider confirms delivery. Recipients without recorded consent are never emailed." };
    },
  },
  {
    method: "POST", path: "/campaigns/members/:memberId/status", permission: "campaigns:write",
    async handler({ q, params, body }) {
      const id = parse(v.id(), params.memberId);
      const b = parse(v.object({ status: v.enumOf(["responded", "converted", "unsubscribed"] as const) }), body);
      const r = await q.query("UPDATE sales_campaign_members SET status = $2 WHERE id = $1 RETURNING id", [id, b.status]);
      if (!r.rows[0]) throw notFound("Campaign member");
      return { ok: true };
    },
  },
];
