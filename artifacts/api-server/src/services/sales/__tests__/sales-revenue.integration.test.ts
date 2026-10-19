import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { openDb, resetDb, client, ident, deps, TEST_DB_URL } from "./helpers/harness";
import { processOutbox } from "../integrations/outbox";
import type { Db } from "../core/types";

const skip = !TEST_DB_URL ? "SALES_TEST_DATABASE_URL not set" : false;
let db: Db & { close(): Promise<void> };
let admin: ReturnType<typeof client>, mgr: ReturnType<typeof client>, rep: ReturnType<typeof client>, fin: ReturnType<typeof client>, repB: ReturnType<typeof client>;
let accountId = 0, widgetId = 0, serviceId = 0;

before(async () => {
  if (skip) return;
  db = await openDb();
  await resetDb(db);
  admin = client(db, ident("boss@example.com", "admin"));
  await admin("GET", "/me");
  for (const [email, role] of [["mgr@example.com", "sales_manager"], ["rep@example.com", "sales_rep"], ["repb@example.com", "sales_rep"], ["fin@example.com", "finance"]] as const) {
    const r = await admin("POST", "/members", { email, display_name: email.split("@")[0], role });
    assert.equal(r.status, 201, JSON.stringify(r.json));
  }
  mgr = client(db, ident("mgr@example.com")); rep = client(db, ident("rep@example.com")); repB = client(db, ident("repb@example.com")); fin = client(db, ident("fin@example.com"));
  const team = (await db.query<{ id: number }>("INSERT INTO sales_teams (name, manager_member_id) VALUES ('North', (SELECT id FROM sales_members WHERE email = 'mgr@example.com')) RETURNING id")).rows[0]!;
  await db.query("UPDATE sales_members SET team_id = $1 WHERE email IN ('mgr@example.com','rep@example.com')", [team.id]);
  const a = await rep("POST", "/accounts", { name: "Revenue Test Ltd", credit_limit: "1000000.00" });
  accountId = a.json.id;
  const p1 = await admin("POST", "/products", { sku: "WID-1", name: "Widget", base_price: "100.00", cost_price: "60.00", tax_rate: 10, track_stock: true });
  const p2 = await admin("POST", "/products", { sku: "SVC-1", name: "Setup service", kind: "service", base_price: "500.00", cost_price: "300.00" });
  assert.equal(p1.status, 201, JSON.stringify(p1.json));
  widgetId = p1.json.id; serviceId = p2.json.id;
});
after(async () => { if (db) await db.close(); });

test("cost price is hidden from roles without cost:read", { skip }, async () => {
  const asRep = await rep("GET", `/products/${widgetId}`);
  assert.equal(asRep.status, 200);
  assert.equal("cost_price" in asRep.json.product, false);
  const asAdmin = await admin("GET", `/products/${widgetId}`);
  assert.equal(asAdmin.json.product.cost_price, "60.00");
  assert.equal((await rep("POST", "/products", { sku: "X", name: "x", base_price: "1.00" })).status, 403);
  assert.equal(asAdmin.json.stock.status, "not_integrated");
});

test("price books, tiers and promotions resolve server-side", { skip }, async () => {
  const pb = await admin("POST", "/price-books", { name: "Standard", is_default: true });
  assert.equal(pb.status, 201, JSON.stringify(pb.json));
  await admin("PUT", `/price-books/${pb.json.id}/entries`, { entries: [{ product_id: widgetId, min_quantity: 1, unit_price: "95.00" }, { product_id: widgetId, min_quantity: 10, unit_price: "85.00" }] });
  const one = await rep("POST", "/pricing/resolve", { account_id: accountId, items: [{ product_id: widgetId, quantity: 1 }] });
  assert.equal(one.json.items[0].unitPrice, "95.00");
  const bulk = await rep("POST", "/pricing/resolve", { account_id: accountId, items: [{ product_id: widgetId, quantity: 12 }] });
  assert.equal(bulk.json.items[0].unitPrice, "85.00");
  assert.equal("cost_price" in bulk.json.items[0], false);
});

