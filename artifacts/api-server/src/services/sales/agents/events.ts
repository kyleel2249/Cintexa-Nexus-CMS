/**
 * Sales event bus. Domain events from committed requests are stored durably in `sales_events`, then consumed by the
 * scheduler (or on demand). Consumers are idempotent (task idempotency key = event id + agent), retries are bounded with
 * back-off, exhausted events are dead-lettered and can be inspected, retried or ignored by an administrator.
 * Events caused by agents themselves are recorded but never dispatched back to agents, so workflows cannot recurse.
 */
import { randomUUID } from "../core/portable";
import type { Actor, Db } from "../core/types";
import type { Deps, DomainEvent } from "../core/router";
import { AGENTS } from "./catalog";
import { runAgent, agentActor } from "./runtime";

export const EVENT_CATALOG = [
  "lead.created", "lead.updated", "lead.status_changed", "lead.assigned", "lead.contacted", "lead.qualified", "lead.converted",
  "opportunity.created", "opportunity.stage_changed", "opportunity.amount_changed", "opportunity.stalled", "opportunity.won", "opportunity.lost",
  "activity.created", "activity.overdue", "activity.completed",
  "quotation.created", "quotation.approval_requested", "quotation.approved", "quotation.sent", "quotation.accepted", "quotation.expired",
  "order.created", "order.confirmed", "order.paid", "order.fulfilled", "order.returned", "order.cancelled", "order.blocked",
  "account.created", "account.health_changed", "contact.created", "contact.updated", "target.at_risk", "target.achieved",
  "forecast.generated", "forecast.deviation_detected", "customer.retention_risk_detected", "customer.renewal_approaching",
  "competitor.discovered", "competitor.observation_updated", "commission.calculated", "commission.approval_required", "automation.execution_failed",
] as const;

const MAX_ATTEMPTS = 5;

/** onCommitted hook: persist, never throw (a failed bus must not fail the user's request). */
export async function recordEvents(events: DomainEvent[], ctx: { db: Db; deps: Deps; actor: Actor | null }): Promise<void> {
  for (const e of events) {
    try {
      const origin = ctx.actor ? `user:${ctx.actor.userSub}` : "system";
      const ignore = (e.depth ?? 0) > 0 || origin.startsWith("agent:");
      await ctx.db.query(
        `INSERT INTO sales_events (event_id, type, entity_type, entity_id, origin, payload, depth, status, occurred_at, processed_at) VALUES ($1,$2,$3,$4,$5,$6::text::jsonb,$7,$8,$9, CASE WHEN $8 = 'ignored' THEN now() END) ON CONFLICT (event_id) DO NOTHING`,
        [randomUUID(), e.type, e.entityType, e.entityId, origin, JSON.stringify(e.data ?? {}).slice(0, 4000), e.depth ?? 0, ignore ? "ignored" : "pending", ctx.deps.now().toISOString()]);
    } catch (err) { ctx.deps.log.warn({ err, event: e.type }, "Could not record sales event"); }
  }
}

export async function processEvents(db: Db, deps: Deps, limit = 25): Promise<{ processed: number; failed: number; dead: number; runs: number }> {
  const now = deps.now();
  const rows = (await db.query<any>(`SELECT * FROM sales_events WHERE status IN ('pending','failed') AND (next_attempt_at IS NULL OR next_attempt_at <= $1::timestamptz) ORDER BY id LIMIT $2`, [now.toISOString(), limit])).rows;
  const out = { processed: 0, failed: 0, dead: 0, runs: 0 };
  for (const e of rows) {
    const claim = await db.query("UPDATE sales_events SET attempts = attempts + 1 WHERE id = $1 AND status IN ('pending','failed') AND attempts = $2 RETURNING attempts", [e.id, e.attempts]);
    if (!claim.rows[0]) continue; // another instance took it
    try {
      const subscribed = AGENTS.filter((a) => a.events?.includes(e.type));
      const active = (await db.query<{ key: string }>("SELECT key FROM sales_agents WHERE status = 'active' AND key = ANY($1::text[])", [subscribed.map((a) => a.key)])).rows.map((r) => r.key);
      let failedAgent: string | null = null;
      for (const key of active) {
        const r = await runAgent(db, deps, key, { trigger: "event", kind: "event", by: agentActor(key), focus: { entityType: e.entity_type, entityId: e.entity_id }, idempotencyKey: `evt:${e.event_id}:${key}`, limit: 25 });
        if (r.status === "failed") failedAgent = key; else if (r.status === "completed") out.runs++;
      }
      if (failedAgent) throw new Error(`Agent ${failedAgent} failed while handling ${e.type}`);
      await db.query("UPDATE sales_events SET status = 'processed', processed_at = now(), last_error = NULL WHERE id = $1", [e.id]);
      out.processed++;
    } catch (err) {
      const attempts = e.attempts + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      await db.query("UPDATE sales_events SET status = $2, last_error = $3, next_attempt_at = $4 WHERE id = $1", [e.id, dead ? "dead" : "failed", (err instanceof Error ? err.message : "error").slice(0, 300), new Date(now.getTime() + Math.min(60, 2 ** attempts) * 60_000).toISOString()]);
      if (dead) out.dead++; else out.failed++;
    }
  }
  return out;
}
