process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuditBundle } from "@workspace/wi-core";
import { evaluateGate, findingsToCsv, findingsToSarif, outstanding } from "../export";

function finding(over: Record<string, unknown> = {}) {
  return { fingerprint: "fp1", id: "fp1", testId: "sec.hsts", category: "security", tags: ["headers"], title: 'Missing "HSTS" header', kind: "defect", status: "failed", severity: "high", confidence: "high", provenance: "measured", description: "d", affectedUrls: ["https://example.com/"], affectedCount: 1, fix: "Add the header", effort: "low", horizon: "immediate", priorityScore: 71.4, actual: "=HYPERLINK(\"x\")", workflow: { status: "open", owner: null }, ...over };
}
function bundle(findings: unknown[], scores: Record<string, unknown> | null = { overall: 82, provisional: false, coverage: 0.95, readiness: { state: "ready_with_improvements", label: "Ready with improvements" } }, status = "completed"): AuditBundle {
  return { audit: { id: "a1", url: "https://example.com/", status, scores, completedAt: "2026-10-15T00:00:00Z" }, findings } as unknown as AuditBundle;
}

test("CSV escapes quotes/newlines and neutralises spreadsheet formula injection", () => {
  const csv = findingsToCsv(bundle([finding()]));
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[1].includes('"Missing ""HSTS"" header"'));
  assert.ok(lines[1].includes(`"'=HYPERLINK(""x"")"`), "a leading = must be defused");
});

test("SARIF 2.1.0 maps severity to level, lists only failed/warning findings and carries fingerprints", () => {
  const s = findingsToSarif(bundle([finding(), finding({ fingerprint: "fp2", testId: "seo.title", status: "passed" }), finding({ fingerprint: "fp3", testId: "seo.h1", severity: "low", status: "warning" })]), "v1") as any;
  assert.equal(s.version, "2.1.0");
  const run = s.runs[0];
  assert.equal(run.results.length, 2);
  assert.equal(run.results[0].level, "error");
  assert.equal(run.results[1].level, "note");
  assert.equal(run.results[0].partialFingerprints["cintexa/v1"], "fp1");
  assert.deepEqual(run.tool.driver.rules.map((r: any) => r.id).sort(), ["sec.hsts", "seo.h1"]);
});

test("outstanding ignores verified, dismissed and accepted-risk findings", () => {
  assert.equal(outstanding(finding() as any), true);
  for (const st of ["verified", "dismissed", "accepted_risk"]) assert.equal(outstanding(finding({ workflow: { status: st } }) as any), false, st);
  assert.equal(outstanding(finding({ status: "passed" }) as any), false);
});

test("gate: passes, and fails with explicit reasons for score, criticals, highs, provisional and unfinished audits", () => {
  const opts = { minScore: 80, maxCritical: 0, maxHigh: null, requireComplete: true };
  assert.equal(evaluateGate(bundle([]), opts).passed, true);
  const low = evaluateGate(bundle([], { overall: 60, provisional: false, coverage: 1, readiness: { state: "conditional", label: "Conditional" } }), opts);
  assert.equal(low.passed, false); assert.match(low.reasons[0], /below the required 80/);
  const crit = evaluateGate(bundle([finding({ severity: "critical" })]), opts);
  assert.equal(crit.passed, false); assert.equal(crit.counts.critical, 1);
  assert.equal(evaluateGate(bundle([finding({ severity: "critical", workflow: { status: "verified" } })]), opts).passed, true, "verified criticals no longer block");
  assert.equal(evaluateGate(bundle([finding()]), { ...opts, maxHigh: 0 }).passed, false);
  const prov = evaluateGate(bundle([], { overall: 90, provisional: true, coverage: 0.5, readiness: { state: "incomplete", label: "Incomplete" } }), opts);
  assert.equal(prov.passed, false); assert.ok(prov.reasons.some((r) => /provisional/.test(r)));
  assert.equal(evaluateGate(bundle([], { overall: 90, provisional: true, coverage: 0.5, readiness: { state: "incomplete", label: "Incomplete" } }), { ...opts, requireComplete: false }).passed, true);
  assert.equal(evaluateGate(bundle([], null), opts).passed, false, "no score never passes");
  assert.equal(evaluateGate(bundle([], undefined, "running"), opts).passed, false);
});