test("quotation: totals are exact, discounts above policy need approval, no self-approval", { skip }, async () => {
  const mk = (discount: number) => rep("POST", "/quotations", { account_id: accountId, lines: [{ product_id: widgetId, quantity: 3, discount_percent: discount }, { product_id: serviceId, quantity: 1 }] });
  const q1 = await mk(5);
  assert.equal(q1.status, 201, JSON.stringify(q1.json));
  // 3 × 95.00 = 285.00; 5% = 14.25 → net 270.75; tax 10% = 27.08 (half-up of 27.075); service 500.00 untaxed
  const d = await rep("GET", `/quotations/${q1.json.id}`);
  assert.equal(d.json.quotation.subtotal, "785.00");
  assert.equal(d.json.quotation.discount_total, "14.25");
  assert.equal(d.json.quotation.total, "797.83"); // 270.75 + 27.08 tax = 297.83, plus 500.00
  const sub1 = await rep("POST", `/quotations/${q1.json.id}/submit`);
  assert.equal(sub1.json.status, "approved");

  const q2 = await mk(15); // reps may give 10%, managers up to 20%
  const sub2 = await rep("POST", `/quotations/${q2.json.id}/submit`);
  assert.equal(sub2.json.status, "pending_approval");
  assert.ok(sub2.json.findings.some((f: any) => f.code === "discount_exceeds_limit"));
  assert.equal((await rep("POST", `/quotations/${q2.json.id}/approve`)).status, 403);
  assert.equal((await repB("POST", `/quotations/${q2.json.id}/approve`)).status, 403);
  assert.equal((await rep("POST", `/quotations/${q2.json.id}/send`, {})).status, 409, "cannot send before approval");
  const ok = await mgr("POST", `/quotations/${q2.json.id}/approve`, { comment: "ok" });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const q3 = await mk(25);
  assert.equal((await rep("POST", `/quotations/${q3.json.id}/submit`)).json.status, "pending_approval");
  assert.equal((await mgr("POST", `/quotations/${q3.json.id}/approve`)).status, 403, "25% is above a manager's 20% limit");
  assert.equal((await admin("POST", `/quotations/${q3.json.id}/approve`)).status, 200);
  // editing an approved quotation is blocked; revising creates v2 and supersedes v1
  assert.equal((await rep("PATCH", `/quotations/${q2.json.id}`, { notes: "x" })).status, 409);
  const rev = await rep("POST", `/quotations/${q2.json.id}/revise`);
  assert.equal(rev.json.version, 2);
  const old = await rep("GET", `/quotations/${q2.json.id}`);
  assert.equal(old.json.quotation.status, "superseded");
});

test("honest sending and customer acceptance through the public link", { skip }, async () => {
  const q = await rep("POST", "/quotations", { account_id: accountId, lines: [{ product_id: widgetId, quantity: 10 }] });
  await rep("POST", `/quotations/${q.json.id}/submit`);
  const emailTry = await rep("POST", `/quotations/${q.json.id}/send`, { channel: "email", to: "buyer@example.com" });
  assert.equal(emailTry.status, 409, "email is not connected so the system must not pretend");
  const sent = await rep("POST", `/quotations/${q.json.id}/send`, { channel: "link" });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  const token = sent.json.link.replace("/q/", "");
  const anon = client(db, undefined, { ip: "198.51.100.7" });
  const view = await anon("GET", `/public/quotations/${token}`);
  assert.equal(view.status, 200);
  assert.equal(view.json.total, "935.00"); // 10 × 85.00 = 850.00 + 10% tax
  assert.ok(!JSON.stringify(view.json).includes("cost"), "no internal cost data on the public page");
  assert.equal((await anon("GET", "/public/quotations/not-a-real-token-value-0000")).status, 404);
  assert.equal((await anon("POST", `/public/quotations/${token}/accept`, { name: "B", agree: true })).status, 422);
  const acc = await anon("POST", `/public/quotations/${token}/accept`, { name: "Buyer Person", agree: true });
  assert.equal(acc.status, 200, JSON.stringify(acc.json));
  assert.equal((await anon("POST", `/public/quotations/${token}/accept`, { name: "Buyer Person", agree: true })).status, 409);
  const d = await rep("GET", `/quotations/${q.json.id}`);
  assert.equal(d.json.quotation.status, "accepted");
  assert.equal(d.json.quotation.acceptance_evidence.kind, "customer_link");
  (globalThis as any).__acceptedQuote = q.json.id;
});

