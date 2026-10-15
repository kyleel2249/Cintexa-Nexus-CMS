/**
 * Machine-readable exports and the CI quality gate. Pure functions over an AuditBundle so they are unit-testable
 * and identical for the authenticated API and any future share-link surface.
 */
import type { AuditBundle, FindingView, Severity } from "@workspace/wi-core";

const OPEN_STATES = new Set(["open", "triaged", "planned", "in_progress", "fixed", "retest_required"]);
const ISSUE_STATUSES = new Set(["failed", "warning"]);

/** A finding is an outstanding issue when the test failed/warned and the team has not verified, accepted or dismissed it. */
export function outstanding(f: FindingView): boolean {
  return ISSUE_STATUSES.has(f.status) && OPEN_STATES.has(f.workflow.status);
}

function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  // Neutralise spreadsheet formula injection: values starting with = + - @ tab or CR are prefixed with an apostrophe.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function findingsToCsv(bundle: AuditBundle): string {
  const head = ["test_id", "title", "category", "severity", "status", "confidence", "provenance", "workflow_status", "owner", "priority", "effort", "horizon", "affected_count", "affected_urls", "expected", "actual", "fix", "wcag"];
  const rows = bundle.findings.map((f) => [f.testId, f.title, f.category, f.severity, f.status, f.confidence, f.provenance, f.workflow.status, f.workflow.owner ?? "", Math.round(f.priorityScore), f.effort, f.horizon, f.affectedCount, f.affectedUrls.slice(0, 20).join(" "), f.expected ?? "", f.actual ?? "", f.fix, (f.wcag ?? []).join(" ")]);
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const SARIF_LEVEL: Record<Severity, "error" | "warning" | "note"> = { critical: "error", high: "error", medium: "warning", low: "note", info: "note" };

/** SARIF 2.1.0 — importable by GitHub code scanning, Azure DevOps and most security dashboards. */
export function findingsToSarif(bundle: AuditBundle, toolVersion: string): unknown {
  const issues = bundle.findings.filter((f) => ISSUE_STATUSES.has(f.status));
  const ruleIds = [...new Set(issues.map((f) => f.testId))];
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: { driver: { name: "CINTEXA NEXUS Website Intelligence", version: toolVersion, informationUri: bundle.audit.url, rules: ruleIds.map((id) => { const f = issues.find((x) => x.testId === id)!; return { id, name: id, shortDescription: { text: f.title }, fullDescription: { text: f.description || f.title }, help: { text: f.fix || "See finding for remediation." }, properties: { category: f.category, tags: f.tags } }; }) } },
      invocations: [{ executionSuccessful: bundle.audit.status === "completed", endTimeUtc: bundle.audit.completedAt ?? undefined }],
      results: issues.map((f) => ({
        ruleId: f.testId,
        level: SARIF_LEVEL[f.severity],
        message: { text: `${f.title}${f.actual ? ` — ${f.actual}` : ""}` },
        partialFingerprints: { "cintexa/v1": f.fingerprint },
        locations: (f.affectedUrls.length ? f.affectedUrls.slice(0, 25) : [bundle.audit.url]).map((u) => ({ physicalLocation: { artifactLocation: { uri: u } } })),
        properties: { severity: f.severity, confidence: f.confidence, provenance: f.provenance, priorityScore: Math.round(f.priorityScore), workflowStatus: f.workflow.status },
      })),
    }],
  };
}

export interface GateOptions { minScore: number | null; maxCritical: number; maxHigh: number | null; requireComplete: boolean }
export interface GateResult {
  passed: boolean;
  options: GateOptions;
  score: number | null;
  provisional: boolean;
  readiness: string;
  counts: Record<"critical" | "high", number>;
  reasons: string[];
}

/** Deterministic quality gate for CI/CD. An unscored or provisional audit never silently passes when completeness is required. */
export function evaluateGate(bundle: AuditBundle, opts: GateOptions): GateResult {
  const scores = bundle.audit.scores;
  const issues = bundle.findings.filter(outstanding);
  const counts = { critical: issues.filter((f) => f.severity === "critical").length, high: issues.filter((f) => f.severity === "high").length };
  const reasons: string[] = [];
  if (bundle.audit.status !== "completed" && bundle.audit.status !== "partial") reasons.push(`Audit is ${bundle.audit.status}; a gate can only be evaluated on a finished audit.`);
  if (!scores || scores.overall == null) reasons.push("The audit has no score, so the score threshold cannot be evaluated.");
  else {
    if (opts.minScore != null && scores.overall < opts.minScore) reasons.push(`Score ${scores.overall} is below the required ${opts.minScore}.`);
    if (opts.requireComplete && scores.provisional) reasons.push(`The score is provisional (coverage ${Math.round(scores.coverage * 100)}%).`);
  }
  if (counts.critical > opts.maxCritical) reasons.push(`${counts.critical} outstanding critical finding(s); at most ${opts.maxCritical} allowed.`);
  if (opts.maxHigh != null && counts.high > opts.maxHigh) reasons.push(`${counts.high} outstanding high finding(s); at most ${opts.maxHigh} allowed.`);
  if (scores?.readiness?.state === "not_ready") reasons.push(`Readiness is "${scores.readiness.label}".`);
  return { passed: reasons.length === 0, options: opts, score: scores?.overall ?? null, provisional: Boolean(scores?.provisional), readiness: scores?.readiness?.label ?? "Unknown", counts, reasons };
}
