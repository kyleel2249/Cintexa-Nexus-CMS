import { randomUUID } from "../core/portable";
import { v, parse } from "../core/validate";
import { created, noContent, type Route, type DomainEvent } from "../core/router";
import { notFound, conflict, badRequest, validationFailed, forbidden } from "../core/errors";
import { audit } from "../core/audit";
import { can } from "../core/rbac";
import { pageOf, orderBy, str } from "../core/http";
import { Where, scopeSql, loadOwned } from "./common";
import { businessDate, startOfDayUtc } from "../core/time";
import type { Actor, Queryable } from "../core/types";

const TYPES = ["call", "email", "meeting", "visit", "demo", "task", "follow_up", "note", "comment", "event"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const recurrence = v.object({ freq: v.enumOf(["daily", "weekly", "monthly"] as const), interval: v.withDefault(v.int({ min: 1, max: 52 }), 1), until: v.optional(v.date()), count: v.optional(v.int({ min: 1, max: 200 })) });

const base = {
  type: v.enumOf(TYPES), subject: v.string({ min: 2, max: 200 }), description: v.optional(v.string({ max: 4000, raw: true })), owner_id: v.optional(v.id()),
  lead_id: v.optional(v.id()), account_id: v.optional(v.id()), contact_id: v.optional(v.id()), opportunity_id: v.optional(v.id()),
  start_at: v.optional(v.timestamp()), due_at: v.optional(v.timestamp()), duration_minutes: v.optional(v.int({ min: 0, max: 1440 })), priority: v.withDefault(v.enumOf(PRIORITIES), "medium"),
  recurrence: v.optional(recurrence), template_id: v.optional(v.id()),
};
const createBody = v.object(base);
const patchBody = v.object({
  subject: v.optional(v.string({ min: 2, max: 200 })), description: v.nullable(v.string({ max: 4000, raw: true })), start_at: v.nullable(v.timestamp()), due_at: v.nullable(v.timestamp()),
  duration_minutes: v.nullable(v.int({ min: 0, max: 1440 })), priority: v.optional(v.enumOf(PRIORITIES)), meeting_notes: v.nullable(v.string({ max: 8000, raw: true })),
});
const completeBody = v.object({ outcome: v.optional(v.string({ max: 500 })), meeting_notes: v.optional(v.string({ max: 8000, raw: true })), next: v.optional(v.object({ subject: v.string({ min: 2, max: 200 }), type: v.withDefault(v.enumOf(TYPES), "follow_up"), due_at: v.timestamp() })) });

/** Create (or silently skip, when the dedupe key exists) a notification. Returns whether a new row was created. */
export async function notify(q: Queryable, memberId: number, n: { kind: string; title: string; body?: string; link?: string; severity?: "info" | "warning" | "critical"; dedupeKey: string }): Promise<boolean> {
  const r = await q.query("INSERT INTO sales_notifications (member_id, kind, title, body, link, severity, dedupe_key) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (member_id, dedupe_key) DO NOTHING RETURNING id", [memberId, n.kind, n.title, n.body ?? null, n.link ?? null, n.severity ?? "info", n.dedupeKey]);
  return r.rows.length > 0;
}

export function nextOccurrence(from: Date, rec: { freq: "daily" | "weekly" | "monthly"; interval: number }): Date {
  const d = new Date(from.getTime());
  if (rec.freq === "daily") d.setUTCDate(d.getUTCDate() + rec.interval);
  else if (rec.freq === "weekly") d.setUTCDate(d.getUTCDate() + 7 * rec.interval);
  else {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + rec.interval);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last)); // Jan 31 + 1 month = Feb 28/29, never March 3
  }
  return d;
}

async function assertLinksVisible(q: Queryable, actor: Actor, b: { lead_id?: number; account_id?: number; contact_id?: number; opportunity_id?: number }): Promise<void> {
  if (b.lead_id) await loadOwned(q, actor, "sales_leads", b.lead_id, "Lead", { extraWhere: "archived_at IS NULL" }).catch((e) => { if (!(can(actor, "leads:assign") && e?.status === 404)) throw e; });
  if (b.account_id) await loadOwned(q, actor, "sales_accounts", b.account_id, "Account", { extraWhere: "archived_at IS NULL" });
  if (b.opportunity_id) await loadOwned(q, actor, "sales_opportunities", b.opportunity_id, "Opportunity", { extraWhere: "archived_at IS NULL" });
  if (b.contact_id) {
    const c = (await q.query<{ account_id: number | null }>("SELECT account_id FROM sales_contacts WHERE id = $1 AND archived_at IS NULL", [b.contact_id])).rows[0];
    if (!c) throw notFound("Contact");
    if (c.account_id) await loadOwned(q, actor, "sales_accounts", c.account_id, "Contact", {});
  }
}

