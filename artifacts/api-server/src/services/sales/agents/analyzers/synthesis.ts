import { type AnalyzerCtx, type Finding, ev } from "../types";
import { ORCHESTRATOR_KEY } from "../keys";

/** Agent 1 analysis step: cross-agent synthesis, evaluated after the delegated agents have run. Read-only. */
export async function orchestratorAnalyze(ctx: AnalyzerCtx): Promise<Finding[]> {
  const out: Finding[] = [];
  const { q, now } = ctx;
  const multi = (await q.query<any>(`SELECT entity_type, entity_id, count(DISTINCT agent_key)::int agents, array_agg(DISTINCT agent_key) keys, array_agg(title ORDER BY priority_score DESC) titles, max(priority_score)::int top
    FROM sales_agent_recommendations WHERE status = 'open' AND entity_id IS NOT NULL AND agent_key <> $1 AND severity IN ('medium','high','critical') GROUP BY entity_type, entity_id HAVING count(DISTINCT agent_key) >= 2 ORDER BY top DESC, agents DESC LIMIT 10`, [ORCHESTRATOR_KEY])).rows;
  for (const m of multi) out.push({
    stage: "recommendation", severity: m.top >= 70 ? "high" : "medium", category: "risk", entityType: m.entity_type, entityId: m.entity_id, dueInDays: 2,
    title: `${m.agents} agents flag the same ${m.entity_type} (#${m.entity_id})`, whatDetected: `Independent agents (${(m.keys as string[]).join(", ")}) each raised a medium-or-higher finding on this record: ${(m.titles as string[]).slice(0, 3).join(" · ")}.`,
    whyItMatters: "Agreement between independent checks is stronger evidence than a single flag, so this is raised above the individual findings.", action: "Open the record and handle the findings together instead of one by one.",
    evidence: (m.titles as string[]).slice(0, 5).map((t) => ev("finding", t)), assumptions: { rule: "two or more different agents, medium severity or higher, same record" }, dedupeKey: `orch:multi:${m.entity_type}:${m.entity_id}`,
  });
  const pend = (await q.query<any>(`SELECT count(*)::int n, min(created_at) oldest FROM sales_approvals WHERE status = 'PENDING'`)).rows[0];
  if (pend.n > 0) out.push({ stage: "metric", severity: "medium", category: "efficiency", title: `${pend.n} decision${pend.n === 1 ? "" : "s"} waiting for a human`, whatDetected: `${pend.n} proposed action${pend.n === 1 ? " is" : "s are"} waiting for approval; the oldest has waited ${Math.floor((now.getTime() - new Date(pend.oldest).getTime()) / 3600000)} hours. Nothing has been done on any of them.`, whyItMatters: "Recommendations only create value once someone decides.", action: "Review the approval queue.", evidence: [ev("metric", "Pending approvals", pend.n)], dedupeKey: "orch:pending" });
  const failed = (await q.query<any>(`SELECT agent_key, error FROM sales_agent_executions WHERE status = 'failed' AND started_at > $1::timestamptz - interval '6 hours' ORDER BY started_at DESC LIMIT 5`, [now.toISOString()])).rows;
  if (failed.length) out.push({ stage: "fact", severity: "medium", category: "risk", title: `${failed.length} agent run${failed.length === 1 ? "" : "s"} failed recently`, whatDetected: failed.map((f: any) => `${f.agent_key}: ${String(f.error ?? "").slice(0, 80)}`).join(" · "), whyItMatters: "Failed agents leave their part of the business unmonitored.", action: "Inspect the execution logs in the Command Centre.", evidence: failed.map((f: any) => ev("agent", f.agent_key)), dedupeKey: "orch:failed-runs" });
  return out;
}
