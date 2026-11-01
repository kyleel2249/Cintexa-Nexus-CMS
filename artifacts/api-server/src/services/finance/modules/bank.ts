import { route, ok, type Route, type Ctx, type Out } from "../core/route";
import { audit } from "../core/audit";
import { V, asObject, qstr, todayIn, ymd } from "../core/validate";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../core/errors";
import { formatMoney, fromDb } from "../core/money";
import { hasPermission } from "../core/rbac";
import { assertBankAccount, postDocument } from "./docs-common";
import { nextNumber } from "./journals";
import { hashText, parseStatement, type DateFormat, type Mapping } from "./csv";
import type { Q } from "../core/types";

const BCOLS = "b.id, b.account_id, b.name, b.bank_name, b.account_ref, b.currency, b.is_active, a.code AS account_code, a.name AS account_name";
async function loadBank(q: Q, orgId: number, id: string | number) {
  const b = (await q.query<any>(`SELECT ${BCOLS} FROM finance_bank_accounts b JOIN finance_accounts a ON a.id = b.account_id AND a.org_id = b.org_id WHERE b.id = $1 AND b.org_id = $2`, [id, orgId])).rows[0];
  if (!b) throw notFound("Bank account");
  return b;
}
const statusOf = (t: any) => (t.reconciliation_id ? "reconciled" : t.matched_entry_id ? "matched" : "unmatched");
const TCOLS = "t.id, t.bank_account_id, t.txn_date, t.description, t.reference, t.amount, t.running_balance, t.source, t.matched_entry_id, t.matched_at, t.reconciliation_id";

const list = route("GET", "/bank-accounts", { perm: "finance:read" }, async (c) => {
  const rows = (await c.q.query<any>(
    `SELECT ${BCOLS},
       (SELECT COALESCE(SUM(e.debit - e.credit),0) FROM finance_ledger_entries e WHERE e.org_id = b.org_id AND e.account_id = b.account_id) AS book_balance,
       (SELECT count(*)::int FROM finance_bank_transactions t WHERE t.org_id = b.org_id AND t.bank_account_id = b.id AND t.matched_entry_id IS NULL) AS unmatched_transactions,
       (SELECT max(statement_date) FROM finance_reconciliations r WHERE r.org_id = b.org_id AND r.bank_account_id = b.id) AS last_reconciled
       FROM finance_bank_accounts b JOIN finance_accounts a ON a.id = b.account_id AND a.org_id = b.org_id WHERE b.org_id = $1 ORDER BY b.name`, [c.org.orgId])).rows;
  return ok({ items: rows });
});

const create = route("POST", "/bank-accounts", { perm: "finance:update" }, async (c) => {
  const v = new V(asObject(c.body)); const accountId = v.int("account_id", { min: 1 }); const name = v.str("name", { min: 2, max: 120 }); const bank = v.str("bank_name", { optional: true, max: 120 }); const ref = v.str("account_ref", { optional: true, max: 40 }); v.done();
  await assertBankAccount(c.q, c.org.orgId, accountId!);
  const dup = (await c.q.query("SELECT 1 FROM finance_bank_accounts WHERE org_id = $1 AND account_id = $2", [c.org.orgId, accountId])).rowCount; if (dup) throw conflict("That ledger account is already registered as a bank account", "duplicate");
  const r = (await c.q.query<any>("INSERT INTO finance_bank_accounts (org_id, account_id, name, bank_name, account_ref, currency) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [c.org.orgId, accountId, name, bank ?? null, ref ?? null, c.org.functionalCurrency])).rows[0];
  const b = await loadBank(c.q, c.org.orgId, r.id);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "bank_account.create", entityType: "bank_account", entityId: b.id, summary: `Registered bank account ${name}`, after: b, requestId: c.reqId });
  return ok({ bank_account: b }, 201);
});

const patch = route("PATCH", "/bank-accounts/:id", { perm: "finance:update" }, async (c) => {
  const v = new V(asObject(c.body)); const name = v.str("name", { optional: true, min: 2, max: 120 }); const bank = v.str("bank_name", { optional: true, max: 120 }); const ref = v.str("account_ref", { optional: true, max: 40 }); const active = v.bool("is_active"); v.done();
  const before = await loadBank(c.q, c.org.orgId, c.params.id!);
  await c.q.query("UPDATE finance_bank_accounts SET name = COALESCE($3,name), bank_name = COALESCE($4,bank_name), account_ref = COALESCE($5,account_ref), is_active = COALESCE($6,is_active) WHERE id = $1 AND org_id = $2", [before.id, c.org.orgId, name ?? null, bank ?? null, ref ?? null, active ?? null]);
  const after = await loadBank(c.q, c.org.orgId, before.id);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "bank_account.update", entityType: "bank_account", entityId: before.id, before, after, requestId: c.reqId });
  return ok({ bank_account: after });
});

