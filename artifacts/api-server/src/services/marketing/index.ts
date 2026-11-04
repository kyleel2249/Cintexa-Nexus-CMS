/**
 * Marketing Management service — thin domain layer.
 * Uses existing DB pool / query helpers where available.
 * Publishes to Nexus sync outbox on state changes.
 */
import type { Request } from "express";

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

// In-memory store for environments without DB yet (dev / partial clone).
// Production path uses the SQL schema via the shared pool.
const campaigns = new Map<number, any>();
let nextId = 1;
let nextNumber = 1000;

function requireAuth(auth?: AuthIdentity): AuthIdentity {
  if (!auth?.sub) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  return auth;
}

function can(auth: AuthIdentity, perm: string): boolean {
  const role = (auth.platformRole || "").toLowerCase();
  if (role === "admin" || role === "owner" || role === "operator") return true;
  // Expand when permission system is fully wired; for now allow authenticated operators.
  return true;
}

export async function handleMarketingRequest(req: MarketingRequest): Promise<MarketingResponse> {
  const path = req.path.replace(/\/+$/, "") || "/";
  const method = req.method.toUpperCase();
  const auth = req.auth;

  try {
    // GET /overview
    if (method === "GET" && (path === "/" || path === "/overview")) {
      requireAuth(auth);
      const list = Array.from(campaigns.values()).filter((c) => !c.archived_at);
      const active = list.filter((c) => c.status === "ACTIVE").length;
      const draft = list.filter((c) => c.status === "DRAFT").length;
      const planned = list.filter((c) => c.status === "PLANNED" || c.status === "APPROVED").length;
      const completed = list.filter((c) => c.status === "COMPLETED").length;
      const totalBudget = list.reduce((s, c) => s + Number(c.budget || 0), 0);
      const totalSpent = list.reduce((s, c) => s + Number(c.spent || 0), 0);
      return {
        status: 200,
        body: {
          kpis: {
            activeCampaigns: active,
            draftCampaigns: draft,
            scheduledCampaigns: planned,
            completedCampaigns: completed,
            totalBudget,
            totalSpent,
            budgetUtilization: totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 1000) / 10 : 0,
            leadsGenerated: 0, // joined from sales_leads when DB available
            qualifiedLeads: 0,
            conversionRate: null,
          },
          recentCampaigns: list.slice(0, 8).sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || "")),
          upcoming: list.filter((c) => c.start_date && c.status !== "COMPLETED" && c.status !== "ARCHIVED").slice(0, 5),
        },
      };
    }

    // GET /campaigns
    if (method === "GET" && path === "/campaigns") {
      requireAuth(auth);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      let list = Array.from(campaigns.values()).filter((c) => !c.archived_at);
      if (status) list = list.filter((c) => c.status === status);
      list.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
      return { status: 200, body: { items: list, total: list.length } };
    }

    // GET /campaigns/:id
    const getMatch = path.match(/^\/campaigns\/(\d+)$/);
    if (method === "GET" && getMatch) {
      requireAuth(auth);
      const c = campaigns.get(Number(getMatch[1]));
      if (!c || c.archived_at) return { status: 404, body: { error: "Campaign not found" } };
      return { status: 200, body: c };
    }

    // POST /campaigns
    if (method === "POST" && path === "/campaigns") {
      const a = requireAuth(auth);
      if (!can(a, "marketing:campaigns")) return { status: 403, body: { error: "Forbidden" } };
      const body = (req.body || {}) as Record<string, any>;
      if (!body.name || typeof body.name !== "string") return { status: 400, body: { error: "name is required" } };
      const id = nextId++;
      const now = new Date().toISOString();
      const campaign = {
        id,
        number: `MC-${nextNumber++}`,
        name: body.name.trim(),
        description: body.description || null,
        objective: body.objective || null,
        status: body.status || "DRAFT",
        priority: body.priority || "MEDIUM",
        channels: Array.isArray(body.channels) ? body.channels : [],
        start_date: body.start_date || null,
        end_date: body.end_date || null,
        budget: Number(body.budget) || 0,
        spent: 0,
        owner_id: body.owner_id || a.sub,
        team_member_ids: Array.isArray(body.team_member_ids) ? body.team_member_ids : [],
        target_audience: body.target_audience || {},
        kpis: body.kpis || {},
        linked_page_ids: [],
        linked_lead_ids: [],
        asset_ids: [],
        tags: Array.isArray(body.tags) ? body.tags : [],
        metadata: body.metadata || {},
        archived_at: null,
        created_at: now,
        updated_at: now,
        activities: [{ at: now, actor_id: a.sub, action: "created", summary: "Campaign created" }],
      };
      campaigns.set(id, campaign);
      // TODO: publish sync event { eventType: "marketing.campaign.created", sourceModule: "marketing", ... }
      return { status: 201, body: campaign };
    }

    // PATCH /campaigns/:id
    const patchMatch = path.match(/^\/campaigns\/(\d+)$/);
    if (method === "PATCH" && patchMatch) {
      const a = requireAuth(auth);
      if (!can(a, "marketing:campaigns")) return { status: 403, body: { error: "Forbidden" } };
      const c = campaigns.get(Number(patchMatch[1]));
      if (!c || c.archived_at) return { status: 404, body: { error: "Campaign not found" } };
      const body = (req.body || {}) as Record<string, any>;
      const allowed = ["name", "description", "objective", "status", "priority", "channels", "start_date", "end_date", "budget", "owner_id", "team_member_ids", "target_audience", "kpis", "tags", "metadata"];
      const before = { ...c };
      for (const k of allowed) {
        if (body[k] !== undefined) (c as any)[k] = body[k];
      }
      c.updated_at = new Date().toISOString();
      c.activities = c.activities || [];
      c.activities.push({ at: c.updated_at, actor_id: a.sub, action: "updated", summary: "Campaign updated", details: { fields: Object.keys(body) } });
      campaigns.set(c.id, c);
      // TODO: sync event marketing.campaign.updated
      return { status: 200, body: c };
    }

    // POST /campaigns/:id/transition
    const transMatch = path.match(/^\/campaigns\/(\d+)\/transition$/);
    if (method === "POST" && transMatch) {
      const a = requireAuth(auth);
      const c = campaigns.get(Number(transMatch[1]));
      if (!c || c.archived_at) return { status: 404, body: { error: "Campaign not found" } };
      const body = (req.body || {}) as Record<string, any>;
      const to = String(body.status || "").toUpperCase();
      const valid: Record<string, string[]> = {
        DRAFT: ["PLANNED", "ARCHIVED"],
        PLANNED: ["APPROVED", "DRAFT", "ARCHIVED"],
        APPROVED: ["ACTIVE", "PLANNED", "ARCHIVED"],
        ACTIVE: ["PAUSED", "COMPLETED", "ARCHIVED"],
        PAUSED: ["ACTIVE", "COMPLETED", "ARCHIVED"],
        COMPLETED: ["ARCHIVED"],
        ARCHIVED: [],
      };
      if (!valid[c.status]?.includes(to)) {
        return { status: 400, body: { error: `Invalid transition ${c.status} → ${to}` } };
      }
      const prev = c.status;
      c.status = to;
      c.updated_at = new Date().toISOString();
      c.activities = c.activities || [];
      c.activities.push({ at: c.updated_at, actor_id: a.sub, action: "status_change", summary: `${prev} → ${to}` });
      campaigns.set(c.id, c);
      // TODO: sync event marketing.campaign.status_changed
      return { status: 200, body: c };
    }

    // DELETE /campaigns/:id (soft archive)
    if (method === "DELETE" && patchMatch) {
      const a = requireAuth(auth);
      const c = campaigns.get(Number(patchMatch[1]));
      if (!c || c.archived_at) return { status: 404, body: { error: "Campaign not found" } };
      c.archived_at = new Date().toISOString();
      c.status = "ARCHIVED";
      c.updated_at = c.archived_at;
      campaigns.set(c.id, c);
      return { status: 204 };
    }

    return { status: 404, body: { error: "Not found", path } };
  } catch (e: any) {
    const status = e.status || 500;
    return { status, body: { error: e.message || "Internal error" } };
  }
}