test("quote → order (once), confirm, outbox honesty, payments, fulfilment, returns, cancel guards", { skip }, async () => {
  const qid = (globalThis as any).__acceptedQuote as number;
  const conv = await rep("POST", `/quotations/${qid}/convert`, {});
  assert.equal(conv.status, 201, JSON.stringify(conv.json));
  const oid = conv.json.id;
  const dupe = await rep("POST", `/quotations/${qid}/convert`, {});
  assert.equal(dupe.status, 409);
  const conc = await Promise.all([rep("POST", `/quotations/${qid}/convert`, {}), rep("POST", `/quotations/${qid}/convert`, {})]);
  assert.ok(conc.every((r) => r.status === 409));
  assert.equal((await db.query<{ n: number }>("SELECT count(*)::int n FROM sales_orders WHERE quotation_id = $1", [qid])).rows[0]!.n, 1);

  const c = await rep("POST", `/orders/${oid}/confirm`);
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.equal(c.json.status, "confirmed");
  let o = (await rep("GET", `/orders/${oid}`)).json;
  assert.equal(o.order.inventory_status, "unavailable", "tracked stock but no inventory system → never 'reserved'");
  assert.match(o.statusNotes.inventory, /Not connected/);
  assert.equal((await rep("POST", `/orders/${oid}/request-invoice`)).status, 403);
  const inv = await mgr("POST", `/orders/${oid}/request-invoice`);
  assert.equal(inv.json.status, "unavailable");

  // the queue keeps the work; processing with no providers must not report success
  const res = await processOutbox(db, { ...deps, integrations: {} }, 50);
  assert.equal((res as any).sent ?? 0, 0);
  o = (await rep("GET", `/orders/${oid}`)).json;
  assert.notEqual(o.order.invoice_status, "issued");
  assert.notEqual(o.order.inventory_status, "reserved");

  // payments
  assert.equal((await rep("POST", `/orders/${oid}/payments`, { amount: "10.00" })).status, 403, "reps cannot record payments");
  const p1 = await fin("POST", `/orders/${oid}/payments`, { amount: "500.00", reference: "BANK-1" });
  assert.equal(p1.status, 201, JSON.stringify(p1.json));
  assert.equal(p1.json.payment_status, "partial");
  assert.equal((await fin("POST", `/orders/${oid}/payments`, { amount: "9999.00" })).status, 409, "overpayment");
  const p2 = await fin("POST", `/orders/${oid}/payments`, { amount: "435.00" });
  assert.equal(p2.json.payment_status, "paid");
  assert.equal((await mgr("POST", `/orders/${oid}/cancel`, { reason: "changed mind" })).status, 409, "payments block cancellation");

  // fulfilment & returns
  const line = o.lines[0];
  assert.equal((await mgr("POST", `/orders/${oid}/fulfil`, { lines: [{ line_id: line.id, quantity: 11 }] })).status, 409, "over-fulfilment");
  assert.equal((await mgr("POST", `/orders/${oid}/fulfil`, { lines: [{ line_id: line.id, quantity: 6 }] })).json.status, "partially_fulfilled");
  assert.equal((await mgr("POST", `/orders/${oid}/fulfil`, { lines: [{ line_id: line.id, quantity: 4 }] })).json.status, "fulfilled");
  assert.equal((await mgr("POST", `/orders/${oid}/returns`, { line_id: line.id, quantity: 11, reason: "Too many" })).status, 409);
  const ret = await mgr("POST", `/orders/${oid}/returns`, { line_id: line.id, quantity: 2, reason: "Damaged" });
  assert.equal(ret.status, 201, JSON.stringify(ret.json));
  assert.equal(ret.json.credit_amount, "187.00"); // 2/10 of 935.00
  assert.equal(ret.json.returned_net, "170.00");
  const after = (await rep("GET", `/orders/${oid}`)).json;
  assert.equal(after.order.returned_total, "170.00");
  assert.equal((await mgr("POST", `/orders/${oid}/complete`)).status, 200);
});

