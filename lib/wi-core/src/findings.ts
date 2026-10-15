import { getTest } from "./catalog";
import { aggregateOutcomes, lowerSeverity, type TestOutcome } from "./scoring";
import {
  EFFORT_HOURS,
  type CheckResult,
  type Confidence,
  type Effort,
  type Evidence,
  type Finding,
  type FindingKind,
  type Horizon,
  type Provenance,
  type Recommendation,
  type Roadmap,
  type Severity,
  type TestDefinition,
  type VerificationState,
} from "./types";

/** Stable 53-bit string hash (cyrb53). Deterministic across runtimes, so fingerprints survive between audits. */
export function hash53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** A finding is identified by the site and the test, so the same defect recurs under the same fingerprint. */
export function fingerprintFor(hostname: string, testId: string): string {
  return `f_${hash53(`${hostname.toLowerCase()}|${testId}`)}`;
}

// ---------------------------------------------------------------------------
// Transparent priority formula
// ---------------------------------------------------------------------------

export const SEVERITY_POINTS: Record<Severity, number> = { critical: 100, high: 75, medium: 50, low: 25, info: 5 };
export const CONFIDENCE_FACTOR: Record<Confidence, number> = { high: 1, medium: 0.85, low: 0.7 };
/** Cheaper fixes rank slightly higher so quick wins surface first. */
export const EFFORT_FACTOR: Record<Effort, number> = { XS: 1, S: 0.95, M: 0.85, L: 0.75, XL: 0.65 };
export const GATE_BONUS = 15;
export const BLOCKING_BONUS = 10;

export const PRIORITY_FORMULA =
  "priority = min(100, (severity points x breadth x confidence + gate bonus + blocking bonus) x effort factor). " +
  "Severity points: critical 100, high 75, medium 50, low 25. Breadth = 0.6 + 0.4 x (affected pages / applicable pages) (1 for site-level tests). " +
  "Confidence: high 1, medium 0.85, low 0.7. Gate bonus +15 for critical-defect gate tests; blocking bonus +10 for problems that block indexing or a journey. " +
  "Effort factor: XS 1, S 0.95, M 0.85, L 0.75, XL 0.65. The value orders work; it is not a forecast of traffic, ranking or revenue.";

export interface PriorityInput {
  severity: Severity;
  affected: number;
  applicable: number;
  confidence: Confidence;
  effort: Effort;
  gate?: boolean;
  blocking?: boolean;
}

export function priorityScore(i: PriorityInput): number {
  const breadth = i.applicable > 0 ? 0.6 + 0.4 * Math.min(1, i.affected / i.applicable) : 1;
  const base = SEVERITY_POINTS[i.severity] * breadth * CONFIDENCE_FACTOR[i.confidence] + (i.gate ? GATE_BONUS : 0) + (i.blocking ? BLOCKING_BONUS : 0);
  return Math.round(Math.min(100, base * EFFORT_FACTOR[i.effort]) * 10) / 10;
}

