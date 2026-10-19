import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { openDb, resetDb, client, ident, TEST_DB_URL } from "./helpers/harness";
import type { Db } from "../core/types";

const skip = !TEST_DB_URL ? "SALES_TEST_DATABASE_URL not set" : false;
let db: Db & { close(): Promise<void> };
let admin: ReturnType<typeof client>, rep: ReturnType<typeof client>, fin: ReturnType<typeof client>, mgr: ReturnType<typeof client>;
let accountId = 0, productId = 0, repId = 0;

before(async () => {
  if (skip) return;
  db = await openDb();
  await resetDb(db);
  admin = client(db, ident("boss@example.com", "admin"));
  await admin("GET", "/me");
  for (const [email, role] of [["rep@example.com", "sales_rep"], ["fin@example.com", "finance"], ["mgr@example.com", "sales_manager"]] as const) await admin("POST", "/members", { email, display_name: email.split("@")[0], role });
  rep = client(db, ident("rep@example.com")); fin = client(db, ident("fin@example.com")); mgr = client(db, ident("mgr@example.com"));
  repId = (await db.query<{ id: number }>("SELECT id FROM sales_members WHERE email = 'rep@example.com'")).rows[0]!.id;
  accountId = (await rep("POST", "/accounts", { name: "Comm Co" })).json.id;
  productId = (await admin("POST", "/products", { sku: "C-1", name: "Thing", base_price: "1000.00", cost_price: "400.00" })).json.id;
});
after(async () => { if (db) await db.close(); });

test("tier validation rejects gaps and non-zero start", { skip }, async () => {
  const bad = await admin("POST", "/commission-plans", { name: "Bad", kind: "tiered", tiers: [{ from: "100.00", to: "500.00", rate: 5 }, { from: "500.00", rate: 10 }], effective_from: "2020-01-01" });
  assert.equal(bad.status, 422);
  assert.equal((await rep("POST", "/commission-plans", { name: "x", kind: "percent", rate: 5, effective_from: "2020-01-01" })).status, 403);
});

test("collected-basis commission accrues only when paid, claws back on return, and locks once approved", { skip }, async () => {
  const plan = await admin("POST", "/commission-plans", { name: "Standard 10%", kind: "percent", rate: 10, basis: "collected", effective_from: "2020-01-01" });
  assert.equal(plan.status, 201, JSON.stringify(plan.json));
  const o = await rep("POST", "/orders", { account_id: accountId, lines: [{ product_id: productId, quantity: 5 }] });
  const oid = o.json.id;
  assert.equal((await rep("POST", `/orders/${oid}/confirm`)).json.status, "confirmed");
  let list = await admin("GET", "/commissions");
  assert.equal(list.json.items.length, 0, "nothing is earned before payment on a collected plan");
  const pay = await fin("POST", `/orders/${oid}/payments`, { amount: "5000.00" });
  assert.equal(pay.json.payment_status, "paid");
  list = await admin("GET", "/commissions");
  assert.equal(list.json.items.length, 1);
  assert.equal(list.json.items[0].amount, "500.00");
  assert.equal(list.json.items[0].status, "calculated");
  const entryId = list.json.items[0].id;

  // a second payment hook run must not duplicate
  await admin("POST", `/commissions/recalculate/${oid}`);
  assert.equal((await admin("GET", "/commissions")).json.items.length, 1);

  // the rep sees only own entries; another member sees none
  assert.equal((await rep("GET", "/commissions")).json.items.length, 1);
  assert.equal((await mgr("GET", "/commissions")).json.items.length, 0);
  assert.equal((await rep("POST", "/commissions/approve", { ids: [entryId] })).status, 403);

  assert.equal((await mgr("POST", "/orders/" + oid + "/fulfil", { lines: [{ line_id: (await admin("GET", `/orders/${oid}`)).json.lines[0].id, quantity: 5 }] })).status, 404, "manager outside the team cannot see the order");
  const line = (await admin("GET", `/orders/${oid}`)).json.lines[0];
  assert.equal((await admin("POST", `/orders/${oid}/fulfil`, { lines: [{ line_id: line.id, quantity: 5 }] })).status, 200);
  assert.equal((await admin("POST", `/commissions/approve`, { ids: [entryId] })).status, 200);
  await assert.rejects(() => db.query("UPDATE sales_commission_entries SET amount = '9999.00' WHERE id = $1", [entryId]), "approved amount is immutable at the database level");

  // return 1 of 5 → clawback of 10% of 1000.00 = 100.00 as an adjustment, original untouched
  const ret = await admin("POST", `/orders/${oid}/returns`, { line_id: line.id, quantity: 1, reason: "Faulty unit" });
  assert.equal(ret.status, 201, JSON.stringify(ret.json));
  const after = (await admin("GET", "/commissions", undefined, { query: { order_id: String(oid) } })).json;
  const adj = after.items.find((e: any) => e.kind === "adjustment");
  assert.ok(adj, "adjustment created");
  assert.equal(adj.amount, "-100.00");
  assert.equal(after.items.find((e: any) => e.kind === "commission").amount, "500.00");

  // paying requires approval first; paid rows cannot be voided
  assert.equal((await admin("POST", "/commissions/pay", { ids: [adj.id], payout_reference: "PAY-1" })).status, 409, "adjustment not approved yet");
  assert.equal((await admin("POST", "/commissions/approve", { ids: [adj.id] })).status, 200);
  assert.equal((await fin("POST", "/commissions/pay", { ids: [entryId, adj.id], payout_reference: "PAY-1" })).status, 200);
  assert.equal((await admin("POST", `/commissions/${entryId}/void`, { reason: "oops" })).status, 409);
  const st = await admin("GET", "/commissions/statement", undefined, { query: { member_id: String(repId) } });
  assert.equal(st.json.totals.paid, "400.00");
  assert.equal(st.json.totals.outstanding, "0.00");
});

test("cancelling an order voids unpaid commission", { skip }, async () => {
  const o = await rep("POST", "/orders", { account_id: accountId, lines: [{ product_id: productId, quantity: 1 }] });
  await rep("POST", `/orders/${o.json.id}/confirm`);
  await admin("POST", `/commissions/recalculate/${o.json.id}`); // collected basis → nothing yet
  const plan2 = await admin("POST", "/commission-plans", { name: "Booked 5% (member)", kind: "percent", rate: 5, basis: "booked", member_id: repId, effective_from: "2020-01-01" });
  assert.equal(plan2.status, 201);
  await admin("POST", `/commissions/recalculate/${o.json.id}`);
  const e = (await admin("GET", "/commissions", undefined, { query: { order_id: String(o.json.id) } })).json.items;
  assert.equal(e.length, 1);
  assert.equal(e[0].amount, "50.00");
  assert.equal((await admin("POST", `/orders/${o.json.id}/cancel`, { reason: "customer withdrew" })).status, 200);
  const after = (await admin("GET", "/commissions", undefined, { query: { order_id: String(o.json.id) } })).json.items;
  assert.ok(after.every((x: any) => x.status === "void"));
});
