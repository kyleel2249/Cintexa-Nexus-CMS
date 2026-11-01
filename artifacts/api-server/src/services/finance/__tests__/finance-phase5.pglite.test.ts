/** Phase 5: banking (import, matching, reconciliation, cashbook, transfers) and expenses - real router + SQL on in-memory PostgreSQL (PGlite). */
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
import { bankRoutes } from "../modules/bank";
import { expenseRoutes } from "../modules/expenses";
import { FINANCE_SCHEMA_STATEMENTS, FINANCE_PHASE4_STATEMENTS, FINANCE_PHASE5_STATEMENTS } from "../../../../../../lib/db/src/finance-schema";
import type { Db, Queryable } from "../core/types";

const routes = [...organisationRoutes, ...accountRoutes, ...periodRoutes, ...journalRoutes, ...reportRoutes, ...taxRoutes, ...partyRouteList, ...invoiceRoutes, ...billRoutes, ...ageingRoutes, ...bankRoutes, ...expenseRoutes];
const wrap = (r: any): Queryable => ({ async query(sql: string, params: unknown[] = []) { const res = await r.query(sql, params); const rows = res.rows; return { rows, rowCount: rows.length > 0 ? rows.length : res.affectedRows ?? 0 } as any; } });
let pg: any; let db: Db; let skip: string | false = false;
const NOW = new Date("2026-03-15T10:00:00Z");
const deps = { now: () => NOW, log: { error: (o: unknown) => console.error("[finance-test]", o) } };
function client(email: string, role = "editor", org?: number) {
  return async (method: string, path: string, body?: unknown, extra: { query?: Record<string, string>; org?: number | null } = {}) => {
    const o = extra.org === undefined ? org : extra.org;
    const res = await dispatch(routes, db, deps, { method, path, query: extra.query ?? {}, body, headers: o ? { "x-finance-org": String(o) } : {}, auth: { sub: `sub-${email}`, email, platformRole: role, displayName: email.split("@")[0] } });
    return Object.assign(res, { json: res.body as any });
  };
}
let orgA = 0, orgB = 0; let owner: any, ctrl: any, acct: any, cashier: any, ownerB: any; let bankGl = 0, bankId = 0;
const gl = async (code: string) => (await owner("GET", "/accounts", undefined, { query: { q: code } })).json.items.find((a: any) => a.code === code).id as number;
const net = async (code: string) => (await ctrl("GET", "/ledger", undefined, { query: { account_code: code } })).json.closing_balance as string;
async function post(lines: Array<[string, string, string]>, date: string, description = "Test") {
  const j = await acct("POST", "/journals", { entry_date: date, description, lines: lines.map(([account_code, debit, credit]) => ({ account_code, debit, credit })) }); assert.equal(j.status, 201, JSON.stringify(j.json));
  assert.equal((await ctrl("POST", `/journals/${j.json.journal.id}/approve`)).status, 200); assert.equal((await ctrl("POST", `/journals/${j.json.journal.id}/post`)).status, 200);
}
const csv1 = "Date,Description,Reference,Debit,Credit,Balance\n2026-03-01,Capital introduced,TT-001,,5000.00,5000.00\n2026-03-12,Customer deposit,DEP-77,,\"1,000.00\",6000.00\n2026-03-14,Monthly bank charges,,15.00,,5985.00\n";