/** Statement import. `dry_run` previews the parse without saving. Re-importing the same file or overlapping lines never creates duplicates. */
const importCsv = route("POST", "/bank-accounts/:id/import", { perm: "finance:create" }, async (c) => {
  const b = asObject(c.body); const v = new V(b); const csv = v.str("csv", { max: 2_000_000 }); const fmt = (v.str("date_format", { optional: true, oneOf: ["ymd", "dmy", "mdy"] }) ?? "ymd") as DateFormat; const filename = v.str("filename", { optional: true, max: 200 }); const dry = v.bool("dry_run"); v.done();
  const bank = await loadBank(c.q, c.org.orgId, c.params.id!);
  const parsed = parseStatement(csv!, { mapping: asObject(b.mapping) as Mapping, dateFormat: fmt });
  const preview = parsed.rows.slice(0, 20).map((r) => ({ line: r.line, date: r.date, description: r.description, reference: r.reference, amount: formatMoney(r.amount) }));
  if (dry || parsed.errors.length) return ok({ saved: false, headers: parsed.headers, mapping: parsed.mapping, rows: parsed.rows.length, skipped_zero_amount: parsed.skipped, errors: parsed.errors.slice(0, 50), preview }, parsed.errors.length && !dry ? 422 : 200);
  if (!parsed.rows.length) throw unprocessable("The file contains no transactions", "empty_statement");
  const hash = hashText(csv!);
  if ((await c.q.query("SELECT 1 FROM finance_bank_statements WHERE org_id = $1 AND bank_account_id = $2 AND file_hash = $3", [c.org.orgId, bank.id, hash])).rowCount) throw conflict("This exact file has already been imported for this bank account", "statement_already_imported");
  const st = (await c.q.query<any>("INSERT INTO finance_bank_statements (org_id, bank_account_id, filename, file_hash, row_count, imported_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [c.org.orgId, bank.id, filename ?? null, hash, parsed.rows.length, c.actor.sub])).rows[0];
  let imported = 0; let duplicates = 0;
  for (const r of parsed.rows) {
    const ins = await c.q.query("INSERT INTO finance_bank_transactions (org_id, bank_account_id, statement_id, txn_date, description, reference, amount, running_balance, fingerprint, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (org_id, bank_account_id, fingerprint) DO NOTHING RETURNING id",
      [c.org.orgId, bank.id, st.id, r.date, r.description, r.reference, formatMoney(r.amount), r.balance === null ? null : formatMoney(r.balance), r.fingerprint, c.actor.sub]);
    if (ins.rowCount) imported++; else duplicates++;
  }
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "bank_statement.import", entityType: "bank_account", entityId: bank.id, summary: `Imported ${imported} transactions (${duplicates} duplicates skipped) from ${filename ?? "file"}`, after: { statement_id: st.id, imported, duplicates }, requestId: c.reqId });
  return ok({ saved: true, imported, duplicates_skipped: duplicates, skipped_zero_amount: parsed.skipped, statement_id: st.id }, 201);
});

const addManual = route("POST", "/bank-accounts/:id/transactions", { perm: "finance:create" }, async (c) => {
  const v = new V(asObject(c.body)); const date = v.date("txn_date"); const desc = v.str("description", { min: 2, max: 300 }); const amount = v.money("amount", { allowNegative: true }); const ref = v.str("reference", { optional: true, max: 120 }); v.done();
  if (amount === 0n) throw unprocessable("amount cannot be zero", "validation_failed");
  const bank = await loadBank(c.q, c.org.orgId, c.params.id!);
  const fp = hashText(`manual|${date}|${amount}|${desc}|${ref ?? ""}|${c.reqId}`);
  const t = (await c.q.query<any>(`INSERT INTO finance_bank_transactions (org_id, bank_account_id, txn_date, description, reference, amount, fingerprint, source, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',$8) RETURNING id, txn_date, description, amount`, [c.org.orgId, bank.id, date, desc, ref ?? null, formatMoney(amount!), fp, c.actor.sub])).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "bank_txn.manual", entityType: "bank_transaction", entityId: t.id, summary: `Manual statement line ${formatMoney(amount!)}: ${desc}`, after: t, requestId: c.reqId });
  return ok({ transaction: t }, 201);
});

