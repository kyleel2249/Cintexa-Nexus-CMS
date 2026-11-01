import { route, ok, type Route, type Ctx } from "../core/route";
import { audit } from "../core/audit";
import { V, asObject, qstr, todayIn, ymd } from "../core/validate";
import { conflict, forbidden, notFound, unprocessable } from "../core/errors";
import { formatMoney, fromDb } from "../core/money";
import { buildLines, controlAccount, assertBankAccount, postDocument, docApprovalRequired, fmtQty, type BuiltLine } from "./docs-common";
import { nextNumber } from "./journals";
import { paymentStatus, METHODS } from "./invoices";
import type { Q } from "../core/types";

const addDays = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const BCOLS = "id, number, supplier_id, supplier_ref, bill_date, due_date, currency, notes, status, subtotal, tax_total, total, amount_paid, journal_id, created_by_label, approved_by_label, approved_at, posted_at, cancel_reason, created_at";

async function saveLines(q: Q, orgId: number, billId: number, built: BuiltLine[]) {
  let n = 1;
  for (const l of built) await q.query("INSERT INTO finance_bill_lines (org_id, bill_id, line_no, description, quantity, unit_price, net_amount, tax_code_id, tax_amount, recoverable_tax, account_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [orgId, billId, n++, l.description, fmtQty(l.qty4), formatMoney(l.unitMinor), formatMoney(l.net), l.taxCodeId, formatMoney(l.tax), formatMoney(l.recoverableTax), l.accountId]);
}
async function load(q: Q, orgId: number, id: string | number, lock = false) {
  const b = (await q.query<any>(`SELECT ${BCOLS} FROM finance_bills WHERE id = $1 AND org_id = $2${lock ? " FOR UPDATE" : ""}`, [id, orgId])).rows[0];
  if (!b) throw notFound("Bill");
  return b;
}
async function detail(c: Ctx, b: any) {
  const org = (await c.q.query<any>("SELECT timezone FROM finance_organisations WHERE id = $1", [c.org.orgId])).rows[0];
  const lines = (await c.q.query<any>("SELECT l.line_no, l.description, l.quantity, l.unit_price, l.net_amount, t.code AS tax_code, l.tax_amount, l.recoverable_tax, a.code AS account_code, a.name AS account_name, l.account_id, l.tax_code_id FROM finance_bill_lines l JOIN finance_accounts a ON a.id = l.account_id AND a.org_id = l.org_id LEFT JOIN finance_tax_codes t ON t.id = l.tax_code_id AND t.org_id = l.org_id WHERE l.bill_id = $1 AND l.org_id = $2 ORDER BY l.line_no", [b.id, c.org.orgId])).rows;
  const allocations = (await c.q.query<any>("SELECT a.amount, p.number, p.payment_date, p.method, p.reference FROM finance_payment_allocations a JOIN finance_payments p ON p.id = a.payment_id AND p.org_id = a.org_id WHERE a.bill_id = $1 AND a.org_id = $2 ORDER BY p.payment_date, p.id", [b.id, c.org.orgId])).rows;
  const supplier = (await c.q.query<any>("SELECT id, code, name, email, tax_id, payment_terms_days FROM finance_suppliers WHERE id = $1 AND org_id = $2", [b.supplier_id, c.org.orgId])).rows[0];
  return { ...b, payment_status: paymentStatus(b, todayIn(org.timezone, c.now)), outstanding: formatMoney(fromDb(b.total) - fromDb(b.amount_paid)), lines, allocations, supplier };
}

const list = route("GET", "/bills", { perm: "finance:read" }, async (c) => {
  const org = (await c.q.query<any>("SELECT timezone FROM finance_organisations WHERE id = $1", [c.org.orgId])).rows[0]; const today = todayIn(org.timezone, c.now);
  const p: unknown[] = [c.org.orgId]; const w = ["b.org_id = $1"];
  const st = qstr(c.query.status); const sup = qstr(c.query.supplier_id); const s = qstr(c.query.q);
  if (st) { p.push(st); w.push(`b.status = $${p.length}`); } if (sup) { p.push(Number(sup)); w.push(`b.supplier_id = $${p.length}`); }
  if (s) { p.push(`%${s.toLowerCase()}%`); w.push(`(lower(COALESCE(b.number,'')) LIKE $${p.length} OR lower(b.supplier_ref) LIKE $${p.length} OR lower(s.name) LIKE $${p.length})`); }
  if (qstr(c.query.overdue) === "true") { p.push(today); w.push(`b.status = 'posted' AND b.amount_paid < b.total AND b.due_date < $${p.length}::date`); }
  const limit = Math.min(200, Math.max(1, Number(qstr(c.query.limit)) || 50)); const offset = Math.max(0, Number(qstr(c.query.offset)) || 0);
  const total = Number((await c.q.query<any>(`SELECT count(*)::int AS n FROM finance_bills b JOIN finance_suppliers s ON s.id = b.supplier_id AND s.org_id = b.org_id WHERE ${w.join(" AND ")}`, p)).rows[0].n);
  const rows = (await c.q.query<any>(`SELECT ${BCOLS.split(", ").map((x) => "b." + x).join(", ")}, s.name AS supplier_name FROM finance_bills b JOIN finance_suppliers s ON s.id = b.supplier_id AND s.org_id = b.org_id WHERE ${w.join(" AND ")} ORDER BY b.bill_date DESC, b.id DESC LIMIT ${limit} OFFSET ${offset}`, p)).rows;
  return ok({ items: rows.map((r: any) => ({ ...r, payment_status: paymentStatus(r, today), outstanding: formatMoney(fromDb(r.total) - fromDb(r.amount_paid)) })), total, limit, offset });
});
const getOne = route("GET", "/bills/:id", { perm: "finance:read" }, async (c) => ok({ bill: await detail(c, await load(c.q, c.org.orgId, c.params.id!)) }));

async function header(c: Ctx, b: Record<string, any>, existing?: any) {
  const v = new V(b); const supplierId = v.int("supplier_id", { min: 1, optional: Boolean(existing) }) ?? Number(existing?.supplier_id);
  const ref = v.str("supplier_ref", { optional: Boolean(existing), max: 120 }) ?? existing?.supplier_ref; const date = v.date("bill_date", Boolean(existing)) ?? ymd(existing?.bill_date);
  const due = v.date("due_date", true); const notes = v.str("notes", { optional: true, max: 1000 }); const cur = v.str("currency", { optional: true, pattern: /^[A-Za-z]{3}$/ }); v.done();
  if (cur && cur.toUpperCase() !== c.org.functionalCurrency) throw unprocessable(`Only ${c.org.functionalCurrency} (the functional currency) is supported for bills right now.`, "currency_not_supported");
  const sup = (await c.q.query<any>("SELECT id, is_active, payment_terms_days FROM finance_suppliers WHERE id = $1 AND org_id = $2", [supplierId, c.org.orgId])).rows[0];
  if (!sup || !sup.is_active) throw unprocessable("Supplier not found or inactive", "invalid_supplier");
  const dup = (await c.q.query<any>("SELECT id, number FROM finance_bills WHERE org_id = $1 AND supplier_id = $2 AND lower(supplier_ref) = lower($3) AND status <> 'cancelled' AND id <> $4", [c.org.orgId, supplierId, ref, existing?.id ?? 0])).rows[0];
  if (dup) throw conflict(`Supplier invoice ${ref} has already been entered (bill ${dup.number ?? "#" + dup.id}). Duplicate supplier invoices are blocked.`, "duplicate_supplier_invoice", { bill_id: dup.id });
  return { supplierId, ref: String(ref), date, due: due ?? addDays(date, Number(sup.payment_terms_days)), notes };
}

const create = route("POST", "/bills", { perm: "finance:create" }, async (c) => {
  const b = asObject(c.body); const h = await header(c, b); const built = await buildLines(c.q, c.org.orgId, b.lines, h.date, "purchase");
  const row = (await c.q.query<any>(`INSERT INTO finance_bills (org_id, supplier_id, supplier_ref, bill_date, due_date, currency, notes, subtotal, tax_total, total, created_by, created_by_label) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${BCOLS}`,
    [c.org.orgId, h.supplierId, h.ref, h.date, h.due, c.org.functionalCurrency, h.notes ?? null, formatMoney(built.subtotal), formatMoney(built.tax), formatMoney(built.total), c.actor.sub, c.actor.label])).rows[0];
  await saveLines(c.q, c.org.orgId, Number(row.id), built.lines);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "bill.create", entityType: "bill", entityId: row.id, summary: `Draft bill ${h.ref}, total ${formatMoney(built.total)}`, after: row, requestId: c.reqId });
  return ok({ bill: await detail(c, row) }, 201);
});

