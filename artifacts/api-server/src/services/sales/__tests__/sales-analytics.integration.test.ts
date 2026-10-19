import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { openDb, resetDb, client, ident, TEST_DB_URL } from "./helpers/harness";
import type { Db } from "../core/types";

const skip = !TEST_DB_URL ? "SALES_TEST_DATABASE_URL not set" : false;
let db: Db & { close(): Promise<void> };
let admin: ReturnType<typeof client>, rep: ReturnType<typeof client>, rep2: ReturnType<typeof client>;
let accountId = 0, productId = 0;

before(async () => {
  if (skip) return;
  db = await openDb();
  await resetDb(db);
  admin = client(db, ident("boss@example.com", "admin"));
  await admin("GET", "/me");
  for (const [email, role] of [["rep@example.com", "sales_rep"], ["rep2@example.com", "sales_rep"]] as const) await admin("POST", "/members", { email, display_name: email.split("@")[0], role });
  rep = client(db, ident("rep@example.com")); rep2 = client(db, ident("rep2@example.com"));
  accountId = (await rep("POST", "/accounts", { name: "Dash Co" })).json.id;
  productId = (await admin("POST", "/products", { sku: "D-1", name: "Widget", base_price: "100.00", cost_price: "40.00" })).json.id;
  const o = await rep("POST", "/orders", { account_id: accountId, lines: [{ product_id: productId, quantity: 3 }] });
  await rep("POST", `/orders/${o.json.id}/confirm`);
  const acc2 = (await rep2("POST", "/accounts", { name: "Other Co" })).json.id;
  const o2 = await rep2("POST", "/orders", { account_id: acc2, lines: [{ product_id: productId, quantity: 1 }] });
  await rep2("POST", `/orders/${o2.json.id}/confirm`);
});
after(async () => { if (db) await db.close(); });

const kpi = (r: any, key: string) => r.json.kpis.find((k: any) => k.key === key);

test("dashboard revenue reconciles with source order rows and is scoped by role", { skip }, async () => {
  const all = await admin("GET", "/dashboard", undefined, { query: { period: "month" } });
  assert.equal(all.status, 200, JSON.stringify(all.json));
  const src = (await db.query<{ a: string }>("SELECT COALESCE(sum(net_total - returned_total),0)::numeric(18,2)::text a FROM sales_orders WHERE status <> 'cancelled'")).rows[0]!.a;
  assert.equal(kpi(all, "revenue_mtd").value, src);
  const mine = await rep("GET", "/dashboard", undefined, { query: { period: "month" } });
  assert.equal(kpi(mine, "revenue_mtd").value, (await db.query<{ a: string }>("SELECT COALESCE(sum(net_total - returned_total),0)::numeric(18,2)::text a FROM sales_orders o JOIN sales_members m ON m.id = o.owner_id WHERE m.email = 'rep@example.com'")).rows[0]!.a);
  assert.notEqual(kpi(mine, "revenue_mtd").value, kpi(all, "revenue_mtd").value);
});

test("cost-derived KPIs are hidden without cost:read and receivables are honest", { skip }, async () => {
  const all = await admin("GET", "/dashboard", undefined, { query: { period: "month" } });
  assert.ok(kpi(all, "gross_profit"));
  const mine = await rep("GET", "/dashboard", undefined, { query: { period: "month" } });
  assert.equal(kpi(mine, "gross_profit"), undefined);
  assert.equal(kpi(mine, "receivables").available, false);
  assert.equal(kpi(mine, "receivables").value, null);
});

test("leaderboard hides peers' revenue from reps; reports respect scope and export permission", { skip }, async () => {
  const lb = await rep("GET", "/performance/leaderboard");
  assert.equal(lb.status, 200);
  const me = lb.json.items.find((i: any) => i.display_name === "rep");
  const peer = lb.json.items.find((i: any) => i.display_name === "rep2");
  assert.notEqual(me.revenue, null);
  assert.equal(peer.revenue, null);
  const rep1 = await rep("GET", "/reports/sales_by_customer");
  assert.equal(rep1.json.rows.length, 1);
  assert.equal((await rep("GET", "/reports/sales_by_customer", undefined, { query: { format: "csv" } })).status, 403);
  const csv = await admin("GET", "/reports/sales_by_customer", undefined, { query: { format: "csv" } });
  assert.equal(csv.status, 200);
  const byRep = await rep("GET", "/reports/sales_by_rep");
  assert.equal(byRep.json.rows.length, 1, "a rep sees only their own row");
  assert.equal((await rep("GET", "/reports/nope")).status, 404);
});

test("forecast reports unreliable history honestly and override keeps the calculated figure", { skip }, async () => {
  const f = await admin("GET", "/forecast", undefined, { query: { period: "quarter" } });
  assert.equal(f.status, 200, JSON.stringify(f.json));
  assert.equal(f.json.history.seasonality, null);
  const o = await admin("PUT", "/forecast/override", { period: "quarter", amount: "12345.00", reason: "Board guidance" });
  assert.equal(o.status, 200, JSON.stringify(o.json));
  const f2 = await admin("GET", "/forecast", undefined, { query: { period: "quarter" } });
  assert.equal(f2.json.override.amount, "12345.00");
  assert.equal(f2.json.override.calculated, f2.json.forecast.baseCase);
  assert.equal((await rep("PUT", "/forecast/override", { period: "quarter", amount: "1.00", reason: "nope nope" })).status, 403);
});

test("every catalogue report runs with default parameters (no unused SQL binds)", { skip }, async () => {
  const list = await admin("GET", "/reports");
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const keys: string[] = (list.json.items ?? list.json.reports).map((r: any) => r.key);
  assert.ok(keys.length >= 10);
  for (const key of keys) {
    const r = await admin("GET", `/reports/${key}`);
    assert.equal(r.status, 200, `${key}: ${JSON.stringify(r.json)}`);
    assert.ok(Array.isArray(r.json.rows), key);
  }
});

test("every list endpoint answers with default sort and every whitelisted sort key", { skip }, async () => {
  const lists: Array<[string, string[]]> = [
    ["/leads", ["created", "score", "name", "status", "followup", "value"]], ["/accounts", ["name", "created", "last_purchase", "status"]],
    ["/activities", ["due", "created", "priority"]], ["/products", ["name", "sku", "price", "created"]], ["/orders", ["created", "total", "number", "booked"]],
    ["/opportunities", ["created", "amount", "close", "name", "stage", "updated"]], ["/quotations", ["created", "total", "validity", "number"]],
  ];
  for (const [path, keys] of lists) {
    assert.equal((await admin("GET", path)).status, 200, path);
    for (const sort of keys) for (const dir of ["asc", "desc"]) assert.equal((await admin("GET", path, undefined, { query: { sort, dir } })).status, 200, `${path} ${sort} ${dir}`);
  }
});