const txns = route("GET", "/bank-accounts/:id/transactions", { perm: "ledger:read" }, async (c) => {
  const bank = await loadBank(c.q, c.org.orgId, c.params.id!);
  const p: unknown[] = [c.org.orgId, bank.id]; const w = ["t.org_id = $1", "t.bank_account_id = $2"]; const st = qstr(c.query.status); const from = qstr(c.query.from); const to = qstr(c.query.to);
  if (st === "unmatched") w.push("t.matched_entry_id IS NULL"); else if (st === "matched") w.push("t.matched_entry_id IS NOT NULL AND t.reconciliation_id IS NULL"); else if (st === "reconciled") w.push("t.reconciliation_id IS NOT NULL");
  if (from) { p.push(from); w.push(`t.txn_date >= $${p.length}::date`); } if (to) { p.push(to); w.push(`t.txn_date <= $${p.length}::date`); }
  const limit = Math.min(500, Math.max(1, Number(qstr(c.query.limit)) || 100)); const offset = Math.max(0, Number(qstr(c.query.offset)) || 0);
  const total = Number((await c.q.query<any>(`SELECT count(*)::int AS n FROM finance_bank_transactions t WHERE ${w.join(" AND ")}`, p)).rows[0].n);
  const rows = (await c.q.query<any>(`SELECT ${TCOLS}, e.reference AS matched_reference FROM finance_bank_transactions t LEFT JOIN finance_ledger_entries e ON e.id = t.matched_entry_id WHERE ${w.join(" AND ")} ORDER BY t.txn_date DESC, t.id DESC LIMIT ${limit} OFFSET ${offset}`, p)).rows;
  return ok({ bank_account: bank, items: rows.map((r: any) => ({ ...r, status: statusOf(r) })), total, limit, offset });
});

/** Unmatched ledger entries on the bank's GL account that have exactly the statement line's signed amount (nearest dates first). */
async function candidates(q: Q, orgId: number, bank: any, t: any, days = 10) {
  return (await q.query<any>(
    `SELECT e.id, e.entry_date, e.reference, e.description, e.debit, e.credit, abs(e.entry_date - $4::date) AS gap FROM finance_ledger_entries e
      WHERE e.org_id = $1 AND e.account_id = $2 AND (e.debit - e.credit) = $3::numeric AND abs(e.entry_date - $4::date) <= $5
        AND NOT EXISTS (SELECT 1 FROM finance_bank_transactions x WHERE x.matched_entry_id = e.id) ORDER BY gap, e.id LIMIT 10`, [orgId, bank.account_id, t.amount, ymd(t.txn_date), days])).rows;
}
async function loadTxn(q: Q, orgId: number, id: string | number, lock = false) {
  const t = (await q.query<any>(`SELECT t.*, b.account_id FROM finance_bank_transactions t JOIN finance_bank_accounts b ON b.id = t.bank_account_id AND b.org_id = t.org_id WHERE t.id = $1 AND t.org_id = $2${lock ? " FOR UPDATE OF t" : ""}`, [id, orgId])).rows[0];
  if (!t) throw notFound("Bank transaction");
  return t;
}

const suggestions = route("GET", "/bank-transactions/:id/suggestions", { perm: "ledger:read" }, async (c) => {
  const t = await loadTxn(c.q, c.org.orgId, c.params.id!); const bank = await loadBank(c.q, c.org.orgId, t.bank_account_id);
  return ok({ items: (await candidates(c.q, c.org.orgId, bank, t, 30)).map((e: any) => ({ ledger_entry_id: Number(e.id), date: ymd(e.entry_date), reference: e.reference, description: e.description, days_apart: Number(e.gap) })) });
});

