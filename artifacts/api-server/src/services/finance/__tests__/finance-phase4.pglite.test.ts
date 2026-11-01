/** Phase 4: tax, customers/suppliers, invoices, bills, payments, ageing - real router + SQL on in-memory PostgreSQL (PGlite). */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "../core/router";
import { organisationRoutes } from "../modules/organisations";
import { accountRoutes } from "../modules/accounts";
import { periodRoutes } from "../modules/periods";
import { journalRoutes } from "../modules/journals";
import { reportRoutes } from "../modules/reports";
import { taxRoutes } from "../modules/tax";
import { partyRouteList } from "../modules/parties";
import { invoiceRoutes } from "../modules/invoices";
import { billRoutes } from "../modules/bills";
import { ageingRoutes } from "../modules/ageing";
import { FINANCE_SCHEMA_STATEMENTS, FINANCE_PHASE4_STATEMENTS } from "../../../../../../lib/db/src/finance-schema";
import type { Db, Queryable } from "../core/types";

const routes = [...organisationRoutes, ...accountRoutes, ...periodRoutes, ...journalRoutes, ...reportRoutes, ...taxRoutes, ...partyRouteList, ...invoiceRoutes, ...billRoutes, ...ageingRoutes];
const wrap = (r: any): Queryable => ({ async query(sql: string, params: unknown[] = []) { const res = await r.query(sql, params); const rows = res.rows; return { rows, rowCount: rows.length > 0 ? rows.length : res.affectedRows ?? 0 } as any; } });
let pg: any; let db: Db; let skip: string | false = false;
const NOW = new Date("2026-03-15T10:00:00Z");
const deps = { now: () => NOW, log: { error: (o: unknown) => console.error("[finance-test]", o) } };
function client(email: string, role = "editor", org?: number) {
  return async (method: string, path: string, body?: unknown, extra: { query?: Record<string, string>; headers?: Record<string, string>; org?: number | null } = {}) => {
    const o = extra.org === undefined ? org : extra.org;
    const res = await dispatch(routes, db, deps, { method, path, query: extra.query ?? {}, body, headers: { ...(o ? { "x-finance-org": String(o) } : {}), ...(extra.headers ?? {}) }, auth: { sub: `sub-${email}`, email, platformRole: role, displayName: email.split("@")[0] } });
    return Object.assign(res, { json: res.body as any });
  };
}
let orgA = 0, orgB = 0; let owner: any, ar: any, ctrl: any, acct: any, ownerB: any;
let custId = 0, supId = 0, bankId = 0, revId = 0, expId = 0, stdId = 0, zeroId = 0;
const accountId = async (code: string) => (await owner("GET", "/accounts", undefined, { query: { q: code } })).json.items.find((a: any) => a.code === code).id as number;
const ledgerNet = async (code: string) => (await ctrl("GET", "/ledger", undefined, { query: { account_code: code } })).json.closing_balance as string;
const invBody = (extra: object = {}, lines: object[] = [{ description: "Consulting", quantity: "1", unit_price: "1000.00", tax_code: "STD" }]) => ({ customer_id: custId, invoice_date: "2026-03-10", lines, ...extra });
async function issueInvoice(body = invBody()) { const c = await ar("POST", "/invoices", body); assert.equal(c.status, 201, JSON.stringify(c.json)); const id = c.json.invoice.id; assert.equal((await ctrl("POST", `/invoices/${id}/approve`)).status, 200); const i = await ar("POST", `/invoices/${id}/issue`); assert.equal(i.status, 200, JSON.stringify(i.json)); return i.json.invoice; }

