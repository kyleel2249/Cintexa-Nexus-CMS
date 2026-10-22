/** Postgres persistence of competitors and discovery runs: upsert, tenant scoping, user decisions, idempotent schema. Needs DATABASE_URL. */
process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import { test } from "node:test";
import { newCandidate, type CompetitorCandidate } from "@workspace/wi-core";

const enabled = Boolean(process.env.DATABASE_URL);
const t = (name: string, fn: () => Promise<void>) => (enabled ? test(name, { timeout: 60_000 }, fn) : test.skip(name, fn));
const cand = (domain: string, over: Partial<CompetitorCandidate> = {}): CompetitorCandidate => ({ ...newCandidate(domain, `https://${domain}/`, new Date().toISOString()), ...over });

t("competitors are upserted by canonical domain, scoped to owner and site, and survive user edits", async () => {
  const store = await import("../store");
  const site = `site-${Date.now()}.example.com`;
  await store.upsertCompetitors("owner-1", site, [cand("rival.com", { confidence: 0.5, sources: ["search_provider"], evidence: [{ kind: "search_result", detail: "rank 1", at: new Date().toISOString() }] })]);
  await store.upsertCompetitors("owner-1", site, [cand("rival.com", { confidence: 0.7, classification: "direct" })]);
  const list = await store.listCompetitors("owner-1", site);
  assert.equal(list.length, 1, "one row per canonical domain");
  assert.equal(list[0]!.confidence, 0.7);
  assert.equal(list[0]!.classification, "direct");
  assert.deepEqual(await store.listCompetitors("owner-2", site), [], "another owner sees nothing");
  assert.equal(await store.patchCompetitor("owner-2", site, "rival.com", { status: "approved" }), null);
  const patched = await store.patchCompetitor("owner-1", site, "rival.com", { status: "approved", name: "Rival Inc", classification: "indirect" });
  assert.ok(patched);
  assert.equal(patched!.status, "approved");
  assert.equal(patched!.userConfirmed, true);
  assert.equal(patched!.classificationReason, "Classification set by a person.");
  assert.equal(await store.deleteCompetitor("owner-2", site, "rival.com"), false);
  assert.equal(await store.deleteCompetitor("owner-1", site, "rival.com"), true);
  assert.equal((await store.listCompetitors("owner-1", site)).length, 0);
});

t("discovery runs record status, provider, queries and summary", async () => {
  const store = await import("../store");
  const site = `runs-${Date.now()}.example.com`;
  const run = await store.createCompetitorRun({ ownerId: "owner-1", hostname: site, auditId: null, provider: "brave", queries: ["managed hosting"] });
  assert.equal(run.status, "running");
  await store.finishCompetitorRun(run.id, { status: "partial", summary: { unavailable: ["one query failed"] }, error: null });
  const runs = await store.listCompetitorRuns("owner-1", site);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.status, "partial");
  assert.deepEqual(runs[0]!.queries, ["managed hosting"]);
  assert.ok(runs[0]!.finishedAt);
  assert.deepEqual(await store.listCompetitorRuns("owner-2", site), []);
});

t("the WI schema is idempotent and includes the competitor tables", async () => {
  const { SCHEMA_STATEMENTS, pool } = await import("@workspace/db");
  for (let i = 0; i < 2; i++) for (const s of SCHEMA_STATEMENTS) await pool.query(s);
  const r = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('wi_competitors','wi_competitor_runs') ORDER BY 1`);
  assert.deepEqual(r.rows.map((x: { table_name: string }) => x.table_name), ["wi_competitor_runs", "wi_competitors"]);
});