const SELECT = `a.id, a.type, a.subject, a.description, a.status, a.priority, a.owner_id, m.display_name AS owner_name, a.lead_id, a.account_id, a.contact_id, a.opportunity_id, a.start_at, a.due_at, a.completed_at,
  a.duration_minutes, a.outcome, a.recurrence, a.series_id, a.created_at,
  (a.status = 'open' AND COALESCE(a.due_at, a.start_at) < now()) AS overdue,
  COALESCE(l.first_name || COALESCE(' ' || l.last_name, ''), ac.name, op.name) AS related_name`;
const FROM = `FROM sales_activities a LEFT JOIN sales_members m ON m.id = a.owner_id LEFT JOIN sales_leads l ON l.id = a.lead_id LEFT JOIN sales_accounts ac ON ac.id = a.account_id LEFT JOIN sales_opportunities op ON op.id = a.opportunity_id`;

function filters(actor: Actor, query: Record<string, string | string[] | undefined>): Where {
  const w = new Where().raw(scopeSql(actor, "a.owner_id"));
  w.search(str(query, "q"), ["a.subject", "a.description"]);
  if (str(query, "status")) w.and("a.status = ?", str(query, "status"));
  if (str(query, "type")) w.and("a.type = ?", str(query, "type"));
  if (str(query, "owner_id")) w.and("a.owner_id = ?", parse(v.id(), str(query, "owner_id")));
  for (const k of ["lead_id", "account_id", "opportunity_id", "contact_id"] as const) if (str(query, k)) w.and(`a.${k} = ?`, parse(v.id(), str(query, k)));
  if (str(query, "overdue") === "true") w.raw("a.status = 'open' AND COALESCE(a.due_at, a.start_at) < now()");
  if (str(query, "from")) w.and("COALESCE(a.due_at, a.start_at, a.created_at) >= ?::timestamptz", parse(v.timestamp(), str(query, "from")));
  if (str(query, "to")) w.and("COALESCE(a.due_at, a.start_at, a.created_at) < ?::timestamptz", parse(v.timestamp(), str(query, "to")));
  return w;
}