before(async () => {
  try {
    const mod: any = await import("@electric-sql/pglite" as string);
    pg = new mod.PGlite(); await pg.waitReady;
    const all = [...FINANCE_SCHEMA_STATEMENTS, ...FINANCE_PHASE4_STATEMENTS, ...FINANCE_PHASE5_STATEMENTS];
    for (const s of all) await pg.exec(`${s.trim().replace(/;$/, "")};`); for (const s of FINANCE_PHASE5_STATEMENTS) await pg.exec(`${s.trim().replace(/;$/, "")};`);
    const base = wrap(pg); db = { query: base.query, tx: (fn) => pg.transaction((t: any) => fn(wrap(t))) };
  } catch (e) { skip = `PGlite unavailable: ${e instanceof Error ? e.message : e}`; return; }
  const admin = client("boss@example.com", "admin");
  orgA = Number((await admin("POST", "/organisations", { legal_name: "Alpha Trading Ltd" })).json.organisation.id); orgB = Number((await admin("POST", "/organisations", { legal_name: "Beta Ltd" })).json.organisation.id);
  owner = client("boss@example.com", "admin", orgA); ownerB = client("boss@example.com", "admin", orgB);
  for (const [email, role] of [["ctrl@example.com", "financial_controller"], ["acct@example.com", "accountant"], ["cash@example.com", "cashier"]]) assert.equal((await owner("POST", "/members", { email, role })).status, 201);
  ctrl = client("ctrl@example.com", "editor", orgA); acct = client("acct@example.com", "editor", orgA); cashier = client("cash@example.com", "editor", orgA);
  bankGl = await gl("1020");
});
after(async () => { try { await pg?.close(); } catch { /* ignore */ } });
const t = (name: string, fn: () => Promise<void>) => test(name, async (tc) => { if (skip) return tc.skip(String(skip)); await fn(); });

t("bank accounts must sit on cash/bank ledger accounts, once", async () => {
  assert.equal((await acct("POST", "/bank-accounts", { account_id: await gl("4000"), name: "Wrong" })).json.code, "invalid_bank_account");
  const r = await acct("POST", "/bank-accounts", { account_id: bankGl, name: "GCB Current", bank_name: "GCB", account_ref: "****4421" }); assert.equal(r.status, 201, JSON.stringify(r.json)); bankId = r.json.bank_account.id;
  assert.equal((await acct("POST", "/bank-accounts", { account_id: bankGl, name: "Again" })).json.code, "duplicate");
  assert.equal((await cashier("POST", "/bank-accounts", { account_id: bankGl, name: "x" })).status, 403);
});

t("statement import: dry-run preview, column auto-detect, bad rows refused, same file / overlapping lines never double-import", async () => {
  await post([["1020", "5000.00", "0"], ["3010", "0", "5000.00"]], "2026-03-01", "Capital"); await post([["6100", "300.00", "0"], ["1020", "0", "300.00"]], "2026-03-10", "Rent cheque 1001"); await post([["1020", "1000.00", "0"], ["4000", "0", "1000.00"]], "2026-03-12", "Customer deposit");
  const dry = await acct("POST", `/bank-accounts/${bankId}/import`, { csv: csv1, dry_run: true }); assert.equal(dry.status, 200); assert.equal(dry.json.rows, 3); assert.equal(dry.json.saved, false); assert.equal(dry.json.mapping.credit, "Credit"); assert.equal(dry.json.preview[1].amount, "1000.00"); assert.equal(dry.json.preview[2].amount, "-15.00");
  const bad = await acct("POST", `/bank-accounts/${bankId}/import`, { csv: csv1.replace("2026-03-12", "31/31/2026") }); assert.equal(bad.status, 422); assert.match(bad.json.errors[0].message, /Invalid date/);
  const ok1 = await acct("POST", `/bank-accounts/${bankId}/import`, { csv: csv1, filename: "march.csv" }); assert.equal(ok1.status, 201, JSON.stringify(ok1.json)); assert.equal(ok1.json.imported, 3);
  assert.equal((await acct("POST", `/bank-accounts/${bankId}/import`, { csv: csv1 })).json.code, "statement_already_imported");
  // a second account: overlapping files and genuinely identical lines
  const momoGl = await gl("1030"); const momo = (await acct("POST", "/bank-accounts", { account_id: momoGl, name: "MTN MoMo" })).json.bank_account.id;
  const a = "Date,Description,Amount\n2026-03-16,Coffee,-5.00\n2026-03-16,Coffee,-5.00\n"; const r1 = await acct("POST", `/bank-accounts/${momo}/import`, { csv: a }); assert.equal(r1.json.imported, 2); // two real identical lines both kept
  const r2 = await acct("POST", `/bank-accounts/${momo}/import`, { csv: a + "2026-03-17,Airtime,-2.00\n0,bad\n".replace("0,bad\n", "") }); assert.equal(r2.json.imported, 1); assert.equal(r2.json.duplicates_skipped, 2);
  assert.equal((await ownerB("POST", `/bank-accounts/${bankId}/import`, { csv: csv1 })).status, 404);
  assert.equal((await cashier("POST", `/bank-accounts/${bankId}/import`, { csv: csv1 })).json.code, "statement_already_imported"); // cashier may import (finance:create) - same file still refused
});

