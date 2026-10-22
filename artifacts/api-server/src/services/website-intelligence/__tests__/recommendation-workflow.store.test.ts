/** Postgres persistence of the recommendation workflow: compare-and-set transitions, event log, approvals, idempotent schema. Needs DATABASE_URL. */
process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyRecWorkflow, applyTransition } from "@workspace/wi-core";

const enabled = Boolean(process.env.DATABASE_URL);
const t = (name: string, fn: () => Promise<void>) => (enabled ? test(name, { timeout: 60_000 }, fn) : test.skip(name, fn));
const USER = { kind: "user", id: "owner@x.test", isOwner: true } as const;

async function newAudit(store: typeof import("../store")): Promise<string> {
  const a = await store.createAudit({ ownerId: "owner-1", ownerEmail: "owner@x.test", hostname: `rw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.example.com`, cfg: { url: "https://x.test/", websiteType: "business", profile: "standard", modules: {} } as never });
  return a.id;
}

t("transitions are compare-and-set: the second of two racing writers loses, and every change is logged", async () => {
  const store = await import("../store");
  const id = await newAudit(store);
  const base = emptyRecWorkflow(id, "fp-1");
  assert.equal(await store.getRecWorkflow(id, "fp-1"), null);
  assert.equal(await store.insertRecWorkflow(base, { actor: { kind: "system", id: "system" }, action: "created", note: null }), true);
  assert.equal(await store.insertRecWorkflow(base, { actor: { kind: "system", id: "system" }, action: "created", note: null }), false, "inserting twice is refused, not duplicated");
  const cur = (await store.getRecWorkflow(id, "fp-1"))!;
  const patch = applyTransition(cur, { to: "READY", note: null, evidence: null }, USER);
  const write = { auditId: id, fingerprint: "fp-1", expectFrom: cur.status, expectVersion: cur.version, patch, actor: USER, action: "status:NEW>READY", note: null, evidence: null };
  const [a, b] = await Promise.all([store.transitionRec(write), store.transitionRec(write)]);
  assert.equal([a, b].filter(Boolean).length, 1, "exactly one writer wins");
  const after = (await store.getRecWorkflow(id, "fp-1"))!;
  assert.equal(after.status, "READY");
  assert.equal(after.version, cur.version + 1);
  const ev = await store.listRecEvents(id, "fp-1");
  assert.equal(ev.filter((e) => e.action === "status:NEW>READY").length, 1, "one event per successful change");
  assert.equal(ev.find((e) => e.action === "status:NEW>READY")!.to, "READY");
});

t("approvals are recorded and decided once, and workflow rows are scoped per audit", async () => {
  const store = await import("../store");
  const id = await newAudit(store);
  const other = await newAudit(store);
  const ap = await store.createRecApproval({ auditId: id, fingerprint: "fp-2", requestedBy: "owner@x.test" });
  assert.equal(ap.decision, null);
  const done = await store.decideRecApproval(id, "fp-2", { decision: "approved", decidedBy: "admin@x.test", note: "ok" });
  assert.equal(done?.decision, "approved");
  assert.equal(await store.decideRecApproval(id, "fp-2", { decision: "rejected", decidedBy: "x", note: null }), null, "an approval cannot be decided twice");
  assert.equal((await store.listRecApprovals(id, "fp-2")).length, 1);
  assert.equal((await store.listRecApprovals(other, "fp-2")).length, 0);
  assert.equal((await store.loadRecWorkflows(other)).size, 0);
});

t("the schema is idempotent and includes the workflow tables", async () => {
  const { SCHEMA_STATEMENTS, pool } = await import("@workspace/db");
  for (let i = 0; i < 2; i++) for (const s of SCHEMA_STATEMENTS) await pool.query(s);
  const r = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('wi_rec_workflow','wi_rec_events','wi_rec_approvals') ORDER BY 1`);
  assert.equal(r.rows.length, 3);
});
