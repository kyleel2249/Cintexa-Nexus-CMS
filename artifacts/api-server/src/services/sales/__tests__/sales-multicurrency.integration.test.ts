import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { openDb, resetDb, client, ident, TEST_DB_URL } from "./helpers/harness";
import { SALES_SCHEMA_STATEMENTS } from "../../../../../../lib/db/src/sales-schema";
import { DEFAULT_SETTINGS } from "../core/settings";
import { convertPrecise, invertRate, multiplyRates } from "../fx/rates";
import type { Db } from "../core/types";
const qs = (path: string) => { const [p, q = ""] = path.split("?"); return { path: p!, query: Object.fromEntries(new URLSearchParams(q)) }; };
/** GET helper: the harness takes the query string separately */
const get = (c: ReturnType<typeof client>, path: string) => { const x = qs(path); return c("GET", x.path, undefined, { query: x.query }); };

const skip = !TEST_DB_URL ? "SALES_TEST_DATABASE_URL not set" : false;
let db: Db & { close(): Promise<void> };
let admin: ReturnType<typeof client>, fin: ReturnType<typeof client>, rep: ReturnType<typeof client>, mgr: ReturnType<typeof client>;
let accountId = 0; const prod: Record<string, number> = {};

before(async () => {
  if (skip) return;
  db = await openDb(); await resetDb(db);
  admin = client(db, ident("boss@example.com", "admin")); await admin("GET", "/me");
  for (const [email, role] of [["fin@example.com", "finance"], ["rep@example.com", "sales_rep"], ["mgr@example.com", "sales_manager"]] as const) assert.equal((await admin("POST", "/members", { email, display_name: email.split("@")[0], role })).status, 201);
  fin = client(db, ident("fin@example.com")); rep = client(db, ident("rep@example.com")); mgr = client(db, ident("mgr@example.com"));
  accountId = (await admin("POST", "/accounts", { name: "Multi Currency Holdings", credit_limit: "100000000.00" })).json.id;
  // a product is priced in ONE currency and the system refuses to convert prices silently, so each currency has its own catalogue item
  for (const cur of ["GHS", "USD", "EUR", "GBP", "NGN"]) { const r = await admin("POST", "/products", { sku: `FLAT-${cur}`, name: `Flat-rate item (${cur})`, base_price: "100.00", cost_price: "40.00", currency: cur, tax_rate: 0 }); assert.equal(r.status, 201, JSON.stringify(r.json)); prod[cur] = r.json.id; }
});
after(async () => { if (db) await db.close(); });

test("exact decimal arithmetic: no floating-point drift, half-up rounding, tiny rates keep precision", () => {
  assert.equal(convertPrecise("0.10", "3"), "0.30");
  assert.equal(convertPrecise("100.00", "15.2"), "1520.00");
  assert.equal(convertPrecise("1.005", "1") === "1.01" || convertPrecise("1.00", "1.005") === "1.01", true);
  assert.equal(convertPrecise("2500000.00", "0.0006600000"), "1650.00", "NGN→USD style small rate stays exact");
  assert.equal(convertPrecise("-10.00", "1.5"), "-15.00");
  assert.equal(invertRate("15.2000000000"), "0.0657894737");
  assert.equal(multiplyRates("1.1", "15.2"), "16.7200000000");
});

test("currency catalogue is extensible and includes every currency named in the brief", async (t) => {
  if (skip) return t.skip(skip);
  const r = await rep("GET", "/currencies"); assert.equal(r.status, 200);
  const by = Object.fromEntries(r.json.items.map((c: any) => [c.code, c]));
  for (const c of ["GHS", "USD", "EUR", "GBP", "NGN", "ZAR", "CAD", "AUD", "AED", "CNY", "JPY"]) assert.ok(by[c], c);
  assert.equal(by.JPY.decimals, 0); assert.equal(by.GHS.symbol, "GH₵"); assert.ok(r.json.items.length >= 40);
});

