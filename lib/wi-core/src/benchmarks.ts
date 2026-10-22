/**
 * Benchmark report: transparent, versioned comparison of one audited site with measured comparator sites.
 *
 * Rules (the method is shown to users, so it is deliberately simple):
 *  - Only like-for-like numbers are compared: same scoring version, a real score, and enough coverage. Anything else is listed as excluded with the reason.
 *  - The peer median is taken over comparable sites only, and is labelled as describing that peer set, never an industry.
 *  - Standards-based targets (the scoring band boundary) are kept separate from competitor-derived differences.
 *  - With fewer than three comparable sites the position is still shown, but confidence is low and the text says so.
 *  - Missing evidence yields "insufficient", never a pass.
 */
import { CATEGORY_IDS, CATEGORY_LABELS, type CategoryId } from "./types";
import { median } from "./competitors";

export const BENCHMARK_METHOD_VERSION = "benchmark-1.0";

export interface BenchSite {
  id: string;
  hostname: string;
  overall: number | null;
  provisional: boolean | null;
  coverage: number | null;
  scoringVersion?: string | null;
  categories: Record<string, number | null>;
  pagesSampled: number;
}

export interface BenchmarkOptions {
  /** Score a site should reach to be in the "Very good" band. Standards-based, not competitor-derived. */
  standardTarget: number;
  /** Differences smaller than this many points are reported as level. */
  levelBand: number;
  minCoverage: number;
  /** Below this many comparable sites the result is flagged as a comparison with specific sites. */
  minComparable: number;
}
export const DEFAULT_BENCHMARK_OPTIONS: BenchmarkOptions = { standardTarget: 80, levelBand: 3, minCoverage: 0.5, minComparable: 3 };

export type BenchPosition = "ahead" | "level" | "behind" | "insufficient";
export type BenchConfidence = "high" | "medium" | "low" | "unavailable";

export interface BenchComparator { id: string; hostname: string; value: number | null; comparable: boolean; reason: string | null }

export interface BenchmarkRow {
  key: CategoryId | "overall";
  label: string;
  definition: string;
  method: string;
  own: number | null;
  comparators: BenchComparator[];
  comparableCount: number;
  /** Median of comparable comparators only. Describes this peer set. */
  peerMedian: number | null;
  difference: number | null;
  target: { value: number; source: "scoring_band"; label: string };
  vsTarget: "meets" | "below" | "unavailable";
  position: BenchPosition;
  confidence: BenchConfidence;
  interpretation: string;
  recommendedResponse: string;
  caveats: string[];
}

export interface BenchmarkReport {
  methodVersion: string;
  options: BenchmarkOptions;
  ownHostname: string | null;
  rows: BenchmarkRow[];
  summary: Record<BenchPosition, number>;
  excluded: { hostname: string; reason: string }[];
  comparableSites: number;
  note: string;
}

const DEFINITIONS: Record<CategoryId | "overall", string> = {
  overall: "Weighted score across all applicable categories, with unavailable tests excluded from the denominator.",
  seo: "Share of applicable technical and on-page SEO tests passed, weighted by test importance.",
  performance: "Share of applicable performance tests passed (lab data from the same measurement environment).",
  functionality: "Share of applicable functionality and completeness tests passed.",
  ux: "Share of applicable UX, responsive-design and conversion-readiness tests passed.",
  security: "Share of applicable security and privacy configuration tests passed.",
  content: "Share of applicable content-quality and trust-signal tests passed.",
  accessibility: "Share of applicable automated accessibility tests passed. Automated tests find only a subset of WCAG issues.",
  infrastructure: "Share of applicable reliability, redirect, TLS and caching tests passed.",
  analytics: "Share of applicable analytics and maintenance tests passed.",
};
const METHOD = "Score from the passive audit sample of public pages, 0-100. Compared as a difference in points against the median of comparable sites.";

const confidenceFor = (n: number, ownProvisional: boolean | null): BenchConfidence => {
  if (n === 0) return "unavailable";
  let c: BenchConfidence = n >= 5 ? "high" : n >= 3 ? "medium" : "low";
  if (ownProvisional && c === "high") c = "medium";
  else if (ownProvisional && c === "medium") c = "low";
  return c;
};

function judge(own: number | null, med: number | null, n: number, label: string, opts: BenchmarkOptions): { position: BenchPosition; difference: number | null; interpretation: string; response: string } {
  if (own === null) return { position: "insufficient", difference: null, interpretation: `${label} could not be scored for this site, so it cannot be compared.`, response: "Resolve the unavailable or blocked tests in this category, then re-run the audit." };
  if (med === null || n === 0) return { position: "insufficient", difference: null, interpretation: `No comparable site produced a ${label} score, so there is nothing to compare with.`, response: "Benchmark more competitors, or check why their audits were provisional or incomplete." };
  const diff = Math.round((own - med) * 10) / 10;
  const peers = n === 1 ? "the one comparable site" : `the ${n} comparable sites`;
  if (Math.abs(diff) < opts.levelBand) return { position: "level", difference: diff, interpretation: `${label} is within ${opts.levelBand} points of the median of ${peers} (${own} vs ${med}).`, response: "No competitive gap here. Use your own findings to decide whether to improve further." };
  if (diff > 0) return { position: "ahead", difference: diff, interpretation: `${label} is ${diff} points above the median of ${peers} (${own} vs ${med}).`, response: "Maintain this lead and protect it with monitoring; avoid regressions." };
  return { position: "behind", difference: diff, interpretation: `${label} is ${Math.abs(diff)} points below the median of ${peers} (${own} vs ${med}).`, response: `Open the ${label} findings for this audit and fix the failed tests first; they explain the gap. Verify with a retest.` };
}

