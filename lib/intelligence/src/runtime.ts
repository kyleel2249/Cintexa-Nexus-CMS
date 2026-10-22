import { AgentRegistry, Orchestrator } from './orchestrator';
import type { ActionExecutor } from './orchestrator';
import { ToolRegistry } from './tools';
import { S } from './validate';
import { ModelRouter } from './llm';
import type { RouteConfig } from './llm';
import { staticPolicy } from './autonomy';
import type { AutonomyPolicy } from './autonomy';
import { ensureIntelSchema, SqlStore } from './sql-store';
import type { IntelDb } from './sql-store';
import { verifyAuditChain } from './store';
import { buildAgentRegistry } from './agents';
import { registerSalesTools } from './sales-tools';
import { registerWebsiteTools } from './website-tools';
import { salesExecutors } from './executors';
import type { AutonomyLevel } from './types';

export interface IntelSettings { autonomy: { defaultLevel: AutonomyLevel; overrides: Record<string, AutonomyLevel>; maxAutoPerWindow: number }; weights: { sales: number; financial: number; operations: number; data: number } }
export const DEFAULT_SETTINGS: IntelSettings = { autonomy: { defaultLevel: 2, overrides: {}, maxAutoPerWindow: 10 }, weights: { sales: 0.35, financial: 0.25, operations: 0.2, data: 0.2 } };

export interface IntelligenceOptions {
  /** Where intel_* tables live. */
  db: IntelDb;
  /** Where Sales tables live (defaults to db). */
  salesDb?: IntelDb;
  llm?: ModelRouter | null;
  /** Register the wi_* readers (API server only). */
  websiteTools?: boolean;
  now?: () => Date;
  concurrency?: number;
  extraExecutors?: Record<string, ActionExecutor>;
}

const FALLBACK: RouteConfig = { model: 'openai/gpt-4o-mini', maxTokens: 700, timeoutMs: 20_000, retries: 1, maxCostUsd: 0.05 };

export class Intelligence {
  readonly store: SqlStore; readonly tools = new ToolRegistry(); readonly agents: AgentRegistry; readonly orchestrator: Orchestrator;
  readonly db: IntelDb; readonly salesDb: IntelDb; readonly now: () => Date; readonly llm: ModelRouter;
  private policies = new Map<string, AutonomyPolicy>();

  constructor(o: IntelligenceOptions) {
    this.db = o.db; this.salesDb = o.salesDb ?? o.db; this.now = o.now ?? (() => new Date());
    this.llm = o.llm ?? new ModelRouter(null, {}, FALLBACK);
    this.store = new SqlStore(this.db); this.agents = buildAgentRegistry();
    registerSalesTools(this.tools, this.salesDb, { now: this.now });
    if (o.websiteTools) registerWebsiteTools(this.tools, this.salesDb);
    this.tools.register({ name: 'gov.audit_chain', risk: 'read', description: 'Verifies the tamper-evident audit chain.', args: S.obj({}),
      handler: async (_a, ctx) => { const ev = await this.store.listAudit(ctx.orgId); return { valid: verifyAuditChain(ev), events: ev.length }; } });
    this.tools.register({ name: 'gov.approvals', risk: 'read', description: 'Pending approval queue health.', args: S.obj({}),
      handler: async (_a, ctx) => { const p = await this.store.listApprovals(ctx.orgId, 'pending'); const cutoff = this.now().getTime() - 3 * 86_400_000;
        return { pending: p.length, stalePending: p.filter((a) => Date.parse(a.requestedAt) < cutoff).length }; } });
    this.orchestrator = new Orchestrator({
      store: this.store, agents: this.agents, tools: this.tools, llm: this.llm, now: this.now, concurrency: o.concurrency ?? 4,
      policy: (orgId) => this.policies.get(orgId) ?? staticPolicy(DEFAULT_SETTINGS.autonomy.defaultLevel),
      executors: { ...salesExecutors(this.salesDb, this.now), ...(o.extraExecutors ?? {}) },
    });
  }

  async getSettings(orgId: string): Promise<IntelSettings> {
    await ensureIntelSchema(this.db);
    const rows = (await this.db.query<{ key: string; value: any }>(`SELECT key, value FROM intel_settings WHERE org_id=$1`, [orgId])).rows;
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { autonomy: { ...DEFAULT_SETTINGS.autonomy, ...(m.autonomy ?? {}) }, weights: { ...DEFAULT_SETTINGS.weights, ...(m.weights ?? {}) } };
  }
  async saveSettings(orgId: string, s: IntelSettings, by: string): Promise<void> {
    await ensureIntelSchema(this.db);
    for (const key of ['autonomy', 'weights'] as const)
      await this.db.query(`INSERT INTO intel_settings (org_id, key, value, updated_by, updated_at) VALUES ($1,$2,$3::jsonb,$4,$5)
        ON CONFLICT (org_id, key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at`, [orgId, key, JSON.stringify(s[key]), by, this.now().toISOString()]);
    await this.loadPolicy(orgId);
  }
  /** Policy lookups inside the orchestrator are synchronous, so the stored policy is loaded before every run/decision. */
  async loadPolicy(orgId: string): Promise<IntelSettings> {
    const s = await this.getSettings(orgId);
    this.policies.set(orgId, staticPolicy(s.autonomy.defaultLevel, s.autonomy.overrides, s.autonomy.maxAutoPerWindow));
    return s;
  }
}

export function createIntelligence(o: IntelligenceOptions): Intelligence { return new Intelligence(o); }