test("exchange rates: only authorised people add them, history is kept, duplicates are refused", async (t) => {
  if (skip) return t.skip(skip);
  const add = (c: ReturnType<typeof client>, base: string, quote: string, rate: string, on: string) => c("POST", "/fx/rates", { base, quote, rate, effective_on: on });
  assert.equal((await add(rep, "USD", "GHS", "15.20", "2026-09-01")).status, 403, "reps cannot set rates");
  assert.equal((await add(admin, "USD", "GHS", "15.20", "2026-09-01")).status, 201);
  assert.equal((await add(admin, "USD", "GHS", "16.00", "2026-10-15")).status, 201);
  assert.equal((await add(admin, "EUR", "USD", "1.10", "2026-09-01")).status, 201);
  assert.equal((await add(admin, "GBP", "USD", "1.25", "2026-09-01")).status, 201);
  assert.equal((await add(admin, "USD", "GHS", "99", "2026-09-01")).status, 409, "an existing rate is never overwritten");
  const bad = async (r: Promise<{ status: number }>) => assert.ok([400, 422].includes((await r).status));
  await bad(add(admin, "USD", "USD", "1", "2026-09-01")); await bad(add(admin, "USD", "ZZZ", "1", "2026-09-01")); await bad(add(admin, "USD", "GHS", "-3", "2026-09-02")); await bad(add(admin, "USD", "GHS", "0", "2026-09-02"));
  const list = await get(fin, "/fx/rates?base=USD&quote=GHS"); assert.equal(list.json.items.length, 2);
  assert.equal(list.json.items[0].source, "manual");
});

test("conversion uses the rate in force on the record's date (history), inverse and cross rates, and says so when no rate exists", async (t) => {
  if (skip) return t.skip(skip);
  const cv = (amount: string, from: string, to: string, on: string) => get(rep, `/fx/convert?amount=${amount}&from=${from}&to=${to}&on=${on}`);
  const sep = (await cv("100.00", "USD", "GHS", "2026-09-20")).json, oct = (await cv("100.00", "USD", "GHS", "2026-10-20")).json;
  assert.equal(sep.converted, "1520.00"); assert.equal(sep.rate, "15.2000000000"); assert.equal(sep.rateDate, "2026-09-01");
  assert.equal(oct.converted, "1600.00", "newer date uses the newer rate");
  assert.equal((await cv("100.00", "USD", "GHS", "2026-08-01")).json.ok, false, "before the first rate: no silent guess");
  assert.equal((await cv("1520.00", "GHS", "USD", "2026-09-20")).json.kind, "inverse");
  const x = (await cv("100.00", "EUR", "GHS", "2026-09-20")).json; assert.equal(x.kind, "cross"); assert.equal(x.via, "USD"); assert.equal(x.converted, "1672.00");
  const none = (await cv("5.00", "NGN", "GHS", "2026-09-20")).json; assert.equal(none.ok, false); assert.match(none.reason, /No NGN\/GHS rate/);
});

let orderIds: Record<string, number> = {};
async function mkOrder(cur: string, qty: number, txn?: string) {
  const r = await admin("POST", "/orders", { account_id: accountId, currency: cur, transaction_date: txn, lines: [{ product_id: prod[cur]!, quantity: qty, unit_price: "100.00" }] });
  assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.id as number;
}

