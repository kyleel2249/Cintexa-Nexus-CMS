/** Routes for the AI agent network, approvals, events, briefing. Mounted at /api/sales by modules/index.ts. */
import { v, parse } from "../core/validate";
import { created, type Route } from "../core/router";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../core/errors";
import { audit } from "../core/audit";
import { can, scopeOf, ownerScopeSql } from "../core/rbac";
import { pageOf, str } from "../core/http";
import { AGENTS, AGENT_BY_KEY, ORCHESTRATOR_KEY } from "../agents/catalog";
import { ensureAgents, loadAgent, runAgent, diagnoseAgent, agentActor } from "../agents/runtime";
import { orchestrate } from "../agents/orchestrator";
import { buildBriefing } from "../agents/briefing";
import { decideApproval, cancelApproval, executeApproval, completeManually, canDecide, EXECUTOR_TYPES } from "../agents/approvals";
import { EVENT_CATALOG, processEvents } from "../agents/events";
import { TIER_DEFAULT_MODELS, tierModel } from "../agents/llm";
import type { Actor, Queryable } from "../core/types";

const STATUSES = ["active", "paused", "disabled"] as const;
const STAGES = ["fact", "metric", "prediction", "recommendation", "proposed_action"] as const;
const REC_STATUS = ["open", "accepted", "dismissed", "actioned", "verified", "expired"] as const;
const APPROVAL_STATUS = ["PENDING", "APPROVED", "REJECTED", "EXECUTING", "COMPLETED", "FAILED", "CANCELLED", "EXPIRED"] as const;

/** Owner-scope for recommendations: people who only see their own records see findings on their own records. */
function recScope(actor: Actor): string {
  return scopeOf(actor) === "all" ? "TRUE" : `r.owner_member_id IS NOT NULL AND ${ownerScopeSql(actor, "r.owner_member_id")}`;
}

async function agentStats(q: Queryable, now: Date) {
  const rows = (await q.query<any>(`SELECT a.key,
    (SELECT count(*) FROM sales_agent_executions e WHERE e.agent_key = a.key)::int runs,
    (SELECT count(*) FROM sales_agent_executions e WHERE e.agent_key = a.key AND e.status = 'success')::int ok,
    (SELECT count(*) FROM sales_agent_executions e WHERE e.agent_key = a.key AND e.status = 'failed')::int failed,
    (SELECT COALESCE(avg(latency_ms),0) FROM sales_agent_executions e WHERE e.agent_key = a.key AND e.status = 'success')::int avg_ms,
    (SELECT COALESCE(sum(cost_usd),0) FROM sales_agent_executions e WHERE e.agent_key = a.key)::float8 cost,
    (SELECT COALESCE(sum(COALESCE(prompt_tokens,0) + COALESCE(completion_tokens,0)),0) FROM sales_agent_executions e WHERE e.agent_key = a.key)::int tokens,
    (SELECT count(*) FROM sales_agent_recommendations r WHERE r.agent_key = a.key AND r.status = 'open')::int open_recs,
    (SELECT count(*) FROM sales_agent_recommendations r WHERE r.agent_key = a.key AND r.status IN ('accepted','actioned','verified'))::int accepted,
    (SELECT count(*) FROM sales_agent_recommendations r WHERE r.agent_key = a.key AND r.status = 'dismissed')::int dismissed,
    (SELECT count(*) FROM sales_approvals p WHERE p.agent_key = a.key AND p.status = 'PENDING')::int pending_approvals,
    (SELECT status FROM sales_agent_tasks t WHERE t.id = a.current_task_id) current_task_status,
    (SELECT kind FROM sales_agent_tasks t WHERE t.id = a.current_task_id) current_task_kind
    FROM sales_agents a`)).rows;
  void now;
  return new Map(rows.map((r) => [r.key, r]));
}