test("orders over the approval threshold wait for an authorised approver", { skip }, async () => {
  const o = await rep("POST", "/orders", { account_id: accountId, lines: [{ product_id: serviceId, quantity: 200 }] }); // 100,000 > 50,000 threshold
  assert.equal(o.status, 201, JSON.stringify(o.json));
  const c = await rep("POST", `/orders/${o.json.id}/confirm`);
  assert.equal(c.json.status, "pending_approval");
  assert.ok(c.json.findings.some((f: any) => f.code === "order_over_threshold"));
  assert.equal((await rep("POST", `/orders/${o.json.id}/approve`)).status, 403);
  assert.equal((await mgr("POST", `/orders/${o.json.id}/approve`)).status, 403, "managers cannot approve over-threshold orders");
  const ok = await admin("POST", `/orders/${o.json.id}/approve`, { comment: "ok" });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const d = (await rep("GET", `/orders/${o.json.id}`)).json;
  assert.equal(d.order.status, "confirmed");
  assert.equal(d.order.approved_by.includes("boss@example.com"), true);
});

test("client_request_id makes order creation idempotent", { skip }, async () => {
  const body = { account_id: accountId, client_request_id: "req-12345678", lines: [{ product_id: serviceId, quantity: 1 }] };
  const a = await rep("POST", "/orders", body);
  const b = await rep("POST", "/orders", body);
  assert.equal(a.json.id, b.json.id);
});

test("targets: attainment reflects booked orders net of returns", { skip }, async () => {
  const memberRow = (await db.query<{ id: number }>("SELECT id FROM sales_members WHERE email = 'rep@example.com'")).rows[0]!;
  const year = new Date().getUTCFullYear();
  const per = await admin("POST", "/target-periods", { name: `FY${year}`, kind: "year", starts_on: `${year}-01-01`, ends_on: `${year}-12-31` });
  assert.equal(per.status, 201, JSON.stringify(per.json));
  const t = await admin("POST", "/targets", { period_id: per.json.id, scope: "member", scope_id: memberRow.id, amount: "100000.00" });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  assert.equal((await admin("POST", "/targets", { period_id: per.json.id, scope: "member", scope_id: memberRow.id, amount: "5.00" })).status, 409);
  assert.equal((await admin("POST", `/target-periods/${per.json.id}/status`, { status: "approved" })).status, 200);
  const r = await rep("GET", "/targets", undefined, { query: { period_id: String(per.json.id) } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const mine = r.json.items.find((x: any) => x.scope_id === memberRow.id);
  assert.ok(mine, "rep sees own target");
  // quoted order: 935.00 net 850.00 − 170.00 returned = 680.00; threshold order 100000 (service 200×500 net) booked too
  const expected = (await db.query<{ s: string }>("SELECT COALESCE(sum(net_total - returned_total),0)::numeric(18,2)::text s FROM sales_orders WHERE owner_id = $1 AND booked_at IS NOT NULL AND status <> 'cancelled'", [memberRow.id])).rows[0]!.s;
  assert.equal(mine.actual, expected);
  const other = await repB("GET", "/targets", undefined, { query: { period_id: String(per.json.id) } });
  assert.ok(!other.json.items.some((x: any) => x.scope_id === memberRow.id), "other reps cannot see this rep's target");
});
