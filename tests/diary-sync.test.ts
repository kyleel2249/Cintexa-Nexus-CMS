/**
 * Business Diary on D1 + records created by the sync engine, one database.
 *   node --test tests/diary-sync.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { onRequest as diary } from "../functions/api/diary/[[path]].ts";
import { onRequest as sync } from "../functions/api/sync/[[path]].ts";
import { makeD1 } from "./helpers/d1-sqlite.ts";

function boot(withDb = true) {
  const d = makeD1();
  const env = withDb ? { NEXUS_DB: d.db } : {};
  const call = async (fn: any, base: string, method: string, path: string, body?: unknown) => {
    const request = new Request(`https://nexus.test/api/${base}/${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    const res = await fn({ request, params: { path: path.split("?")[0]!.split("/").filter(Boolean) }, env });
    return { status: res.status as number, json: (await res.json()) as any };
  };
  const n = (sql: string, ...a: unknown[]) => Number((d.sqlite.prepare(sql).get(...(a as any[])) as any).n);
  return { ...d, bd: (m: string, p: string, b?: unknown) => call(diary, "diary", m, p, b), syn: (m: string, p: string, b?: unknown) => call(sync, "sync", m, p, b), n };
}
const today = new Date().toISOString().slice(0, 10);

test("a record created by another module (via sync) appears in the Diary list and dashboard", async () => {
  const t = boot();
  await t.syn("POST", "events", { eventType: "SALES_ORDER_CONFIRMED", sourceModule: "sales", entityType: "order", entityId: "SO-5", effectiveDate: today, payload: { title: "Order SO-5 confirmed", activityDate: today } });
  const list = (await t.bd("GET", "entries")).json.items;
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "Order SO-5 confirmed");
  assert.ok(list[0].tags.includes("order:SO-5"), "references its source record");
  assert.equal((await t.bd("GET", "dashboard")).json.totals.entries, 1);
});

test("manual entries are stored in D1, survive a fresh request, and can be archived", async () => {
  const t = boot();
  const created = await t.bd("POST", "entries", { title: "Board meeting", category: "Operations", activityDate: today, tags: ["board"], followUpRequired: true });
  assert.equal(created.status, 201);
  assert.equal(t.n("SELECT COUNT(*) n FROM bd_entries WHERE title = 'Board meeting'"), 1);

  // a row written straight to D1 (e.g. by another isolate) is visible too: the list comes from the database, not isolate memory
  t.sqlite.prepare("INSERT INTO bd_entries (id, org_id, title, category, activity_date, recorded_at, status, updated_at) VALUES ('x1','default','From elsewhere','Ops',?,?, 'active', ?)").run(today, today, today);
  const items = (await t.bd("GET", "entries")).json.items;
  assert.deepEqual(items.map((e: any) => e.title).sort(), ["Board meeting", "From elsewhere"]);
  assert.equal(items.find((e: any) => e.title === "Board meeting").followUpRequired, true);

  const id = created.json.entry.id;
  assert.equal((await t.bd("PATCH", `entries/${id}`, { status: "archived", outcome: "Closed" })).status, 200);
  assert.equal((t.sqlite.prepare("SELECT status, outcome FROM bd_entries WHERE id = ?").get(id) as any).status, "archived");
  assert.equal((await t.bd("GET", "entries")).json.items.length, 1, "archived entries are hidden by default");
  assert.equal((await t.bd("GET", "entries?archived=1")).json.items.length, 2);
});

test("demo seeding is refused when real storage is bound, and meta reports where data lives", async () => {
  const t = boot();
  assert.equal((await t.bd("POST", "seed-demo")).status, 409);
  const meta = (await t.bd("GET", "meta")).json;
  assert.equal(meta.storage, "d1");
  assert.equal(meta.persistence.other, "isolate-memory");
  assert.equal(t.n("SELECT COUNT(*) n FROM bd_entries"), 0);
});

test("without a D1 binding the Diary still works from isolate memory and says so", async () => {
  const t = boot(false);
  assert.equal((await t.bd("GET", "meta")).json.storage, "isolate-memory");
  assert.equal((await t.bd("POST", "entries", { title: "Local only", category: "Ops", activityDate: today })).status, 201);
});
