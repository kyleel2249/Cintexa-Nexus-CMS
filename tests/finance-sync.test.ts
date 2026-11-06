/**
 * Finance -> Sync -> Diary integration against one D1 database (SQLite-backed stand-in).
 *   node --test tests/finance-sync.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { onRequest as finance } from "../functions/api/finance/[[path]].ts";
import { onRequest as sync } from "../functions/api/sync/[[path]].ts";
import { makeD1 } from "./helpers/d1-sqlite.ts";

function boot() {
  const d = makeD1();
  const env = { FIN_DB: d.db };
  const call = async (fn: any, base: string, method: string, path: string, body?: unknown) => {
    const request = new Request(`https://nexus.test/api/${base}/${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    const res = await fn({ request, params: { path: path.split("?")[0]!.split("/").filter(Boolean) }, env });
    return { status: res.status as number, json: (await res.json()) as any };
  };
  const n = (sql: string, ...a: unknown[]) => Number((d.sqlite.prepare(sql).get(...(a as any[])) as any).n);
  return { ...d, fin: (m: string, p: string, b?: unknown) => call(finance, "finance", m, p, b), syn: (m: string, p: string, b?: unknown) => call(sync, "sync", m, p, b), n };
}

test("invoice, partial payment and expense each publish exactly one event and one diary entry in the same D1", async () => {
  const t = boot();
  const inv = await t.fin("POST", "invoices", { customerName: "Acme Ghana Ltd", amountMinor: 100000, currency: "GHS", issueDate: "2026-11-01" });
  assert.equal(inv.status, 201, JSON.stringify(inv.json));
  const invoice = inv.json.invoice;

  const pay = await t.fin("POST", "payments", { invoiceId: invoice.id, amountMinor: 40000, paymentDate: "2026-11-02" });
  assert.equal(pay.status, 201, JSON.stringify(pay.json));

  const exp = await t.fin("POST", "expenses/with-discount", { grossMinor: 5000, discountMinor: 500, entryDate: "2026-11-02", description: "Office supplies" });
  assert.equal(exp.status, 201, JSON.stringify(exp.json));

  const events = (await t.syn("GET", "events")).json;
  assert.deepEqual(events.items.map((e: any) => e.eventType).sort(), ["EXPENSE_RECORDED", "INVOICE_CREATED", "PAYMENT_RECEIVED"]);
  assert.ok(events.items.every((e: any) => e.status === "processed"));
  assert.equal(t.n("SELECT COUNT(*) n FROM bd_entries"), 3, "one diary entry per event, and Finance no longer writes a second one");

  const titles = (t.sqlite.prepare("SELECT title FROM bd_entries ORDER BY title").all() as any[]).map((r) => r.title);
  assert.ok(titles.some((x) => x.startsWith("Invoice issued")));
  assert.ok(titles.some((x) => x.startsWith("Payment received from Acme Ghana Ltd")));
  assert.ok(titles.some((x) => x.startsWith("Expense recorded")));

  // the payment event is linked back to its invoice
  const payEv = events.items.find((e: any) => e.eventType === "PAYMENT_RECEIVED");
  assert.equal(payEv.related[0].entityId, invoice.id);
  assert.equal(payEv.effectiveDate, "2026-11-02");
});

test("the discounted expense journal survives the next request (it used to be lost on re-hydrate)", async () => {
  const t = boot();
  const exp = await t.fin("POST", "expenses/with-discount", { grossMinor: 8000, discountMinor: 1000, entryDate: "2026-11-03", description: "Printer paper" });
  assert.equal(exp.status, 201, JSON.stringify(exp.json));
  assert.equal(t.n("SELECT COUNT(*) n FROM fin_journals WHERE id = ?", exp.json.journal.id), 1);
  const list = await t.fin("GET", "journals");
  assert.ok(list.json.items.some((j: any) => j.id === exp.json.journal.id));
});

test("re-posting an invoice with the same source id is a duplicate and publishes nothing new", async () => {
  const t = boot();
  const body = { customerName: "Acme", amountMinor: 5000, issueDate: "2026-11-01", sourceModule: "sales", sourceId: "SO-77" };
  const a = await t.fin("POST", "invoices", body);
  const b = await t.fin("POST", "invoices", body);
  assert.equal(a.status, 201);
  assert.equal(b.json.duplicate, true);
  assert.equal(t.n("SELECT COUNT(*) n FROM nx_sync_events"), 1);
  assert.equal(t.n("SELECT COUNT(*) n FROM bd_entries"), 1);
});

test("a part-paid invoice keeps its paid amount and status on the next request (accounts receivable stays right)", async () => {
  const t = boot();
  const inv = (await t.fin("POST", "invoices", { customerName: "Acme", amountMinor: 100000, issueDate: "2026-11-01" })).json.invoice;
  assert.equal((await t.fin("POST", "payments", { invoiceId: inv.id, amountMinor: 40000, paymentDate: "2026-11-02" })).status, 201);
  const after = (await t.fin("GET", "invoices")).json.items.find((i: any) => i.id === inv.id);
  assert.equal(after.amountPaidMinor, 40000);
  assert.equal(after.status, "partial");
  assert.equal((await t.fin("POST", "payments", { invoiceId: inv.id, amountMinor: 60000, paymentDate: "2026-11-03" })).status, 201);
  const paid = (await t.fin("GET", "invoices")).json.items.find((i: any) => i.id === inv.id);
  assert.equal(paid.status, "paid");
  assert.equal((await t.fin("POST", "payments", { invoiceId: inv.id, amountMinor: 1, paymentDate: "2026-11-03" })).status, 400, "overpayment is refused");
});

test("deleting a payment restores the invoice balance and removes its journal; deleting an invoice with payments is refused", async () => {
  const t = boot();
  const inv = (await t.fin("POST", "invoices", { customerName: "Acme", amountMinor: 100000, issueDate: "2026-11-01" })).json.invoice;
  const pay = (await t.fin("POST", "payments", { invoiceId: inv.id, amountMinor: 40000, paymentDate: "2026-11-02" })).json.payment;
  const blocked = await t.fin("DELETE", `invoices/${inv.id}`, { confirm: "DELETE_INVOICE" });
  assert.equal(blocked.status, 409);
  assert.equal((await t.fin("DELETE", `payments/${pay.id}`, {})).status, 400, "confirmation word is required");
  const del = await t.fin("DELETE", `payments/${pay.id}`, { confirm: "DELETE_PAYMENT" });
  assert.equal(del.status, 200, JSON.stringify(del.json));
  const after = (await t.fin("GET", "invoices")).json.items.find((i: any) => i.id === inv.id);
  assert.equal(after.amountPaidMinor, 0);
  assert.equal(after.status, "open");
  assert.equal(t.n("SELECT COUNT(*) n FROM fin_payments"), 0);
  assert.equal((await t.fin("DELETE", `invoices/${inv.id}`, { confirm: "DELETE_INVOICE" })).status, 200);
  assert.equal(t.n("SELECT COUNT(*) n FROM fin_invoices"), 0);
  assert.equal(t.n("SELECT COUNT(*) n FROM fin_journals"), 0, "both journals are gone, so no report still counts them");
  const types = (await t.syn("GET", "events")).json.items.map((e: any) => e.eventType);
  assert.ok(types.includes("PAYMENT_DELETED") && types.includes("INVOICE_DELETED"));
});

test("a manual journal syncs to every tool, gets an automatic memo and line notes, and its deletion syncs too", async () => {
  const t = boot();
  const accts = (await t.fin("GET", "accounts")).json.items;
  const cash = accts.find((a: any) => a.code === "1010").code, rev = accts.find((a: any) => a.code === "4010").code;
  const r = await t.fin("POST", "journals", { entryDate: "2026-11-04", post: true, lines: [{ accountCode: cash, debit: 500000 }, { accountCode: rev, credit: 500000 }] });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const j = r.json.journal;
  assert.match(j.description, /debit Cash on Hand; credit Website Design Revenue/);
  assert.ok(j.lines.every((l: any) => l.memo && l.memo.length > 5));
  const ev = (await t.syn("GET", "events?eventType=JOURNAL_POSTED")).json.items[0];
  assert.deepEqual(ev.links.map((l: any) => l.targetModule).sort(), ["business-diary", "corporate-strategy", "dashboard", "financial-intelligence", "marketing", "sales"]);
  const del = await t.fin("DELETE", `journals/${j.id}`, { confirm: "DELETE_JOURNAL" });
  assert.equal(del.status, 200);
  assert.equal((await t.syn("GET", "events?eventType=JOURNAL_DELETED")).json.items.length, 1);
  const series = (await t.fin("GET", "analytics/series")).json;
  assert.deepEqual(series.items, [], "deleted entries no longer appear in analytics");
});

test("mobile phones are in the chart of accounts and depreciate at 25% to their own accounts", async () => {
  const t = boot();
  const accts = (await t.fin("GET", "accounts")).json.items;
  for (const code of ["1215", "1283", "6312"]) assert.ok(accts.some((a: any) => a.code === code), `account ${code} exists`);
  const a = await t.fin("POST", "assets", { name: "iPhone", category: "mobile_phone", costMinor: 480000, residualMinor: 0, depreciationRateBps: 1000 });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  assert.equal(a.json.asset.depreciationRateBps, 2500, "policy overrides any other rate");
  const run = await t.fin("POST", "assets/depreciate", { periodYm: "2026-11" });
  assert.equal(run.json.created[0].amountMinor, 10000, "480,000 x 25% / 12");
  const j = (await t.fin("GET", "journals")).json.items.find((x: any) => x.journalType === "depreciation");
  assert.deepEqual(j.lines.map((l: any) => l.accountCode).sort(), ["1283", "6312"]);
});