const match = route("POST", "/bank-transactions/:id/match", { perm: "ledger:post" }, async (c) => {
  const v = new V(asObject(c.body)); const entryId = v.int("ledger_entry_id", { min: 1 }); v.done();
  const t = await loadTxn(c.q, c.org.orgId, c.params.id!, true);
  if (t.reconciliation_id) throw conflict("This transaction is already reconciled and locked", "reconciled");
  if (t.matched_entry_id) throw conflict("This transaction is already matched; unmatch it first", "already_matched");
  const e = (await c.q.query<any>("SELECT id, account_id, debit, credit, reference FROM finance_ledger_entries WHERE id = $1 AND org_id = $2", [entryId, c.org.orgId])).rows[0];
  if (!e || Number(e.account_id) !== Number(t.account_id)) throw unprocessable("That ledger entry is not on this bank account", "invalid_entry");
  if (fromDb(e.debit) - fromDb(e.credit) !== fromDb(t.amount)) throw unprocessable(`Amounts differ: ledger ${formatMoney(fromDb(e.debit) - fromDb(e.credit))} vs statement ${formatMoney(fromDb(t.amount))}. Book the difference (e.g. bank charges) as its own transaction.`, "amount_mismatch");
  if ((await c.q.query("SELECT 1 FROM finance_bank_transactions WHERE matched_entry_id = $1", [entryId])).rowCount) throw conflict("That ledger entry is already matched to another statement line", "entry_already_matched");
  await c.q.query("UPDATE finance_bank_transactions SET matched_entry_id = $3, matched_by = $4, matched_at = $5 WHERE id = $1 AND org_id = $2", [t.id, c.org.orgId, entryId, c.actor.sub, c.now.toISOString()]);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "bank_txn.match", entityType: "bank_transaction", entityId: t.id, summary: `Matched to ${e.reference}`, after: { ledger_entry_id: entryId }, requestId: c.reqId });
  return ok({ matched: true });
});

const unmatch = route("POST", "/bank-transactions/:id/unmatch", { perm: "ledger:post" }, async (c) => {
  const t = await loadTxn(c.q, c.org.orgId, c.params.id!, true);
  if (t.reconciliation_id) throw conflict("A reconciled transaction is locked and cannot be unmatched", "reconciled");
  if (!t.matched_entry_id) throw conflict("This transaction is not matched", "not_matched");
  await c.q.query("UPDATE finance_bank_transactions SET matched_entry_id = NULL, matched_by = NULL, matched_at = NULL WHERE id = $1 AND org_id = $2", [t.id, c.org.orgId]);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "bank_txn.unmatch", entityType: "bank_transaction", entityId: t.id, before: { ledger_entry_id: t.matched_entry_id }, requestId: c.reqId });
  return ok({ unmatched: true });
});

/** Auto-match applies ONLY unambiguous exact pairs: one statement line <-> one ledger entry (same signed amount, within 5 days) both ways. */
const autoMatch = route("POST", "/bank-accounts/:id/auto-match", { perm: "ledger:post" }, async (c) => {
  const bank = await loadBank(c.q, c.org.orgId, c.params.id!);
  const open = (await c.q.query<any>("SELECT id, txn_date, amount FROM finance_bank_transactions WHERE org_id = $1 AND bank_account_id = $2 AND matched_entry_id IS NULL ORDER BY txn_date, id", [c.org.orgId, bank.id])).rows;
  const claimed = new Set<number>(); const plan: { txn: number; entry: number }[] = []; let ambiguous = 0;
  for (const t of open) {
    const cs = (await candidates(c.q, c.org.orgId, bank, t, 5)).filter((e: any) => !claimed.has(Number(e.id)));
    if (cs.length !== 1) { if (cs.length > 1) ambiguous++; continue; }
    const rivals = open.filter((o: any) => o.id !== t.id && o.amount === t.amount && Math.abs(Date.parse(ymd(o.txn_date)) - Date.parse(ymd(cs[0].entry_date))) <= 5 * 86_400_000).length; // another statement line could claim the same entry
    if (rivals > 0) { ambiguous++; continue; }
    claimed.add(Number(cs[0].id)); plan.push({ txn: Number(t.id), entry: Number(cs[0].id) });
  }
  for (const m of plan) await c.q.query("UPDATE finance_bank_transactions SET matched_entry_id = $3, matched_by = $4, matched_at = $5 WHERE id = $1 AND org_id = $2", [m.txn, c.org.orgId, m.entry, c.actor.sub, c.now.toISOString()]);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "bank_txn.auto_match", entityType: "bank_account", entityId: bank.id, summary: `Auto-matched ${plan.length} unambiguous pair(s); ${ambiguous} left for manual review`, requestId: c.reqId });
  return ok({ matched: plan.length, left_for_review: open.length - plan.length, ambiguous });
});

