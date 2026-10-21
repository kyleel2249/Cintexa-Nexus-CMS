import type { Severity } from './types.ts';

export interface Opp { id: string; value: number; currency: string; probability: number }

/** Weighted Pipeline = sum(value * probability). Grouped per currency; currencies are never silently mixed. Not guaranteed revenue. */
export function weightedPipeline(opps: Opp[]): Record<string, { count: number; total: number; weighted: number }> {
  const out: Record<string, { count: number; total: number; weighted: number }> = {};
  for (const o of opps) {
    if (!(o.probability >= 0 && o.probability <= 1)) throw new Error(`probability out of range for ${o.id}`);
    if (!(o.value >= 0)) throw new Error(`negative value for ${o.id}`);
    const b = (out[o.currency] ??= { count: 0, total: 0, weighted: 0 });
    b.count++; b.total += o.value; b.weighted += o.value * o.probability;
  }
  return out;
}

export function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null; // null = not computable, never 0
}

export const SEVERITY_WEIGHT: Record<Severity, number> = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFORMATIONAL: 1 };

/** Severity and confidence are separate axes. Severe-but-weak findings are routed to verification, not presented as fact. */
export function triage(severity: Severity, confidence: number): 'confirmed_priority' | 'needs_verification' | 'standard' {
  if (SEVERITY_WEIGHT[severity] >= 4 && confidence < 0.5) return 'needs_verification';
  return SEVERITY_WEIGHT[severity] >= 4 ? 'confirmed_priority' : 'standard';
}

export interface RecInputs { impact: number; confidence: number; urgency: number; effort: number; risk: number } // impact/urgency/effort/risk 1..5, confidence 0..1
/** Transparent score = impact * confidence * urgency / (effort * risk). Higher is better to do first. */
export function recommendationScore(r: RecInputs): number {
  for (const k of ['impact', 'urgency', 'effort', 'risk'] as const) if (!(r[k] >= 1 && r[k] <= 5)) throw new Error(`${k} must be 1..5`);
  if (!(r.confidence >= 0 && r.confidence <= 1)) throw new Error('confidence must be 0..1');
  return (r.impact * r.confidence * r.urgency) / (r.effort * r.risk);
}

export interface DomainScore { domain: string; value: number | null; weight: number; coverage: number }
export interface HealthScore {
  score: number | null; reason?: string; dataCoverage: number;
  domains: { domain: string; value: number | null; effectiveWeight: number; contribution: number | null }[];
  positives: string[]; negatives: string[];
}

/** Weighted mean over domains that actually have data. Refuses to produce a score when weighted coverage is below minCoverage. */
export function healthScore(domains: DomainScore[], minCoverage = 0.5): HealthScore {
  const totalW = domains.reduce((s, d) => s + d.weight, 0);
  if (totalW <= 0) return { score: null, reason: 'no_weights', dataCoverage: 0, domains: [], positives: [], negatives: [] };
  const usable = domains.filter((d) => d.value !== null && d.coverage > 0);
  const coverage = usable.reduce((s, d) => s + d.weight * d.coverage, 0) / totalW;
  const effW = usable.reduce((s, d) => s + d.weight * d.coverage, 0);
  const detail = domains.map((d) => {
    const usableD = d.value !== null && d.coverage > 0;
    const ew = usableD && effW > 0 ? (d.weight * d.coverage) / effW : 0;
    return { domain: d.domain, value: d.value, effectiveWeight: ew, contribution: usableD ? ew * (d.value as number) : null };
  });
  if (coverage < minCoverage) return { score: null, reason: 'insufficient_data_coverage', dataCoverage: coverage, domains: detail, positives: [], negatives: [] };
  const score = detail.reduce((s, d) => s + (d.contribution ?? 0), 0);
  const ranked = detail.filter((d) => d.value !== null);
  return {
    score: Math.round(score * 10) / 10, dataCoverage: coverage, domains: detail,
    positives: ranked.filter((d) => (d.value as number) >= 75).map((d) => d.domain),
    negatives: ranked.filter((d) => (d.value as number) < 50).map((d) => d.domain),
  };
}