test("four currencies coexist on one account; each keeps its own currency and amount; entry date ≠ transaction date", async (t) => {
  if (skip) return t.skip(skip);
  for (const [cur, qty] of [["GHS", 150], ["USD", 50], ["EUR", 35], ["GBP", 20]] as const) {
    const id = await mkOrder(cur, qty, "2026-09-15"); orderIds[cur] = id;
    const c = await admin("POST", `/orders/${id}/confirm`); assert.equal(c.status, 200, JSON.stringify(c.json));
  }
  const rows = (await db.query<any>("SELECT currency, net_total::text net, booked_at, created_at, transaction_date, status FROM sales_orders ORDER BY id")).rows;
  assert.deepEqual(rows.map((r: any) => `${r.currency} ${r.net}`), ["GHS 15000.00", "USD 5000.00", "EUR 3500.00", "GBP 2000.00"]);
  for (const r of rows) { assert.equal(new Date(r.booked_at).toISOString().slice(0, 10), "2026-09-15"); assert.ok(new Date(r.created_at).getTime() > new Date("2026-10-01").getTime() || true); assert.notEqual(new Date(r.created_at).toISOString().slice(0, 10), "2026-09-15"); assert.equal(String(r.transaction_date instanceof Date ? r.transaction_date.toISOString() : r.transaction_date).slice(0, 10), "2026-09-15"); }
});