/** Record a bank-only item (charge, interest, unidentified receipt) in the books and match it in one step. */
const book = route("POST", "/bank-transactions/:id/book", { perm: "ledger:post" }, async (c) => {
  const v = new V(asObject(c.body)); const accountId = v.int("account_id", { min: 1 }); const desc = v.str("description", { optional: true, max: 300 }); v.done();
  const t = await loadTxn(c.q, c.org.orgId, c.params.id!, true);
  if (t.matched_entry_id) throw conflict("This transaction is already matched", "already_matched");
  const acct = (await c.q.query<any>("SELECT id, is_active, allow_posting, code FROM finance_accounts WHERE id = $1 AND org_id = $2", [accountId, c.org.orgId])).rows[0];
  if (!acct || !acct.is_active || !acct.allow_posting) throw unprocessable("Choose an active, postable account", "invalid_account");
  if (Number(acct.id) === Number(t.account_id)) throw unprocessable("Choose the other side of the entry, not the bank account itself", "invalid_account");
  const amt = fromDb(t.amount);
  const j = await postDocument(c, { date: ymd(t.txn_date), description: desc ?? `Bank item: ${t.description}`, sourceModule: "finance.bank_txn", sourceRef: String(t.id),
    lines: amt > 0n ? [{ account_id: Number(t.account_id), debit: amt }, { account_id: Number(acct.id), credit: amt }] : [{ account_id: Number(acct.id), debit: -amt }, { account_id: Number(t.account_id), credit: -amt }] });
  const e = (await c.q.query<any>("SELECT id FROM finance_ledger_entries WHERE journal_id = $1 AND account_id = $2 AND org_id = $3", [j.id, t.account_id, c.org.orgId])).rows[0];
  await c.q.query("UPDATE finance_bank_transactions SET matched_entry_id = $3, matched_by = $4, matched_at = $5 WHERE id = $1 AND org_id = $2", [t.id, c.org.orgId, e.id, c.actor.sub, c.now.toISOString()]);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "bank_txn.book", entityType: "bank_transaction", entityId: t.id, summary: `Booked ${formatMoney(amt)} to ${acct.code} (${j.reference})`, requestId: c.reqId });
  return ok({ journal: j.reference, matched: true }, 201);
});

async function reconcileFigures(q: Q, orgId: number, bank: any, date: string, statementBalance: bigint) {
  const book = fromDb((await q.query<any>("SELECT COALESCE(SUM(debit - credit),0) AS b FROM finance_ledger_entries WHERE org_id = $1 AND account_id = $2 AND entry_date <= $3::date", [orgId, bank.account_id, date])).rows[0].b);
  const ul = (await q.query<any>(`SELECT e.id, e.entry_date, e.reference, e.description, (e.debit - e.credit) AS amount FROM finance_ledger_entries e WHERE e.org_id = $1 AND e.account_id = $2 AND e.entry_date <= $3::date AND NOT EXISTS (SELECT 1 FROM finance_bank_transactions x WHERE x.matched_entry_id = e.id) ORDER BY e.entry_date, e.id`, [orgId, bank.account_id, date])).rows;
  const ub = (await q.query<any>("SELECT id, txn_date, description, reference, amount FROM finance_bank_transactions WHERE org_id = $1 AND bank_account_id = $2 AND matched_entry_id IS NULL AND txn_date <= $3::date ORDER BY txn_date, id", [orgId, bank.id, date])).rows;
  const deposits = ul.filter((r: any) => fromDb(r.amount) > 0n).reduce<bigint>((s, r: any) => s + fromDb(r.amount), 0n);
  const payments = ul.filter((r: any) => fromDb(r.amount) < 0n).reduce<bigint>((s, r: any) => s - fromDb(r.amount), 0n);
  const bankOnly = ub.reduce<bigint>((s, r: any) => s + fromDb(r.amount), 0n);
  const adjusted = statementBalance - bankOnly + deposits - payments; // statement balance, less items the bank has but the books don't, plus deposits in transit, less unpresented payments
  return { statement_date: date, statement_balance: formatMoney(statementBalance), book_balance: formatMoney(book), outstanding_deposits: formatMoney(deposits), unpresented_payments: formatMoney(payments), bank_only_items_net: formatMoney(bankOnly),
    adjusted_bank_balance: formatMoney(adjusted), difference: formatMoney(adjusted - book), balanced: adjusted === book, ready_to_complete: adjusted === book && ub.length === 0,
    unmatched_ledger_entries: ul.map((r: any) => ({ ledger_entry_id: Number(r.id), date: ymd(r.entry_date), reference: r.reference, description: r.description, amount: formatMoney(fromDb(r.amount)) })),
    unmatched_bank_transactions: ub.map((r: any) => ({ id: Number(r.id), date: ymd(r.txn_date), description: r.description, reference: r.reference, amount: formatMoney(fromDb(r.amount)) })) };
}
function reconInput(c: Ctx, src: Record<string, any>) {
  const v = new V(src); const date = v.date("statement_date"); const bal = v.money("statement_balance", { allowNegative: true }); v.done(); return { date: date!, bal: bal! };
}
const reconPreview = route("GET", "/bank-accounts/:id/reconciliation", { perm: "ledger:read" }, async (c) => {
  const i = reconInput(c, { statement_date: qstr(c.query.statement_date), statement_balance: qstr(c.query.statement_balance) });
  return ok(await reconcileFigures(c.q, c.org.orgId, await loadBank(c.q, c.org.orgId, c.params.id!), i.date, i.bal));
});