before(async () => {
  try {
    const mod: any = await import("@electric-sql/pglite" as string);
    pg = new mod.PGlite(); await pg.waitReady;
    for (const s of [...FINANCE_SCHEMA_STATEMENTS, ...FINANCE_PHASE4_STATEMENTS]) await pg.exec(`${s.trim().replace(/;$/, "")};`);
    for (const s of FINANCE_PHASE4_STATEMENTS) await pg.exec(`${s.trim().replace(/;$/, "")};`); // idempotent second boot
    const base = wrap(pg); db = { query: base.query, tx: (fn) => pg.transaction((t: any) => fn(wrap(t))) };
  } catch (e) { skip = `PGlite unavailable: ${e instanceof Error ? e.message : e}`; return; }
  const admin = client("boss@example.com", "admin");
  orgA = Number((await admin("POST", "/organisations", { legal_name: "Alpha Trading Ltd" })).json.organisation.id); orgB = Number((await admin("POST", "/organisations", { legal_name: "Beta Ltd" })).json.organisation.id);
  owner = client("boss@example.com", "admin", orgA); ownerB = client("boss@example.com", "admin", orgB);
  for (const [email, role] of [["ar@example.com", "ar_officer"], ["ctrl@example.com", "financial_controller"], ["acct@example.com", "accountant"]]) assert.equal((await owner("POST", "/members", { email, role })).status, 201);
  ar = client("ar@example.com", "editor", orgA); ctrl = client("ctrl@example.com", "editor", orgA); acct = client("acct@example.com", "editor", orgA);
  custId = (await ar("POST", "/customers", { name: "Kofi Mensah Enterprises", email: "kofi@example.com" })).json.customer.id;
  supId = (await ar("POST", "/suppliers", { name: "Accra Office Supplies" })).json.supplier.id;
  bankId = await accountId("1020"); revId = await accountId("4000"); expId = await accountId("6600");
  const codes = (await owner("GET", "/tax-codes")).json.items; stdId = codes.find((t: any) => t.code === "STD").id; zeroId = codes.find((t: any) => t.code === "ZERO").id;
});
after(async () => { try { await pg?.close(); } catch { /* ignore */ } });
const t = (name: string, fn: () => Promise<void>) => test(name, async (tc) => { if (skip) return tc.skip(String(skip)); await fn(); });

t("Ghana tax is seeded as effective-dated DATA (VAT 15 + NHIL 2.5 + GETFund 2.5 from 2026-01-01)", async () => {
  const std = (await owner("GET", "/tax-codes")).json.items.find((x: any) => x.code === "STD");
  assert.deepEqual(std.rates.map((r: any) => [r.component, Number(r.rate)]).sort(), [["GETFUND", 2.5], ["NHIL", 2.5], ["VAT", 15]]); assert.ok(std.rates.every((r: any) => new Date(r.effective_from).toISOString().startsWith("2026-01-01")));
  assert.equal((await owner("POST", "/tax-codes/seed-ghana")).status, 200); // idempotent
  assert.equal((await owner("GET", "/tax-codes")).json.items.find((x: any) => x.code === "STD").rates.length, 3);
});

t("tax maths: half-up rounding per component per line, zero-rated and exempt, and no rate before it takes effect", async () => {
  const r = await ar("POST", "/invoices", invBody({}, [{ description: "Widgets", quantity: "3", unit_price: "33.33", tax_code: "STD" }, { description: "Export", quantity: "1", unit_price: "100.00", tax_code: "ZERO" }]));
  assert.equal(r.status, 201, JSON.stringify(r.json)); const i = r.json.invoice;
  assert.equal(i.lines[0].net_amount, "99.99"); assert.equal(i.lines[0].tax_amount, "20.00"); assert.equal(i.lines[1].tax_amount, "0.00"); assert.equal(i.subtotal, "199.99"); assert.equal(i.total, "219.99");
  assert.deepEqual(i.taxes.map((x: any) => [x.component, x.amount]), [["GETFUND", "2.50"], ["NHIL", "2.50"], ["VAT", "15.00"]]);
  const early = await ar("POST", "/invoices", invBody({ invoice_date: "2025-12-15" })); assert.equal(early.json.code, "no_tax_rate_in_effect");
  assert.equal((await ar("POST", "/invoices", invBody({ currency: "USD" }))).json.code, "currency_not_supported");
  await ar("DELETE", `/invoices/${i.id}`);
});