t("statement lines are tamper-proof; auto-match takes only exact unambiguous pairs", async () => {
  await assert.rejects(db.query("DELETE FROM finance_bank_transactions"), /cannot be deleted/); await assert.rejects(db.query("UPDATE finance_bank_transactions SET amount = 1"), /cannot be edited/);
  const am = await acct("POST", `/bank-accounts/${bankId}/auto-match`); assert.equal(am.status, 200, JSON.stringify(am.json)); assert.equal(am.json.matched, 2); assert.equal(am.json.left_for_review, 1);
  const rows = (await acct("GET", `/bank-accounts/${bankId}/transactions`)).json.items; const charge = rows.find((r: any) => r.description.includes("bank charges")); assert.equal(charge.status, "unmatched");
  const rent = (await acct("GET", `/cashbook`, undefined, { query: { bank_account_id: String(bankId) } })).json.items.find((r: any) => r.description === "Rent cheque 1001");
  const wrong = await acct("POST", `/bank-transactions/${charge.id}/match`, { ledger_entry_id: rent.id }); assert.equal(wrong.json.code, "amount_mismatch");
  const cap = rows.find((r: any) => r.description === "Capital introduced"); assert.equal((await acct("POST", `/bank-transactions/${cap.id}/unmatch`)).status, 200);
  const sug = (await acct("GET", `/bank-transactions/${cap.id}/suggestions`)).json.items; assert.equal(sug.length, 1); assert.equal((await acct("POST", `/bank-transactions/${cap.id}/match`, { ledger_entry_id: sug[0].ledger_entry_id })).status, 200);
  const other = rows.find((r: any) => r.description === "Customer deposit"); assert.equal((await acct("POST", `/bank-transactions/${other.id}/match`, { ledger_entry_id: sug[0].ledger_entry_id })).status, 409); // already matched txn
});

t("reconciliation never forces a result: differences and un-booked statement lines block completion", async () => {
  const q = { statement_date: "2026-03-15", statement_balance: "5985.00" };
  const pv = (await acct("GET", `/bank-accounts/${bankId}/reconciliation`, undefined, { query: q })).json;
  assert.equal(pv.book_balance, "5700.00"); assert.equal(pv.unpresented_payments, "300.00"); assert.equal(pv.bank_only_items_net, "-15.00"); assert.equal(pv.balanced, true); assert.equal(pv.ready_to_complete, false);
  assert.equal((await acct("POST", `/bank-accounts/${bankId}/reconciliations`, q)).json.code, "unmatched_bank_transactions");
  const off = (await acct("GET", `/bank-accounts/${bankId}/reconciliation`, undefined, { query: { ...q, statement_balance: "5990.00" } })).json; assert.equal(off.difference, "5.00"); assert.equal(off.balanced, false);
  assert.equal((await acct("POST", `/bank-accounts/${bankId}/reconciliations`, { ...q, statement_balance: "5990.00" })).json.code, "reconciliation_difference");
  assert.equal((await cashier("POST", `/bank-accounts/${bankId}/reconciliations`, q)).status, 403);
});