export function buildBenchmarkReport(own: BenchSite | null, comparators: BenchSite[], options: Partial<BenchmarkOptions> = {}): BenchmarkReport {
  const opts = { ...DEFAULT_BENCHMARK_OPTIONS, ...options };
  const excluded: { hostname: string; reason: string }[] = [];
  const usable: BenchSite[] = [];
  for (const c of comparators) {
    if (c.overall === null) excluded.push({ hostname: c.hostname, reason: "No score was produced (the audit failed, was cancelled, or has not finished)." });
    else if (own?.scoringVersion && c.scoringVersion && own.scoringVersion !== c.scoringVersion) excluded.push({ hostname: c.hostname, reason: `Scored with a different scoring version (${c.scoringVersion} vs ${own.scoringVersion}); not comparable.` });
    else if (c.coverage !== null && c.coverage < opts.minCoverage) excluded.push({ hostname: c.hostname, reason: `Test coverage was only ${Math.round(c.coverage * 100)}%, below the ${Math.round(opts.minCoverage * 100)}% needed for a fair comparison.` });
    else usable.push(c);
  }
  const keys: (CategoryId | "overall")[] = ["overall", ...CATEGORY_IDS];
  const rows: BenchmarkRow[] = keys.map((key) => {
    const label = key === "overall" ? "Overall score" : CATEGORY_LABELS[key];
    const ownVal = own ? (key === "overall" ? own.overall : own.categories[key] ?? null) : null;
    const comps: BenchComparator[] = comparators.map((c) => {
      const ex = excluded.find((e) => e.hostname === c.hostname);
      const v = key === "overall" ? c.overall : c.categories[key] ?? null;
      if (ex) return { id: c.id, hostname: c.hostname, value: v, comparable: false, reason: ex.reason };
      if (v === null) return { id: c.id, hostname: c.hostname, value: null, comparable: false, reason: `${label} could not be scored for this site (no applicable completed tests).` };
      return { id: c.id, hostname: c.hostname, value: v, comparable: true, reason: null };
    });
    const values = comps.filter((c) => c.comparable && c.value !== null).map((c) => c.value as number);
    const med = median(values);
    const j = judge(ownVal, med, values.length, label, opts);
    const caveats: string[] = [];
    if (own?.provisional) caveats.push("Your audit was provisional because test coverage was incomplete.");
    if (values.length > 0 && values.length < opts.minComparable) caveats.push(`Only ${values.length} comparable site${values.length === 1 ? "" : "s"}: this compares you with specific sites, not an industry average.`);
    if (comps.some((c) => c.comparable && c.value !== null) && comparators.some((c) => c.pagesSampled > 0 && own && c.pagesSampled < Math.max(3, Math.floor(own.pagesSampled / 4)))) caveats.push("Some competitors were sampled with far fewer pages than your site.");
    if (key === "performance" || key === "accessibility") caveats.push("Passive lab sample; not field data and not a full accessibility review.");
    const vsTarget: BenchmarkRow["vsTarget"] = ownVal === null ? "unavailable" : ownVal >= opts.standardTarget ? "meets" : "below";
    const response = vsTarget === "below" && j.position !== "behind" ? `${j.response} Separately, this is below the ${opts.standardTarget}-point target for a "Very good" rating, which applies regardless of competitors.` : j.response;
    return {
      key, label, definition: DEFINITIONS[key], method: METHOD, own: ownVal, comparators: comps, comparableCount: values.length, peerMedian: med, difference: j.difference,
      target: { value: opts.standardTarget, source: "scoring_band", label: `${opts.standardTarget}+ is the "Very good" band` }, vsTarget, position: j.position,
      confidence: ownVal === null ? "unavailable" : confidenceFor(values.length, own?.provisional ?? null), interpretation: j.interpretation, recommendedResponse: response, caveats,
    };
  });
  const summary: Record<BenchPosition, number> = { ahead: 0, level: 0, behind: 0, insufficient: 0 };
  for (const r of rows.filter((x) => x.key !== "overall")) summary[r.position]++;
  return {
    methodVersion: BENCHMARK_METHOD_VERSION, options: opts, ownHostname: own?.hostname ?? null, rows, summary, excluded, comparableSites: usable.length,
    note: "Differences are measured against the median of the comparable sites listed here. That median describes this peer set only. It is not an industry average, and the pages sampled are a small passive sample.",
  };
}
