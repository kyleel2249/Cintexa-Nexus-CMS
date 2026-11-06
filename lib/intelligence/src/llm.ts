import type { Usage } from './types';
import { validate } from './validate';
import type { Schema } from './validate';

export interface ProviderRequest { model: string; system: string; user: string; maxTokens: number; signal: AbortSignal }
export interface ProviderResponse { text: string; usage: Usage }
export type Provider = (req: ProviderRequest) => Promise<ProviderResponse>;

export type LlmResult<T> =
  | { ok: true; value: T; usage: Usage; model: string }
  | { ok: false; degraded: true; reason: string; usage: Usage };

export interface RouteConfig { model: string; maxTokens: number; timeoutMs: number; retries: number; maxCostUsd: number }

const ZERO: Usage = { promptTokens: 0, completionTokens: 0, costUsd: 0 };

/** Task-class model routing with retries, timeouts, cost cap and strict JSON validation. On failure returns a degraded result, never fabricated content. */
export class ModelRouter {
  private unavailableUntil = new Map<string, number>();
  constructor(
    private provider: Provider | null,
    private routes: Record<string, RouteConfig>,
    private fallbackRoute: RouteConfig,
    private now: () => number = Date.now,
  ) {}

  /** Whether any provider is wired in (says nothing about its health). */
  get configured(): boolean { return this.provider !== null; }

  availability(model: string): 'available' | 'cooling_down' {
    return (this.unavailableUntil.get(model) ?? 0) > this.now() ? 'cooling_down' : 'available';
  }

  async completeJson<T>(taskClass: string, system: string, user: string, schema: Schema): Promise<LlmResult<T>> {
    if (!this.provider) return { ok: false, degraded: true, reason: 'ai_provider_not_configured', usage: ZERO };
    const route = this.routes[taskClass] ?? this.fallbackRoute;
    if (this.availability(route.model) === 'cooling_down') return { ok: false, degraded: true, reason: 'model_cooling_down', usage: ZERO };
    const total: Usage = { ...ZERO };
    let lastReason = 'unknown_error';
    for (let attempt = 0; attempt <= route.retries; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), route.timeoutMs);
      try {
        const r = await this.provider({ model: route.model, system, user, maxTokens: route.maxTokens, signal: ac.signal });
        total.promptTokens += r.usage.promptTokens; total.completionTokens += r.usage.completionTokens; total.costUsd += r.usage.costUsd;
        if (total.costUsd > route.maxCostUsd) return { ok: false, degraded: true, reason: 'cost_limit_exceeded', usage: total };
        let parsed: unknown;
        try { parsed = JSON.parse(r.text.replace(/^```(?:json)?\s*|\s*```$/g, '')); }
        catch { lastReason = 'invalid_json'; continue; }
        const errs = validate(schema, parsed);
        if (errs.length) { lastReason = `schema_violation: ${errs[0]}`; continue; }
        return { ok: true, value: parsed as T, usage: total, model: route.model };
      } catch (e) {
        lastReason = ac.signal.aborted ? 'timeout' : `provider_error: ${(e as Error).message.slice(0, 120)}`;
      } finally { clearTimeout(timer); }
    }
    this.unavailableUntil.set(route.model, this.now() + 30_000);
    return { ok: false, degraded: true, reason: lastReason, usage: total };
  }
}