t("book a bank-only item, complete the reconciliation, and the matched lines lock", async () => {
  const charge = (await acct("GET", `/bank-accounts/${bankId}/transactions`, undefined, { query: { status: "unmatched" } })).json.items[0];
  assert.equal((await acct("POST", `/bank-transactions/${charge.id}/book`, { account_id: bankGl })).json.code, "invalid_account");
  const b = await acct("POST", `/bank-transactions/${charge.id}/book`, { account_id: await gl("7000") }); assert.equal(b.status, 201, JSON.stringify(b.json)); assert.equal(await net("7000"), "15.00");
  assert.equal((await acct("POST", `/bank-transactions/${charge.id}/book`, { account_id: await gl("7000") })).json.code, "already_matched");
  const q = { statement_date: "2026-03-15", statement_balance: "5985.00" };
  const pv = (await acct("GET", `/bank-accounts/${bankId}/reconciliation`, undefined, { query: q })).json; assert.equal(pv.book_balance, "5685.00"); assert.equal(pv.ready_to_complete, true); assert.equal(pv.difference, "0.00");
  const done = await acct("POST", `/bank-accounts/${bankId}/reconciliations`, { ...q, notes: "March mid-month" }); assert.equal(done.status, 201, JSON.stringify(done.json)); assert.equal(done.json.locked_transactions, 3);
  assert.equal((await acct("POST", `/bank-accounts/${bankId}/reconciliations`, q)).json.code, "already_reconciled");
  const rec = (await acct("GET", `/bank-accounts/${bankId}/transactions`, undefined, { query: { status: "reconciled" } })).json.items; assert.equal(rec.length, 3);
  assert.equal((await acct("POST", `/bank-transactions/${rec[0].id}/unmatch`)).json.code, "reconciled");
  await assert.rejects(db.query("UPDATE finance_bank_transactions SET matched_entry_id = NULL WHERE id = $1", [rec[0].id]), /locked/);
  await assert.rejects(db.query("UPDATE finance_reconciliations SET notes = 'x'"), /append-only/);
  const rev = (await ctrl("GET", "/journals", undefined, { query: { q: "Bank item" } })).json.items[0]; assert.equal(rev.source_module, "finance.bank_txn");
});

t("the unpresented cheque clears later and the next reconciliation completes; cashbook agrees to the ledger", async () => {
  const m = await acct("POST", `/bank-accounts/${bankId}/transactions`, { txn_date: "2026-03-20", description: "Cheque 1001 cleared", amount: "-300.00", reference: "1001" }); assert.equal(m.status, 201, JSON.stringify(m.json));
  const sug = (await acct("GET", `/bank-transactions/${m.json.transaction.id}/suggestions`)).json.items; assert.equal(sug.length, 1);
  assert.equal((await acct("POST", `/bank-transactions/${m.json.transaction.id}/match`, { ledger_entry_id: sug[0].ledger_entry_id })).status, 200);
  assert.equal((await acct("POST", `/bank-accounts/${bankId}/reconciliations`, { statement_date: "2026-03-31", statement_balance: "5685.00" })).status, 201);
  assert.equal((await acct("GET", `/bank-accounts/${bankId}/reconciliations`)).json.items.length, 2);
  const cb = (await acct("GET", "/cashbook", undefined, { query: { bank_account_id: String(bankId) } })).json; assert.equal(cb.closing_balance, "5685.00"); assert.equal(cb.closing_balance, await net("1020")); assert.ok(cb.items.every((x: any) => x.status === "reconciled")); assert.equal(cb.total_receipts, "6000.00");
  assert.equal((await acct("GET", "/bank-accounts")).json.items.find((b: any) => b.id === bankId).unmatched_transactions, 0);
});

t("bank transfers post one balanced journal and need payments:approve", async () => {
  const body = { from_account_id: bankGl, to_account_id: await gl("1010"), transfer_date: "2026-03-18", amount: "500.00", reference: "Petty cash top-up" };
  assert.equal((await acct("POST", "/bank-transfers", body)).status, 403); assert.equal((await ctrl("POST", "/bank-transfers", { ...body, to_account_id: bankGl })).status, 422); assert.equal((await ctrl("POST", "/bank-transfers", { ...body, to_account_id: await gl("6100") })).json.code, "invalid_bank_account");
  const r = await ctrl("POST", "/bank-transfers", body); assert.equal(r.status, 201, JSON.stringify(r.json)); assert.match(r.json.number, /^TRF-2026-/);
  assert.equal(await net("1010"), "500.00"); assert.equal(await net("1020"), "5185.00"); assert.equal((await ctrl("GET", "/bank-transfers")).json.items[0].amount, "500.00");
  assert.equal((await ctrl("GET", "/trial-balance", undefined, { query: { as_of: "2026-03-31" } })).json.trial_balance.balanced, true);
});

