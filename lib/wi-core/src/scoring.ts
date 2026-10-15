import { getTest } from "./catalog";
import {
  CATEGORY_IDS,
  CATEGORY_LABELS,
  DEFAULT_WEIGHTS,
  SCORING_VERSION,
  SEVERITIES,
  TEST_STATUSES,
  type AdditionalScore,
  type Band,
  type CategoryId,
  type CategoryScore,
  type CheckResult,
  type Readiness,
  type ScoreBreakdown,
  type Severity,
  type TestDefinition,
  type TestStatus,
} from "./types";

/** Weight of a test inside its category, by severity. Informational tests carry no weight. */
export const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 5, high: 4, medium: 2.5, low: 1, info: 0 };

/** Credit for a warning inside a test (a failure is 0, a pass is 1). */
export const WARNING_CREDIT = 0.5;

export const SCORE_FORMULA = [
  "Each test returns one of eight statuses. Only passed, warning and failed results are scored.",
  "A page-level test is scored as the page-weighted share of passes across the pages it was applicable to (a warning earns half credit; homepage and important pages carry more weight).",
  "A category score is the severity-weighted mean of its test scores (critical 5, high 4, medium 2.5, low 1; informational tests carry no weight), scaled to 0-100.",
  "Not-applicable tests are removed from the denominator. Blocked, inconclusive and not-tested results are never counted as passes; they lower coverage and make the score provisional.",
  "The overall score is the weighted mean of category scores using the configured weights (default SEO 20, performance 15, functionality 15, UX 12, security 12, content 8, accessibility 7, infrastructure 6, analytics 5). Categories with no scoreable test are left out and the remaining weights are renormalised.",
  "A score is provisional when coverage is below 80% or a weighted category could not be scored.",
  "Readiness is decided separately from the score by the critical-defect gate: a failed critical security, privacy, availability or payment test caps readiness regardless of the score.",
].join("\n");

export function bandFor(score: number): Band {
  if (score >= 95) return "Exceptional";
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Very good";
  if (score >= 70) return "Good, with improvements needed";
  if (score >= 50) return "Needs substantial improvement";
  return "Major remediation required";
}

export function validateWeights(weights: Record<CategoryId, number>): { ok: boolean; total: number; error?: string } {
  let total = 0;
  for (const id of CATEGORY_IDS) {
    const w = weights[id];
    if (typeof w !== "number" || !Number.isFinite(w) || w < 0) return { ok: false, total, error: `Weight for ${id} must be a non-negative number.` };
    total += w;
  }
  total = Math.round(total * 1000) / 1000;
  if (total !== 100) return { ok: false, total, error: `Weights must total 100 (currently ${total}).` };
  return { ok: true, total };
}

export function mergeWeights(partial?: Partial<Record<CategoryId, number>> | null): Record<CategoryId, number> {
  const merged = { ...DEFAULT_WEIGHTS };
  if (partial) for (const id of CATEGORY_IDS) if (typeof partial[id] === "number") merged[id] = partial[id] as number;
  return validateWeights(merged).ok ? merged : { ...DEFAULT_WEIGHTS };
}

export interface TestOutcome {
  testId: string;
  status: TestStatus;
  /** 0..1 for scoreable outcomes, null otherwise. */
  score: number | null;
  completed: number;
  passed: number;
  failed: number;
  warned: number;
  unavailable: number;
  notApplicable: number;
  informational: number;
  total: number;
  affectedUrls: string[];
  results: CheckResult[];
}

const SCOREABLE: ReadonlySet<TestStatus> = new Set(["passed", "failed", "warning"]);
/** True for statuses that count toward a score. Everything else is excluded and never treated as a pass. */
export const isScoreable = (s: TestStatus): boolean => SCOREABLE.has(s);
const UNAVAILABLE: ReadonlySet<TestStatus> = new Set(["blocked", "inconclusive", "not_tested"]);