const update = route("PATCH", "/bills/:id", { perm: "finance:create" }, async (c) => {
  const cur = await load(c.q, c.org.orgId, c.params.id!, true);
  if (cur.status !== "draft") throw conflict(`Only draft bills can be edited (this one is ${cur.status})`, "bill_not_editable");
  const b = asObject(c.body); const h = await header(c, b, cur); const before = await detail(c, cur);
  const built = await buildLines(c.q, c.org.orgId, b.lines ?? before.lines.map((l: any) => ({ description: l.description, quantity: l.quantity, unit_price: l.unit_price, tax_code_id: l.tax_code_id ?? undefined, account_id: l.account_id })), h.date, "purchase");
  await c.q.query("DELETE FROM finance_bill_lines WHERE bill_id = $1 AND org_id = $2", [cur.id, c.org.orgId]);
  const after = (await c.q.query<any>(`UPDATE finance_bills SET supplier_id = $3, supplier_ref = $4, bill_date = $5, due_date = $6, notes = $7, subtotal = $8, tax_total = $9, total = $10, updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING ${BCOLS}`,
    [cur.id, c.org.orgId, h.supplierId, h.ref, h.date, h.due, h.notes ?? cur.notes, formatMoney(built.subtotal), formatMoney(built.tax), formatMoney(built.total)])).rows[0];
  await saveLines(c.q, c.org.orgId, Number(cur.id), built.lines);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "bill.update", entityType: "bill", entityId: cur.id, before, after, requestId: c.reqId });
  return ok({ bill: await detail(c, after) });
});

