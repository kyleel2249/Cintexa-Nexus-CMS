/**
 * Agent 1 - Chief Sales Intelligence Orchestrator.
 * Runs the network in dependency order, then synthesises: duplicate/conflicting proposals are superseded, records flagged by
 * several independent agents are raised in priority, critical findings are escalated to leaders (internal notification only),
 * and past recommendations are checked against what really happened.
 */
import type { Actor, Db } from "../core/types";
import type { Deps } from "../core/router";
import { audit } from "../core/audit";
import { conflict } from "../core/errors";
import { notify } from "../modules/activities";
import { AGENT_BY_KEY, ORCHESTRATION_ORDER, ORCHESTRATOR_KEY } from "./catalog";
import { agentActor, loadAgent, runAgent, type RunResult } from "./runtime";
import { sweepApprovals } from "./approvals";

const TIME_BUDGET_MS = 4 * 60_000;

export interface OrchestrationResult {
  startedAt: string; durationMs: number;
  agents: Array<{ key: string; status: "completed" | "failed" | "skipped"; reason?: string; findings?: number; created?: number; resolved?: number; prepared?: number; executed?: number; error?: string }>;
  synthesis: { superseded: number; corroborated: number; escalated: number; verified: number; expiredApprovals: number };
  totals: { findings: number; created: number; approvalsPrepared: number; actionsExecuted: number; failures: number };
}

export async function orchestrate(db: Db, deps: Deps, by: Pick<Actor, "userSub" | "label">, only?: string[]): Promise<OrchestrationResult> {
  const orch = await loadAgent(db, ORCHESTRATOR_KEY);
  if (orch.status !== "active") throw conflict("The orchestrator is not active. Enable it to run the network.", "orchestrator_inactive");
  const started = Date.now();
  const startedAt = deps.now().toISOString();
  const swept = await sweepApprovals(db, deps.now());
  const agents: OrchestrationResult["agents"] = [];
  const totals = { findings: 0, created: 0, approvalsPrepared: 0, actionsExecuted: 0, failures: 0 };
  const add = (key: string, r: RunResult) => {
    agents.push({ key, status: r.status, reason: r.reason, findings: r.findings, created: r.created, resolved: r.resolved, prepared: r.proposals.prepared, executed: r.proposals.executed, error: r.error });
    totals.findings += r.findings; totals.created += r.created; totals.approvalsPrepared += r.proposals.prepared; totals.actionsExecuted += r.proposals.executed; if (r.status === "failed") totals.failures++;
  };
  for (const tier of ORCHESTRATION_ORDER) {
    for (const key of tier) {
      if (only && !only.includes(key)) continue;
      if (Date.now() - started > TIME_BUDGET_MS) { agents.push({ key, status: "skipped", reason: "orchestration time budget reached" }); continue; }
      const row = await loadAgent(db, key);
      if (row.status !== "active") { agents.push({ key, status: "skipped", reason: row.status }); continue; }
      try { add(key, await runAgent(db, deps, key, { trigger: "orchestrator", by: agentActor(ORCHESTRATOR_KEY) })); }
      catch (err) { agents.push({ key, status: "failed", error: err instanceof Error ? err.message : "error" }); totals.failures++; }
    }
  }
  // synthesis pass by the orchestrator agent itself
  try { add(ORCHESTRATOR_KEY, await runAgent(db, deps, ORCHESTRATOR_KEY, { trigger: "orchestrator", kind: "orchestration", by })); }
  catch (err) { agents.push({ key: ORCHESTRATOR_KEY, status: "failed", error: err instanceof Error ? err.message : "error" }); totals.failures++; }

  const actor = agentActor(ORCHESTRATOR_KEY);
  const superseded = (await db.query(`UPDATE sales_approvals a SET status = 'CANCELLED', decided_by = $1, decided_at = now(), decision_note = 'Superseded by the orchestrator: a newer proposal exists for the same action and record', updated_at = now()
    WHERE a.status = 'PENDING' AND EXISTS (SELECT 1 FROM sales_approvals b WHERE b.status = 'PENDING' AND b.action_type = a.action_type AND b.entity_type IS NOT DISTINCT FROM a.entity_type AND b.entity_id IS NOT DISTINCT FROM a.entity_id AND b.id > a.id) RETURNING a.id`, [actor.userSub])).rowCount;
  const corroborated = (await db.query(`UPDATE sales_agent_recommendations r SET priority_score = LEAST(100, r.priority_score + 5 * (m.n - 1))
    FROM (SELECT entity_type, entity_id, count(DISTINCT agent_key)::int n FROM sales_agent_recommendations WHERE status = 'open' AND entity_id IS NOT NULL AND agent_key <> $1 GROUP BY 1, 2 HAVING count(DISTINCT agent_key) >= 2) m
    WHERE r.status = 'open' AND r.agent_key <> $1 AND r.entity_type = m.entity_type AND r.entity_id = m.entity_id RETURNING r.id`, [ORCHESTRATOR_KEY])).rowCount;
  const limit = Number(orch.thresholds?.criticalNotifyLimit ?? 5);
  let escalated = 0;
  const crit = (await db.query<{ id: number; title: string }>("SELECT id, title FROM sales_agent_recommendations WHERE status = 'open' AND severity = 'critical' ORDER BY priority_score DESC, id DESC LIMIT $1", [limit])).rows;
  if (crit.length) {
    const leaders = (await db.query<{ id: number }>("SELECT id FROM sales_members WHERE active AND role IN ('sales_admin','sales_director')")).rows;
    await db.tx(async (q) => { for (const c of crit) for (const m of leaders) if (await notify(q, m.id, { kind: "agent_critical", title: `Critical finding: ${c.title}`.slice(0, 200), link: "/sales/command-centre", severity: "critical", dedupeKey: `orch:crit:${c.id}` })) escalated++; });
  }
  const verified = await verifyOutcomes(db);
  await db.tx((q) => audit(q, actor, { action: "agent.orchestrate", entityType: "agent", entityId: ORCHESTRATOR_KEY, summary: `Orchestration cycle: ${agents.filter((a) => a.status === "completed").length} agents ran, ${totals.findings} findings, ${totals.approvalsPrepared} approvals requested, ${superseded} superseded, ${escalated} escalations, ${verified} outcomes verified, ${totals.failures} failures` }));
  void AGENT_BY_KEY;
  return { startedAt, durationMs: Date.now() - started, agents, synthesis: { superseded, corroborated, escalated, verified, expiredApprovals: swept.expired }, totals };
}