export const activityRoutes: Route[] = [
  {
    method: "GET", path: "/activities", permission: "activities:read",
    async handler({ q, actor, query }) {
      const w = filters(actor, query);
      const { page, pageSize, offset } = pageOf(query);
      const order = orderBy(query, { due: "COALESCE(a.due_at, a.start_at)", created: "a.created_at", priority: "a.priority" }, "due", "asc");
      const total = (await q.query<{ n: number }>(`SELECT count(*)::int n FROM sales_activities a WHERE ${w.sql}`, w.params)).rows[0]!.n;
      const r = await q.query(`SELECT ${SELECT} ${FROM} WHERE ${w.sql} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`, w.params);
      return { items: r.rows, total, page, pageSize };
    },
  },
  {
    method: "GET", path: "/activities/agenda", permission: "activities:read",
    async handler({ q, actor, now, settings }) {
      const tz = settings.business.timezone;
      const today = businessDate(now, tz);
      const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
      const startToday = startOfDayUtc(ty, tm, td, tz);
      const startTomorrow = new Date(startToday.getTime() + 86_400_000);
      const weekEnd = new Date(startToday.getTime() + 8 * 86_400_000);
      const mine = actor.memberId ? `a.owner_id = ${Number(actor.memberId)}` : "FALSE";
      const pick = async (cond: string, p: unknown[]) => (await q.query(`SELECT ${SELECT} ${FROM} WHERE a.status = 'open' AND ${mine} AND ${cond} ORDER BY COALESCE(a.due_at, a.start_at) LIMIT 100`, p)).rows;
      const overdue = await pick("COALESCE(a.due_at, a.start_at) < $1::timestamptz", [startToday.toISOString()]);
      const todays = await pick("COALESCE(a.due_at, a.start_at) >= $1::timestamptz AND COALESCE(a.due_at, a.start_at) < $2::timestamptz", [startToday.toISOString(), startTomorrow.toISOString()]);
      const upcoming = await pick("COALESCE(a.due_at, a.start_at) >= $1::timestamptz AND COALESCE(a.due_at, a.start_at) < $2::timestamp with time zone", [startTomorrow.toISOString(), weekEnd.toISOString()]);
      const undated = await pick("COALESCE(a.due_at, a.start_at) IS NULL", []);
      return { today, overdue, today_items: todays, upcoming, undated };
    },
  },
  {
    method: "GET", path: "/activities/calendar", permission: "activities:read",
    async handler({ q, actor, query }) {
      const from = parse(v.timestamp(), str(query, "from") ?? "");
      const to = parse(v.timestamp(), str(query, "to") ?? "");
      if (Date.parse(to) - Date.parse(from) > 100 * 86_400_000) throw badRequest("Choose a range of at most 100 days");
      const w = filters(actor, { ...query, from, to });
      w.raw("a.status <> 'cancelled'");
      const r = await q.query(`SELECT ${SELECT} ${FROM} WHERE ${w.sql} ORDER BY COALESCE(a.start_at, a.due_at) LIMIT 1000`, w.params);
      return { items: r.rows };
    },
  },
  {
    method: "GET", path: "/activity-templates", permission: "activities:read", tx: false,
    async handler({ q }) {
      return { items: (await q.query("SELECT id, name, type, subject, description, default_due_days, priority FROM sales_activity_templates WHERE archived_at IS NULL ORDER BY name")).rows };
    },
  },
  {
    method: "POST", path: "/activity-templates", permission: "activities:write",
    async handler({ q, actor, body, requestId }) {
      if (!can(actor, "playbook:write")) throw forbidden("Only managers can manage activity templates");
      const b = parse(v.object({ name: v.string({ min: 2, max: 80 }), type: v.enumOf(TYPES), subject: v.string({ min: 2, max: 200 }), description: v.optional(v.string({ max: 2000 })), default_due_days: v.withDefault(v.int({ min: 0, max: 365 }), 1), priority: v.withDefault(v.enumOf(PRIORITIES), "medium") }), body);
      const r = await q.query<{ id: number }>("INSERT INTO sales_activity_templates (name, type, subject, description, default_due_days, priority) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [b.name, b.type, b.subject, b.description ?? null, b.default_due_days, b.priority]);
      await audit(q, actor, { action: "activity_template.create", entityType: "activity_template", entityId: r.rows[0]!.id, summary: `Created template ${b.name}` }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "DELETE", path: "/activity-templates/:id", permission: "activities:write",
    async handler({ q, actor, params, requestId }) {
      if (!can(actor, "playbook:write")) throw forbidden("Only managers can manage activity templates");
      const id = parse(v.id(), params.id);
      const r = await q.query("UPDATE sales_activity_templates SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id", [id]);
      if (!r.rows[0]) throw notFound("Template");
      await audit(q, actor, { action: "activity_template.archive", entityType: "activity_template", entityId: id, summary: "Archived template" }, requestId);
      return noContent();
    },
  },
  {
    method: "POST", path: "/activities", permission: "activities:write", idempotent: true,
    async handler({ q, actor, body, now, requestId }) {
      let b = parse(createBody, body);
      if (b.template_id) {
        const t = (await q.query<any>("SELECT * FROM sales_activity_templates WHERE id = $1 AND archived_at IS NULL", [b.template_id])).rows[0];
        if (!t) throw notFound("Template");
        b = { ...b, type: b.type ?? t.type, subject: b.subject || t.subject, description: b.description ?? t.description, priority: b.priority ?? t.priority, due_at: b.due_at ?? new Date(now.getTime() + t.default_due_days * 86_400_000).toISOString() };
      }
      if (!b.lead_id && !b.account_id && !b.opportunity_id && !b.contact_id && b.type !== "task" && b.type !== "event") throw validationFailed([{ path: "account_id", message: "Link the activity to a lead, account, contact or opportunity" }]);
      if (b.start_at && b.due_at && Date.parse(b.due_at) < Date.parse(b.start_at)) throw validationFailed([{ path: "due_at", message: "The due time cannot be before the start time" }]);
      if (b.recurrence && !b.due_at && !b.start_at) throw validationFailed([{ path: "recurrence", message: "A recurring activity needs a due or start time" }]);
      const owner = b.owner_id ?? actor.memberId;
      if (b.owner_id && b.owner_id !== actor.memberId && actor.role === "sales_rep") throw forbidden("You cannot assign activities to other people");
      if (!owner) throw badRequest("An owner is required");
      if (!(await q.query("SELECT 1 FROM sales_members WHERE id = $1 AND active", [owner])).rows[0]) throw badRequest("The owner is not an active sales member");
      await assertLinksVisible(q, actor, b);
      const seriesId = b.recurrence ? randomUUID() : null;
      const r = await q.query<{ id: number }>(
        `INSERT INTO sales_activities (type, subject, description, owner_id, lead_id, account_id, contact_id, opportunity_id, start_at, due_at, duration_minutes, priority, recurrence, series_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text::jsonb,$14,$15) RETURNING id`,
        [b.type, b.subject, b.description ?? null, owner, b.lead_id ?? null, b.account_id ?? null, b.contact_id ?? null, b.opportunity_id ?? null, b.start_at ?? null, b.due_at ?? null, b.duration_minutes ?? null, b.priority, b.recurrence ? JSON.stringify(b.recurrence) : null, seriesId, actor.label],
      );
      await audit(q, actor, { action: "activity.create", entityType: "activity", entityId: r.rows[0]!.id, summary: `Created ${b.type}: ${b.subject}` }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "PATCH", path: "/activities/:id", permission: "activities:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const cur = await loadOwned<any>(q, actor, "sales_activities", id, "Activity", { forUpdate: true });
      if (cur.status !== "open") throw conflict(`This activity is ${cur.status} and can no longer be edited`, "activity_closed");
      const b = parse(patchBody, body);
      const sets: string[] = [];
      const p: unknown[] = [id];
      for (const k of ["subject", "description", "start_at", "due_at", "duration_minutes", "priority", "meeting_notes"] as const) if ((b as any)[k] !== undefined) { p.push((b as any)[k]); sets.push(`${k} = $${p.length}`); }
      if (!sets.length) return { ok: true };
      await q.query(`UPDATE sales_activities SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, p);
      await audit(q, actor, { action: "activity.update", entityType: "activity", entityId: id, summary: `Updated activity ${cur.subject}`, after: b }, requestId);
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/activities/:id/complete", permission: "activities:write", idempotent: true,
    async handler({ q, actor, params, body, now, requestId, events }) {
      const id = parse(v.id(), params.id);
      const b = parse(completeBody, body ?? {});
      const cur = await loadOwned<any>(q, actor, "sales_activities", id, "Activity", { forUpdate: true });
      if (cur.status === "done") return { ok: true, alreadyDone: true };
      if (cur.status !== "open") throw conflict(`This activity is ${cur.status}`, "activity_closed");
      await q.query("UPDATE sales_activities SET status = 'done', completed_at = $2, outcome = COALESCE($3, outcome), meeting_notes = COALESCE($4, meeting_notes), updated_at = now() WHERE id = $1", [id, now.toISOString(), b.outcome ?? null, b.meeting_notes ?? null]);
      // an engagement keeps the related records "warm" for stalled/stale detection
      if (cur.opportunity_id) await q.query("UPDATE sales_opportunities SET last_activity_at = $2 WHERE id = $1", [cur.opportunity_id, now.toISOString()]);
      if (cur.lead_id) await q.query("UPDATE sales_leads SET last_contact_at = $2, first_response_at = COALESCE(first_response_at, CASE WHEN $3 THEN $2::timestamptz END), updated_at = now() WHERE id = $1", [cur.lead_id, now.toISOString(), ["call", "email", "meeting", "visit", "demo"].includes(cur.type)]);
      let nextId: number | null = null;
      if (b.next) {
        const n = await q.query<{ id: number }>("INSERT INTO sales_activities (type, subject, owner_id, lead_id, account_id, contact_id, opportunity_id, due_at, priority, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id", [b.next.type, b.next.subject, cur.owner_id, cur.lead_id, cur.account_id, cur.contact_id, cur.opportunity_id, b.next.due_at, cur.priority, actor.label]);
        nextId = n.rows[0]!.id;
      }
      let recurId: number | null = null;
      if (cur.recurrence && (cur.due_at || cur.start_at)) {
        const rec = cur.recurrence as { freq: "daily" | "weekly" | "monthly"; interval: number; until?: string; count?: number };
        const anchor = new Date(cur.due_at ?? cur.start_at);
        const nextDue = nextOccurrence(anchor, rec);
        const done = (await q.query<{ n: number }>("SELECT count(*)::int n FROM sales_activities WHERE series_id = $1", [cur.series_id])).rows[0]!.n;
        const withinUntil = !rec.until || nextDue.toISOString().slice(0, 10) <= rec.until;
        const withinCount = !rec.count || done < rec.count;
        if (withinUntil && withinCount) {
          const r = await q.query<{ id: number }>(
            `INSERT INTO sales_activities (type, subject, description, owner_id, lead_id, account_id, contact_id, opportunity_id, start_at, due_at, duration_minutes, priority, recurrence, series_id, dedupe_key, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text::jsonb,$14,$15,'system') ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING id`,
            [cur.type, cur.subject, cur.description, cur.owner_id, cur.lead_id, cur.account_id, cur.contact_id, cur.opportunity_id, cur.start_at ? nextOccurrence(new Date(cur.start_at), rec).toISOString() : null, cur.due_at ? nextDue.toISOString() : null, cur.duration_minutes, cur.priority, JSON.stringify(rec), cur.series_id, `recur:${id}`],
          );
          recurId = r.rows[0]?.id ?? null;
        }
      }
      await audit(q, actor, { action: "activity.complete", entityType: "activity", entityId: id, summary: `Completed ${cur.type}: ${cur.subject}`, after: { outcome: b.outcome } }, requestId);
      events.push({ type: "activity.completed", entityType: "activity", entityId: id } as DomainEvent);
      return { ok: true, nextActivityId: nextId, recurringActivityId: recurId };
    },
  },
  {
    method: "POST", path: "/activities/:id/snooze", permission: "activities:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ due_at: v.timestamp() }), body);
      const cur = await loadOwned<any>(q, actor, "sales_activities", id, "Activity", { forUpdate: true });
      if (cur.status !== "open") throw conflict(`This activity is ${cur.status}`, "activity_closed");
      await q.query("UPDATE sales_activities SET due_at = $2, updated_at = now() WHERE id = $1", [id, b.due_at]);
      await audit(q, actor, { action: "activity.reschedule", entityType: "activity", entityId: id, summary: `Rescheduled to ${b.due_at}` }, requestId);
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/activities/:id/cancel", permission: "activities:write",
    async handler({ q, actor, params, requestId }) {
      const id = parse(v.id(), params.id);
      const cur = await loadOwned<any>(q, actor, "sales_activities", id, "Activity", { forUpdate: true });
      if (cur.status !== "open") throw conflict(`This activity is ${cur.status}`, "activity_closed");
      await q.query("UPDATE sales_activities SET status = 'cancelled', updated_at = now() WHERE id = $1", [id]);
      await audit(q, actor, { action: "activity.cancel", entityType: "activity", entityId: id, summary: `Cancelled ${cur.subject}` }, requestId);
      return { ok: true };
    },
  },
  // ───── notifications (in-app)
  {
    method: "GET", path: "/notifications", permission: null, tx: false,
    async handler({ q, actor, query }) {
      if (!actor.memberId) return { items: [], unread: 0 };
      const unreadOnly = str(query, "unread") === "true";
      const items = (await q.query(`SELECT id, kind, title, body, link, severity, read_at, created_at FROM sales_notifications WHERE member_id = $1 ${unreadOnly ? "AND read_at IS NULL" : ""} ORDER BY created_at DESC, id DESC LIMIT 50`, [actor.memberId])).rows;
      const unread = (await q.query<{ n: number }>("SELECT count(*)::int n FROM sales_notifications WHERE member_id = $1 AND read_at IS NULL", [actor.memberId])).rows[0]!.n;
      return { items, unread };
    },
  },
  {
    method: "POST", path: "/notifications/read", permission: null,
    async handler({ q, actor, body }) {
      const b = parse(v.object({ ids: v.optional(v.array(v.int({ min: 1 }), { max: 200 })) }), body ?? {});
      if (!actor.memberId) return { ok: true, updated: 0 };
      const r = b.ids?.length
        ? await q.query(`UPDATE sales_notifications SET read_at = now() WHERE member_id = $1 AND read_at IS NULL AND id IN (${b.ids.map((i) => Number(i)).join(",")}) RETURNING id`, [actor.memberId])
        : await q.query("UPDATE sales_notifications SET read_at = now() WHERE member_id = $1 AND read_at IS NULL RETURNING id", [actor.memberId]);
      return { ok: true, updated: r.rows.length };
    },
  },
];