const remove = route("DELETE", "/bills/:id", { perm: "finance:create" }, async (c) => {
  const b = await load(c.q, c.org.orgId, c.params.id!, true);
  if (b.status !== "draft") throw conflict("Only draft bills can be deleted; cancel an approved bill instead", "bill_not_deletable");
  await c.q.query("DELETE FROM finance_bill_lines WHERE bill_id = $1 AND org_id = $2", [b.id, c.org.orgId]); await c.q.query("DELETE FROM finance_bills WHERE id = $1 AND org_id = $2", [b.id, c.org.orgId]);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "bill.delete", entityType: "bill", entityId: b.id, before: b, requestId: c.reqId });
  return ok({ deleted: true });
});

const approve = route("POST", "/bills/:id/approve", { perm: "finance:approve" }, async (c) => {
  const b = await load(c.q, c.org.orgId, c.params.id!, true);
  if (b.status !== "draft") throw conflict(`Only draft bills can be approved (this one is ${b.status})`, "invalid_status");
  const row = (await c.q.query<any>("SELECT created_by FROM finance_bills WHERE id = $1 AND org_id = $2", [b.id, c.org.orgId])).rows[0];
  if (row.created_by === c.actor.sub && c.org.settings?.allow_self_approval !== true) throw forbidden("Separation of duties: you cannot approve a bill you entered", "separation_of_duties");
  const after = (await c.q.query<any>(`UPDATE finance_bills SET status = 'approved', approved_by = $3, approved_by_label = $4, approved_at = $5, updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING ${BCOLS}`, [b.id, c.org.orgId, c.actor.sub, c.actor.label, c.now.toISOString()])).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "bill.approve", entityType: "bill", entityId: b.id, before: { status: "draft" }, after: { status: "approved" }, requestId: c.reqId });
  return ok({ bill: await detail(c, after) });
});