const shapeAgent = (a: any, s: any) => {
  const def = AGENT_BY_KEY.get(a.key)!;
  const decided = (s?.accepted ?? 0) + (s?.dismissed ?? 0);
  return {
    key: a.key, name: a.name, purpose: a.purpose, group: def.group, version: a.version, status: a.status, level: a.level, maxLevel: a.max_level,
    model: { tier: a.model_tier, override: a.model, fallback: a.fallback_model, resolved: a.model ?? tierModel(a.model_tier), useAi: a.use_ai },
    tools: def.tools, reads: def.reads, limitations: def.limitations ?? null, events: def.events ?? [],
    schedule: { everyMinutes: a.schedule_minutes, nextRunAt: a.next_run_at }, thresholds: { ...def.thresholds, ...(a.thresholds ?? {}) },
    lastActivityAt: a.last_activity_at, lastSuccessAt: a.last_success_at, currentTask: a.current_task_id ? { id: a.current_task_id, status: s?.current_task_status ?? null, kind: s?.current_task_kind ?? null } : null,
    stats: {
      runs: s?.runs ?? 0, successRate: s?.runs ? Math.round(((s.ok ?? 0) / s.runs) * 1000) / 10 : null, failureRate: s?.runs ? Math.round(((s.failed ?? 0) / s.runs) * 1000) / 10 : null, avgLatencyMs: s?.avg_ms ?? 0,
      costUsd: s?.cost ?? 0, tokens: s?.tokens ?? 0, openFindings: s?.open_recs ?? 0, pendingApprovals: s?.pending_approvals ?? 0,
    },
    evaluation: { decidedRecommendations: decided, acceptanceRate: decided >= 5 ? Math.round(((s?.accepted ?? 0) / decided) * 1000) / 10 : null, falsePositiveRate: decided >= 5 ? Math.round(((s?.dismissed ?? 0) / decided) * 1000) / 10 : null, note: decided >= 5 ? "From people's accept/dismiss decisions; dismissal is a proxy for a false positive." : "Not enough decisions yet (needs at least 5); no accuracy is claimed." },
  };
};

async function audited(q: Queryable, actor: Actor, action: string, key: string, summary: string, before?: unknown, after?: unknown, requestId?: string) {
  await audit(q, actor, { action, entityType: "agent", entityId: key, summary, before, after }, requestId);
}