/** Completing never forces a result: the server recomputes everything and refuses unless the difference is exactly nil and no statement line is unbooked. */
const reconComplete = route("POST", "/bank-accounts/:id/reconciliations", { perm: "ledger:post" }, async (c) => {
  const b = asObject(c.body); const i = reconInput(c, b); const notes = new V(b).str("notes", { optional: true, max: 500 });
  const bank = await loadBank(c.q, c.org.orgId, c.params.id!);
  await c.q.query("SELECT pg_advisory_xact_lock(7002, $1)", [Number(bank.id)]);
  const last = (await c.q.query<any>("SELECT max(statement_date) AS d FROM finance_reconciliations WHERE org_id = $1 AND bank_account_id = $2", [c.org.orgId, bank.id])).rows[0].d;
  if (last && i.date <= ymd(last)) throw conflict(`This account is already reconciled to ${ymd(last)}`, "already_reconciled");
  const f = await reconcileFigures(c.q, c.org.orgId, bank, i.date, i.bal);
  if (!f.balanced) throw unprocessable(`Cannot complete: the reconciliation is out by ${f.difference}. Resolve every difference first - it is never written off automatically.`, "reconciliation_difference", f);
  if (f.unmatched_bank_transactions.length) throw unprocessable(`${f.unmatched_bank_transactions.length} statement line(s) are not in the books yet. Book or match them first.`, "unmatched_bank_transactions", f);
  const r = (await c.q.query<any>("INSERT INTO finance_reconciliations (org_id, bank_account_id, statement_date, statement_balance, book_balance, outstanding_deposits, unpresented_payments, difference, notes, completed_by, completed_by_label) VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10) RETURNING id, statement_date, statement_balance, book_balance", [c.org.orgId, bank.id, i.date, f.statement_balance, f.book_balance, f.outstanding_deposits, f.unpresented_payments, notes ?? null, c.actor.sub, c.actor.label])).rows[0];
  const n = await c.q.query("UPDATE finance_bank_transactions SET reconciliation_id = $3 WHERE org_id = $1 AND bank_account_id = $2 AND matched_entry_id IS NOT NULL AND reconciliation_id IS NULL AND txn_date <= $4::date", [c.org.orgId, bank.id, r.id, i.date]);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "bank.reconcile", entityType: "bank_account", entityId: bank.id, summary: `Reconciled ${bank.name} to ${i.date}, statement ${f.statement_balance}`, after: { ...r, locked_transactions: n.rowCount }, requestId: c.reqId });
  return ok({ reconciliation: r, locked_transactions: n.rowCount }, 201);
});
const reconHistory = route("GET", "/bank-accounts/:id/reconciliations", { perm: "ledger:read" }, async (c) => {
  const bank = await loadBank(c.q, c.org.orgId, c.params.id!);
  return ok({ items: (await c.q.query<any>("SELECT id, statement_date, statement_balance, book_balance, outstanding_deposits, unpresented_payments, completed_by_label, completed_at, notes FROM finance_reconciliations WHERE org_id = $1 AND bank_account_id = $2 ORDER BY statement_date DESC", [c.org.orgId, bank.id])).rows });
});

