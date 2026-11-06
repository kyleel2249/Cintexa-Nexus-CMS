/**
 * Nexus sync engine tests. Runs the real Pages Function against an in-memory SQLite database exposed through a thin
 * D1-compatible wrapper (D1 is SQLite), so SQL, batching/rollback and idempotency are genuinely exercised.
 *
 *   node --test tests/nexus-sync.test.ts        (Node >= 22.18)      or      bun test tests/nexus-sync.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { onRequest, enqueue, processEvent, drain } from "../functions/api/sync/[[path]].ts";
import { makeD1, type Fault } from "./helpers/d1-sqlite.ts";

async function setup(fault?: Fault) {
  const d = makeD1(fault);
  const env = { NEXUS_DB: d.db };
  const call = async (method: string, path: string, body?: unknown) => {
    const request = new Request(`https://nexus.test/api/sync/${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    const res = await (onRequest as any)({ request, params: { path: path.split("?")[0]!.split("/").filter(Boolean) }, env });
    return { status: res.status as number, json: (await res.json()) as any };
  };
  await call("GET", "status"); // creates the schema
  const count = (sql: string, ...a: unknown[]) => Number((d.sqlite.prepare(sql).get(...(a as any[])) as any).n);
  return { ...d, env, call, count };
}

const sale = (over: Record<string, unknown> = {}) => ({
  eventType: "SALES_ORDER_CONFIRMED", sourceModule: "sales", entityType: "order", entityId: "SO-1",
  effectiveDate: "2026-11-03", payload: { title: "Order SO-1 confirmed", amountMinor: 120000, currency: "GHS" }, ...over,
});

test("an event is persisted, processed once, and fans out to diary, FI and dashboard", async () => {
  const t = await setup();
  const r = await t.call("POST", "events", sale());
  assert.equal(r.status, 201);
  assert.equal(r.json.duplicate, false);
  assert.equal(r.json.event.status, "processed");
  assert.equal(r.json.event.attempts, 1);
  assert.deepEqual(r.json.event.links.map((l: any) => l.targetModule).sort(), ["business-diary", "corporate-strategy", "dashboard", "finance", "financial-intelligence", "marketing", "sales"]);
  assert.equal(t.count("SELECT COUNT(*) n FROM bd_entries"), 1);
  const diary = t.sqlite.prepare("SELECT * FROM bd_entries").get() as any;
  assert.equal(diary.title, "Order SO-1 confirmed");
  assert.equal(diary.activity_date, "2026-11-03");
  assert.match(diary.tags, /order:SO-1/); // diary entry references its source record
});

test("duplicate idempotency key returns the original event and applies nothing twice", async () => {
  const t = await setup();
  const a = await t.call("POST", "events", sale({ idempotencyKey: "so-1-confirmed" }));
  const b = await t.call("POST", "events", sale({ idempotencyKey: "so-1-confirmed" }));
  assert.equal(b.status, 200);
  assert.equal(b.json.duplicate, true);
  assert.equal(b.json.event.id, a.json.event.id);
  assert.equal(t.count("SELECT COUNT(*) n FROM nx_sync_events"), 1);
  assert.equal(t.count("SELECT COUNT(*) n FROM bd_entries"), 1);
  assert.equal(t.count("SELECT COUNT(*) n FROM nx_sync_links"), 7);
});

test("a different event key for the same business fact still yields one diary entry", async () => {
  const t = await setup();
  await t.call("POST", "events", sale({ idempotencyKey: "k1" }));
  await t.call("POST", "events", sale({ idempotencyKey: "k2" }));
  assert.equal(t.count("SELECT COUNT(*) n FROM nx_sync_events"), 2);
  assert.equal(t.count("SELECT COUNT(*) n FROM bd_entries"), 1);
});

test("concurrent processing of one event applies its effects exactly once", async () => {
  const t = await setup();
  const q = await enqueue(t.db, sale());
  assert.ok(q.ok);
  await Promise.all([processEvent(t.db, (q as any).event.id), processEvent(t.db, (q as any).event.id), processEvent(t.db, (q as any).event.id)]);
  const row = t.sqlite.prepare("SELECT * FROM nx_sync_events").get() as any;
  assert.equal(row.status, "processed");
  assert.equal(row.attempts, 1);
  assert.equal(t.count("SELECT COUNT(*) n FROM bd_entries"), 1);
});

test("an older version of an already-recorded event is rejected as a conflict", async () => {
  const t = await setup();
  assert.equal((await t.call("POST", "events", sale({ version: 3 }))).status, 201);
  const stale = await t.call("POST", "events", sale({ version: 2 }));
  assert.equal(stale.status, 409);
  assert.match(stale.json.error, /stale version 2/);
  assert.equal((await t.call("POST", "events", sale({ version: 4 }))).status, 201);
});

test("a failure rolls back every effect, is logged, then recovers via retry without duplicates", async () => {
  const fault: Fault = { when: (sql) => sql.includes("INSERT OR IGNORE INTO bd_entries"), on: true };
  const t = await setup(fault);
  const r = await t.call("POST", "events", sale());
  assert.equal(r.status, 201);
  assert.equal(r.json.event.status, "failed");
  assert.equal(r.json.event.lastError, "injected failure");
  assert.ok(r.json.event.nextAttemptAt, "a backoff time is scheduled");
  assert.equal(t.count("SELECT COUNT(*) n FROM bd_entries"), 0);
  assert.equal(t.count("SELECT COUNT(*) n FROM nx_sync_links"), 0, "atomic: no partial links either");
  assert.equal(t.count("SELECT COUNT(*) n FROM nx_sync_log WHERE outcome='failed'"), 1);

  // not due yet: a normal drain leaves it alone
  assert.equal((await t.call("POST", "process")).json.processed, 0);

  fault.on = false;
  const retried = await t.call("POST", "retry", { id: r.json.event.id });
  assert.equal(retried.json.event.status, "processed");
  assert.equal(t.count("SELECT COUNT(*) n FROM bd_entries"), 1);
  assert.equal(t.count("SELECT COUNT(*) n FROM nx_sync_links"), 7);
});

test("repeated failure dead-letters the event; manual retry recovers it", async () => {
  const fault: Fault = { when: (sql) => sql.includes("INSERT OR IGNORE INTO bd_entries"), on: true };
  const t = await setup(fault);
  const q = (await enqueue(t.db, sale())) as any;
  for (let i = 0; i < 6; i++) await processEvent(t.db, q.event.id);
  const dead = t.sqlite.prepare("SELECT * FROM nx_sync_events").get() as any;
  assert.equal(dead.status, "dead");
  assert.equal(dead.attempts, 5, "a dead event is no longer claimed");
  assert.equal((await t.call("GET", "events?status=dead")).json.total, 1);
  assert.equal((await t.call("GET", "status")).json.healthy, false);

  fault.on = false;
  const back = await t.call("POST", "retry", { id: q.event.id });
  assert.equal(back.json.event.status, "processed");
  assert.equal((await t.call("GET", "status")).json.healthy, true);
  assert.equal(t.count("SELECT COUNT(*) n FROM bd_entries"), 1);
});

test("a crashed worker's expired lease is picked up by the next drain", async () => {
  const t = await setup();
  const q = (await enqueue(t.db, sale())) as any;
  t.sqlite.prepare("UPDATE nx_sync_events SET status='processing', attempts=1, next_attempt_at=? WHERE id=?").run(new Date(Date.now() - 1000).toISOString(), q.event.id);
  const done = await drain(t.db);
  assert.equal(done.length, 1);
  assert.equal(done[0]!.status, "processed");
  assert.equal(t.count("SELECT COUNT(*) n FROM bd_entries"), 1);
});

test("a live lease is respected (another worker is still on it)", async () => {
  const t = await setup();
  const q = (await enqueue(t.db, sale())) as any;
  t.sqlite.prepare("UPDATE nx_sync_events SET status='processing', attempts=1, next_attempt_at=? WHERE id=?").run(new Date(Date.now() + 60_000).toISOString(), q.event.id);
  assert.equal((await drain(t.db)).length, 0);
  assert.equal(t.count("SELECT COUNT(*) n FROM bd_entries"), 0);
});

test("changes cursor reports new events and advances", async () => {
  const t = await setup();
  assert.deepEqual((await t.call("GET", "changes?after=0")).json, { cursor: 0, items: [] });
  await t.call("POST", "events", sale({ entityId: "SO-1" }));
  await t.call("POST", "events", sale({ entityId: "SO-2" }));
  const first = (await t.call("GET", "changes?after=0")).json;
  assert.equal(first.items.length, 2);
  assert.equal((await t.call("GET", `changes?after=${first.cursor}`)).json.items.length, 0);
  await t.call("POST", "events", sale({ entityId: "SO-3" }));
  assert.equal((await t.call("GET", `changes?after=${first.cursor}`)).json.items.length, 1);
});

test("input validation", async () => {
  const t = await setup();
  assert.equal((await t.call("POST", "events", { eventType: "bad type" })).status, 400);
  assert.equal((await t.call("POST", "events", sale({ effectiveDate: "03/11/2026" }))).status, 400);
  assert.equal((await t.call("POST", "events", sale({ payload: { big: "x".repeat(70_000) } }))).status, 413);
  assert.equal((await t.call("POST", "retry", { id: "nope" })).status, 404);
  const ok = await t.call("POST", "events", sale({ entityId: "SO-9" }));
  assert.equal((await t.call("POST", "retry", { id: ok.json.event.id })).status, 409, "only failed/dead events can be retried");
});

test("without a D1 binding nothing is kept in memory: writes answer 503, meta says not persistent", async () => {
  const call = async (method: string, path: string) =>
    (onRequest as any)({ request: new Request(`https://nexus.test/api/sync/${path}`, { method }), params: { path: path.split("/") }, env: {} });
  assert.equal((await call("POST", "events")).status, 503);
  const meta = await (await call("GET", "meta")).json();
  assert.equal(meta.persistent, false);
});