/** Compare accepted/actioned recommendations with what the record shows now. Observation only; no claim of causation. */
export async function verifyOutcomes(db: Db): Promise<number> {
  const specs: Array<[string, string]> = [
    ["opportunity", "SELECT r.id, o.status AS observed FROM sales_agent_recommendations r JOIN sales_opportunities o ON o.id = r.entity_id WHERE r.entity_type = 'opportunity' AND r.status IN ('accepted','actioned') AND o.status <> 'open'"],
    ["lead", "SELECT r.id, l.status AS observed FROM sales_agent_recommendations r JOIN sales_leads l ON l.id = r.entity_id WHERE r.entity_type = 'lead' AND r.status IN ('accepted','actioned') AND l.status IN ('converted','disqualified')"],
    ["quotation", "SELECT r.id, x.status AS observed FROM sales_agent_recommendations r JOIN sales_quotations x ON x.id = r.entity_id WHERE r.entity_type = 'quotation' AND r.status IN ('accepted','actioned') AND x.status IN ('accepted','rejected','expired','cancelled','superseded')"],
    ["order", "SELECT r.id, o.status AS observed FROM sales_agent_recommendations r JOIN sales_orders o ON o.id = r.entity_id WHERE r.entity_type = 'order' AND r.status IN ('accepted','actioned') AND o.status IN ('completed','fulfilled','cancelled')"],
    ["activity", "SELECT r.id, a.status AS observed FROM sales_agent_recommendations r JOIN sales_activities a ON a.id = r.entity_id WHERE r.entity_type = 'activity' AND r.status IN ('accepted','actioned') AND a.status <> 'open'"],
  ];
  let n = 0;
  for (const [type, sql] of specs) {
    const rows = (await db.query<{ id: number; observed: string }>(sql)).rows;
    for (const r of rows) {
      await db.query("UPDATE sales_agent_recommendations SET status = 'verified', outcome = $2::text::jsonb, updated_at = now() WHERE id = $1", [r.id, JSON.stringify({ verifiedAt: new Date().toISOString(), entityType: type, observedStatus: r.observed, note: "Observed state of the record after the recommendation; not proof that the recommendation caused it." })]);
      n++;
    }
  }
  return n;
}
