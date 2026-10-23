import type { Queryable } from "../core/types";
import type { SalesSettings } from "../core/settings";

/** What kind of statement a finding is. Predictions are never facts; proposals are never completed actions. */
export type Stage = "fact" | "metric" | "prediction" | "recommendation" | "proposed_action";
export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type Category = "risk" | "opportunity" | "efficiency" | "compliance" | "info";
export type Level = 1 | 2 | 3;

export interface Evidence { type: string; id?: number | string; label: string; value?: string | number | null }

export interface Proposal {
  actionType: string;
  entityType: string;
  entityId: number;
  summary: string;
  payload: Record<string, unknown>;
  amount?: string;
  currency?: string;
}

export interface Finding {
  stage: Stage;
  severity: Severity;
  category: Category;
  title: string;
  whatDetected: string;
  whyItMatters?: string;
  action?: string;
  expectedOutcome?: string;
  ownerMemberId?: number | null;
  dueInDays?: number;
  entityType?: string;
  entityId?: number;
  evidence: Evidence[];
  assumptions?: Record<string, unknown>;
  /** stable key: the same condition on the same record always yields the same key (dedupe + auto-resolve) */
  dedupeKey: string;
  impactAmount?: number;
  proposal?: Proposal;
}

export interface AnalyzerCtx {
  q: Queryable;
  now: Date;
  today: string;
  settings: SalesSettings;
  thresholds: Record<string, number>;
  /** when set, the run was triggered by an event about one record */
  focus?: { entityType: string; entityId: number };
  limit: number;
  /** which provider adapters are installed in this process (used by governance checks) */
  integrations: { ai: boolean; email: boolean; whatsapp: boolean; inventory: boolean; finance: boolean };
}

export type ToolName = "read:crm" | "read:finance" | "read:analytics" | "read:documents" | "propose:action" | "write:internal_task" | "write:internal_notification" | "write:lead_assignment" | "queue:customer_message";

export interface AgentDef {
  key: string;
  name: string;
  purpose: string;
  group: "orchestration" | "operations" | "revenue" | "customer" | "intelligence" | "governance";
  version: string;
  defaultLevel: Level;
  maxLevel: Level;
  tier: "economy" | "standard" | "reasoning";
  scheduleMinutes: number | null;
  tools: ToolName[];
  /** data domains the agent may read; shown in the registry, enforced by the fact that analyzers only query these */
  reads: string[];
  thresholds: Record<string, number>;
  /** event types that trigger a focused run */
  events?: string[];
  /** honest statement of what this agent cannot do in the current deployment (shown in the registry) */
  limitations?: string;
  analyze?: (ctx: AnalyzerCtx) => Promise<Finding[]>;
}

export const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 90, high: 70, medium: 50, low: 30, info: 10 };

export function priorityOf(f: Pick<Finding, "severity" | "impactAmount" | "stage">): number {
  const base = SEVERITY_WEIGHT[f.severity];
  const impact = f.impactAmount && f.impactAmount > 0 ? Math.min(9, Math.floor(Math.log10(f.impactAmount + 1) * 1.5)) : 0;
  return Math.min(100, base + impact + (f.stage === "proposed_action" ? 1 : 0));
}

export const ev = (type: string, label: string, value?: string | number | null, id?: number | string): Evidence => ({ type, label, value: value ?? null, ...(id !== undefined ? { id } : {}) });

/** `AND col = id` when the run is focused on one record of the given kind. */
export function focusSql(ctx: AnalyzerCtx, entityType: string, col: string): string {
  return ctx.focus && ctx.focus.entityType === entityType ? ` AND ${col} = ${Number(ctx.focus.entityId) | 0}` : "";
}
/** a focused run about a different kind of record has nothing to do for this analyzer section */
export const focusedElsewhere = (ctx: AnalyzerCtx, entityType: string): boolean => Boolean(ctx.focus && ctx.focus.entityType !== entityType);

export const num = (x: unknown, d = 0): number => { const n = Number(x); return Number.isFinite(n) ? n : d; };
export const th = (ctx: AnalyzerCtx, key: string, d: number): number => num(ctx.thresholds[key], d);
export const personName = (r: { first_name?: string | null; last_name?: string | null }) => `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim();
