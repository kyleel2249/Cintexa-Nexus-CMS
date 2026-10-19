import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { openDb, resetDb, client, ident, deps, TEST_DB_URL } from "./helpers/harness";
import { expireQuotations, sendReminders, deliverReportSchedules, weeklyForecastSnapshot, housekeeping, runSalesJobs } from "../jobs";
import type { Db } from "../core/types";

const skip = !TEST_DB_URL ? "SALES_TEST_DATABASE_URL not set" : false;
let db: Db & { close(): Promise<void> };
let admin: ReturnType<typeof client>, rep: ReturnType<typeof client>;
let accountId = 0, productId = 0;

before(async () => {
  if (skip) return;
  db = await openDb();
  await resetDb(db);
  admin = client(db, ident("boss@example.com", "admin"));
  await admin("GET", "/me");
  await admin("POST", "/members", { email: "rep@example.com", display_name: "rep", role: "sales_rep" });
  rep = client(db, ident("rep@example.com"));
  accountId = (await rep("POST", "/accounts", { name: "Job Co" })).json.id;
  productId = (await admin("POST", "/products", { sku: "J-1", name: "Thing", base_price: "100.00", cost_price: "30.00" })).json.id;
});
after(async () => { if (db) await db.close(); });

test("a second platform admin is not silently made a Sales Administrator", { skip }, async () => {
  const second = client(db, ident("other-admin@example.com", "admin"));
  const r = await second("GET", "/me");
  assert.equal(r.status, 403);
  assert.equal(r.json.code, "not_a_sales_member");
  assert.equal((await admin("POST", "/members", { email: "other-admin@example.com", display_name: "Other", role: "sales_manager" })).status, 201);
  assert.equal((await second("GET", "/me")).status, 200);
});

test("expiry job persists expired quotations; reminders are deduplicated per day", { skip }, async () => {
  const q = await rep("POST", "/quotations", { account_id: accountId, lines: [{ product_id: productId, quantity: 1 }] });
  assert.equal(q.status, 201, JSON.stringify(q.json));
  await db.query("UPDATE sales_quotations SET status = 'sent', validity_date = (now() - interval '3 days')::date WHERE id = $1", [q.json.id]);
  assert.equal(await expireQuotations(db, deps), 1);
  assert.equal((await db.query<any>("SELECT status FROM sales_quotations WHERE id = $1", [q.json.id])).rows[0].status, "expired");
  assert.equal(await expireQuotations(db, deps), 0, "idempotent");

  const act = await rep("POST", "/activities", { type: "task", subject: "Call the customer", due_at: new Date(Date.now() - 3_600_000).toISOString() });
  assert.equal(act.status, 201, JSON.stringify(act.json));
  const first = await sendReminders(db, deps);
  assert.ok(first >= 1);
  assert.equal(await sendReminders(db, deps), 0, "same day, same item: no duplicate notification");
});

test("report schedules stay due (not silently dropped) while email is not connected", { skip }, async () => {
  const s = await admin("POST", "/report-schedules", { report: "sales_by_day", cadence: "daily", recipients: ["boss@example.com"] });
  assert.equal(s.status, 201, JSON.stringify(s.json));
  await db.query("UPDATE sales_report_schedules SET next_run_at = now() - interval '1 hour'");
  const r = await deliverReportSchedules(db, deps);
  assert.deepEqual(r, { sent: 0, waiting: 1 });
  assert.equal((await db.query<any>("SELECT last_run_at FROM sales_report_schedules")).rows[0].last_run_at, null);
  assert.equal((await db.query("SELECT 1 FROM sales_outbox WHERE entity_type = 'report_schedule'")).rows.length, 0);
});

test("weekly forecast snapshot runs once per week; housekeeping and the combined pass do not throw", { skip }, async () => {
  assert.equal(await weeklyForecastSnapshot(db, deps), true);
  assert.equal(await weeklyForecastSnapshot(db, deps), false);
  await housekeeping(db, deps);
  const pass = await runSalesJobs(db, deps);
  assert.ok(!Object.values(pass).includes("error"), JSON.stringify(pass));
});
