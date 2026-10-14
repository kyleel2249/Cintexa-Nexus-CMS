import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALL_TESTS, DEFAULT_WEIGHTS, SCORE_FORMULA, aggregateOutcomes, bandFor, buildRecommendations, buildRoadmap, classifyIp, compareAudits, computeScores,
  deriveFindings, fingerprintFor, isInScope, normalizeUrl, parseAuditUrl, priorityScore, screenHostname, validateCatalog, validateTransition, validateWeights,
  type CheckResult, type TestDefinition,
} from "../index";

const now = "2026-10-13T00:00:00.000Z";
const res = (testId: string, status: CheckResult["status"], url?: string, extra: Partial<CheckResult> = {}): CheckResult => ({
  testId, status, url, provenance: "observed", confidence: "high", observedAt: now, ...extra,
});

test("catalogue is structurally valid and large", () => {
  assert.deepEqual(validateCatalog(), []);
  assert.ok(ALL_TESTS.length >= 150);
});

test("default weights total 100 and validation rejects bad sets", () => {
  assert.equal(validateWeights(DEFAULT_WEIGHTS).ok, true);
  assert.equal(validateWeights({ ...DEFAULT_WEIGHTS, seo: 30 }).ok, false);
  assert.equal(validateWeights({ ...DEFAULT_WEIGHTS, seo: -1 }).ok, false);
});

test("bands follow the documented thresholds", () => {
  assert.equal(bandFor(95), "Exceptional");
  assert.equal(bandFor(94.9), "Excellent");
  assert.equal(bandFor(80), "Very good");
  assert.equal(bandFor(70), "Good, with improvements needed");
  assert.equal(bandFor(50), "Needs substantial improvement");
  assert.equal(bandFor(49.9), "Major remediation required");
});

const mk = (id: string, sev: TestDefinition["severity"], extra: Partial<TestDefinition> = {}): TestDefinition =>
  ({ ...(ALL_TESTS[0] as TestDefinition), id, severity: sev, category: "seo", tags: [], gate: false, blocking: false, requires: undefined, dependsOn: [], ...extra });

test("not applicable is excluded and unavailable results are never passes", () => {
  const tests = [mk("t.a", "high"), mk("t.b", "high"), mk("t.c", "high"), mk("t.d", "high")];
  const s = computeScores({ tests, results: [res("t.a", "passed", "u"), res("t.b", "not_applicable"), res("t.c", "blocked"), res("t.d", "failed", "u")] });
  const seo = s.categories.find((c) => c.category === "seo")!;
  assert.equal(seo.applicableTests, 3);
  assert.equal(seo.completedTests, 2);
  assert.equal(seo.unavailableTests, 1);
  assert.equal(seo.score, 50);
  assert.ok(seo.coverage < 0.7);
  assert.equal(s.provisional, true);
});

test("missing results count as not tested, not as passed", () => {
  const tests = [mk("t.a", "high"), mk("t.b", "high")];
  const s = computeScores({ tests, results: [res("t.a", "passed", "u")] });
  assert.equal(s.counts.not_tested, 1);
  assert.equal(s.categories.find((c) => c.category === "seo")!.coverage, 0.5);
});

test("a category with no scoreable result has a null score and the overall renormalises", () => {
  const tests = [mk("t.a", "high"), mk("p.a", "high", { category: "performance" })];
  const s = computeScores({ tests, results: [res("t.a", "passed", "u")] });
  assert.equal(s.categories.find((c) => c.category === "performance")!.score, null);
  assert.equal(s.overall, 100);
  assert.equal(s.provisional, true);
});

test("critical gate failure makes the site not ready whatever the score", () => {
  const tests = [mk("g.a", "critical", { gate: true }), ...Array.from({ length: 12 }, (_, i) => mk(`t.${i}`, "high"))];
  const results = [res("g.a", "failed"), ...Array.from({ length: 12 }, (_, i) => res(`t.${i}`, "passed", "u"))];
  const s = computeScores({ tests, results });
  assert.ok((s.overall ?? 0) > 70);
  assert.equal(s.readiness.state, "not_ready");
  assert.deepEqual(s.readiness.gatingFindings, ["g.a"]);
});

test("clean audit is ready; low coverage is incomplete", () => {
  const tests = Array.from({ length: 10 }, (_, i) => mk(`t.${i}`, "medium"));
  const ready = computeScores({ tests, results: tests.map((t) => res(t.id, "passed", "u")) });
  assert.equal(ready.readiness.state, "ready");
  const incomplete = computeScores({ tests, results: [res("t.0", "passed", "u")] });
  assert.equal(incomplete.readiness.state, "incomplete");
});

test("page weights shift a test score towards important pages", () => {
  const o = aggregateOutcomes([res("t", "passed", "a", { pageWeight: 1 }), res("t", "failed", "b", { pageWeight: 3 })]);
  assert.equal(o.get("t")!.score, 0.25);
  assert.equal(o.get("t")!.status, "failed");
});

test("findings carry fingerprints, priority, horizon and evidence-based recommendations", () => {
  const tests = ALL_TESTS.filter((t) => t.id === "sec.exposed_files" || t.id === "sec.hsts");
  const results = [res("sec.exposed_files", "failed", undefined, { actual: "/.env readable", expected: "404" }), res("sec.hsts", "failed")];
  const findings = deriveFindings({ hostname: "Example.com", results, tests });
  assert.equal(findings.length, 2);
  assert.equal(findings[0].testId, "sec.exposed_files");
  assert.equal(findings[0].horizon, "immediate");
  assert.equal(findings[0].fingerprint, fingerprintFor("example.com", "sec.exposed_files"));
  const recs = buildRecommendations(findings);
  assert.equal(recs[0].rank, 1);
  assert.match(recs[0].expectedOutcome, /not a forecast/);
  const road = buildRoadmap(recs);
  assert.equal(road.sequence.length, 2);
});

