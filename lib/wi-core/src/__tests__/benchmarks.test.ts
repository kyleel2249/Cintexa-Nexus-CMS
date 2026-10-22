import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BENCHMARK_OPTIONS, buildBenchmarkReport, type BenchSite } from "../benchmarks";

const site = (hostname: string, overall: number | null, cats: Record<string, number | null> = {}, over: Partial<BenchSite> = {}): BenchSite => ({
  id: hostname, hostname, overall, provisional: false, coverage: 0.9, scoringVersion: "s1", pagesSampled: 12, categories: { seo: overall, performance: overall, ...cats }, ...over,
});
const row = (r: ReturnType<typeof buildBenchmarkReport>, key: string) => r.rows.find((x) => x.key === key)!;

test("ahead, level and behind are decided against the peer median with a 3-point level band", () => {
  const own = site("me.com", 80, { seo: 90, performance: 60, security: 70 });
  const peers = [site("a.com", 70, { seo: 70, performance: 80, security: 70 }), site("b.com", 72, { seo: 72, performance: 82, security: 71 }), site("c.com", 74, { seo: 74, performance: 84, security: 72 })];
  const r = buildBenchmarkReport(own, peers);
  assert.equal(row(r, "seo").position, "ahead");
  assert.equal(row(r, "seo").peerMedian, 72);
  assert.equal(row(r, "seo").difference, 18);
  assert.equal(row(r, "performance").position, "behind");
  assert.equal(row(r, "security").position, "level");
  assert.equal(r.methodVersion, "benchmark-1.0");
  assert.equal(r.comparableSites, 3);
  assert.equal(row(r, "seo").confidence, "medium");
});

test("missing evidence is insufficient, never a pass", () => {
  const r = buildBenchmarkReport(site("me.com", 80, { accessibility: null }), [site("a.com", 70, { accessibility: 60 })]);
  const a = row(r, "accessibility");
  assert.equal(a.own, null);
  assert.equal(a.position, "insufficient");
  assert.equal(a.confidence, "unavailable");
  assert.equal(a.vsTarget, "unavailable");
  const none = buildBenchmarkReport(site("me.com", 80), []);
  assert.equal(row(none, "overall").position, "insufficient");
  assert.equal(row(none, "overall").confidence, "unavailable");
  assert.equal(row(none, "overall").peerMedian, null);
});

test("incompatible comparators are excluded with a reason and do not influence the median", () => {
  const own = site("me.com", 80);
  const r = buildBenchmarkReport(own, [
    site("ok.com", 60), site("old.com", 10, {}, { scoringVersion: "s0" }), site("thin.com", 5, {}, { coverage: 0.2 }), site("failed.com", null), site("ok2.com", 62),
  ]);
  assert.equal(r.comparableSites, 2);
  assert.equal(r.excluded.length, 3);
  assert.ok(r.excluded.find((e) => e.hostname === "old.com")!.reason.includes("scoring version"));
  assert.ok(r.excluded.find((e) => e.hostname === "thin.com")!.reason.includes("20%"));
  assert.equal(row(r, "overall").peerMedian, 61);
  assert.ok(row(r, "overall").comparators.find((c) => c.hostname === "old.com")!.comparable === false);
});

test("a small peer set is never described as an industry average and carries low confidence", () => {
  const r = buildBenchmarkReport(site("me.com", 80), [site("a.com", 60)]);
  const o = row(r, "overall");
  assert.equal(o.confidence, "low");
  assert.ok(o.caveats.some((c) => /not an industry average/.test(c)));
  assert.ok(/not an industry average/.test(r.note));
});

test("a provisional own audit lowers confidence one step", () => {
  const peers = ["a", "b", "c", "d", "e"].map((h, i) => site(`${h}.com`, 60 + i));
  assert.equal(row(buildBenchmarkReport(site("me.com", 80), peers), "overall").confidence, "high");
  const prov = buildBenchmarkReport(site("me.com", 80, {}, { provisional: true }), peers);
  assert.equal(row(prov, "overall").confidence, "medium");
  assert.ok(row(prov, "overall").caveats.some((c) => /provisional/.test(c)));
});

test("standards-based target is kept separate from the competitor comparison", () => {
  const r = buildBenchmarkReport(site("me.com", 70, { seo: 70 }), [site("a.com", 40, { seo: 40 }), site("b.com", 45, { seo: 45 }), site("c.com", 50, { seo: 50 })]);
  const s = row(r, "seo");
  assert.equal(s.position, "ahead");
  assert.equal(s.vsTarget, "below");
  assert.equal(s.target.value, DEFAULT_BENCHMARK_OPTIONS.standardTarget);
  assert.equal(s.target.source, "scoring_band");
  assert.ok(/regardless of competitors/.test(s.recommendedResponse));
});

test("summary counts exclude the overall row and cover every category", () => {
  const r = buildBenchmarkReport(site("me.com", 80), [site("a.com", 60), site("b.com", 60), site("c.com", 60)]);
  const total = Object.values(r.summary).reduce((a, b) => a + b, 0);
  assert.equal(total, r.rows.length - 1);
  assert.equal(r.rows[0]!.key, "overall");
});