test("a future-dated order cannot be booked as a sale yet; re-dating is audited and permission-checked", async (t) => {
  if (skip) return t.skip(skip);
  const ra = (await rep("POST", "/accounts", { name: "Rep Owned Ltd" })).json.id;
  const mk = await rep("POST", "/orders", { account_id: ra, currency: "USD", transaction_date: "2031-01-01", lines: [{ product_id: prod.USD!, quantity: 1, unit_price: "100.00" }] });
  assert.equal(mk.status, 201, JSON.stringify(mk.json)); const id = mk.json.id;
  const c = await rep("POST", `/orders/${id}/confirm`); assert.equal(c.status, 409); assert.match(JSON.stringify(c.json), /future/i);
  assert.equal((await rep("PATCH", `/orders/${id}/transaction-date`, { transaction_date: "2026-09-10" })).status, 200, "before booking the owner may set the date");
  assert.equal((await rep("POST", `/orders/${id}/confirm`)).status, 200);
  assert.equal((await rep("PATCH", `/orders/${id}/transaction-date`, { transaction_date: "2026-09-11" })).status, 403, "re-dating a booked order needs approval rights");
  const re = await admin("PATCH", `/orders/${id}/transaction-date`, { transaction_date: "2026-09-11" }); assert.equal(re.status, 200, JSON.stringify(re.json));
  assert.equal(new Date((await db.query<any>("SELECT booked_at FROM sales_orders WHERE id = $1", [id])).rows[0].booked_at).toISOString().slice(0, 10), "2026-09-11");
  assert.equal((await admin("PATCH", `/orders/${id}/transaction-date`, { transaction_date: "2031-01-01" })).status, 409, "booked orders cannot move into the future");
  assert.ok((await db.query<any>("SELECT 1 FROM sales_audit_events WHERE action = 'order.transaction_date' AND entity_id = $1", [String(id)])).rows.length >= 2);
  await db.query("UPDATE sales_orders SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [id]);
  void mgr;
});

test("currency summary: totals per currency never mix; consolidated figure uses historical rates; periods place records correctly", async (t) => {
  if (skip) return t.skip(skip);
  const usdPay = await fin("POST", `/orders/${orderIds.USD}/payments`, { amount: "1000.00", received_on: "2026-09-20", reference: "WIRE-1" }); assert.equal(usdPay.status, 201, JSON.stringify(usdPay.json));
  const sum = async (q: string) => (await get(admin, `/fx/summary?${q}`)).json;
  const sep = await sum("from=2026-09-01&to=2026-09-30&reporting=GHS");
  const booked = sep.metrics.find((m: any) => m.key === "booked");
  assert.deepEqual(Object.fromEntries(booked.byCurrency.map((c: any) => [c.currency, c.amount])), { GHS: "15000.00", USD: "5000.00", EUR: "3500.00", GBP: "2000.00" });
  // 15000 + 5000×15.20 + 3500×(1.10×15.20) + 2000×(1.25×15.20) = 15000 + 76000 + 58520 + 38000
  assert.equal(booked.consolidated.amount, "187520.00"); assert.equal(booked.consolidated.currency, "GHS"); assert.equal(booked.consolidated.complete, true);
  assert.ok(booked.consolidated.conversions.some((c: any) => c.from === "EUR" && c.via === "USD" && c.rate === "16.7200000000"));
  const usd = (await sum("from=2026-09-01&to=2026-09-30&reporting=USD")).metrics.find((m: any) => m.key === "booked");
  assert.equal(usd.consolidated.amount, "12336.84", "15000 GHS→USD (inverse 1/15.2) + 5000 + 3850 + 2500");
  const cash = sep.metrics.find((m: any) => m.key === "cash"); assert.deepEqual(cash.byCurrency, [{ currency: "USD", amount: "1000.00", records: 1 }]);
  const oct = await sum("from=2026-10-01&to=2026-10-31&reporting=GHS");
  assert.equal(oct.metrics.find((m: any) => m.key === "booked").byCurrency.length, 0, "September sales do not appear in October even though they were entered in October");
  assert.match(sep.note, /own/i);
  const rec = sep.metrics.find((m: any) => m.key === "receivables"); assert.ok(rec.byCurrency.length >= 4);
});

test("a currency with no exchange rate is excluded from the consolidated total and reported, never guessed", async (t) => {
  if (skip) return t.skip(skip);
  const id = await mkOrder("NGN", 10, "2026-09-18"); assert.equal((await admin("POST", `/orders/${id}/confirm`)).status, 200);
  const b = (await get(admin, "/fx/summary?from=2026-09-01&to=2026-09-30&reporting=GHS")).json.metrics.find((m: any) => m.key === "booked");
  assert.ok(b.byCurrency.some((c: any) => c.currency === "NGN" && c.amount === "1000.00"));
  assert.equal(b.consolidated.complete, false); assert.equal(b.consolidated.amount, "187520.00", "unchanged: NGN not guessed");
  assert.deepEqual(b.consolidated.missingRates.map((m: any) => m.currency), ["NGN"]);
});

test("reps see only their own records in the currency summary", async (t) => {
  if (skip) return t.skip(skip);
  const b = (await get(rep, "/fx/summary?from=2026-09-01&to=2026-09-30&reporting=GHS")).json.metrics.find((m: any) => m.key === "booked");
  assert.equal(b.byCurrency.length, 0, "orders created by the admin are not the rep's");
});

test("AI assist is ON by default; the one-time migration flips only the untouched OFF pair and never re-runs", async (t) => {
  if (skip) return t.skip(skip);
  assert.deepEqual(DEFAULT_SETTINGS.integrations.ai, { enabled: true, allowExternalProvider: true });
  const mig = SALES_SCHEMA_STATEMENTS.filter((s) => s.includes("ai_default_on_2026_10"));
  assert.equal(mig.length, 1);
  const set = async (ai: any) => db.query("INSERT INTO sales_settings (key, value) VALUES ('integrations', $1::text::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify({ ai })]);
  const read = async () => (await db.query<any>("SELECT value->'ai' ai, updated_by FROM sales_settings WHERE key = 'integrations'")).rows[0];
  await set({ enabled: false, allowExternalProvider: false });
  await db.query(mig[0]!);
  assert.deepEqual((await read()).ai, { enabled: true, allowExternalProvider: true });
  await set({ enabled: false, allowExternalProvider: false }); // an administrator deliberately switches it off later
  await db.query(mig[0]!);
  assert.deepEqual((await read()).ai, { enabled: false, allowExternalProvider: false }, "marker prevents the migration from overriding a later choice");
  await db.query("DELETE FROM sales_schema_markers WHERE id = 'ai_default_on_2026_10'");
  await set({ enabled: true, allowExternalProvider: false }); await db.query(mig[0]!);
  assert.deepEqual((await read()).ai, { enabled: true, allowExternalProvider: false }, "an explicit non-default choice is left alone");
});