test("limitations never become defects or recommendations", () => {
  const tests = ALL_TESTS.filter((t) => t.id === "a11y.contrast");
  const findings = deriveFindings({ hostname: "x.com", results: [res("a11y.contrast", "not_tested", undefined, { provenance: "unavailable", note: "browser worker not configured" })], tests });
  assert.equal(findings[0].kind, "limitation");
  assert.equal(buildRecommendations(findings).length, 0);
});

test("priority formula is monotonic in severity and favours cheap fixes", () => {
  const base = { affected: 5, applicable: 10, confidence: "high" as const, effort: "M" as const };
  assert.ok(priorityScore({ ...base, severity: "high" }) > priorityScore({ ...base, severity: "medium" }));
  assert.ok(priorityScore({ ...base, severity: "medium", effort: "XS" }) > priorityScore({ ...base, severity: "medium", effort: "XL" }));
  assert.ok(priorityScore({ ...base, severity: "critical", gate: true, blocking: true }) <= 100);
});

test("a finding cannot be verified by a status change alone", () => {
  assert.equal(validateTransition({ from: "fixed", to: "verified" }).ok, false);
  assert.equal(validateTransition({ from: "fixed", to: "verified", retestStatus: "passed" }).verificationMethod, "retest");
  assert.equal(validateTransition({ from: "fixed", to: "verified", manualVerification: { by: "a@b.c", notes: "Checked header in production" } }).verificationMethod, "manual");
  assert.equal(validateTransition({ from: "open", to: "verified", retestStatus: "passed" }).ok, false);
  assert.equal(validateTransition({ from: "open", to: "dismissed" }).ok, false);
  assert.equal(validateTransition({ from: "open", to: "accepted_risk", rationale: "Low exposure, scheduled for Q2" }).ok, true);
});

test("SSRF: private, loopback, metadata and mapped addresses are refused", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fe80::1", "fc00::1", "fd12::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "2002:7f00:1::1", "ff02::1", "224.0.0.1", "not-an-ip"]) {
    assert.equal(classifyIp(ip).allowed, false, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) assert.equal(classifyIp(ip).allowed, true, ip);
  assert.equal(classifyIp("172.32.0.1").allowed, true);
});

test("SSRF: hostnames and URL forms", () => {
  for (const h of ["localhost", "foo.localhost", "metadata.google.internal", "service.internal", "intranet", "2130706433", "0x7f000001", "127.1", "printer.local", "[::1]"]) assert.equal(screenHostname(h).allowed, false, h);
  assert.equal(screenHostname("example.com").allowed, true);
  for (const u of ["file:///etc/passwd", "ftp://example.com", "http://user:pw@example.com", "https://example.com:22", "http://169.254.169.254/latest", "gopher://x.com", "javascript:alert(1)"]) assert.equal(parseAuditUrl(u).ok, false, u);
  assert.equal(parseAuditUrl("example.com").url?.href, "https://example.com/");
  assert.equal(parseAuditUrl("https://Example.com:8443/a#x").url?.hash, "");
});

test("URL normalisation and scope", () => {
  assert.equal(normalizeUrl("HTTPS://Example.COM:443/a?b=2&a=1&utm_source=x#frag"), "https://example.com/a?a=1&b=2");
  assert.equal(normalizeUrl("/x", "https://example.com/y/"), "https://example.com/x");
  assert.equal(normalizeUrl("mailto:a@b.c"), null);
  assert.equal(isInScope("www.example.com", "example.com"), true);
  assert.equal(isInScope("evil.com", "example.com"), false);
  assert.equal(isInScope("example.com.evil.com", "example.com"), false);
  assert.equal(isInScope("cdn.example.com", "example.com", ["cdn.example.com"]), true);
});

test("comparison detects new, resolved and recurring findings and regressions", () => {
  const f = (fp: string, severity: "high" | "low") => ({ fingerprint: fp, title: fp, severity, category: "seo" as const, kind: "defect" as const });
  const tests = [mk("t.a", "high")];
  const prev = { id: "p", scores: computeScores({ tests, results: [res("t.a", "failed", "u")] }), findings: [f("a", "high"), f("b", "low")], pages: [{ url: "u", status: 200, title: "t", metaDescription: "d" }], testStatuses: { "sec.hsts": "passed" as const } };
  const cur = { id: "c", scores: computeScores({ tests, results: [res("t.a", "passed", "u")] }), findings: [f("b", "low"), f("c", "high")], pages: [{ url: "u2", status: 404, title: null, metaDescription: null }], testStatuses: { "sec.hsts": "failed" as const } };
  const c = compareAudits(cur, prev);
  assert.deepEqual(c.newFindings.map((x) => x.fingerprint), ["c"]);
  assert.deepEqual(c.resolvedFindings.map((x) => x.fingerprint), ["a"]);
  assert.deepEqual(c.recurringFindings.map((x) => x.fingerprint), ["b"]);
  assert.equal(c.overallDelta, 100);
  assert.equal(c.securityHeaderChanges[0].header, "Strict-Transport-Security");
  assert.ok(c.regressions.some((r) => r.label.includes("New high")));
  assert.equal(c.brokenLinks.current, 1);
  assert.deepEqual(c.pagesAdded, ["u2"]);
});

test("formula text is exposed for the UI and the report", () => {
  assert.match(SCORE_FORMULA, /never counted as passes/);
});