t("effective-dated rate change: old invoices keep their tax, new documents use the new rate, overlaps are refused", async () => {
  const vat = (await owner("GET", "/tax-codes")).json.items.find((x: any) => x.code === "STD").rates.find((x: any) => x.component === "VAT");
  const vatAcct = await accountId("2100");
  const overlap = await owner("POST", "/tax-rates", { tax_code_id: stdId, component: "VAT", rate: "16", effective_from: "2026-06-01", payable_account_id: vatAcct }); assert.equal(overlap.json.code, "rate_overlap");
  assert.equal((await owner("PATCH", `/tax-rates/${vat.id}`, { effective_to: "2026-12-31" })).status, 200);
  assert.equal((await owner("POST", "/tax-rates", { tax_code_id: stdId, component: "VAT", rate: "16", effective_from: "2027-01-01", payable_account_id: vatAcct, recoverable: true })).status, 201);
  const old = await ar("POST", "/invoices", invBody({ invoice_date: "2026-12-31" })); const nu = await ar("POST", "/invoices", invBody({ invoice_date: "2027-01-01" }));
  assert.equal(old.json.invoice.tax_total, "200.00"); assert.equal(nu.json.invoice.tax_total, "210.00"); // 16% + 2.5% + 2.5% = 21%
  assert.equal((await acct("POST", "/tax-rates", { tax_code_id: stdId, component: "X", rate: "1", effective_from: "2030-01-01", payable_account_id: vatAcct })).status, 403);
  await ar("DELETE", `/invoices/${old.json.invoice.id}`); await ar("DELETE", `/invoices/${nu.json.invoice.id}`);
});

t("invoice lifecycle: approval + separation of duties, issue posts a balanced journal, issued invoices are immutable", async () => {
  const c = await ar("POST", "/invoices", invBody()); assert.equal(c.status, 201, JSON.stringify(c.json)); const id = c.json.invoice.id; assert.equal(c.json.invoice.total, "1200.00");
  assert.equal((await ar("POST", `/invoices/${id}/issue`)).json.code, "approval_required");
  assert.equal((await ar("POST", `/invoices/${id}/approve`)).status, 403); // ar_officer cannot approve
  assert.equal((await ctrl("POST", `/invoices/${id}/approve`)).status, 200);
  const iss = await ar("POST", `/invoices/${id}/issue`); assert.equal(iss.status, 200, JSON.stringify(iss.json)); const inv = iss.json.invoice; assert.match(inv.number, /^INV-2026-\d{6}$/);
  assert.equal(await ledgerNet("1100"), "1200.00"); assert.equal(await ledgerNet("4000"), "1000.00"); assert.equal(await ledgerNet("2100"), "150.00"); assert.equal(await ledgerNet("2110"), "25.00"); assert.equal(await ledgerNet("2120"), "25.00");
  const tb = (await ctrl("GET", "/trial-balance", undefined, { query: { as_of: "2026-03-31" } })).json.trial_balance; assert.equal(tb.balanced, true);
  assert.equal((await ar("POST", `/invoices/${id}/issue`)).json.code, "already_issued");
  assert.equal((await ar("PATCH", `/invoices/${id}`, { notes: "x" })).json.code, "invoice_not_editable");
  assert.equal((await ar("POST", `/invoices/${id}/cancel`, { reason: "oops" })).json.code, "invalid_status");
  await assert.rejects(db.query("UPDATE finance_invoices SET total = 1 WHERE id = $1", [id]), /immutable/);
  await assert.rejects(db.query("UPDATE finance_invoice_lines SET net_amount = 1 WHERE invoice_id = $1", [id]), /cannot be changed/);
  await assert.rejects(db.query("DELETE FROM finance_invoices WHERE id = $1", [id]), /draft/);
  const journal = (await db.query<any>("SELECT count(*)::int AS n FROM finance_journals WHERE source_module = 'finance.invoice' AND source_ref = $1", [String(id)])).rows[0].n; assert.equal(journal, 1);
});

