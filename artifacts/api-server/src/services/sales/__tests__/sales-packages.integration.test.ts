import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { openDb, resetDb, client, ident, TEST_DB_URL } from "./helpers/harness";
import { buildPlan, allocate, addMonths } from "../domain/instalments";
import { SALES_SCHEMA_STATEMENTS } from "../../../../../../lib/db/src/sales-schema";
import type { Db } from "../core/types";

const skip = !TEST_DB_URL ? "SALES_TEST_DATABASE_URL not set" : false;
let db: Db & { close(): Promise<void> };
let admin: ReturnType<typeof client>, rep: ReturnType<typeof client>, fin: ReturnType<typeof client>, mgr: ReturnType<typeof client>, dir: ReturnType<typeof client>;
let acct = 0;
const get = (c: ReturnType<typeof client>, path: string) => { const [p, q = ""] = path.split("?"); return c("GET", p!, undefined, { query: Object.fromEntries(new URLSearchParams(q)) }); };
const sched = (j: any) => j.summary.schedule.map((i: any) => `${i.label}:${i.amount}`);

before(async () => {
  if (skip) return;
  db = await openDb(); await resetDb(db);
  // resetDb empties every sales_ table, so run the idempotent catalogue seed again exactly as a fresh boot would
  for (const st of SALES_SCHEMA_STATEMENTS.filter((x) => /^\s*(INSERT INTO sales_website_package|INSERT INTO sales_products \(sku|UPDATE sales_website_packages)/.test(x))) await db.query(st);
  admin = client(db, ident("boss@example.com", "admin")); await admin("GET", "/me");
  for (const [email, role] of [["rep@example.com", "sales_rep"], ["fin@example.com", "finance"], ["mgr@example.com", "sales_manager"], ["dir@example.com", "sales_director"]] as const) assert.equal((await admin("POST", "/members", { email, display_name: email.split("@")[0], role })).status, 201);
  rep = client(db, ident("rep@example.com")); fin = client(db, ident("fin@example.com")); mgr = client(db, ident("mgr@example.com")); dir = client(db, ident("dir@example.com"));
  acct = (await admin("POST", "/accounts", { name: "Akosua Boutique Ltd", email: "akosua@boutique.test", credit_limit: "100000000.00" })).json.id;
});
after(async () => { if (db) await db.close(); });

test("payment-plan arithmetic is exact: 50% upfront, equal instalments, the last absorbs rounding", () => {
  const p = (total: string, n: number) => buildPlan({ total, upfrontPercent: 50, instalments: n, bookingDate: "2026-01-31" });
  assert.deepEqual(p("3000.00", 2).items.map((i) => i.amount), ["1500.00", "750.00", "750.00"]);
  assert.deepEqual(p("5000.00", 3).items.map((i) => i.amount), ["2500.00", "833.33", "833.33", "833.34"]);
  assert.deepEqual(p("9000.00", 4).items.map((i) => i.amount), ["4500.00", "1125.00", "1125.00", "1125.00", "1125.00"]);
  assert.deepEqual(p("15000.00", 6).items.map((i) => i.amount), ["7500.00", "1250.00", "1250.00", "1250.00", "1250.00", "1250.00", "1250.00"]);
  assert.equal(p("9000.00", 4).balance, "4500.00", "never the 7,500 printed on the sheet");
  assert.equal(p("100.00", 3).items.slice(1).reduce((a, i) => a + Number(i.amount) * 100, 0), 5000);
  assert.deepEqual(p("3000.00", 2).items.map((i) => i.due_on), ["2026-01-31", "2026-02-28", "2026-03-28"].map((d, k) => k === 2 ? "2026-03-28" : d), "month-end dates clamp (31 Jan + 1 month = 28 Feb)");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28"); assert.equal(addMonths("2026-11-15", 3), "2027-02-15");
  assert.throws(() => buildPlan({ total: "100.00", upfrontAmount: "150.00", instalments: 1, bookingDate: "2026-01-01" }));
  const al = allocate(p("3000.00", 2).items, "1600.00", "2026-02-15");
  assert.deepEqual(al.items.map((i) => `${i.status}:${i.allocated}`), ["paid:1500.00", "partial:100.00", "pending:0.00"]);
});

test("the four website packages are seeded with every feature, price and payment term from the sheet", async (t) => {
  if (skip) return t.skip(skip);
  const r = await rep("GET", "/website-packages"); assert.equal(r.status, 200);
  const by = Object.fromEntries(r.json.items.map((p: any) => [p.code, p]));
  assert.deepEqual(r.json.items.map((p: any) => p.code), ["basic", "seo_growth", "seo_ai_support", "premium"]);
  const exp: any = { basic: ["3000.00", "1500.00", "1500.00", "750.00", 2, 6, "blue"], seo_growth: ["5000.00", "2500.00", "2500.00", "833.33", 3, 6, "green"], seo_ai_support: ["9000.00", "4500.00", "4500.00", "1125.00", 4, 6, "purple"], premium: ["15000.00", "7500.00", "7500.00", "1250.00", 6, 7, "orange"] };
  for (const [code, [price, up, bal, monthly, n, feats, accent]] of Object.entries(exp) as any) {
    const p = by[code]; assert.equal(p.price, price, code); assert.equal(p.upfront, up); assert.equal(p.balance, bal); assert.equal(p.monthly, monthly); assert.equal(p.instalments, n); assert.equal(p.features.length, feats); assert.equal(p.accent, accent); assert.equal(p.currency, "GHS");
  }
  assert.equal(by.seo_growth.lastInstalment, "833.34");
  assert.notEqual(by.seo_ai_support.balance, "7500.00");
  assert.deepEqual(by.basic.features.map((f: any) => f.text), ["Custom website design (up to 5 pages)", "Mobile responsiveness", "Basic UI setup", "Contact form integration", "Social media linking", "Fast loading optimization"]);
  assert.deepEqual(by.seo_growth.features.map((f: any) => f.text), ["On-page SEO setup (titles, metadata, structure)", "Keyword optimization", "Google indexing setup", "Performance optimization", "Sitemap configuration", "Analytics integration"]);
  assert.deepEqual(by.seo_ai_support.features.map((f: any) => f.text), ["Full SEO setup (on-page and technical)", "AI assistant integration for website interaction", "Customer support chat system", "Automated response flows", "Lead capture system", "Dashboard analytics for user activity"]);
  assert.deepEqual(by.premium.features.map((f: any) => f.text), ["Advanced SEO (technical and content structure)", "AI assistant with extended capabilities", "Customer support system with automation", "Security hardening (firewall and attack protection)", "Regular maintenance (updates, fixes, monitoring)", "Performance scaling optimization", "Backup system configuration"]);
  assert.match(by.basic.upfront_note, /before work starts/); assert.match(by.basic.terms, /Ghana Cedis/);
  const pv = await rep("POST", "/website-packages/preview", { package_code: "seo_growth", booking_date: "2026-09-15" });
  assert.deepEqual(pv.json.items.map((i: any) => `${i.amount}@${i.due_on}`), ["2500.00@2026-09-15", "833.33@2026-10-15", "833.33@2026-11-15", "833.34@2026-12-15"]);
});

const pkgOrder = async (c: ReturnType<typeof client>, code: string, extra: any = {}) => { const r = await c("POST", "/orders/package", { account_id: acct, package_code: code, ...extra }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json; };
const orders: Record<string, any> = {};

test("creating a package order stores the order, a frozen package snapshot and the schedule together", async (t) => {
  if (skip) return t.skip(skip);
  for (const [code, total, n] of [["basic", "3000.00", 3], ["seo_growth", "5000.00", 4], ["seo_ai_support", "9000.00", 5], ["premium", "15000.00", 7]] as const) {
    const r = await pkgOrder(admin, code, { booking_date: "2026-09-15" }); orders[code] = r;
    assert.equal(r.total, total); assert.equal(r.plan.items.length, n);
    const a = (await admin("GET", `/orders/${r.id}/agreement`)).json;
    assert.equal(a.order.currency, "GHS"); assert.equal(a.order.booking_date, "2026-09-15"); assert.equal(a.package.package_code, code);
    assert.equal(a.package.snapshot.features.length, code === "premium" ? 7 : 6); assert.equal(a.package.original_price, total); assert.equal(a.package.agreed_price, total);
    assert.equal(a.summary.planMatchesTotal, true); assert.equal(a.summary.outstanding, total); assert.equal(a.account.name, "Akosua Boutique Ltd");
  }
  assert.deepEqual(sched((await admin("GET", `/orders/${orders.seo_growth.id}/agreement`)).json), ["Upfront (50%):2500.00", "Month 1:833.33", "Month 2:833.33", "Month 3:833.34"]);
  assert.deepEqual(sched((await admin("GET", `/orders/${orders.premium.id}/agreement`)).json).slice(1), Array.from({ length: 6 }, (_, k) => `Month ${k + 1}:1250.00`));
});

test("later catalogue edits never change an existing agreement; negotiated changes stay distinguishable from the package", async (t) => {
  if (skip) return t.skip(skip);
  assert.equal((await rep("PATCH", "/website-packages/basic", { price: "1.00" })).status, 403);
  assert.equal((await admin("PATCH", "/website-packages/basic", { price: "3600.00", features: ["Custom website design (up to 5 pages)", "A brand new feature"] })).status, 200);
  const old = (await admin("GET", `/orders/${orders.basic.id}/agreement`)).json;
  assert.equal(old.package.snapshot.catalogue.price, "3000.00"); assert.equal(old.order.total, "3000.00"); assert.equal(old.package.snapshot.features.length, 6);
  const fresh = await pkgOrder(admin, "basic", { booking_date: "2026-09-16", agreed_price: "3300.00", discount_percent: 10, extras: [{ description: "Logo design", quantity: 1, unit_price: "400.00" }], requirements: "Needs Twi language toggle", custom_terms: "Hosting is billed separately", upfront_percent: 40, instalments: 3 });
  const a = (await admin("GET", `/orders/${fresh.id}/agreement`)).json;
  assert.equal(a.package.original_price, "3600.00"); assert.equal(a.package.agreed_price, "3300.00");
  assert.deepEqual(a.package.modifications.map((m: any) => m.type), ["price_change", "discount_percent", "extra_item", "payment_terms_changed"]);
  assert.equal(a.order.total, "3370.00", "3300 less 10% = 2970, plus the 400 extra");
  assert.equal(a.summary.schedule[0].amount, "1348.00", "40% upfront of 3370");
  assert.equal(a.summary.schedule.reduce((s: number, i: any) => s + Math.round(Number(i.amount) * 100), 0), 337000);
  assert.equal(a.package.requirements, "Needs Twi language toggle");
  assert.equal((await admin("PATCH", "/website-packages/basic", { price: "3000.00", features: ["Custom website design (up to 5 pages)", "Mobile responsiveness", "Basic UI setup", "Contact form integration", "Social media linking", "Fast loading optimization"] })).status, 200);
  assert.equal((await admin("POST", `/orders/${fresh.id}/delete`, { reason: "test clean-up", confirm_number: fresh.number })).status, 200);
});

test("payment tracking: upfront, instalments, early and extra payments, overpayment guard, no double counting", async (t) => {
  if (skip) return t.skip(skip);
  const o = orders.basic; await admin("POST", `/orders/${o.id}/confirm`);
  const pay = (amount: string, extra: any = {}) => fin("POST", `/orders/${o.id}/payments`, { amount, ...extra });
  const s0 = (await get(fin, `/orders/${o.id}/payment-summary`)).json; assert.equal(s0.upfrontExpected, "1500.00"); assert.equal(s0.upfrontReceived, "0.00"); assert.ok(s0.instalmentsOverdue >= 1, "the upfront was due on the booking date, which has passed");
  const p1 = await pay("1500.00", { method: "mobile_money", reference: "MOMO-1", received_on: "2026-09-15", notes: "Upfront" }); assert.equal(p1.status, 201, JSON.stringify(p1.json));
  const s1 = (await get(fin, `/orders/${o.id}/payment-summary`)).json;
  assert.equal(s1.upfrontReceived, "1500.00"); assert.equal(s1.totalPaid, "1500.00"); assert.equal(s1.outstanding, "1500.00"); assert.equal(s1.completionPercent, 50); assert.equal(s1.nextDue.label, "Month 1");
  assert.equal(s1.instalmentsPaid, 0); assert.equal(s1.instalmentsTotal, 2);
  const p2 = await pay("400.00", { received_on: "2026-10-14" }); assert.equal(p2.status, 201);
  const s2 = (await get(fin, `/orders/${o.id}/payment-summary`)).json; assert.equal(s2.schedule[1].status, "overdue"); assert.equal(s2.schedule[1].allocated, "400.00"); assert.equal(s2.schedule[1].outstanding, "350.00");
  assert.equal((await pay("9999.00")).status, 409, "overpayment refused");
  assert.equal((await pay("1500.00", { received_on: "2026-10-20" })).status, 409, "exceeds the outstanding 1100");
  const early = await pay("1100.00", { received_on: "2026-10-20", method: "bank_transfer", notes: "Early settlement" }); assert.equal(early.status, 201);
  const s3 = (await get(fin, `/orders/${o.id}/payment-summary`)).json; assert.equal(s3.outstanding, "0.00"); assert.equal(s3.completionPercent, 100); assert.equal(s3.instalmentsPaid, 2); assert.equal(s3.nextDue, null);
  const a = (await admin("GET", `/orders/${o.id}/agreement`)).json;
  assert.deepEqual(a.payments.map((p: any) => p.amount), ["1500.00", "400.00", "1100.00"]); assert.equal(a.payments[0].notes, "Upfront");
  assert.equal(a.order.payment_status, "paid");
  const idem = { "idempotency-key": "same-click-1" };
  const o2 = orders.seo_growth; await admin("POST", `/orders/${o2.id}/confirm`);
  const d1 = await fin("POST", `/orders/${o2.id}/payments`, { amount: "2500.00" }, { headers: idem }), d2 = await fin("POST", `/orders/${o2.id}/payments`, { amount: "2500.00" }, { headers: idem });
  assert.equal(d1.status, 201); assert.equal((await db.query<any>("SELECT count(*)::int n FROM sales_order_payments WHERE order_id = $1", [o2.id])).rows[0].n, 1, "a double submission is counted once");
  void d2;
});

test("payment plan changes: reschedule, change instalments, custom schedule; payments are never altered", async (t) => {
  if (skip) return t.skip(skip);
  const o = orders.seo_growth;
  const beforePay = (await db.query<any>("SELECT id, amount::text, received_on, at FROM sales_order_payments WHERE order_id = $1", [o.id])).rows;
  const r = await fin("PATCH", `/orders/${o.id}/instalments/2`, { due_on: "2027-01-15", note: "Customer asked to delay" }); assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.schedule.find((i: any) => i.seq === 2).due_on, "2027-01-15");
  const re = await fin("PUT", `/orders/${o.id}/payment-plan`, { instalments: 5, first_due_on: "2026-11-01", reason: "stretch to 5 months" }); assert.equal(re.status, 200, JSON.stringify(re.json));
  assert.deepEqual(re.json.schedule.map((i: any) => i.amount), ["2500.00", "500.00", "500.00", "500.00", "500.00", "500.00"]); assert.equal(re.json.schedule[1].due_on, "2026-11-01");
  assert.equal(re.json.totalPaid, "2500.00"); assert.equal(re.json.outstanding, "2500.00"); assert.equal(re.json.schedule[0].status, "paid");
  const bad = await fin("PUT", `/orders/${o.id}/payment-plan`, { items: [{ label: "Upfront", due_on: "2026-09-15", amount: "2500.00" }, { label: "Rest", due_on: "2026-12-01", amount: "2000.00" }] }); assert.equal(bad.status, 400); assert.match(JSON.stringify(bad.json), /must match exactly/);
  const ok = await fin("PUT", `/orders/${o.id}/payment-plan`, { items: [{ label: "Upfront (50%)", due_on: "2026-09-15", amount: "2500.00" }, { label: "Go-live", due_on: "2026-12-01", amount: "1500.00" }, { label: "Handover", due_on: "2027-02-01", amount: "1000.00" }] }); assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual(ok.json.schedule.map((i: any) => i.label), ["Upfront (50%)", "Go-live", "Handover"]);
  assert.deepEqual((await db.query<any>("SELECT id, amount::text, received_on, at FROM sales_order_payments WHERE order_id = $1", [o.id])).rows, beforePay, "recorded payments are untouched");
  assert.equal((await rep("PUT", `/orders/${o.id}/payment-plan`, { instalments: 2 })).status, 404, "a rep cannot touch someone else's order");
  assert.ok((await db.query<any>("SELECT 1 FROM sales_audit_events WHERE action = 'order.payment_plan_changed' AND entity_id = $1", [String(o.id)])).rows.length >= 2);
});

test("booking date: past, today, future; editable at every stage; actual event times are never rewritten", async (t) => {
  if (skip) return t.skip(skip);
  const today = new Date().toISOString().slice(0, 10), future = "2031-03-01";
  const created: Record<string, number> = {};
  for (const [k, d] of [["past", "2025-01-10"], ["today", today], ["future", future]] as const) { const r = await pkgOrder(admin, "basic", { booking_date: d }); created[k] = r.id; assert.equal((await admin("GET", `/orders/${r.id}/agreement`)).json.order.booking_date, d); assert.equal((await admin("POST", `/orders/${r.id}/confirm`)).status, 200, `${k} dated orders can be confirmed`); }
  assert.equal(new Date((await db.query<any>("SELECT booked_at FROM sales_orders WHERE id = $1", [created.future])).rows[0].booked_at).toISOString().slice(0, 10), future);
  const id = orders.basic.id; // fully paid above
  const before = (await db.query<any>("SELECT confirmed_at, created_at FROM sales_orders WHERE id = $1", [id])).rows[0];
  const pays = (await db.query<any>("SELECT received_on::text r, at FROM sales_order_payments WHERE order_id = $1 ORDER BY id", [id])).rows;
  assert.equal((await rep("PATCH", `/orders/${id}/transaction-date`, { transaction_date: "2026-08-01" })).status, 404);
  assert.equal((await mgr("PATCH", `/orders/${id}/transaction-date`, { transaction_date: "2026-08-01" })).status, 404, "not in their scope");
  assert.equal((await admin("PATCH", `/orders/${id}/transaction-date`, { transaction_date: "2026-08-01", reason: "sale actually closed in August" })).status, 200);
  await admin("POST", `/orders/${id}/complete`);
  assert.equal((await admin("PATCH", `/orders/${id}/transaction-date`, { transaction_date: "2026-08-02" })).status, 200, "even a fully paid or completed order can be re-dated by an authorised user");
  const after = (await db.query<any>("SELECT confirmed_at, created_at, booked_at, transaction_date FROM sales_orders WHERE id = $1", [id])).rows[0];
  assert.deepEqual([after.confirmed_at, after.created_at], [before.confirmed_at, before.created_at], "creation and confirmation timestamps are unchanged");
  assert.equal(new Date(after.booked_at).toISOString().slice(0, 10), "2026-08-02");
  assert.deepEqual((await db.query<any>("SELECT received_on::text r, at FROM sales_order_payments WHERE order_id = $1 ORDER BY id", [id])).rows, pays, "payment dates are unchanged");
  assert.equal((await admin("PATCH", `/orders/${id}/transaction-date`, { transaction_date: null })).status, 400, "a booked order needs a date");
  const sep = (await get(admin, "/fx/summary?from=2026-08-01&to=2026-08-31&reporting=GHS")).json.metrics.find((m: any) => m.key === "booked");
  assert.ok(sep.byCurrency.some((c: any) => c.currency === "GHS" && Number(c.amount) >= 3000), "reports follow the booking date");
});

test("permanent deletion: confirmations, roles, evidence, cleanup and reconciliation at every stage", async (t) => {
  if (skip) return t.skip(skip);
  const stages: Record<string, any> = {};
  stages.draft = await pkgOrder(admin, "basic", { booking_date: "2026-09-20" });
  stages.pending = await pkgOrder(admin, "seo_growth", { booking_date: "2026-09-20" }); await db.query("UPDATE sales_orders SET status = 'pending_approval' WHERE id = $1", [stages.pending.id]);
  stages.confirmed = await pkgOrder(admin, "seo_ai_support", { booking_date: "2026-09-20" }); await admin("POST", `/orders/${stages.confirmed.id}/confirm`);
  stages.partial = await pkgOrder(admin, "premium", { booking_date: "2026-09-20" }); await admin("POST", `/orders/${stages.partial.id}/confirm`); await fin("POST", `/orders/${stages.partial.id}/payments`, { amount: "7500.00", reference: "BANK-9", received_on: "2026-09-21" });
  stages.paid = await pkgOrder(admin, "basic", { booking_date: "2026-09-20" }); await admin("POST", `/orders/${stages.paid.id}/confirm`); await fin("POST", `/orders/${stages.paid.id}/payments`, { amount: "3000.00", received_on: "2026-09-21" });
  stages.completed = await pkgOrder(admin, "basic", { booking_date: "2026-09-20" }); await admin("POST", `/orders/${stages.completed.id}/confirm`); await fin("POST", `/orders/${stages.completed.id}/payments`, { amount: "3000.00" }); await admin("POST", `/orders/${stages.completed.id}/complete`);
  await db.query("INSERT INTO sales_commission_entries (order_id, member_id, plan_id, kind, status, amount, basis_amount, split_percent, breakdown) SELECT $1, (SELECT id FROM sales_members LIMIT 1), 0, 'commission', 'calculated', 10, 100, 100, '{}'::jsonb WHERE false", [stages.partial.id]).catch(() => undefined);
  const imp = (await admin("GET", `/orders/${stages.partial.id}/deletion-impact`)).json;
  assert.equal(imp.payments, 1); assert.equal(imp.paid_total, "7500.00"); assert.equal(imp.needsPaymentAcknowledgement, true); assert.equal(imp.customer, "Akosua Boutique Ltd"); assert.equal(imp.instalments, 7);
  for (const c of [rep, mgr, dir, fin]) assert.equal((await c("POST", `/orders/${stages.draft.id}/delete`, { reason: "unauthorised try", confirm_number: stages.draft.number })).status, 403, "only administrators may permanently delete");
  assert.equal((await admin("POST", `/orders/${stages.draft.id}/delete`, { reason: "x", confirm_number: stages.draft.number })).status, 422, "a reason of at least 5 characters is required");
  const wrong = await admin("POST", `/orders/${stages.draft.id}/delete`, { reason: "duplicate booking", confirm_number: "SO-WRONG" }); assert.equal(wrong.status, 400);
  const before = (await get(admin, "/orders")).json.total ?? (await get(admin, "/orders")).json.items.length;
  for (const k of ["draft", "pending"]) { const r = await admin("POST", `/orders/${stages[k].id}/delete`, { reason: `delete ${k} order`, confirm_number: stages[k].number, acknowledge_confirmed: k === "pending" }); assert.equal(r.status, 200, JSON.stringify(r.json)); }
  assert.equal((await admin("POST", `/orders/${stages.confirmed.id}/delete`, { reason: "customer withdrew", confirm_number: stages.confirmed.number })).status, 409, "confirmed orders need the extra acknowledgement");
  assert.equal((await admin("POST", `/orders/${stages.confirmed.id}/delete`, { reason: "customer withdrew", confirm_number: stages.confirmed.number, acknowledge_confirmed: true })).status, 200);
  const noAck = await admin("POST", `/orders/${stages.partial.id}/delete`, { reason: "entered on wrong customer", confirm_number: stages.partial.number, acknowledge_confirmed: true }); assert.equal(noAck.status, 409); assert.match(JSON.stringify(noAck.json), /does NOT refund/);
  const del = await admin("POST", `/orders/${stages.partial.id}/delete`, { reason: "entered on wrong customer", confirm_number: stages.partial.number, acknowledge_confirmed: true, acknowledge_payments: true });
  assert.equal(del.status, 200, JSON.stringify(del.json)); assert.deepEqual(del.json.paymentsReceivedNotRefunded, { amount: "7500.00", currency: "GHS", count: 1 });
  for (const k of ["paid", "completed"]) { const r = await admin("POST", `/orders/${stages[k].id}/delete`, { reason: `remove ${k} order`, confirm_number: stages[k].number, acknowledge_confirmed: true, acknowledge_payments: true }); assert.equal(r.status, 200, JSON.stringify(r.json)); }
  for (const k of Object.keys(stages)) {
    const id = stages[k].id;
    assert.equal((await admin("GET", `/orders/${id}`)).status, 404, `${k}: gone from detail`);
    for (const tb of ["sales_order_lines", "sales_order_payments", "sales_order_instalments", "sales_order_packages"]) assert.equal((await db.query<any>(`SELECT count(*)::int n FROM ${tb} WHERE order_id = $1`, [id])).rows[0].n, 0, `${k}: ${tb} cleaned`);
  }
  const list = (await get(admin, "/orders")).json; assert.ok(!JSON.stringify(list).includes(stages.paid.number)); void before;
  const allEv = (await admin("GET", "/orders-deleted")).json.items; assert.ok(allEv.length >= 7, "includes the order removed in an earlier test");
  const nums = new Set(Object.values(stages).map((x: any) => x.number)); const ev = allEv.filter((e: any) => nums.has(e.number)); assert.equal(ev.length, 6);
  const partial = ev.find((e: any) => e.number === stages.partial.number); assert.equal(partial.paid_total, "7500.00"); assert.equal(partial.payment_count, 1); assert.match(partial.note, /not refunded/); assert.equal(partial.deleted_by.length > 0, true); assert.equal(partial.reason, "entered on wrong customer");
  const snap = (await db.query<any>("SELECT snapshot FROM sales_deleted_orders WHERE number = $1", [stages.partial.number])).rows[0].snapshot;
  assert.equal(snap.payments.length, 1); assert.equal(snap.payments[0].reference, "BANK-9"); assert.equal(snap.package.package_code, "premium"); assert.equal(snap.instalments.length, 7);
  assert.equal(ev.reduce((s: number, e: any) => s + Number(e.paid_total), 0), 7500 + 3000 + 3000, "received money is reconcilable from the evidence");
  for (const c of [rep, mgr, dir, fin]) assert.equal((await c("GET", "/orders-deleted")).status, 403);
  assert.ok((await db.query<any>("SELECT 1 FROM sales_audit_events WHERE action = 'order.deleted'")).rows.length >= 6, "audit trail survives");
  const acc = (await admin("GET", `/accounts/${acct}`)).json; assert.ok(!JSON.stringify(acc).includes(stages.paid.number), "removed from the customer's order history");
});

test("website package orders feed reporting by booking date and sale; cash by payment date", async (t) => {
  if (skip) return t.skip(skip);
  const sum = (await get(admin, "/fx/summary?from=2026-09-01&to=2026-12-31&reporting=GHS")).json;
  const booked = sum.metrics.find((m: any) => m.key === "booked"), cash = sum.metrics.find((m: any) => m.key === "cash");
  assert.ok(booked.byCurrency.find((c: any) => c.currency === "GHS"));
  assert.ok(cash.byCurrency.find((c: any) => c.currency === "GHS" && Number(c.amount) >= 2500), "cash counts on the payment date");
  const bypkg = (await db.query<any>("SELECT p.package_code, count(*)::int n, sum(o.total)::text t FROM sales_order_packages p JOIN sales_orders o ON o.id = p.order_id GROUP BY 1 ORDER BY 1")).rows;
  assert.ok(bypkg.length >= 2);
});

test("package report: by package, customer, representative, collections and overdue; separated by currency; deleted orders only for administrators", async (t) => {
  if (skip) return t.skip(skip);
  const r = (await get(admin, "/website-packages/report?from=2025-01-01&to=2027-12-31")).json;
  assert.ok(r.byPackage.length >= 2 && r.byPackage.every((x: any) => x.currency === "GHS"));
  assert.ok(r.byCustomer.some((x: any) => x.customer === "Akosua Boutique Ltd")); assert.ok(r.byRep.length >= 1);
  assert.ok(r.cashReceived.find((c: any) => c.currency === "GHS" && Number(c.amount) > 0)); assert.ok(r.monthlyCollections.length >= 1);
  assert.ok(Array.isArray(r.outstanding) && Array.isArray(r.completedAndCancelled)); assert.ok(Array.isArray(r.deletedPackageOrders) && r.deletedPackageOrders[0].orders >= 6);
  assert.equal((await get(rep, "/website-packages/report?from=2025-01-01&to=2027-12-31")).json.deletedPackageOrders, null, "deleted-order reporting is for authorised users only");
  assert.equal((await get(rep, "/website-packages/report?from=2025-01-01&to=2027-12-31")).json.byPackage.length, 0, "a rep sees only their own sales");
});