/** Post: Dr expense/asset (net + non-recoverable tax), Dr Input tax recoverable, Cr Accounts payable. */
const post = route("POST", "/bills/:id/post", { perm: "finance:post" }, async (c) => {
  const b = await load(c.q, c.org.orgId, c.params.id!, true);
  if (b.status === "posted") throw conflict("This bill has already been posted", "already_posted");
  if (!(b.status === "approved" || (b.status === "draft" && !docApprovalRequired(c)))) throw conflict(b.status === "draft" ? "This bill needs approval before it can be posted" : `A ${b.status} bill cannot be posted`, b.status === "draft" ? "approval_required" : "invalid_status");
  const sup = (await c.q.query<any>("SELECT name FROM finance_suppliers WHERE id = $1 AND org_id = $2", [b.supplier_id, c.org.orgId])).rows[0];
  const ap = await controlAccount(c.q, c.org.orgId, "accounts_payable");
  const lines = (await c.q.query<any>("SELECT account_id, net_amount, tax_amount, recoverable_tax FROM finance_bill_lines WHERE bill_id = $1 AND org_id = $2", [b.id, c.org.orgId])).rows;
  const cost = new Map<number, bigint>(); let recoverable = 0n;
  for (const l of lines) { const nonRec = fromDb(l.tax_amount) - fromDb(l.recoverable_tax); cost.set(Number(l.account_id), (cost.get(Number(l.account_id)) ?? 0n) + fromDb(l.net_amount) + nonRec); recoverable += fromDb(l.recoverable_tax); }
  const inputTax = recoverable > 0n ? await controlAccount(c.q, c.org.orgId, "tax_recoverable") : 0;
  const number = `BILL-${ymd(b.bill_date).slice(0, 4)}-${String(await nextNumber(c.q, c.org.orgId, `bill:${ymd(b.bill_date).slice(0, 4)}`)).padStart(6, "0")}`;
  const j = await postDocument(c, { date: ymd(b.bill_date), description: `Supplier bill ${number} (${b.supplier_ref}) - ${sup.name}`, sourceModule: "finance.bill", sourceRef: String(b.id),
    lines: [...[...cost].map(([account_id, amt]) => ({ account_id, debit: amt })), ...(recoverable > 0n ? [{ account_id: inputTax, debit: recoverable }] : []), { account_id: ap, credit: fromDb(b.total) }] });
  const after = (await c.q.query<any>(`UPDATE finance_bills SET status = 'posted', number = $3, journal_id = $4, posted_by = $5, posted_at = $6, updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING ${BCOLS}`, [b.id, c.org.orgId, number, j.id, c.actor.sub, c.now.toISOString()])).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "bill.post", entityType: "bill", entityId: b.id, summary: `Posted ${number} (${j.reference}), total ${b.total}`, before: { status: b.status }, after: { status: "posted", number, journal: j.reference }, requestId: c.reqId });
  return ok({ bill: await detail(c, after), journal: j.reference });
});

const cancel = route("POST", "/bills/:id/cancel", { perm: "finance:create" }, async (c) => {
  const v = new V(asObject(c.body)); const reason = v.str("reason", { min: 3, max: 300 }); v.done();
  const b = await load(c.q, c.org.orgId, c.params.id!, true);
  if (!["draft", "approved"].includes(b.status)) throw conflict(b.status === "posted" ? "A posted bill cannot be cancelled; raise a supplier credit note instead" : `A ${b.status} bill cannot be cancelled`, "invalid_status");
  const after = (await c.q.query<any>(`UPDATE finance_bills SET status = 'cancelled', cancelled_by = $3, cancelled_at = $4, cancel_reason = $5, updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING ${BCOLS}`, [b.id, c.org.orgId, c.actor.sub, c.now.toISOString(), reason])).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "bill.cancel", entityType: "bill", entityId: b.id, summary: reason, before: { status: b.status }, after: { status: "cancelled" }, requestId: c.reqId });
  return ok({ bill: await detail(c, after) });
});