t("receipts: partial then full payment, over-payment refused, ageing reconciles to the ledger control account", async () => {
  const inv = (await ar("GET", "/invoices", undefined, { query: { status: "issued" } })).json.items[0];
  const p1 = await ar("POST", `/invoices/${inv.id}/payments`, { amount: "500.00", payment_date: "2026-03-12", bank_account_id: bankId }); assert.equal(p1.status, 201, JSON.stringify(p1.json));
  assert.equal(p1.json.invoice.payment_status, "partially_paid"); assert.equal(p1.json.invoice.outstanding, "700.00");
  assert.equal(await ledgerNet("1100"), "700.00"); assert.equal(await ledgerNet("1020"), "500.00");
  const over = await ar("POST", `/invoices/${inv.id}/payments`, { amount: "700.01", payment_date: "2026-03-12", bank_account_id: bankId }); assert.equal(over.json.code, "exceeds_outstanding");
  assert.equal((await ar("POST", `/invoices/${inv.id}/payments`, { amount: "10.00", payment_date: "2026-03-12", bank_account_id: await accountId("4000") })).json.code, "invalid_bank_account");
  const age = (await ctrl("GET", "/receivables/ageing", undefined, { query: { as_of: "2026-03-15" } })).json; assert.equal(age.totals.total, "700.00"); assert.equal(age.reconciled, true); assert.equal(age.items[0].current, "700.00");
  const late = (await ctrl("GET", "/receivables/ageing", undefined, { query: { as_of: "2026-06-30" } })).json; assert.equal(late.totals.d61_90, "700.00"); assert.equal(late.reconciled, true); // due 2026-04-09, 82 days late
  const st = (await ar("GET", `/customers/${custId}/statement`)).json; assert.equal(st.closing_balance, "700.00"); assert.equal(st.lines.length, 2);
  const p2 = await ar("POST", `/invoices/${inv.id}/payments`, { amount: "700.00", payment_date: "2026-03-14", bank_account_id: bankId, method: "mobile_money" }); assert.equal(p2.json.invoice.payment_status, "paid");
  assert.equal((await ctrl("GET", "/receivables/ageing")).json.totals.total, "0.00"); assert.equal(await ledgerNet("1100"), "0.00");
  assert.equal((await ar("POST", `/invoices/${inv.id}/payments`, { amount: "1.00", payment_date: "2026-03-14", bank_account_id: bankId })).json.code, "exceeds_outstanding");
  await assert.rejects(db.query("UPDATE finance_payments SET amount = 1"), /append-only/); await assert.rejects(db.query("DELETE FROM finance_payment_allocations"), /append-only/);
  assert.equal((await ctrl("GET", "/payments", undefined, { query: { direction: "receipt" } })).json.total, 2);
});

t("credit limits stop an invoice from being issued", async () => {
  const small = (await ar("POST", "/customers", { name: "Small Buyer", credit_limit: "1000.00" })).json.customer.id;
  const c = await ar("POST", "/invoices", invBody({ customer_id: small })); await ctrl("POST", `/invoices/${c.json.invoice.id}/approve`);
  const r = await ar("POST", `/invoices/${c.json.invoice.id}/issue`); assert.equal(r.status, 422); assert.equal(r.json.code, "credit_limit_exceeded");
  assert.equal((await ar("POST", `/invoices/${c.json.invoice.id}/cancel`, { reason: "over limit" })).json.invoice.status, "cancelled");
});

