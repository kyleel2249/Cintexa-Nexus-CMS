import test from "node:test";
import assert from "node:assert/strict";
import { computeRatios, ratioImpact, ratiosForAccount, tagsOf, type RSnapshot } from "../functions/_lib/finance-ratios.ts";
import { makeD1 } from "./helpers/d1-sqlite.ts";
import { onRequest as finance } from "../functions/api/finance/[[path]].ts";

const A = (code: string, name: string, type: any, balance: number, subtype?: string) => ({ code, name, type, subtype, balance });
const snap = (over: Partial<RSnapshot> = {}): RSnapshot => ({
  periodDays: 365, customers: 10, newCustomers: 4,
  accounts: [
    A("1010", "Cash on Hand", "asset", 500000, "cash"), A("1050", "Accounts Receivable", "asset", 300000, "ar"),
    A("1085", "Data Bandwidth", "asset", 50000, "prepaid"), A("1210", "Computers and Laptops", "asset", 400000, "fixed"),
    A("1281", "Accumulated Depreciation — Computers and Laptops", "asset", -100000, "contra"),
    A("2010", "Accounts Payable", "liability", 200000, "ap"), A("3010", "Share Capital", "equity", 950000),
    A("4010", "Website Design Revenue", "revenue", 2000000), A("5010", "Direct Developer Salaries", "expense", 600000, "cos"),
    A("6200", "Marketing and Advertising", "expense", 200000), A("6060", "Office Rent", "expense", 400000),
  ], ...over,
});

test("data bandwidth is a current (prepaid) asset: in current assets, not in quick assets", () => {
  const t = tagsOf({ code: "1085", name: "Data Bandwidth", type: "asset", subtype: "prepaid" });
  assert.ok(t.includes("currentAssets") && t.includes("prepaid") && !t.includes("cash") && !t.includes("fixedAssets"));
  const r = computeRatios(snap()).ratios;
  assert.equal(r.find((x) => x.id === "current_ratio")!.value, 4.25, "(500+300+50) / 200");
  assert.equal(r.find((x) => x.id === "quick_ratio")!.value, 4, "(500+300) / 200");
});

test("profitability, leverage and efficiency ratios are correct", () => {
  const r = Object.fromEntries(computeRatios(snap()).ratios.map((x) => [x.id, x.value]));
  assert.equal(r.gross_margin, 70);            // (2000-600)/2000
  assert.equal(r.operating_margin, 40);        // (1400-600)/2000
  assert.equal(r.net_margin, 40);
  assert.equal(r.debt_to_equity, 0.21);        // 200/950
  assert.equal(r.dso, 54.75);                  // 300/2000*365
  assert.equal(r.working_capital, 650000);
});

test("Customer Acquisition Cost and its ratios", () => {
  const r = Object.fromEntries(computeRatios(snap()).ratios.map((x) => [x.id, x.value]));
  assert.equal(r.cac, 50000, "200,000 marketing / 4 new customers");
  assert.equal(r.cac_ratio, 25, "CAC 500 / revenue per customer 2,000, as a %");
  assert.equal(r.ltv_cac, 2.8, "(2,000 x 70%) / 500");
  assert.equal(r.marketing_pct, 10);
  assert.equal(computeRatios(snap({ newCustomers: 0 })).ratios.find((x) => x.id === "cac")!.value, null, "no new customers: not measurable");
});

test("a transaction shows before/after, direction and an explanation for each ratio it moves", () => {
  const imp = ratioImpact(snap(), [{ accountCode: "6200", debit: 100000, credit: 0 }, { accountCode: "1010", debit: 0, credit: 100000 }]);
  const cac = imp.changes.find((c) => c.id === "cac")!;
  assert.equal(cac.before, 50000); assert.equal(cac.after, 75000); assert.equal(cac.direction, "worsens");
  assert.match(cac.explanation, /moved from 500 to 750/);
  assert.ok(imp.changes.some((c) => c.id === "current_ratio" && c.direction === "worsens"));
  assert.deepEqual(imp.unknownAccounts, []);
  assert.deepEqual(ratioImpact(snap(), [{ accountCode: "9999", debit: 1, credit: 0 }]).unknownAccounts, ["9999"]);
});

test("each account lists the ratios it feeds", () => {
  const ids = ratiosForAccount({ code: "6200", name: "Marketing and Advertising", type: "expense" }).map((r) => r.id);
  assert.ok(ids.includes("cac") && ids.includes("net_margin") && ids.includes("marketing_pct"));
  assert.ok(ratiosForAccount({ code: "1085", name: "Data Bandwidth", type: "asset", subtype: "prepaid" }).some((r) => r.id === "current_ratio"));
});

test("the API serves ratios, impact and account explanation from the real ledger, and Data Bandwidth exists", async () => {
  const d = makeD1();
  const env = { FIN_DB: d.db };
  const call = async (method: string, path: string, body?: unknown) => {
    const request = new Request(`https://x.test/api/finance/${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    const res = await finance({ request, params: { path: path.split("?")[0]!.split("/") }, env } as any);
    return { status: res.status, json: (await res.json()) as any };
  };
  const accts = (await call("GET", "accounts")).json.items;
  for (const c of ["1085", "6085"]) assert.ok(accts.some((a: any) => a.code === c), c);
  assert.equal((await call("POST", "journals", { entryDate: "2026-03-01", post: true, lines: [{ accountCode: "1010", debit: 1000000 }, { accountCode: "3010", credit: 1000000 }] })).status, 201);
  const r = (await call("GET", "analytics/ratios?from=2026-01-01&to=2026-12-31")).json;
  assert.ok(r.ratios.length >= 25);
  const imp = (await call("POST", "analytics/ratio-impact", { entryDate: "2026-04-01", lines: [{ accountCode: "1085", debit: 50000 }, { accountCode: "1010", credit: 50000 }] })).json;
  assert.ok(Array.isArray(imp.changes));
  const ar = (await call("GET", "analytics/account-ratios?code=1085")).json;
  assert.ok(ar.ratios.some((x: any) => x.id === "current_ratio"));
});