/** Supplier payment: Dr Accounts payable / Cr Bank, allocated to bills. Needs payments:approve. */
export async function recordSupplierPayment(c: Ctx, a: { supplierId: number; date: string; bankAccountId: number; method: string; reference?: string; allocations: Array<{ billId: number; amount: bigint }> }) {
  if (!a.allocations.length) throw unprocessable("Allocate the payment to at least one bill", "allocation_required");
  if (a.allocations.some((x) => x.amount <= 0n)) throw unprocessable("Allocation amounts must be greater than zero", "validation_failed");
  if (new Set(a.allocations.map((x) => x.billId)).size !== a.allocations.length) throw unprocessable("Each bill can appear only once per payment", "validation_failed");
  const amount = a.allocations.reduce((s, x) => s + x.amount, 0n);
  await assertBankAccount(c.q, c.org.orgId, a.bankAccountId);
  for (const al of [...a.allocations].sort((x, y) => x.billId - y.billId)) {
    const b = (await c.q.query<any>("SELECT id, number, supplier_id, status, total, amount_paid FROM finance_bills WHERE id = $1 AND org_id = $2 FOR UPDATE", [al.billId, c.org.orgId])).rows[0];
    if (!b || Number(b.supplier_id) !== a.supplierId) throw unprocessable(`Bill ${al.billId} does not belong to this supplier`, "invalid_bill");
    if (b.status !== "posted") throw unprocessable(`Bill ${b.number ?? b.id} is ${b.status}; only posted bills can be paid`, "invalid_bill");
    const out = fromDb(b.total) - fromDb(b.amount_paid);
    if (al.amount > out) throw unprocessable(`The amount applied to ${b.number} exceeds its outstanding balance of ${formatMoney(out)}`, "exceeds_outstanding", { bill: b.number, outstanding: formatMoney(out) });
  }
  const ap = await controlAccount(c.q, c.org.orgId, "accounts_payable");
  const year = a.date.slice(0, 4); const number = `PAY-${year}-${String(await nextNumber(c.q, c.org.orgId, `payment:${year}`)).padStart(6, "0")}`;
  const sup = (await c.q.query<any>("SELECT name FROM finance_suppliers WHERE id = $1 AND org_id = $2", [a.supplierId, c.org.orgId])).rows[0];
  const j = await postDocument(c, { date: a.date, description: `Supplier payment ${number} - ${sup.name}`, sourceModule: "finance.payment", sourceRef: number, lines: [{ account_id: ap, debit: amount }, { account_id: a.bankAccountId, credit: amount }] });
  const pay = (await c.q.query<any>("INSERT INTO finance_payments (org_id, direction, number, supplier_id, payment_date, amount, bank_account_id, method, reference, journal_id, created_by, created_by_label) VALUES ($1,'payment',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, number, payment_date, amount, method, reference", [c.org.orgId, number, a.supplierId, a.date, formatMoney(amount), a.bankAccountId, a.method, a.reference ?? null, j.id, c.actor.sub, c.actor.label])).rows[0];
  for (const al of a.allocations) {
    await c.q.query("INSERT INTO finance_payment_allocations (org_id, payment_id, bill_id, amount) VALUES ($1,$2,$3,$4)", [c.org.orgId, pay.id, al.billId, formatMoney(al.amount)]);
    await c.q.query("UPDATE finance_bills SET amount_paid = amount_paid + $3, updated_at = now() WHERE id = $1 AND org_id = $2", [al.billId, c.org.orgId, formatMoney(al.amount)]);
  }
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "supplier_payment.create", entityType: "payment", entityId: pay.id, summary: `Payment ${number} ${formatMoney(amount)} (${j.reference})`, after: { ...pay, allocations: a.allocations.map((x) => ({ bill_id: x.billId, amount: formatMoney(x.amount) })) }, requestId: c.reqId });
  return { payment: pay, journal: j.reference };
}

const payBill = route("POST", "/bills/:id/payments", { perm: "payments:approve" }, async (c) => {
  const v = new V(asObject(c.body)); const amount = v.money("amount"); const date = v.date("payment_date"); const bank = v.int("bank_account_id", { min: 1 }); const method = v.str("method", { optional: true, oneOf: METHODS }) ?? "bank_transfer"; const ref = v.str("reference", { optional: true, max: 120 }); v.done();
  const b = await load(c.q, c.org.orgId, c.params.id!);
  const r = await recordSupplierPayment(c, { supplierId: Number(b.supplier_id), date: date!, bankAccountId: bank!, method, reference: ref, allocations: [{ billId: Number(b.id), amount: amount! }] });
  return ok({ ...r, bill: await detail(c, await load(c.q, c.org.orgId, b.id)) }, 201);
});

export const billRoutes: Route[] = [list, getOne, create, update, remove, approve, post, cancel, payBill];