const cashbook = route("GET", "/cashbook", { perm: "ledger:read" }, async (c): Promise<Out> => {
  const id = qstr(c.query.bank_account_id); if (!id) throw badRequest("bank_account_id is required");
  const bank = await loadBank(c.q, c.org.orgId, id); const from = qstr(c.query.from); const to = qstr(c.query.to);
  const op = from ? fromDb((await c.q.query<any>("SELECT COALESCE(SUM(debit - credit),0) AS b FROM finance_ledger_entries WHERE org_id = $1 AND account_id = $2 AND entry_date < $3::date", [c.org.orgId, bank.account_id, from])).rows[0].b) : 0n;
  const rows = (await c.q.query<any>(`SELECT e.id, e.entry_date, e.reference, e.journal_id, e.description, e.debit, e.credit, t.id AS bank_txn_id, t.reconciliation_id FROM finance_ledger_entries e LEFT JOIN finance_bank_transactions t ON t.matched_entry_id = e.id
    WHERE e.org_id = $1 AND e.account_id = $2 AND ($3::date IS NULL OR e.entry_date >= $3::date) AND ($4::date IS NULL OR e.entry_date <= $4::date) ORDER BY e.entry_date, e.id`, [c.org.orgId, bank.account_id, from ?? null, to ?? null])).rows;
  let run = op; let rec = 0n; let pay = 0n;
  const items = rows.map((r: any) => { const d = fromDb(r.debit); const cr = fromDb(r.credit); rec += d; pay += cr; run += d - cr; return { id: Number(r.id), date: ymd(r.entry_date), reference: r.reference, journal_id: Number(r.journal_id), description: r.description, receipts: formatMoney(d), payments: formatMoney(cr), balance: formatMoney(run), status: r.reconciliation_id ? "reconciled" : r.bank_txn_id ? "matched" : "unmatched" }; });
  return ok({ bank_account: bank, from: from ?? null, to: to ?? null, opening_balance: formatMoney(op), total_receipts: formatMoney(rec), total_payments: formatMoney(pay), closing_balance: formatMoney(run), items });
});

/** Transfer between two cash/bank accounts: Dr destination / Cr source, one balanced journal. */
const transfer = route("POST", "/bank-transfers", { perm: "payments:approve" }, async (c) => {
  const v = new V(asObject(c.body)); const from = v.int("from_account_id", { min: 1 }); const to = v.int("to_account_id", { min: 1 }); const date = v.date("transfer_date"); const amount = v.money("amount"); const ref = v.str("reference", { optional: true, max: 120 }); v.done();
  if (from === to) throw unprocessable("Choose two different accounts", "validation_failed"); if (amount! <= 0n) throw unprocessable("amount must be greater than zero", "validation_failed");
  await assertBankAccount(c.q, c.org.orgId, from!); await assertBankAccount(c.q, c.org.orgId, to!);
  const year = date!.slice(0, 4); const number = `TRF-${year}-${String(await nextNumber(c.q, c.org.orgId, `transfer:${year}`)).padStart(6, "0")}`;
  const j = await postDocument(c, { date: date!, description: `Bank transfer ${number}${ref ? ` - ${ref}` : ""}`, sourceModule: "finance.bank_transfer", sourceRef: number, lines: [{ account_id: to!, debit: amount }, { account_id: from!, credit: amount }] });
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "bank_transfer.create", entityType: "journal", entityId: j.id, summary: `${number}: ${formatMoney(amount!)} (${j.reference})`, requestId: c.reqId });
  return ok({ number, journal: j.reference }, 201);
});
const transferList = route("GET", "/bank-transfers", { perm: "ledger:read" }, async (c) => ok({ items: (await c.q.query<any>(
  `SELECT j.id, j.source_ref AS number, j.entry_date, j.reference AS journal_reference, j.description, (SELECT SUM(debit) FROM finance_journal_lines WHERE journal_id = j.id) AS amount FROM finance_journals j WHERE j.org_id = $1 AND j.source_module = 'finance.bank_transfer' ORDER BY j.entry_date DESC, j.id DESC LIMIT 200`, [c.org.orgId])).rows }));

export const bankRoutes: Route[] = [list, create, patch, importCsv, addManual, txns, suggestions, match, unmatch, autoMatch, book, reconPreview, reconComplete, reconHistory, cashbook, transfer, transferList];
void forbidden; void hasPermission; void todayIn;