t("expenses: approval + separation of duties, posting splits recoverable input tax, posted expenses are immutable", async () => {
  const body = { expense_date: "2026-03-19", payee: "Shell Ghana", description: "Fuel for deliveries", account_id: await gl("6400"), paid_from_account_id: bankGl, net_amount: "1000.00", tax_code_id: (await owner("GET", "/tax-codes")).json.items.find((x: any) => x.code === "STD").id };
  const c = await cashier("POST", "/expenses", body); assert.equal(c.status, 201, JSON.stringify(c.json)); const id = c.json.expense.id; assert.equal(c.json.expense.tax_amount, "200.00"); assert.equal(c.json.expense.total, "1200.00"); assert.equal(c.json.expense.recoverable_tax, "150.00");
  assert.equal((await cashier("POST", "/expenses", { ...body, paid_from_account_id: await gl("6400") })).json.code, "invalid_bank_account");
  assert.equal((await ctrl("POST", `/expenses/${id}/post`)).json.code, "approval_required");
  assert.equal((await acct("POST", `/expenses/${id}/approve`)).status, 403);
  const mine = await ctrl("POST", "/expenses", { ...body, description: "mine" }); assert.equal((await ctrl("POST", `/expenses/${mine.json.expense.id}/approve`)).json.code, "separation_of_duties");
  assert.equal((await ctrl("POST", `/expenses/${id}/approve`)).status, 200);
  const p = await ctrl("POST", `/expenses/${id}/post`); assert.equal(p.status, 200, JSON.stringify(p.json)); assert.match(p.json.expense.number, /^EXP-2026-/);
  assert.equal(await net("6400"), "1050.00"); assert.equal(await net("1300"), "150.00"); assert.equal(await net("1020"), "3985.00");
  assert.equal((await ctrl("POST", `/expenses/${id}/post`)).json.code, "already_posted"); assert.equal((await ctrl("POST", `/expenses/${id}/cancel`, { reason: "nope" })).json.code, "invalid_status");
  await assert.rejects(db.query("UPDATE finance_expenses SET net_amount = 1 WHERE id = $1", [id]), /immutable/);
  const an = (await ctrl("GET", "/expenses/analysis/by-category")).json; assert.equal(an.items[0].code, "6400"); assert.equal(an.total, "1050.00");
  assert.equal((await ctrl("GET", "/trial-balance", undefined, { query: { as_of: "2026-03-31" } })).json.trial_balance.balanced, true);
});

t("tenant isolation and database-level matching rules", async () => {
  assert.equal((await ownerB("GET", "/bank-accounts")).json.items.length, 0); assert.equal((await ownerB("GET", `/bank-accounts/${bankId}/transactions`)).status, 404); assert.equal((await ownerB("GET", "/cashbook", undefined, { query: { bank_account_id: String(bankId) } })).status, 404);
  const momoTxn = (await db.query<any>("SELECT t.id FROM finance_bank_transactions t JOIN finance_bank_accounts b ON b.id = t.bank_account_id WHERE b.name = 'MTN MoMo' LIMIT 1")).rows[0];
  const revenueEntry = (await db.query<any>("SELECT id FROM finance_ledger_entries WHERE credit = 1000 LIMIT 1")).rows[0];
  await assert.rejects(db.query("UPDATE finance_bank_transactions SET matched_entry_id = $2 WHERE id = $1", [momoTxn.id, revenueEntry.id]), /not on this bank account|identical/);
  await assert.rejects(db.query("INSERT INTO finance_bank_transactions (org_id, bank_account_id, txn_date, description, amount, fingerprint, created_by) VALUES ($1,$2,'2026-03-01','x',1,'fp','u')", [orgB, bankId]), /foreign key/i);
  assert.equal((await owner("GET", "/audit/verify")).json.ok, true);
});