t("supplier bills: duplicate invoice blocked, non-recoverable levies join cost, input VAT recovered, payment needs payments:approve", async () => {
  const body = { supplier_id: supId, supplier_ref: "ACC-0042", bill_date: "2026-03-05", lines: [{ description: "Office furniture", quantity: "1", unit_price: "1000.00", tax_code: "STD", account_id: expId }] };
  const c = await ar("POST", "/bills", body); assert.equal(c.status, 201, JSON.stringify(c.json)); const id = c.json.bill.id;
  assert.equal((await ar("POST", "/bills", { ...body, supplier_ref: "acc-0042" })).json.code, "duplicate_supplier_invoice");
  assert.equal((await ctrl("POST", `/bills/${id}/post`)).json.code, "approval_required");
  assert.equal((await ar("POST", `/bills/${id}/approve`)).status, 403); assert.equal((await ctrl("POST", `/bills/${id}/approve`)).status, 200);
  const p = await ctrl("POST", `/bills/${id}/post`); assert.equal(p.status, 200, JSON.stringify(p.json)); assert.match(p.json.bill.number, /^BILL-2026-/);
  assert.equal(await ledgerNet("6600"), "1050.00"); assert.equal(await ledgerNet("1300"), "150.00"); assert.equal(await ledgerNet("2010"), "1200.00");
  assert.equal((await ctrl("GET", "/trial-balance", undefined, { query: { as_of: "2026-03-31" } })).json.trial_balance.balanced, true);
  assert.equal((await acct("POST", `/bills/${id}/payments`, { amount: "100.00", payment_date: "2026-03-14", bank_account_id: bankId })).status, 403);
  const pay = await ctrl("POST", `/bills/${id}/payments`, { amount: "700.00", payment_date: "2026-03-14", bank_account_id: bankId }); assert.equal(pay.status, 201, JSON.stringify(pay.json)); assert.equal(pay.json.bill.outstanding, "500.00");
  assert.equal((await ctrl("POST", `/bills/${id}/payments`, { amount: "500.01", payment_date: "2026-03-14", bank_account_id: bankId })).json.code, "exceeds_outstanding");
  const age = (await ctrl("GET", "/payables/ageing", undefined, { query: { as_of: "2026-03-15" } })).json; assert.equal(age.totals.total, "500.00"); assert.equal(age.reconciled, true);
  assert.equal(await ledgerNet("2010"), "500.00");
  assert.equal((await ctrl("POST", `/bills/${id}/cancel`, { reason: "nope" })).json.code, "invalid_status");
  await assert.rejects(db.query("UPDATE finance_bill_lines SET net_amount = 1 WHERE bill_id = $1", [id]), /cannot be changed/);
  assert.equal((await ctrl("GET", `/suppliers/${supId}/statement`)).json.closing_balance, "500.00");
});

t("period locks and tenant isolation apply to documents", async () => {
  const c = await ar("POST", "/invoices", invBody({ invoice_date: "2026-01-20" })); await ctrl("POST", `/invoices/${c.json.invoice.id}/approve`);
  const jan = (await owner("GET", "/periods")).json.items.find((p: any) => p.name === "Jan 2026"); await owner("POST", `/periods/${jan.id}/status`, { status: "hard_closed" });
  assert.equal((await ar("POST", `/invoices/${c.json.invoice.id}/issue`)).json.code, "period_locked");
  assert.equal((await ar("GET", `/invoices/${c.json.invoice.id}`)).json.invoice.status, "approved"); // failed issue rolled back completely
  await owner("POST", `/periods/${jan.id}/status`, { status: "open", reason: "reopen for test" }); await ar("POST", `/invoices/${c.json.invoice.id}/cancel`, { reason: "test" });
  const inv = (await ar("GET", "/invoices")).json.items[0];
  assert.equal((await ownerB("GET", `/invoices/${inv.id}`)).status, 404); assert.equal((await ownerB("GET", `/customers/${custId}`)).status, 404);
  const x = await ownerB("POST", "/invoices", { customer_id: custId, invoice_date: "2026-03-10", lines: [{ description: "x", quantity: "1", unit_price: "1.00" }] }); assert.equal(x.json.code, "invalid_customer");
  await assert.rejects(db.query("INSERT INTO finance_invoices (org_id, customer_id, invoice_date, due_date, currency, created_by) VALUES ($1,$2,'2026-03-01','2026-03-31','GHS','u')", [orgB, custId]), /foreign key/i);
});