/** Collapses per-page / per-device results into one outcome per test. */
export function aggregateOutcomes(results: readonly CheckResult[]): Map<string, TestOutcome> {
  const grouped = new Map<string, CheckResult[]>();
  for (const r of results) {
    const list = grouped.get(r.testId);
    if (list) list.push(r);
    else grouped.set(r.testId, [r]);
  }
  const out = new Map<string, TestOutcome>();
  for (const [testId, list] of grouped) {
    let wTotal = 0;
    let wCredit = 0;
    let passed = 0, failed = 0, warned = 0, unavailable = 0, notApplicable = 0, informational = 0;
    const affected = new Set<string>();
    const statusCount: Partial<Record<TestStatus, number>> = {};
    for (const r of list) {
      statusCount[r.status] = (statusCount[r.status] ?? 0) + 1;
      const w = r.pageWeight && r.pageWeight > 0 ? r.pageWeight : 1;
      if (r.status === "passed") { passed++; wTotal += w; wCredit += w; }
      else if (r.status === "warning") { warned++; wTotal += w; wCredit += w * WARNING_CREDIT; if (r.url) affected.add(r.url); }
      else if (r.status === "failed") { failed++; wTotal += w; if (r.url) affected.add(r.url); }
      else if (UNAVAILABLE.has(r.status)) unavailable++;
      else if (r.status === "not_applicable") notApplicable++;
      else if (r.status === "informational") informational++;
    }
    const completed = passed + failed + warned;
    let status: TestStatus;
    if (failed > 0) status = "failed";
    else if (warned > 0) status = "warning";
    else if (passed > 0) status = "passed";
    else if (statusCount.blocked) status = "blocked";
    else if (statusCount.inconclusive) status = "inconclusive";
    else if (statusCount.not_tested) status = "not_tested";
    else if (informational > 0) status = "informational";
    else status = "not_applicable";
    out.set(testId, {
      testId,
      status,
      score: completed > 0 && wTotal > 0 ? wCredit / wTotal : null,
      completed,
      passed,
      failed,
      warned,
      unavailable,
      notApplicable,
      informational,
      total: list.length,
      affectedUrls: [...affected],
      results: list,
    });
  }
  return out;
}

interface Bucket {
  weightSum: number;
  creditSum: number;
  applicable: number;
  completed: number;
  passed: number;
  failed: number;
  warning: number;
  unavailable: number;
  informational: number;
}

const emptyBucket = (): Bucket => ({ weightSum: 0, creditSum: 0, applicable: 0, completed: 0, passed: 0, failed: 0, warning: 0, unavailable: 0, informational: 0 });