export function horizonFor(sev: Severity, priority: number, effort: Effort, gate: boolean, blocking: boolean): Horizon {
  if (sev === "critical" || gate) return "immediate";
  if (sev === "high" && (blocking || priority >= 60)) return "immediate";
  if ((effort === "L" || effort === "XL") && sev !== "high") return "strategic";
  if (sev === "high" || sev === "medium") return "short";
  return priority >= 30 && effort !== "L" && effort !== "XL" ? "short" : "strategic";
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

const CONF_ORDER: Confidence[] = ["low", "medium", "high"];
const lowestConfidence = (list: Confidence[]): Confidence => list.reduce((a, b) => (CONF_ORDER.indexOf(b) < CONF_ORDER.indexOf(a) ? b : a), "high" as Confidence);

function dominantProvenance(list: Provenance[]): Provenance {
  const tally = new Map<Provenance, number>();
  for (const p of list) tally.set(p, (tally.get(p) ?? 0) + 1);
  let best: Provenance = "observed";
  let n = -1;
  for (const [p, c] of tally) if (c > n) { best = p; n = c; }
  return best;
}

function verificationFor(prov: Provenance, conf: Confidence): VerificationState {
  if ((prov === "measured" || prov === "observed") && conf === "high") return "verified";
  if (prov === "unavailable") return "unverified";
  return conf === "low" ? "unverified" : "probable";
}

function collectEvidence(rs: CheckResult[], limit = 6): Evidence[] {
  const out: Evidence[] = [];
  for (const r of rs) {
    if (r.evidence) for (const e of r.evidence) { out.push(e); if (out.length >= limit) return out; }
    if (out.length < limit && (r.actual !== undefined || r.expected !== undefined) && !r.evidence?.length) {
      out.push({ kind: "text", label: r.url ? `Observed at ${r.url}` : "Observed", value: `actual: ${r.actual ?? "n/a"} | expected: ${r.expected ?? "n/a"}` });
    }
  }
  return out.slice(0, limit);
}

export interface DeriveInput {
  hostname: string;
  results: readonly CheckResult[];
  tests: readonly TestDefinition[];
}

export function deriveFindings(input: DeriveInput): Finding[] {
  const outcomes = aggregateOutcomes(input.results);
  const findings: Finding[] = [];
  for (const def of input.tests) {
    const o = outcomes.get(def.id);
    if (!o) continue;
    const f = findingFromOutcome(input.hostname, def, o);
    if (f) findings.push(f);
  }
  findings.sort((a, b) => b.priorityScore - a.priorityScore || a.testId.localeCompare(b.testId));
  return findings;
}

function findingFromOutcome(hostname: string, def: TestDefinition, o: TestOutcome): Finding | null {
  let kind: FindingKind;
  if (o.status === "failed" || o.status === "warning") kind = "defect";
  else if (o.status === "blocked" || o.status === "inconclusive" || o.status === "not_tested") kind = "limitation";
  else if (o.status === "informational") kind = "observation";
  else return null;

  const bad = o.results.filter((r) => (kind === "defect" ? r.status === "failed" || r.status === "warning" : r.status === o.status));
  const sample = bad[0];
  const confidence = lowestConfidence(bad.map((r) => r.confidence));
  const provenance = dominantProvenance(bad.map((r) => r.provenance));
  const severity: Severity = kind !== "defect" ? "info" : o.status === "warning" ? lowerSeverity(def.severity) : def.severity;
  const applicable = Math.max(o.completed, 1);
  const affected = kind === "defect" ? o.failed + o.warned : 0;
  const prio = kind === "defect" ? priorityScore({ severity, affected, applicable, confidence, effort: def.effort, gate: def.gate, blocking: def.blocking }) : 0;
  const description = kind === "defect" ? (o.status === "warning" && def.partial ? def.partial : def.fail) : kind === "limitation" ? `${def.title} could not be completed.` : def.measures;
  const note = kind === "limitation" ? sample?.note ?? def.method : sample?.note;
  return {
    fingerprint: fingerprintFor(hostname, def.id),
    testId: def.id,
    category: def.category,
    subcategory: def.subcategory,
    tags: def.tags,
    title: def.title,
    kind,
    status: o.status,
    severity,
    confidence,
    provenance,
    verification: verificationFor(provenance, confidence),
    description,
    affectedUrls: kind === "defect" ? o.affectedUrls.slice(0, 200) : [],
    affectedCount: affected,
    applicableCount: applicable,
    evidence: collectEvidence(bad),
    expected: sample?.expected,
    actual: sample?.actual,
    observedAt: sample?.observedAt ?? new Date().toISOString(),
    impact: def.impact,
    measurementMethod: def.method,
    rootCause: def.rationale,
    fix: def.fix,
    implementation: def.implementation,
    effort: def.effort,
    verify: def.verify,
    refs: def.refs,
    wcag: def.wcag,
    dependsOn: def.dependsOn ?? [],
    priorityScore: prio,
    horizon: kind === "defect" ? horizonFor(severity, prio, def.effort, Boolean(def.gate), Boolean(def.blocking)) : "strategic",
    gate: Boolean(def.gate),
    blocking: Boolean(def.blocking),
    note,
  };
}

// ---------------------------------------------------------------------------
// Recommendations and roadmap
// ---------------------------------------------------------------------------

function riskOfInaction(f: Finding): string {
  const parts = [f.impact.security, f.impact.user, f.impact.search, f.impact.business].filter(Boolean) as string[];
  return parts.length ? parts.join(" ") : "The condition described in the finding remains in place.";
}

export function buildRecommendations(findings: readonly Finding[]): Recommendation[] {
  const defects = findings.filter((f) => f.kind === "defect").sort((a, b) => b.priorityScore - a.priorityScore || a.testId.localeCompare(b.testId));
  return defects.map((f, i) => ({
    fingerprint: f.fingerprint,
    testId: f.testId,
    rank: i + 1,
    title: f.fix,
    category: f.category,
    severity: f.severity,
    horizon: f.horizon,
    priorityScore: f.priorityScore,
    problem: `${f.title}: ${f.description}`,
    evidenceSummary: f.affectedCount > 0 ? `${f.affectedCount} of ${f.applicableCount} applicable page(s) or checks.${f.actual ? ` Observed: ${f.actual}.` : ""}` : f.actual ? `Observed: ${f.actual}.` : "See the finding evidence.",
    affectedUrls: f.affectedUrls.slice(0, 25),
    correction: f.fix,
    implementation: f.implementation,
    expectedOutcome: `The test "${f.title}" passes on the affected URLs after a retest. This is a statement about the test, not a forecast of traffic, ranking or revenue.`,
    effort: f.effort,
    effortHours: EFFORT_HOURS[f.effort],
    dependencies: f.dependsOn,
    riskOfInaction: riskOfInaction(f),
    verification: f.verify,
    refs: f.refs,
    verification_state: f.verification,
  }));
}

/** Orders recommendations so that dependencies come first, then by priority. */
export function orderSequence(recs: readonly Recommendation[]): string[] {
  const byTest = new Map(recs.map((r) => [r.testId, r]));
  const placed = new Set<string>();
  const out: string[] = [];
  const visit = (r: Recommendation, trail: Set<string>) => {
    if (placed.has(r.fingerprint) || trail.has(r.fingerprint)) return;
    trail.add(r.fingerprint);
    for (const d of r.dependencies) {
      const dep = byTest.get(d);
      if (dep) visit(dep, trail);
    }
    trail.delete(r.fingerprint);
    placed.add(r.fingerprint);
    out.push(r.fingerprint);
  };
  for (const r of [...recs].sort((a, b) => b.priorityScore - a.priorityScore)) visit(r, new Set());
  return out;
}

export function buildRoadmap(recs: readonly Recommendation[]): Roadmap {
  const sequence = orderSequence(recs);
  const rank = new Map(sequence.map((fp, i) => [fp, i]));
  const sorted = [...recs].sort((a, b) => (rank.get(a.fingerprint) ?? 0) - (rank.get(b.fingerprint) ?? 0));
  const pick = (h: Horizon) => sorted.filter((r) => r.horizon === h);
  const total: [number, number] = [0, 0];
  for (const r of recs) { total[0] += r.effortHours[0]; total[1] += r.effortHours[1]; }
  return { immediate: pick("immediate"), short: pick("short"), strategic: pick("strategic"), sequence, totalEffortHours: [Math.round(total[0] * 10) / 10, Math.round(total[1] * 10) / 10] };
}

export const HORIZON_LABELS: Record<Horizon, string> = {
  immediate: "Immediate (critical and blocking)",
  short: "Short term (high-value improvements)",
  strategic: "Strategic (larger or lower-urgency work)",
};

export { getTest };
