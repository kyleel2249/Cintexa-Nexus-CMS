/**
 * Marketing Management service.
 * Uses shared Postgres pool when available; falls back to in-memory for offline/dev.
 * Publishes intent for Nexus sync outbox on state changes.
 */
import { pool } from "@workspace/db";

export type AuthIdentity = {
  sub: string;
  email?: string;
  platformRole?: string;
  displayName?: string;
};

export type MarketingRequest = {
  method: string;
  path: string;
  query: Record<string, string | string[] | undefined>;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  auth?: AuthIdentity;
  ip?: string;
};

export type MarketingResponse = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};

// In-memory fallback
const memCampaigns = new Map<number, any>();
const memContent = new Map<number, any>();
const memEvents = new Map<number, any>();
let nextCampaignId = 1;
let nextContentId = 1;
let nextEventId = 1;
let nextNumber = 1000;
let dbReady: boolean | null = null;

async function hasDb(): Promise<boolean> {
  if (dbReady !== null) return dbReady;
  try {
    await pool.query("SELECT 1 FROM marketing_campaigns LIMIT 1");
    dbReady = true;
  } catch {
    dbReady = false;
  }
  return dbReady;
}

function requireAuth(auth?: AuthIdentity): AuthIdentity {
  if (!auth?.sub) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  return auth;
}

function can(_auth: AuthIdentity, _perm: string): boolean {
  return true; // operator mode; tighten when RBAC rows exist
}

async function emitSync(eventType: string, entityType: string, entityId: string | number, payload: unknown) {
  // Best-effort: use existing outbox pattern when sales_outbox or sync exists
  try {
    await pool.query(
      `INSERT INTO sales_outbox (kind, provider, entity_type, entity_id, payload, status, idempotency_key)
       VALUES ($1, 'nexus-sync', $2, $3, $4::jsonb, 'pending', $5)
       ON CONFLICT DO NOTHING`,
      [eventType, entityType, String(entityId), JSON.stringify(payload), `${eventType}:${entityType}:${entityId}:${Date.now()}`],
    );
  } catch {
    // outbox may not exist yet — ignore
  }
}

// ─── Campaigns ───────────────────────────────────────────