function addToBucket(b: Bucket, def: TestDefinition, o: TestOutcome): void {
  if (o.status === "not_applicable") return;
  if (o.status === "informational") { b.informational++; return; }
  if (def.severity === "info") {
    // Informational-severity tests are reported but never scored; they do not enter the denominator.
    b.informational++;
    return;
  }
  b.applicable++;
  if (o.score === null) { b.unavailable++; return; }
  b.completed++;
  const w = SEVERITY_WEIGHT[def.severity];
  b.weightSum += w;
  b.creditSum += w * o.score;
  if (o.status === "passed") b.passed++;
  else if (o.status === "failed") b.failed++;
  else b.warning++;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export const ADDITIONAL_SCORE_DEFS: { key: string; label: string; tag: string }[] = [
  { key: "technical_seo", label: "Technical SEO", tag: "technical_seo" },
  { key: "on_page_seo", label: "On-page SEO", tag: "on_page_seo" },
  { key: "content_quality", label: "Content quality", tag: "content_quality" },
  { key: "performance_cwv", label: "Core Web Vitals and performance", tag: "performance" },
  { key: "accessibility", label: "Accessibility", tag: "accessibility" },
  { key: "security", label: "Security", tag: "security" },
  { key: "functional", label: "Functional quality", tag: "functional" },
  { key: "mobile", label: "Mobile experience", tag: "mobile" },
  { key: "conversion", label: "Conversion readiness", tag: "conversion" },
  { key: "infrastructure", label: "Infrastructure", tag: "infrastructure" },
  { key: "analytics", label: "Analytics and measurement", tag: "analytics" },
];

export interface ComputeScoresInput {
  results: readonly CheckResult[];
  tests: readonly TestDefinition[];
  weights?: Partial<Record<CategoryId, number>> | null;
  /** True when the audit stopped early (limit hit, cancelled, a stage failed). */
  incomplete?: boolean;
}

export function computeScores(input: ComputeScoresInput): ScoreBreakdown {
  const weights = mergeWeights(input.weights);
  const outcomes = aggregateOutcomes(input.results);
  const catBuckets = Object.fromEntries(CATEGORY_IDS.map((c) => [c, emptyBucket()])) as Record<CategoryId, Bucket>;
  const tagBuckets = new Map<string, Bucket>(ADDITIONAL_SCORE_DEFS.map((d) => [d.tag, emptyBucket()]));
  const counts = Object.fromEntries(TEST_STATUSES.map((s) => [s, 0])) as Record<TestStatus, number>;
  const severityCounts = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;

  const defs = new Map(input.tests.map((t) => [t.id, t]));
  for (const t of input.tests) {
    const o = outcomes.get(t.id) ?? ({ testId: t.id, status: "not_tested", score: null, completed: 0, passed: 0, failed: 0, warned: 0, unavailable: 1, notApplicable: 0, informational: 0, total: 0, affectedUrls: [], results: [] } as TestOutcome);
    counts[o.status]++;
    if (o.status === "failed" || o.status === "warning") severityCounts[o.status === "warning" ? lowerSeverity(t.severity) : t.severity]++;
    addToBucket(catBuckets[t.category], t, o);
    for (const tag of t.tags) {
      const tb = tagBuckets.get(tag);
      if (tb) addToBucket(tb, t, o);
    }
  }
  // Results for tests that are not in the supplied list are ignored on purpose (module disabled).
  void defs;

  const categories: CategoryScore[] = CATEGORY_IDS.map((id) => {
    const b = catBuckets[id];
    const score = b.weightSum > 0 ? round1((b.creditSum / b.weightSum) * 100) : null;
    const coverage = b.applicable > 0 ? b.completed / b.applicable : 0;
    return {
      category: id,
      label: CATEGORY_LABELS[id],
      weight: weights[id],
      score,
      applicableTests: b.applicable,
      completedTests: b.completed,
      passedTests: b.passed,
      failedTests: b.failed,
      warningTests: b.warning,
      unavailableTests: b.unavailable,
      informationalTests: b.informational,
      coverage: Math.round(coverage * 1000) / 1000,
      provisional: b.applicable > 0 && coverage < 0.8,
    };
  });

  const scored = categories.filter((c) => c.score !== null && c.weight > 0);
  const weightTotal = scored.reduce((s, c) => s + c.weight, 0);
  const overall = weightTotal > 0 ? round1(scored.reduce((s, c) => s + (c.score as number) * c.weight, 0) / weightTotal) : null;

  const totalApplicable = categories.reduce((s, c) => s + c.applicableTests, 0);
  const totalCompleted = categories.reduce((s, c) => s + c.completedTests, 0);
  const coverage = totalApplicable > 0 ? Math.round((totalCompleted / totalApplicable) * 1000) / 1000 : 0;
  const weightedButUnscored = categories.some((c) => c.weight > 0 && c.applicableTests > 0 && c.score === null);
  const provisional = overall === null || coverage < 0.8 || weightedButUnscored || Boolean(input.incomplete);

  const additional: AdditionalScore[] = ADDITIONAL_SCORE_DEFS.map((d) => {
    const b = tagBuckets.get(d.tag) as Bucket;
    return {
      key: d.key,
      label: d.label,
      score: b.weightSum > 0 ? round1((b.creditSum / b.weightSum) * 100) : null,
      applicableTests: b.applicable,
      completedTests: b.completed,
      coverage: b.applicable > 0 ? Math.round((b.completed / b.applicable) * 1000) / 1000 : 0,
    };
  });

  const readiness = computeReadiness({ overall, coverage, provisional, outcomes, tests: input.tests, incomplete: Boolean(input.incomplete) });

  return {
    version: SCORING_VERSION,
    overall,
    provisional,
    band: overall === null ? null : bandFor(overall),
    coverage,
    categories,
    additional,
    readiness,
    weights,
    formula: SCORE_FORMULA,
    counts,
    severityCounts,
  };
}

export function lowerSeverity(s: Severity): Severity {
  const order: Severity[] = ["critical", "high", "medium", "low", "info"];
  return order[Math.min(order.indexOf(s) + 1, order.length - 1)];
}

interface ReadinessInput {
  overall: number | null;
  coverage: number;
  provisional: boolean;
  outcomes: Map<string, TestOutcome>;
  tests: readonly TestDefinition[];
  incomplete: boolean;
}

export const READINESS_LABELS: Record<Readiness["state"], string> = {
  ready: "Ready",
  ready_with_improvements: "Ready with recommended improvements",
  conditional: "Conditionally ready",
  not_ready: "Not ready",
  incomplete: "Assessment incomplete",
};

export function computeReadiness(i: ReadinessInput): Readiness {
  const reasons: string[] = [];
  const gating: string[] = [];
  const criticalNonGate: string[] = [];
  const blockingHigh: string[] = [];
  let anyFailedHighOrMedium = false;
  let gateUnavailable = 0;

  for (const t of i.tests) {
    const o = i.outcomes.get(t.id);
    if (!o) continue;
    if (t.gate && o.status === "failed") gating.push(t.id);
    else if (t.gate && (o.status === "blocked" || o.status === "inconclusive" || o.status === "not_tested") && t.requires === undefined) gateUnavailable++;
    if (o.status === "failed" && t.severity === "critical" && !t.gate) criticalNonGate.push(t.id);
    if (o.status === "failed" && t.blocking && (t.severity === "high" || t.severity === "critical")) blockingHigh.push(t.id);
    if (o.status === "failed" && (t.severity === "high" || t.severity === "medium")) anyFailedHighOrMedium = true;
  }

  const title = (id: string) => getTest(id)?.title ?? id;
  let state: Readiness["state"];
  if (gating.length > 0) {
    state = "not_ready";
    reasons.push(`Critical-defect gate: ${gating.map(title).join("; ")}. A failed critical security, privacy, availability or payment test caps readiness whatever the score.`);
  } else if (i.overall === null || i.coverage < 0.5) {
    state = "incomplete";
    reasons.push(`Only ${Math.round(i.coverage * 100)}% of applicable tests produced a result, which is too little to judge readiness.`);
  } else if (criticalNonGate.length > 0 || blockingHigh.length > 0 || (i.overall !== null && i.overall < 50)) {
    state = "conditional";
    if (criticalNonGate.length) reasons.push(`Critical findings: ${criticalNonGate.map(title).join("; ")}.`);
    if (blockingHigh.length) reasons.push(`High-severity defects that block indexing or break user journeys: ${blockingHigh.map(title).join("; ")}.`);
    if (i.overall !== null && i.overall < 50) reasons.push("The overall score is below 50.");
  } else if (anyFailedHighOrMedium || (i.overall !== null && i.overall < 90)) {
    state = "ready_with_improvements";
    reasons.push("No critical defects were detected; the remaining findings are improvements.");
  } else {
    state = "ready";
    reasons.push("No critical or high-severity defects were detected and the score is 90 or above.");
  }

  if (i.provisional && state !== "incomplete") reasons.push("The score is provisional because some tests could not be completed; readiness may change once coverage improves.");
  if (i.incomplete) reasons.push("The audit stopped before every stage finished.");
  if (gateUnavailable > 0 && state !== "not_ready") reasons.push(`${gateUnavailable} critical gate test(s) could not be completed, so a critical defect cannot be ruled out.`);
  return { state, label: READINESS_LABELS[state], reasons, gatingFindings: gating };
}

/** Score for a single page from its own results (used by the page comparison chart). */
export function scorePage(results: readonly CheckResult[]): number | null {
  let weight = 0;
  let credit = 0;
  for (const r of results) {
    const def = getTest(r.testId);
    if (!def || def.scope !== "page" || def.severity === "info") continue;
    const w = SEVERITY_WEIGHT[def.severity];
    if (r.status === "passed") { weight += w; credit += w; }
    else if (r.status === "warning") { weight += w; credit += w * WARNING_CREDIT; }
    else if (r.status === "failed") weight += w;
  }
  return weight > 0 ? round1((credit / weight) * 100) : null;
}
