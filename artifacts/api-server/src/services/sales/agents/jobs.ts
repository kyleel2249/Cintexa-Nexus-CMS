import type { Db } from "../core/types";
import type { Deps } from "../core/router";
import { ensureAgents, runAgent, agentActor } from "./runtime";
import { processEvents } from "./events";
import { sweepApprovals } from "./approvals";
import { orchestrate } from "./orchestrator";
import { ORCHESTRATOR_KEY } from "./keys";

/** Scheduler pass for the agent network: events, approval expiry, then due agents (bounded per tick). */
export async function runAgentJobs(db: Db, deps: Deps): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  await ensureAgents(db);
  out.events = await processEvents(db, deps, 25);
  out.approvals = await sweepApprovals(db, deps.now());
  const orchestratorActive = (await db.query("SELECT 1 FROM sales_agents WHERE key = $1 AND status = 'active'", [ORCHESTRATOR_KEY])).rows.length > 0;
  const due = (await db.query<{ key: string; schedule_minutes: number }>(
    `SELECT key, schedule_minutes FROM sales_agents WHERE status = 'active' AND schedule_minutes IS NOT NULL AND next_run_at IS NOT NULL AND next_run_at <= $1::timestamptz ${orchestratorActive ? "AND key = $2" : "AND key <> $2"} ORDER BY next_run_at LIMIT 3`,
    [deps.now().toISOString(), ORCHESTRATOR_KEY])).rows;
  const ran: string[] = [];
  for (const a of due) {
    // atomic claim so two instances never run the same schedule
    const claim = await db.query("UPDATE sales_agents SET next_run_at = $2::timestamptz + (schedule_minutes || ' minutes')::interval WHERE key = $1 AND next_run_at <= $2::timestamptz RETURNING key", [a.key, deps.now().toISOString()]);
    if (!claim.rows[0]) continue;
    try {
      if (a.key === ORCHESTRATOR_KEY) await orchestrate(db, deps, agentActor(ORCHESTRATOR_KEY));
      else await runAgent(db, deps, a.key, { trigger: "schedule", by: agentActor(a.key) });
      ran.push(a.key);
    } catch (err) { deps.log.error({ err, agent: a.key }, "Scheduled agent run failed"); }
  }
  out.ran = ran;
  return out;
}