export const agentRoutes: Route[] = [
  // ───────── command centre ─────────
  {
    method: "GET", path: "/agents/command-centre", permission: "agents:run", tx: false,
    async handler({ q, db, deps, now, settings }) {
      await ensureAgents(db);
      const agents = (await q.query<any>("SELECT * FROM sales_agents ORDER BY key")).rows;
      const stats = await agentStats(q, now);
      const byStatus = (s: string) => agents.filter((a: any) => a.status === s).length;
      const tasks = (await q.query<any>(`SELECT count(*) FILTER (WHERE status = 'queued')::int queued, count(*) FILTER (WHERE status = 'running')::int running, count(*) FILTER (WHERE status = 'completed' OR status = 'awaiting_approval')::int completed, count(*) FILTER (WHERE status = 'failed')::int failed, count(*) FILTER (WHERE status = 'awaiting_approval')::int awaiting FROM sales_agent_tasks`)).rows[0];
      const ex = (await q.query<any>(`SELECT COALESCE(avg(latency_ms) FILTER (WHERE status = 'success'),0)::int avg_ms, count(*) FILTER (WHERE status = 'failed' AND started_at > $1::timestamptz - interval '24 hours')::int failed_24h, count(*) FILTER (WHERE started_at > $1::timestamptz - interval '24 hours')::int runs_24h,
        COALESCE(sum(COALESCE(prompt_tokens,0) + COALESCE(completion_tokens,0)),0)::int tokens, COALESCE(sum(cost_usd),0)::float8 cost, count(cost_usd)::int cost_samples, max(finished_at) FILTER (WHERE status = 'success') last_ok,
        count(*) FILTER (WHERE ai_status IN ('ok','fallback_model'))::int ai_ok, count(*) FILTER (WHERE ai_status IN ('unavailable','invalid_output','error'))::int ai_failed FROM sales_agent_executions e`, [now.toISOString()])).rows[0];
      const retries = (await q.query<any>("SELECT COALESCE(sum(GREATEST(attempts - 1, 0)),0)::int n FROM sales_events")).rows[0].n;
      const approvals = (await q.query<any>("SELECT count(*) FILTER (WHERE status = 'PENDING')::int pending, count(*) FILTER (WHERE status = 'FAILED')::int failed, count(*) FILTER (WHERE status = 'EXECUTING')::int executing FROM sales_approvals")).rows[0];
      const events = (await q.query<any>("SELECT count(*) FILTER (WHERE status IN ('pending','failed'))::int backlog, count(*) FILTER (WHERE status = 'dead')::int dead, count(*) FILTER (WHERE status = 'processed')::int processed FROM sales_events")).rows[0];
      const findings = (await q.query<any>("SELECT count(*) FILTER (WHERE status = 'open')::int open, count(*) FILTER (WHERE status = 'open' AND severity IN ('high','critical'))::int high FROM sales_agent_recommendations")).rows[0];
      const top = (await q.query<any>(`SELECT r.id, r.agent_key, r.stage, r.severity, r.title, r.what_detected, r.recommended_action, r.entity_type, r.entity_id, r.priority_score FROM sales_agent_recommendations r WHERE r.status = 'open' AND r.severity IN ('high','critical') ORDER BY r.priority_score DESC, r.id DESC LIMIT 8`)).rows;
      const health = ex.failed_24h > 0 && ex.runs_24h > 0 && ex.failed_24h / ex.runs_24h > 0.25 ? "degraded" : events.dead > 0 || approvals.executing > 0 || approvals.failed > 0 ? "attention" : byStatus("active") === 0 ? "idle" : "healthy";
      const ai = { installed: Boolean(deps.integrations.ai), enabled: settings.integrations.ai.enabled, externalAllowed: settings.integrations.ai.allowExternalProvider, models: TIER_DEFAULT_MODELS, mode: settings.integrations.ai.enabled && deps.integrations.ai && (!deps.integrations.ai.external || settings.integrations.ai.allowExternalProvider) ? "ai_narration_available" : "deterministic_only" };
      return {
        totals: { configured: agents.length, active: byStatus("active"), idle: agents.filter((a: any) => a.status === "active" && !a.current_task_id).length, running: agents.filter((a: any) => a.current_task_id).length, paused: byStatus("paused"), disabled: byStatus("disabled"), awaitingApproval: tasks.awaiting },
        tasks: { queued: tasks.queued, running: tasks.running, completed: tasks.completed, failed: tasks.failed }, executions: { avgDurationMs: ex.avg_ms, failed24h: ex.failed_24h, runs24h: ex.runs_24h, eventRetries: retries },
        usage: { tokens: ex.tokens, estimatedCostUsd: ex.cost_samples > 0 ? ex.cost : null, costNote: ex.cost_samples > 0 ? "Sum of provider-reported cost for runs that reported one." : "No provider-reported cost yet (deterministic runs are free; the provider must report usage).", aiRuns: ex.ai_ok, aiFailures: ex.ai_failed },
        lastSuccessfulExecution: ex.last_ok, health, ai, findings: { open: findings.open, highOrCritical: findings.high, top }, pendingHumanDecisions: approvals.pending, approvals, events,
        agents: agents.map((a: any) => shapeAgent(a, stats.get(a.key))),
      };
    },
  },
  {
    method: "GET", path: "/agents", permission: "agents:run", tx: false,
    async handler({ q, db, now }) {
      await ensureAgents(db);
      const stats = await agentStats(q, now);
      return { items: (await q.query<any>("SELECT * FROM sales_agents ORDER BY key")).rows.map((a: any) => shapeAgent(a, stats.get(a.key))), note: "Tools and data access are fixed in code. An agent cannot edit its own permissions, approval rules or audit logging." };
    },
  },
  // static routes before /agents/:key
  {
    method: "GET", path: "/agents/tasks", permission: "agents:run", tx: false,
    async handler({ q, query }) {
      const pg = pageOf(query);
      const w: string[] = []; const p: unknown[] = [];
      if (str(query, "agent_key")) { p.push(str(query, "agent_key")); w.push(`t.agent_key = $${p.length}`); }
      if (str(query, "status")) { p.push(str(query, "status")); w.push(`t.status = $${p.length}`); }
      const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
      const total = (await q.query<any>(`SELECT count(*)::int n FROM sales_agent_tasks t ${where}`, p)).rows[0].n;
      const items = (await q.query(`SELECT t.* FROM sales_agent_tasks t ${where} ORDER BY t.id DESC LIMIT $${p.length + 1} OFFSET $${p.length + 2}`, [...p, pg.pageSize, pg.offset])).rows;
      return { items, total, page: pg.page, pageSize: pg.pageSize };
    },
  },
  {
    method: "GET", path: "/agents/executions", permission: "agents:run", tx: false,
    async handler({ q, query }) {
      const pg = pageOf(query);
      const w: string[] = []; const p: unknown[] = [];
      if (str(query, "agent_key")) { p.push(str(query, "agent_key")); w.push(`e.agent_key = $${p.length}`); }
      if (str(query, "status")) { p.push(str(query, "status")); w.push(`e.status = $${p.length}`); }
      const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
      const total = (await q.query<any>(`SELECT count(*)::int n FROM sales_agent_executions e ${where}`, p)).rows[0].n;
      const items = (await q.query(`SELECT e.id, e.task_id, e.agent_key, e.status, e.level, e.ai_status, e.provider, e.model, e.prompt_tokens, e.completion_tokens, e.cost_usd::float8 cost_usd, e.latency_ms, e.findings_count, e.actions_prepared, e.actions_executed, e.error, e.started_at, e.finished_at FROM sales_agent_executions e ${where} ORDER BY e.id DESC LIMIT $${p.length + 1} OFFSET $${p.length + 2}`, [...p, pg.pageSize, pg.offset])).rows;
      return { items, total, page: pg.page, pageSize: pg.pageSize };
    },
  },
  {
    method: "GET", path: "/agents/executions/:id", permission: "agents:run", tx: false,
    async handler({ q, params }) {
      const e = (await q.query("SELECT * FROM sales_agent_executions WHERE id = $1", [parse(v.id(), params.id)])).rows[0];
      if (!e) throw notFound("Execution");
      return e;
    },
  },
  {
    method: "GET", path: "/agents/recommendations", permission: "agents:read", tx: false,
    async handler({ q, actor, query }) {
      const pg = pageOf(query);
      const w: string[] = [recScope(actor)]; const p: unknown[] = [];
      const add = (cond: string, val: unknown) => { p.push(val); w.push(cond.replace("?", `$${p.length}`)); };
      add("r.status = ?", str(query, "status") ? parse(v.enumOf(REC_STATUS), str(query, "status")) : "open");
      if (str(query, "agent_key")) add("r.agent_key = ?", str(query, "agent_key"));
      if (str(query, "stage")) add("r.stage = ?", parse(v.enumOf(STAGES), str(query, "stage")));
      if (str(query, "severity")) add("r.severity = ?", parse(v.enumOf(["info", "low", "medium", "high", "critical"] as const), str(query, "severity")));
      if (str(query, "category")) add("r.category = ?", parse(v.enumOf(["risk", "opportunity", "efficiency", "compliance", "info"] as const), str(query, "category")));
      if (str(query, "entity_type") && str(query, "entity_id")) { add("r.entity_type = ?", str(query, "entity_type")); add("r.entity_id = ?", parse(v.id(), str(query, "entity_id"))); }
      const where = w.join(" AND ");
      const total = (await q.query<any>(`SELECT count(*)::int n FROM sales_agent_recommendations r WHERE ${where}`, p)).rows[0].n;
      const items = (await q.query(`SELECT r.*, r.impact_amount::float8 impact, m.display_name owner_name FROM sales_agent_recommendations r LEFT JOIN sales_members m ON m.id = r.owner_member_id WHERE ${where} ORDER BY r.priority_score DESC, r.id DESC LIMIT $${p.length + 1} OFFSET $${p.length + 2}`, [...p, pg.pageSize, pg.offset])).rows;
      return { items, total, page: pg.page, pageSize: pg.pageSize, legend: { fact: "recorded observation", metric: "calculated from records", prediction: "model estimate, not a fact", recommendation: "suggested action", proposed_action: "an action prepared for approval or execution" } };
    },
  },
  ...(["accept", "dismiss"] as const).map((verb): Route => ({
    method: "POST", path: `/agents/recommendations/:id/${verb}`, permission: "agents:read",
    async handler({ q, actor, params, body, now, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ note: v.optional(v.string({ max: 300 })) }), body);
      const r = (await q.query<any>(`SELECT r.* FROM sales_agent_recommendations r WHERE r.id = $1 AND ${recScope(actor)} FOR UPDATE`, [id])).rows[0];
      if (!r) throw notFound("Recommendation");
      if (r.status !== "open" && !(verb === "dismiss" && r.status === "accepted")) throw conflict(`This recommendation is already ${r.status}`);
      const row = (await q.query("UPDATE sales_agent_recommendations SET status = $2, decided_by = $3, decided_at = $4, outcome = COALESCE(outcome, '{}'::jsonb) || $5::text::jsonb, updated_at = now() WHERE id = $1 RETURNING *", [id, verb === "accept" ? "accepted" : "dismissed", actor.userSub, now.toISOString(), JSON.stringify({ decision: verb, note: b.note ?? null })])).rows[0];
      await audit(q, actor, { action: `agent.recommendation.${verb}`, entityType: "recommendation", entityId: id, summary: `${verb === "accept" ? "Accepted" : "Dismissed"}: ${r.title}` }, requestId);
      return row;
    },
  })),
  {
    method: "GET", path: "/agents/briefing", permission: "agents:run", tx: false,
    async handler({ db, deps, query, actor }) {
      return buildBriefing(db, deps, { ai: str(query, "ai") === "1" && can(actor, "ai:use"), memberId: actor.memberId });
    },
  },
  {
    method: "GET", path: "/agents/my-actions", permission: "agents:read", tx: false,
    async handler({ q, actor, now }) {
      const recs = (await q.query<any>(`SELECT r.id, r.agent_key, r.stage, r.severity, r.title, r.what_detected, r.recommended_action, r.due_on, r.entity_type, r.entity_id, r.impact_amount::float8 impact FROM sales_agent_recommendations r WHERE r.status = 'open' AND r.stage <> 'metric' AND r.owner_member_id = $1 ORDER BY (r.due_on IS NULL), r.due_on, r.priority_score DESC LIMIT 15`, [actor.memberId || -1])).rows;
      const due = (await q.query<any>(`SELECT a.id, a.type, a.subject, a.due_at, a.priority FROM sales_activities a WHERE a.owner_id = $1 AND a.status = 'open' AND COALESCE(a.due_at, a.start_at) <= $2::timestamptz + interval '1 day' ORDER BY COALESCE(a.due_at, a.start_at) LIMIT 15`, [actor.memberId || -1, now.toISOString()])).rows;
      return { recommendations: recs, dueActivities: due, note: "Recommendations come from the agents' deterministic analysis of your records; due activities are your own tasks." };
    },
  },
  {
    method: "POST", path: "/agents/orchestrate", permission: "agents:run",
    async handler({ db, deps, actor, body }) {
      const b = parse(v.object({ only: v.optional(v.array(v.string({ max: 60 }), { max: 30 })) }), body);
      if (b.only?.some((k) => !AGENT_BY_KEY.has(k))) throw badRequest("Unknown agent key in 'only'");
      return orchestrate(db, deps, actor, b.only);
    },
    tx: false,
  },
  {
    method: "POST", path: "/agents/bulk", permission: "agents:manage",
    async handler({ q, actor, body, requestId }) {
      const b = parse(v.object({ action: v.enumOf(["enable_all", "pause_all"] as const) }), body);
      await ensureAgents(q);
      const r = await q.query("UPDATE sales_agents SET status = $1, updated_by = $2, updated_at = now() WHERE status <> 'disabled' AND status <> $1 RETURNING key", [b.action === "enable_all" ? "active" : "paused", actor.label]);
      await audit(q, actor, { action: `agent.${b.action}`, entityType: "agent", entityId: "*", summary: `${b.action === "enable_all" ? "Activated" : "Paused"} ${r.rows.length} agents (disabled agents unchanged)` }, requestId);
      return { changed: r.rows.map((x: any) => x.key) };
    },
  },
  {
    method: "GET", path: "/agents/events", permission: "agents:run", tx: false,
    async handler({ q, query }) {
      const pg = pageOf(query);
      const w: string[] = []; const p: unknown[] = [];
      if (str(query, "status")) { p.push(str(query, "status")); w.push(`status = $${p.length}`); }
      if (str(query, "type")) { p.push(str(query, "type")); w.push(`type = $${p.length}`); }
      const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
      const total = (await q.query<any>(`SELECT count(*)::int n FROM sales_events ${where}`, p)).rows[0].n;
      const items = (await q.query(`SELECT id, event_id, type, entity_type, entity_id, origin, status, attempts, last_error, occurred_at, next_attempt_at, processed_at FROM sales_events ${where} ORDER BY id DESC LIMIT $${p.length + 1} OFFSET $${p.length + 2}`, [...p, pg.pageSize, pg.offset])).rows;
      return { items, total, page: pg.page, pageSize: pg.pageSize, catalog: EVENT_CATALOG };
    },
  },
  // ───────── single agent ─────────
  {
    method: "GET", path: "/agents/:key", permission: "agents:run", tx: false,
    async handler({ q, params, now }) {
      const a = await loadAgent(q as any, params.key!);
      const stats = await agentStats(q, now);
      const executions = (await q.query("SELECT id, task_id, status, level, ai_status, model, latency_ms, findings_count, actions_prepared, actions_executed, error, started_at, finished_at FROM sales_agent_executions WHERE agent_key = $1 ORDER BY id DESC LIMIT 15", [a.key])).rows;
      const recs = (await q.query("SELECT id, stage, severity, status, title, created_at FROM sales_agent_recommendations WHERE agent_key = $1 ORDER BY id DESC LIMIT 10", [a.key])).rows;
      const approvals = (await q.query("SELECT id, action_type, status, summary, created_at FROM sales_approvals WHERE agent_key = $1 ORDER BY id DESC LIMIT 10", [a.key])).rows;
      return { ...shapeAgent(a, stats.get(a.key)), recentExecutions: executions, recentFindings: recs, recentApprovals: approvals };
    },
  },
  {
    method: "PATCH", path: "/agents/:key", permission: "agents:manage",
    async handler({ q, actor, params, body, requestId }) {
      const key = params.key!;
      const def = AGENT_BY_KEY.get(key); if (!def) throw notFound("Agent");
      const cur = await loadAgent(q as any, key);
      // The schema deliberately has no field for tools, permissions, approval rules or audit logging: unknown keys are rejected.
      const b = parse(v.object({ level: v.optional(v.int({ min: 1, max: 3 })), model_tier: v.optional(v.enumOf(["economy", "standard", "reasoning"] as const)), model: v.optional(v.nullable(v.string({ min: 3, max: 120 }))), fallback_model: v.optional(v.nullable(v.string({ min: 3, max: 120 }))), use_ai: v.optional(v.boolean()), schedule_minutes: v.optional(v.nullable(v.int({ min: 5, max: 10080 }))), thresholds: v.optional(v.record(v.number({ min: 0, max: 1_000_000 }))) }), body);
      if (b.level !== undefined && b.level > cur.max_level) throw unprocessable(`${def.name} cannot run above level ${cur.max_level}`, "level_above_max");
      if (b.thresholds) for (const k of Object.keys(b.thresholds)) if (!(k in def.thresholds)) throw unprocessable(`Unknown threshold "${k}" for this agent`);
      const sets: string[] = ["updated_by = $2", "updated_at = now()"]; const p: unknown[] = [key, actor.label];
      const set = (col: string, val: unknown, cast = "") => { p.push(val); sets.push(`${col} = $${p.length}${cast}`); };
      if (b.level !== undefined) set("level", b.level);
      if (b.model_tier !== undefined) set("model_tier", b.model_tier);
      if (b.model !== undefined) set("model", b.model);
      if (b.fallback_model !== undefined) set("fallback_model", b.fallback_model);
      if (b.use_ai !== undefined) set("use_ai", b.use_ai);
      if (b.schedule_minutes !== undefined) { set("schedule_minutes", b.schedule_minutes); sets.push(b.schedule_minutes === null ? "next_run_at = NULL" : `next_run_at = now() + ($${p.length} || ' minutes')::interval`); }
      if (b.thresholds) set("thresholds", JSON.stringify({ ...(cur.thresholds ?? {}), ...b.thresholds }), "::text::jsonb");
      const row = (await q.query<any>(`UPDATE sales_agents SET ${sets.join(", ")} WHERE key = $1 RETURNING *`, p)).rows[0];
      await audited(q, actor, "agent.configure", key, `Configured ${def.name}`, { level: cur.level, model_tier: cur.model_tier, schedule: cur.schedule_minutes }, b, requestId);
      return shapeAgent(row, undefined);
    },
  },
  ...([["enable", "active", ["paused", "disabled"]], ["resume", "active", ["paused"]], ["pause", "paused", ["active"]], ["disable", "disabled", ["active", "paused"]]] as const).map(([verb, to, from]): Route => ({
    method: "POST", path: `/agents/:key/${verb}`, permission: "agents:manage",
    async handler({ q, actor, params, requestId }) {
      const key = params.key!;
      const cur = await loadAgent(q as any, key);
      if (!(from as readonly string[]).includes(cur.status)) throw conflict(`Cannot ${verb} an agent that is ${cur.status}`);
      const row = (await q.query<any>(`UPDATE sales_agents SET status = $2, updated_by = $3, updated_at = now(), next_run_at = CASE WHEN $2 = 'active' AND schedule_minutes IS NOT NULL THEN now() + interval '1 minute' ELSE next_run_at END ${to === "disabled" ? ", current_task_id = NULL" : ""} WHERE key = $1 RETURNING *`, [key, to, actor.label])).rows[0];
      await audited(q, actor, `agent.${verb}`, key, `${verb[0]!.toUpperCase()}${verb.slice(1)}: ${cur.name} (${cur.status} → ${to})`, { status: cur.status }, { status: to }, requestId);
      return shapeAgent(row, undefined);
    },
  })),
  {
    method: "POST", path: "/agents/:key/run", permission: "agents:run", tx: false,
    async handler({ db, deps, actor, params, body }) {
      const key = params.key!;
      const b = parse(v.object({ mode: v.withDefault(v.enumOf(["analysis", "test", "diagnostic"] as const), "analysis"), entity_type: v.optional(v.string({ max: 40 })), entity_id: v.optional(v.id()) }), body);
      if (!AGENT_BY_KEY.has(key)) throw notFound("Agent");
      if (b.mode === "diagnostic") return diagnoseAgent(db, deps, key, actor);
      if (key === ORCHESTRATOR_KEY && b.mode === "analysis") throw conflict("Use POST /agents/orchestrate to run the orchestrator's cycle");
      const focus = b.entity_type && b.entity_id ? { entityType: b.entity_type, entityId: b.entity_id } : undefined;
      return runAgent(db, deps, key, { trigger: "manual", kind: b.mode === "test" ? "test" : "analysis", by: actor, focus, dryRun: b.mode === "test" });
    },
  },
  // ───────── approvals ─────────
  {
    method: "GET", path: "/approvals", permission: "approvals:read", tx: false,
    async handler({ q, query, actor }) {
      const pg = pageOf(query);
      const w: string[] = []; const p: unknown[] = [];
      if (str(query, "status")) { p.push(parse(v.enumOf(APPROVAL_STATUS), str(query, "status"))); w.push(`a.status = $${p.length}`); }
      if (str(query, "agent_key")) { p.push(str(query, "agent_key")); w.push(`a.agent_key = $${p.length}`); }
      if (str(query, "action_type")) { p.push(str(query, "action_type")); w.push(`a.action_type = $${p.length}`); }
      if (str(query, "mine") === "1") { p.push(actor.userSub); w.push(`a.requested_by = $${p.length}`); }
      const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
      const total = (await q.query<any>(`SELECT count(*)::int n FROM sales_approvals a ${where}`, p)).rows[0].n;
      const items = (await q.query<any>(`SELECT a.*, a.amount::float8 amount_num, p.label action_label, p.has_executor FROM sales_approvals a JOIN sales_approval_policies p ON p.action_type = a.action_type ${where} ORDER BY (a.status = 'PENDING') DESC, a.id DESC LIMIT $${p.length + 1} OFFSET $${p.length + 2}`, [...p, pg.pageSize, pg.offset])).rows;
      return { items: items.map((a: any) => ({ ...a, canDecide: canDecide(actor, a.required_role) && a.requested_by !== actor.userSub && can(actor, "approvals:decide") })), total, page: pg.page, pageSize: pg.pageSize };
    },
  },
  {
    method: "GET", path: "/approval-policies", permission: "approvals:read", tx: false,
    async handler({ q, db }) { await ensureAgents(db); return { items: (await q.query("SELECT * FROM sales_approval_policies ORDER BY always_protected DESC, action_type")).rows, executors: EXECUTOR_TYPES }; },
  },
  {
    method: "PATCH", path: "/approval-policies/:action", permission: "agents:manage",
    async handler({ q, actor, params, body, requestId }) {
      const cur = (await q.query<any>("SELECT * FROM sales_approval_policies WHERE action_type = $1 FOR UPDATE", [params.action])).rows[0];
      if (!cur) throw notFound("Policy");
      const b = parse(v.object({ requires_approval: v.optional(v.boolean()), auto_executable: v.optional(v.boolean()), approver_role: v.optional(v.enumOf(["sales_manager", "sales_director", "sales_admin", "finance"] as const)), threshold_amount: v.optional(v.nullable(v.money())), ttl_hours: v.optional(v.int({ min: 1, max: 720 })) }), body);
      if (cur.always_protected && (b.requires_approval === false || b.auto_executable === true)) throw forbidden("This action type is protected and always requires approval", "protected_policy");
      if (b.auto_executable && !cur.has_executor) throw unprocessable("This action type has no executor, so it cannot be automatic");
      if (b.auto_executable && (b.requires_approval ?? cur.requires_approval)) throw unprocessable("An action that requires approval cannot also be automatic");
      const sets: string[] = ["updated_by = $2", "updated_at = now()"]; const p: unknown[] = [params.action, actor.label];
      for (const [k, val] of Object.entries(b)) { if (val === undefined) continue; p.push(val); sets.push(`${k} = $${p.length}`); }
      const row = (await q.query(`UPDATE sales_approval_policies SET ${sets.join(", ")} WHERE action_type = $1 RETURNING *`, p)).rows[0];
      await audit(q, actor, { action: "approval.policy_change", entityType: "approval_policy", entityId: params.action, summary: `Changed approval policy ${params.action}`, before: cur, after: b }, requestId);
      return row;
    },
  },
  {
    method: "GET", path: "/approvals/:id", permission: "approvals:read", tx: false,
    async handler({ q, params }) {
      const a = (await q.query("SELECT a.*, p.label action_label, p.has_executor FROM sales_approvals a JOIN sales_approval_policies p ON p.action_type = a.action_type WHERE a.id = $1", [parse(v.id(), params.id)])).rows[0];
      if (!a) throw notFound("Approval");
      return a;
    },
  },
  ...(["approve", "reject"] as const).map((verb): Route => ({
    method: "POST", path: `/approvals/:id/${verb}`, permission: "approvals:decide", idempotent: true,
    async handler({ q, actor, params, body, now, requestId }) {
      const b = parse(v.object({ note: v.optional(v.string({ max: 500 })) }), body);
      return decideApproval(q, actor, parse(v.id(), params.id), verb, b.note, now, requestId);
    },
  })),
  {
    method: "POST", path: "/approvals/:id/cancel", permission: "approvals:read",
    async handler({ q, actor, params, now, requestId }) { return cancelApproval(q, actor, parse(v.id(), params.id), now, requestId); },
  },
  {
    method: "POST", path: "/approvals/:id/execute", permission: "approvals:decide", tx: false, idempotent: true,
    async handler({ db, deps, actor, params }) {
      const id = parse(v.id(), params.id);
      const a = (await db.query<any>("SELECT required_role FROM sales_approvals WHERE id = $1", [id])).rows[0];
      if (!a) throw notFound("Approval");
      if (!canDecide(actor, a.required_role)) throw forbidden(`Executing needs the ${a.required_role.replace("_", " ")} role`);
      return executeApproval(db, deps, id, actor, "automatic");
    },
  },
  {
    method: "POST", path: "/approvals/:id/complete-manually", permission: "approvals:decide",
    async handler({ q, actor, params, body, now, requestId }) {
      const b = parse(v.object({ note: v.string({ min: 3, max: 500 }) }), body);
      return completeManually(q, actor, parse(v.id(), params.id), b.note, now, requestId);
    },
  },
  // ───────── events ─────────
  {
    method: "POST", path: "/agents/events/process", permission: "agents:manage", tx: false,
    async handler({ db, deps }) { return processEvents(db, deps, 50); },
  },
  ...(["retry", "ignore"] as const).map((verb): Route => ({
    method: "POST", path: `/agents/events/:id/${verb}`, permission: "agents:manage",
    async handler({ q, actor, params, requestId }) {
      const id = parse(v.id(), params.id);
      const r = verb === "retry"
        ? await q.query("UPDATE sales_events SET status = 'pending', attempts = 0, next_attempt_at = NULL, last_error = NULL WHERE id = $1 AND status IN ('dead','failed') RETURNING id", [id])
        : await q.query("UPDATE sales_events SET status = 'ignored', processed_at = now() WHERE id = $1 AND status IN ('dead','failed','pending') RETURNING id", [id]);
      if (!r.rows[0]) throw conflict(`Event ${id} cannot be ${verb === "retry" ? "retried" : "ignored"} in its current state`);
      await audit(q, actor, { action: `event.${verb}`, entityType: "event", entityId: id, summary: `${verb === "retry" ? "Retried" : "Ignored"} sales event #${id}` }, requestId);
      return { id, status: verb === "retry" ? "pending" : "ignored" };
    },
  })),
];
void created; void AGENTS;
