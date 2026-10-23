import type { Tone } from "./labels";

export type Stage = "fact" | "metric" | "prediction" | "recommendation" | "proposed_action";
export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface AgentView {
  key: string; name: string; purpose: string; group: string; version: string; status: "active" | "paused" | "disabled"; level: 1 | 2 | 3; maxLevel: 1 | 2 | 3;
  model: { tier: "economy" | "standard" | "reasoning"; override: string | null; fallback: string | null; resolved: string; useAi: boolean };
  tools: string[]; reads: string[]; limitations: string | null; events: string[];
  schedule: { everyMinutes: number | null; nextRunAt: string | null }; thresholds: Record<string, number>;
  lastActivityAt: string | null; lastSuccessAt: string | null; currentTask: { id: number; status: string | null; kind: string | null } | null;
  stats: { runs: number; successRate: number | null; failureRate: number | null; avgLatencyMs: number; costUsd: number; tokens: number; openFindings: number; pendingApprovals: number };
  evaluation: { decidedRecommendations: number; acceptanceRate: number | null; falsePositiveRate: number | null; note: string };
}

export interface CommandCentre {
  totals: { configured: number; active: number; idle: number; running: number; paused: number; disabled: number; awaitingApproval: number };
  tasks: { queued: number; running: number; completed: number; failed: number };
  executions: { avgDurationMs: number; failed24h: number; runs24h: number; eventRetries: number };
  usage: { tokens: number; estimatedCostUsd: number | null; costNote: string; aiRuns: number; aiFailures: number };
  lastSuccessfulExecution: string | null; health: "healthy" | "attention" | "degraded" | "idle";
  ai: { installed: boolean; enabled: boolean; externalAllowed: boolean; models: Record<string, string>; mode: "ai_narration_available" | "deterministic_only" };
  findings: { open: number; highOrCritical: number; top: Array<{ id: number; agent_key: string; stage: Stage; severity: Severity; title: string; what_detected: string; recommended_action: string | null; entity_type: string | null; entity_id: number | null }> };
  pendingHumanDecisions: number; approvals: { pending: number; failed: number; executing: number }; events: { backlog: number; dead: number; processed: number };
  agents: AgentView[];
}

export const LEVEL_LABEL: Record<number, { name: string; hint: string }> = {
  1: { name: "Observe", hint: "Analyses and recommends only." },
  2: { name: "Prepare", hint: "Also prepares actions and approval requests; nothing is executed automatically." },
  3: { name: "Execute", hint: "May run internal actions that policy allows without approval. Protected actions still need approval." },
};

export const STAGE_LABEL: Record<Stage, { label: string; hint: string; tone: Tone }> = {
  fact: { label: "Recorded fact", hint: "Observed in your records", tone: "info" },
  metric: { label: "Calculated metric", hint: "Computed from records by deterministic code", tone: "neutral" },
  prediction: { label: "Prediction", hint: "An estimate, not a fact", tone: "violet" },
  recommendation: { label: "Recommendation", hint: "A suggested action", tone: "gold" },
  proposed_action: { label: "Proposed action", hint: "Prepared for approval or execution; not done yet", tone: "warning" },
};

export const SEVERITY_TONE: Record<Severity, Tone> = { info: "neutral", low: "info", medium: "gold", high: "warning", critical: "danger" };
export const APPROVAL_TONE: Record<string, Tone> = { PENDING: "warning", APPROVED: "info", REJECTED: "danger", EXECUTING: "violet", COMPLETED: "success", FAILED: "danger", CANCELLED: "neutral", EXPIRED: "neutral" };
export const HEALTH_TONE: Record<CommandCentre["health"], { tone: Tone; label: string; text: string }> = {
  healthy: { tone: "success", label: "Healthy", text: "Agents are running normally." },
  attention: { tone: "warning", label: "Needs attention", text: "Something failed or is stuck. Check the Activity tab." },
  degraded: { tone: "danger", label: "Degraded", text: "More than a quarter of runs failed in the last 24 hours." },
  idle: { tone: "neutral", label: "Idle", text: "No agent is active yet. Activate agents to start analysis." },
};
export const GROUP_COLOR: Record<string, string> = {
  orchestration: "from-violet-500/20 to-fuchsia-500/10", operations: "from-sky-500/20 to-cyan-500/10", revenue: "from-emerald-500/20 to-teal-500/10",
  customer: "from-amber-500/20 to-orange-500/10", intelligence: "from-indigo-500/20 to-blue-500/10", governance: "from-rose-500/20 to-pink-500/10",
};

export function entityHref(type: string | null | undefined, id: number | null | undefined): string | null {
  if (!type || !id) return null;
  const map: Record<string, string> = { lead: "/sales/leads", account: "/sales/accounts", opportunity: "/sales/opportunities", quotation: "/sales/quotations", order: "/sales/orders", contact: "/sales/contacts", activity: "/sales/activities", campaign: "/sales/campaigns", competitor: "/sales/competitors", product: "/sales/products" };
  return map[type] ? `${map[type]}/${id}` : null;
}
export const ago = (ms: number) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