async function listCampaigns(status?: string) {
  if (await hasDb()) {
    const q = status
      ? await pool.query(
          `SELECT * FROM marketing_campaigns WHERE archived_at IS NULL AND status = $1 ORDER BY updated_at DESC`,
          [status],
        )
      : await pool.query(
          `SELECT * FROM marketing_campaigns WHERE archived_at IS NULL ORDER BY updated_at DESC`,
        );
    return q.rows;
  }
  let list = Array.from(memCampaigns.values()).filter((c) => !c.archived_at);
  if (status) list = list.filter((c) => c.status === status);
  return list.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

async function getCampaign(id: number) {
  if (await hasDb()) {
    const r = await pool.query(`SELECT * FROM marketing_campaigns WHERE id = $1 AND archived_at IS NULL`, [id]);
    if (!r.rows[0]) return null;
    const acts = await pool.query(
      `SELECT * FROM marketing_campaign_activities WHERE campaign_id = $1 ORDER BY at DESC LIMIT 50`,
      [id],
    );
    return { ...r.rows[0], activities: acts.rows };
  }
  const c = memCampaigns.get(id);
  return c && !c.archived_at ? c : null;
}

async function createCampaign(body: any, auth: AuthIdentity) {
  const now = new Date().toISOString();
  if (await hasDb()) {
    const num = await pool.query(`SELECT COALESCE(MAX(id), 0) + 1000 AS n FROM marketing_campaigns`);
    const number = `MC-${num.rows[0].n}`;
    const r = await pool.query(
      `INSERT INTO marketing_campaigns
        (number, name, description, objective, status, priority, channels, start_date, end_date, budget, owner_id, tags, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        number,
        body.name.trim(),
        body.description || null,
        body.objective || null,
        body.status || "DRAFT",
        body.priority || "MEDIUM",
        body.channels || [],
        body.start_date || null,
        body.end_date || null,
        Number(body.budget) || 0,
        body.owner_id || auth.sub,
        body.tags || [],
        JSON.stringify(body.metadata || {}),
      ],
    );
    const row = r.rows[0];
    await pool.query(
      `INSERT INTO marketing_campaign_activities (campaign_id, actor_id, actor_label, action, summary)
       VALUES ($1,$2,$3,'created','Campaign created')`,
      [row.id, auth.sub, auth.displayName || auth.email],
    );
    await emitSync("marketing.campaign.created", "campaign", row.id, { number: row.number, name: row.name, status: row.status });
    return row;
  }
  const id = nextCampaignId++;
  const campaign = {
    id,
    number: `MC-${nextNumber++}`,
    name: body.name.trim(),
    description: body.description || null,
    objective: body.objective || null,
    status: body.status || "DRAFT",
    priority: body.priority || "MEDIUM",
    channels: body.channels || [],
    start_date: body.start_date || null,
    end_date: body.end_date || null,
    budget: Number(body.budget) || 0,
    spent: 0,
    owner_id: body.owner_id || auth.sub,
    team_member_ids: body.team_member_ids || [],
    target_audience: body.target_audience || {},
    kpis: body.kpis || {},
    tags: body.tags || [],
    metadata: body.metadata || {},
    archived_at: null,
    created_at: now,
    updated_at: now,
    activities: [{ at: now, actor_id: auth.sub, action: "created", summary: "Campaign created" }],
  };
  memCampaigns.set(id, campaign);
  return campaign;
}

async function updateCampaign(id: number, body: any, auth: AuthIdentity) {
  const allowed = ["name", "description", "objective", "status", "priority", "channels", "start_date", "end_date", "budget", "owner_id", "tags", "metadata", "target_audience", "kpis"];
  if (await hasDb()) {
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    for (const k of allowed) {
      if (body[k] !== undefined) {
        sets.push(`${k} = $${i++}`);
        vals.push(k === "metadata" || k === "target_audience" || k === "kpis" ? JSON.stringify(body[k]) : body[k]);
      }
    }
    if (!sets.length) return getCampaign(id);
    sets.push(`updated_at = now()`);
    vals.push(id);
    const r = await pool.query(
      `UPDATE marketing_campaigns SET ${sets.join(", ")} WHERE id = $${i} AND archived_at IS NULL RETURNING *`,
      vals,
    );
    if (!r.rows[0]) return null;
    await pool.query(
      `INSERT INTO marketing_campaign_activities (campaign_id, actor_id, action, summary, details)
       VALUES ($1,$2,'updated','Campaign updated',$3::jsonb)`,
      [id, auth.sub, JSON.stringify({ fields: Object.keys(body) })],
    );
    await emitSync("marketing.campaign.updated", "campaign", id, { status: r.rows[0].status });
    return getCampaign(id);
  }
  const c = memCampaigns.get(id);
  if (!c || c.archived_at) return null;
  for (const k of allowed) if (body[k] !== undefined) (c as any)[k] = body[k];
  c.updated_at = new Date().toISOString();
  c.activities = c.activities || [];
  c.activities.push({ at: c.updated_at, actor_id: auth.sub, action: "updated", summary: "Campaign updated" });
  return c;
}

async function transitionCampaign(id: number, to: string, auth: AuthIdentity) {
  const valid: Record<string, string[]> = {
    DRAFT: ["PLANNED", "ARCHIVED"],
    PLANNED: ["APPROVED", "DRAFT", "ARCHIVED"],
    APPROVED: ["ACTIVE", "PLANNED", "ARCHIVED"],
    ACTIVE: ["PAUSED", "COMPLETED", "ARCHIVED"],
    PAUSED: ["ACTIVE", "COMPLETED", "ARCHIVED"],
    COMPLETED: ["ARCHIVED"],
    ARCHIVED: [],
  };
  const c = await getCampaign(id);
  if (!c) return { error: "not_found" as const };
  if (!valid[c.status]?.includes(to)) return { error: "invalid_transition" as const, from: c.status, to };
  if (await hasDb()) {
    await pool.query(`UPDATE marketing_campaigns SET status = $1, updated_at = now() WHERE id = $2`, [to, id]);
    await pool.query(
      `INSERT INTO marketing_campaign_activities (campaign_id, actor_id, action, summary)
       VALUES ($1,$2,'status_change',$3)`,
      [id, auth.sub, `${c.status} → ${to}`],
    );
    await emitSync("marketing.campaign.status_changed", "campaign", id, { from: c.status, to });
    return { campaign: await getCampaign(id) };
  }
  const prev = c.status;
  c.status = to;
  c.updated_at = new Date().toISOString();
  c.activities = c.activities || [];
  c.activities.push({ at: c.updated_at, actor_id: auth.sub, action: "status_change", summary: `${prev} → ${to}` });
  if (to === "ARCHIVED") c.archived_at = c.updated_at;
  memCampaigns.set(id, c);
  return { campaign: c };
}

async function overviewKpis() {
  const list = await listCampaigns();
  const active = list.filter((c) => c.status === "ACTIVE").length;
  const draft = list.filter((c) => c.status === "DRAFT").length;
  const planned = list.filter((c) => c.status === "PLANNED" || c.status === "APPROVED").length;
  const completed = list.filter((c) => c.status === "COMPLETED").length;
  const totalBudget = list.reduce((s, c) => s + Number(c.budget || 0), 0);
  const totalSpent = list.reduce((s, c) => s + Number(c.spent || 0), 0);
  let contentCount = 0;
  let eventCount = 0;
  if (await hasDb()) {
    try {
      const cc = await pool.query(`SELECT COUNT(*)::int AS n FROM marketing_content WHERE archived_at IS NULL`);
      contentCount = cc.rows[0]?.n || 0;
      const ec = await pool.query(`SELECT COUNT(*)::int AS n FROM marketing_calendar_events WHERE archived_at IS NULL AND starts_at >= now()`);
      eventCount = ec.rows[0]?.n || 0;
    } catch { /* ignore */ }
  } else {
    contentCount = Array.from(memContent.values()).filter((x) => !x.archived_at).length;
    eventCount = Array.from(memEvents.values()).filter((x) => !x.archived_at).length;
  }
  return {
    kpis: {
      activeCampaigns: active,
      draftCampaigns: draft,
      scheduledCampaigns: planned,
      completedCampaigns: completed,
      totalBudget,
      totalSpent,
      budgetUtilization: totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 1000) / 10 : 0,
      leadsGenerated: 0,
      qualifiedLeads: 0,
      conversionRate: null as number | null,
      contentItems: contentCount,
      upcomingEvents: eventCount,
    },
    recentCampaigns: list.slice(0, 8),
    upcoming: list.filter((c) => c.start_date && !["COMPLETED", "ARCHIVED"].includes(c.status)).slice(0, 5),
  };
}

// ─── Content ─────────────────────────────────────────────

async function listContent(type?: string, status?: string) {
  if (await hasDb()) {
    const clauses = ["archived_at IS NULL"];
    const vals: any[] = [];
    if (type) { vals.push(type); clauses.push(`type = $${vals.length}`); }
    if (status) { vals.push(status); clauses.push(`status = $${vals.length}`); }
    const r = await pool.query(
      `SELECT id, title, slug, type, status, campaign_id, owner_id, category, tags, channel, scheduled_at, published_at, version, created_at, updated_at
       FROM marketing_content WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC LIMIT 200`,
      vals,
    );
    return r.rows;
  }
  let list = Array.from(memContent.values()).filter((c) => !c.archived_at);
  if (type) list = list.filter((c) => c.type === type);
  if (status) list = list.filter((c) => c.status === status);
  return list.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

async function getContent(id: number) {
  if (await hasDb()) {
    const r = await pool.query(`SELECT * FROM marketing_content WHERE id = $1 AND archived_at IS NULL`, [id]);
    return r.rows[0] || null;
  }
  const c = memContent.get(id);
  return c && !c.archived_at ? c : null;
}

async function createContent(body: any, auth: AuthIdentity) {
  const now = new Date().toISOString();
  if (await hasDb()) {
    const r = await pool.query(
      `INSERT INTO marketing_content (title, slug, type, status, body, body_html, excerpt, campaign_id, owner_id, category, tags, channel, scheduled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        body.title.trim(),
        body.slug || null,
        body.type || "blog",
        body.status || "DRAFT",
        body.body || null,
        body.body_html || null,
        body.excerpt || null,
        body.campaign_id || null,
        auth.sub,
        body.category || null,
        body.tags || [],
        body.channel || null,
        body.scheduled_at || null,
      ],
    );
    await emitSync("marketing.content.created", "content", r.rows[0].id, { title: r.rows[0].title, type: r.rows[0].type });
    return r.rows[0];
  }
  const id = nextContentId++;
  const row = {
    id, title: body.title.trim(), slug: body.slug || null, type: body.type || "blog",
    status: body.status || "DRAFT", body: body.body || null, body_html: body.body_html || null,
    excerpt: body.excerpt || null, campaign_id: body.campaign_id || null, owner_id: auth.sub,
    category: body.category || null, tags: body.tags || [], channel: body.channel || null,
    scheduled_at: body.scheduled_at || null, published_at: null, version: 1,
    metadata: {}, archived_at: null, created_at: now, updated_at: now,
  };
  memContent.set(id, row);
  return row;
}

async function updateContent(id: number, body: any, auth: AuthIdentity) {
  if (await hasDb()) {
    const allowed = ["title", "slug", "type", "status", "body", "body_html", "excerpt", "campaign_id", "category", "tags", "channel", "scheduled_at"];
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    for (const k of allowed) {
      if (body[k] !== undefined) {
        sets.push(`${k} = $${i++}`);
        vals.push(body[k]);
      }
    }
    if (!sets.length) return getContent(id);
    sets.push(`updated_at = now()`, `version = version + 1`);
    vals.push(id);
    const r = await pool.query(
      `UPDATE marketing_content SET ${sets.join(", ")} WHERE id = $${i} AND archived_at IS NULL RETURNING *`,
      vals,
    );
    if (r.rows[0]) await emitSync("marketing.content.updated", "content", id, { status: r.rows[0].status });
    return r.rows[0] || null;
  }
  const c = memContent.get(id);
  if (!c || c.archived_at) return null;
  for (const k of ["title", "slug", "type", "status", "body", "body_html", "excerpt", "campaign_id", "category", "tags", "channel", "scheduled_at"]) {
    if (body[k] !== undefined) (c as any)[k] = body[k];
  }
  c.updated_at = new Date().toISOString();
  c.version = (c.version || 1) + 1;
  return c;
}

// ─── Calendar / Social events ────────────────────────────

async function listEvents(from?: string, to?: string) {
  if (await hasDb()) {
    const clauses = ["archived_at IS NULL"];
    const vals: any[] = [];
    if (from) { vals.push(from); clauses.push(`starts_at >= $${vals.length}`); }
    if (to) { vals.push(to); clauses.push(`starts_at <= $${vals.length}`); }
    const r = await pool.query(
      `SELECT * FROM marketing_calendar_events WHERE ${clauses.join(" AND ")} ORDER BY starts_at ASC LIMIT 300`,
      vals,
    );
    return r.rows;
  }
  return Array.from(memEvents.values()).filter((e) => !e.archived_at).sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
}

async function createEvent(body: any, auth: AuthIdentity) {
  const now = new Date().toISOString();
  if (await hasDb()) {
    const r = await pool.query(
      `INSERT INTO marketing_calendar_events
        (title, description, event_type, status, channel, campaign_id, content_id, starts_at, ends_at, all_day, owner_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        body.title.trim(), body.description || null, body.event_type || "content",
        body.status || "DRAFT", body.channel || null, body.campaign_id || null,
        body.content_id || null, body.starts_at, body.ends_at || null,
        !!body.all_day, auth.sub, JSON.stringify(body.metadata || {}),
      ],
    );
    await emitSync("marketing.calendar.created", "calendar_event", r.rows[0].id, { title: r.rows[0].title });
    return r.rows[0];
  }
  const id = nextEventId++;
  const row = {
    id, title: body.title.trim(), description: body.description || null,
    event_type: body.event_type || "content", status: body.status || "DRAFT",
    channel: body.channel || null, campaign_id: body.campaign_id || null,
    content_id: body.content_id || null, starts_at: body.starts_at, ends_at: body.ends_at || null,
    all_day: !!body.all_day, owner_id: auth.sub, metadata: body.metadata || {},
    archived_at: null, created_at: now, updated_at: now,
  };
  memEvents.set(id, row);
  return row;
}

async function updateEvent(id: number, body: any) {
  if (await hasDb()) {
    const allowed = ["title", "description", "event_type", "status", "channel", "campaign_id", "content_id", "starts_at", "ends_at", "all_day", "metadata"];
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    for (const k of allowed) {
      if (body[k] !== undefined) {
        sets.push(`${k} = $${i++}`);
        vals.push(k === "metadata" ? JSON.stringify(body[k]) : body[k]);
      }
    }
    if (!sets.length) {
      const r = await pool.query(`SELECT * FROM marketing_calendar_events WHERE id = $1`, [id]);
      return r.rows[0] || null;
    }
    sets.push(`updated_at = now()`);
    vals.push(id);
    const r = await pool.query(
      `UPDATE marketing_calendar_events SET ${sets.join(", ")} WHERE id = $${i} AND archived_at IS NULL RETURNING *`,
      vals,
    );
    return r.rows[0] || null;
  }
  const e = memEvents.get(id);
  if (!e || e.archived_at) return null;
  for (const k of ["title", "description", "event_type", "status", "channel", "campaign_id", "content_id", "starts_at", "ends_at", "all_day", "metadata"]) {
    if (body[k] !== undefined) (e as any)[k] = body[k];
  }
  e.updated_at = new Date().toISOString();
  return e;
}

// ─── Router ──────────────────────────────────────────────

export async function handleMarketingRequest(req: MarketingRequest): Promise<MarketingResponse> {
  const path = req.path.replace(/\/+$/, "") || "/";
  const method = req.method.toUpperCase();
  const auth = req.auth;

  try {
    // Overview
    if (method === "GET" && (path === "/" || path === "/overview")) {
      requireAuth(auth);
      return { status: 200, body: await overviewKpis() };
    }

    // Campaigns
    if (method === "GET" && path === "/campaigns") {
      requireAuth(auth);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const items = await listCampaigns(status);
      return { status: 200, body: { items, total: items.length } };
    }
    const getCamp = path.match(/^\/campaigns\/(\d+)$/);
    if (method === "GET" && getCamp) {
      requireAuth(auth);
      const c = await getCampaign(Number(getCamp[1]));
      if (!c) return { status: 404, body: { error: "Campaign not found" } };
      return { status: 200, body: c };
    }
    if (method === "POST" && path === "/campaigns") {
      const a = requireAuth(auth);
      if (!can(a, "marketing:campaigns")) return { status: 403, body: { error: "Forbidden" } };
      const body = (req.body || {}) as any;
      if (!body.name || typeof body.name !== "string") return { status: 400, body: { error: "name is required" } };
      const row = await createCampaign(body, a);
      return { status: 201, body: row };
    }
    if (method === "PATCH" && getCamp) {
      const a = requireAuth(auth);
      const row = await updateCampaign(Number(getCamp[1]), (req.body || {}) as any, a);
      if (!row) return { status: 404, body: { error: "Campaign not found" } };
      return { status: 200, body: row };
    }
    const trans = path.match(/^\/campaigns\/(\d+)\/transition$/);
    if (method === "POST" && trans) {
      const a = requireAuth(auth);
      const body = (req.body || {}) as any;
      const result = await transitionCampaign(Number(trans[1]), String(body.status || "").toUpperCase(), a);
      if ("error" in result && result.error === "not_found") return { status: 404, body: { error: "Campaign not found" } };
      if ("error" in result && result.error === "invalid_transition") {
        return { status: 400, body: { error: `Invalid transition ${result.from} → ${result.to}` } };
      }
      return { status: 200, body: (result as any).campaign };
    }
    if (method === "DELETE" && getCamp) {
      const a = requireAuth(auth);
      const result = await transitionCampaign(Number(getCamp[1]), "ARCHIVED", a);
      if ("error" in result) return { status: 404, body: { error: "Campaign not found" } };
      return { status: 204 };
    }

    // Content
    if (method === "GET" && path === "/content") {
      requireAuth(auth);
      const type = typeof req.query.type === "string" ? req.query.type : undefined;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const items = await listContent(type, status);
      return { status: 200, body: { items, total: items.length } };
    }
    const getCont = path.match(/^\/content\/(\d+)$/);
    if (method === "GET" && getCont) {
      requireAuth(auth);
      const c = await getContent(Number(getCont[1]));
      if (!c) return { status: 404, body: { error: "Content not found" } };
      return { status: 200, body: c };
    }
    if (method === "POST" && path === "/content") {
      const a = requireAuth(auth);
      const body = (req.body || {}) as any;
      if (!body.title) return { status: 400, body: { error: "title is required" } };
      return { status: 201, body: await createContent(body, a) };
    }
    if (method === "PATCH" && getCont) {
      const a = requireAuth(auth);
      const row = await updateContent(Number(getCont[1]), (req.body || {}) as any, a);
      if (!row) return { status: 404, body: { error: "Content not found" } };
      return { status: 200, body: row };
    }

    // Calendar / Social
    if (method === "GET" && path === "/calendar") {
      requireAuth(auth);
      const from = typeof req.query.from === "string" ? req.query.from : undefined;
      const to = typeof req.query.to === "string" ? req.query.to : undefined;
      const items = await listEvents(from, to);
      return { status: 200, body: { items, total: items.length } };
    }
    if (method === "POST" && path === "/calendar") {
      const a = requireAuth(auth);
      const body = (req.body || {}) as any;
      if (!body.title || !body.starts_at) return { status: 400, body: { error: "title and starts_at are required" } };
      return { status: 201, body: await createEvent(body, a) };
    }
    const getEv = path.match(/^\/calendar\/(\d+)$/);
    if (method === "PATCH" && getEv) {
      requireAuth(auth);
      const row = await updateEvent(Number(getEv[1]), (req.body || {}) as any);
      if (!row) return { status: 404, body: { error: "Event not found" } };
      return { status: 200, body: row };
    }
    if (method === "POST" && getEv && path.endsWith("/confirm-published")) {
      requireAuth(auth);
      const row = await updateEvent(Number(getEv[1]), { status: "PUBLISHED_MANUALLY" });
      if (!row) return { status: 404, body: { error: "Event not found" } };
      await emitSync("marketing.calendar.published_manually", "calendar_event", row.id, { title: row.title, channel: row.channel });
      return { status: 200, body: row };
    }

    return { status: 404, body: { error: "Not found", path } };
  } catch (e: any) {
    const status = e.status || 500;
    return { status, body: { error: e.message || "Internal error" } };
  }
}
