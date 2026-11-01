import { route, ok, type Route, type Ctx } from "../core/route";
import { audit } from "../core/audit";
import { V, asObject, qstr, todayIn, ymd } from "../core/validate";
import { conflict, forbidden, notFound, unprocessable } from "../core/errors";
import { formatMoney, fromDb } from "../core/money";
import { buildLines, controlAccount, assertBankAccount, postDocument, docApprovalRequired, fmtQty, type BuiltLine } from "./docs-common";
import { nextNumber } from "./journals";
import type { Q } from "../core/types";

const addDays = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const ICOLS = "id, number, customer_id, invoice_date, due_date, currency, reference, notes, status, subtotal, tax_total, total, amount_paid, journal_id, created_by_label, approved_by_label, approved_at, issued_at, cancel_reason, created_at";

async function saveLines(q: Q, orgId: number, invoiceId: number, built: BuiltLine[]) {
  let n = 1;
  for (const l of built) {
    const r = (await q.query<any>("INSERT INTO finance_invoice_lines (org_id, invoice_id, line_no, description, quantity, unit_price, net_amount, tax_code_id, tax_amount, account_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
      [orgId, invoiceId, n++, l.description, fmtQty(l.qty4), formatMoney(l.unitMinor), formatMoney(l.net), l.taxCodeId, formatMoney(l.tax), l.accountId])).rows[0];
    for (const p of l.parts) await q.query("INSERT INTO finance_invoice_taxes (org_id, invoice_id, line_id, component, rate, amount, account_id) VALUES ($1,$2,$3,$4,$5,$6,$7)", [orgId, invoiceId, r.id, p.component, p.rate, formatMoney(p.amount), p.accountId]);
  }
}

export function paymentStatus(i: { status: string; total: unknown; amount_paid: unknown; due_date: unknown }, today: string): string {
  if (i.status !== "issued" && i.status !== "posted") return i.status;
  const total = fromDb(i.total); const paid = fromDb(i.amount_paid);
  if (paid >= total) return "paid";
  if (ymd(i.due_date) < today) return paid > 0n ? "partially_paid_overdue" : "overdue";
  return paid > 0n ? "partially_paid" : i.status;
}

async function load(q: Q, orgId: number, id: string | number, lock = false) {
  const i = (await q.query<any>(`SELECT ${ICOLS} FROM finance_invoices WHERE id = $1 AND org_id = $2${lock ? " FOR UPDATE" : ""}`, [id, orgId])).rows[0];
  if (!i) throw notFound("Invoice");
  return i;
}
async function detail(c: Ctx, i: any) {
  const org = (await c.q.query<any>("SELECT timezone FROM finance_organisations WHERE id = $1", [c.org.orgId])).rows[0];
  const lines = (await c.q.query<any>("SELECT l.id, l.line_no, l.description, l.quantity, l.unit_price, l.net_amount, l.tax_code_id, t.code AS tax_code, l.tax_amount, l.account_id, a.code AS account_code, a.name AS account_name FROM finance_invoice_lines l JOIN finance_accounts a ON a.id = l.account_id AND a.org_id = l.org_id LEFT JOIN finance_tax_codes t ON t.id = l.tax_code_id AND t.org_id = l.org_id WHERE l.invoice_id = $1 AND l.org_id = $2 ORDER BY l.line_no", [i.id, c.org.orgId])).rows;
  const taxes = (await c.q.query<any>("SELECT component, rate, SUM(amount) AS amount FROM finance_invoice_taxes WHERE invoice_id = $1 AND org_id = $2 GROUP BY component, rate ORDER BY component", [i.id, c.org.orgId])).rows;
  const allocations = (await c.q.query<any>("SELECT a.amount, p.number, p.payment_date, p.method, p.reference FROM finance_payment_allocations a JOIN finance_payments p ON p.id = a.payment_id AND p.org_id = a.org_id WHERE a.invoice_id = $1 AND a.org_id = $2 ORDER BY p.payment_date, p.id", [i.id, c.org.orgId])).rows;
  const customer = (await c.q.query<any>("SELECT id, code, name, email, tax_id, payment_terms_days, credit_limit FROM finance_customers WHERE id = $1 AND org_id = $2", [i.customer_id, c.org.orgId])).rows[0];
  return { ...i, payment_status: paymentStatus(i, todayIn(org.timezone, c.now)), outstanding: formatMoney(fromDb(i.total) - fromDb(i.amount_paid)), lines, taxes, allocations, customer };
}

const list = route("GET", "/invoices", { perm: "finance:read" }, async (c) => {
  const org = (await c.q.query<any>("SELECT timezone FROM finance_organisations WHERE id = $1", [c.org.orgId])).rows[0]; const today = todayIn(org.timezone, c.now);
  const p: unknown[] = [c.org.orgId]; const w = ["i.org_id = $1"]; const add = (sql: string, v: unknown) => { p.push(v); w.push(sql.replace("?", `$${p.length}`)); };
  const st = qstr(c.query.status); const cust = qstr(c.query.customer_id); const s = qstr(c.query.q); const overdue = qstr(c.query.overdue);
  if (st) add("i.status = ?", st); if (cust) add("i.customer_id = ?", Number(cust));
  if (s) { p.push(`%${s.toLowerCase()}%`); w.push(`(lower(COALESCE(i.number,'')) LIKE $${p.length} OR lower(c.name) LIKE $${p.length} OR lower(COALESCE(i.reference,'')) LIKE $${p.length})`); }
  if (overdue === "true") { p.push(today); w.push(`i.status = 'issued' AND i.amount_paid < i.total AND i.due_date < $${p.length}::date`); }
  const limit = Math.min(200, Math.max(1, Number(qstr(c.query.limit)) || 50)); const offset = Math.max(0, Number(qstr(c.query.offset)) || 0);
  const total = Number((await c.q.query<any>(`SELECT count(*)::int AS n FROM finance_invoices i JOIN finance_customers c ON c.id = i.customer_id AND c.org_id = i.org_id WHERE ${w.join(" AND ")}`, p)).rows[0].n);
  const rows = (await c.q.query<any>(`SELECT ${ICOLS.split(", ").map((x) => "i." + x).join(", ")}, c.name AS customer_name FROM finance_invoices i JOIN finance_customers c ON c.id = i.customer_id AND c.org_id = i.org_id WHERE ${w.join(" AND ")} ORDER BY i.invoice_date DESC, i.id DESC LIMIT ${limit} OFFSET ${offset}`, p)).rows;
  return ok({ items: rows.map((r: any) => ({ ...r, payment_status: paymentStatus(r, today), outstanding: formatMoney(fromDb(r.total) - fromDb(r.amount_paid)) })), total, limit, offset });
});

const getOne = route("GET", "/invoices/:id", { perm: "finance:read" }, async (c) => ok({ invoice: await detail(c, await load(c.q, c.org.orgId, c.params.id!)) }));

async function header(c: Ctx, b: Record<string, any>, existing?: any) {
  const v = new V(b);
  const customerId = v.int("customer_id", { min: 1, optional: Boolean(existing) }) ?? existing?.customer_id; const date = v.date("invoice_date", Boolean(existing)) ?? ymd(existing?.invoice_date);
  const due = v.date("due_date", true); const ref = v.str("reference", { optional: true, max: 120 }); const notes = v.str("notes", { optional: true, max: 1000 }); const cur = v.str("currency", { optional: true, pattern: /^[A-Za-z]{3}$/ });
  v.done();
  if (cur && cur.toUpperCase() !== c.org.functionalCurrency) throw unprocessable(`Only ${c.org.functionalCurrency} (the functional currency) is supported for invoices right now; foreign-currency documents arrive with the multi-currency phase.`, "currency_not_supported");
  const cust = (await c.q.query<any>("SELECT id, is_active, payment_terms_days FROM finance_customers WHERE id = $1 AND org_id = $2", [customerId, c.org.orgId])).rows[0];
  if (!cust || !cust.is_active) throw unprocessable("Customer not found or inactive", "invalid_customer");
  return { customerId: Number(cust.id), date, due: due ?? addDays(date, Number(cust.payment_terms_days)), ref, notes };
}

const create = route("POST", "/invoices", { perm: "invoices:manage" }, async (c) => {
  const b = asObject(c.body); const h = await header(c, b); const built = await buildLines(c.q, c.org.orgId, b.lines, h.date, "sales");
  const i = (await c.q.query<any>(`INSERT INTO finance_invoices (org_id, customer_id, invoice_date, due_date, currency, reference, notes, subtotal, tax_total, total, created_by, created_by_label) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${ICOLS}`,
    [c.org.orgId, h.customerId, h.date, h.due, c.org.functionalCurrency, h.ref ?? null, h.notes ?? null, formatMoney(built.subtotal), formatMoney(built.tax), formatMoney(built.total), c.actor.sub, c.actor.label])).rows[0];
  await saveLines(c.q, c.org.orgId, Number(i.id), built.lines);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "invoice.create", entityType: "invoice", entityId: i.id, summary: `Draft invoice for customer ${h.customerId}, total ${formatMoney(built.total)}`, after: i, requestId: c.reqId });
  return ok({ invoice: await detail(c, i) }, 201);
});

const update = route("PATCH", "/invoices/:id", { perm: "invoices:manage" }, async (c) => {
  const i = await load(c.q, c.org.orgId, c.params.id!, true);
  if (i.status !== "draft") throw conflict(`Only draft invoices can be edited (this one is ${i.status})`, "invoice_not_editable");
  const b = asObject(c.body); const h = await header(c, b, i); const before = await detail(c, i);
  const built = await buildLines(c.q, c.org.orgId, b.lines ?? before.lines.map((l: any) => ({ description: l.description, quantity: l.quantity, unit_price: l.unit_price, tax_code_id: l.tax_code_id ?? undefined, account_id: l.account_id })), h.date, "sales");
  await c.q.query("DELETE FROM finance_invoice_taxes WHERE invoice_id = $1 AND org_id = $2", [i.id, c.org.orgId]); await c.q.query("DELETE FROM finance_invoice_lines WHERE invoice_id = $1 AND org_id = $2", [i.id, c.org.orgId]);
  const after = (await c.q.query<any>(`UPDATE finance_invoices SET customer_id = $3, invoice_date = $4, due_date = $5, reference = $6, notes = $7, subtotal = $8, tax_total = $9, total = $10, updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING ${ICOLS}`,
    [i.id, c.org.orgId, h.customerId, h.date, h.due, h.ref ?? i.reference, h.notes ?? i.notes, formatMoney(built.subtotal), formatMoney(built.tax), formatMoney(built.total)])).rows[0];
  await saveLines(c.q, c.org.orgId, Number(i.id), built.lines);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "invoice.update", entityType: "invoice", entityId: i.id, before, after, requestId: c.reqId });
  return ok({ invoice: await detail(c, after) });
});

const remove = route("DELETE", "/invoices/:id", { perm: "invoices:manage" }, async (c) => {
  const i = await load(c.q, c.org.orgId, c.params.id!, true);
  if (i.status !== "draft") throw conflict("Only draft invoices can be deleted; cancel an approved invoice instead", "invoice_not_deletable");
  await c.q.query("DELETE FROM finance_invoice_taxes WHERE invoice_id = $1 AND org_id = $2", [i.id, c.org.orgId]); await c.q.query("DELETE FROM finance_invoice_lines WHERE invoice_id = $1 AND org_id = $2", [i.id, c.org.orgId]); await c.q.query("DELETE FROM finance_invoices WHERE id = $1 AND org_id = $2", [i.id, c.org.orgId]);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "invoice.delete", entityType: "invoice", entityId: i.id, before: i, requestId: c.reqId });
  return ok({ deleted: true });
});

const approve = route("POST", "/invoices/:id/approve", { perm: "finance:approve" }, async (c) => {
  const i = await load(c.q, c.org.orgId, c.params.id!, true);
  if (i.status !== "draft") throw conflict(`Only draft invoices can be approved (this one is ${i.status})`, "invalid_status");
  const row = (await c.q.query<any>("SELECT created_by FROM finance_invoices WHERE id = $1 AND org_id = $2", [i.id, c.org.orgId])).rows[0];
  if (row.created_by === c.actor.sub && c.org.settings?.allow_self_approval !== true) throw forbidden("Separation of duties: you cannot approve an invoice you created", "separation_of_duties");
  const after = (await c.q.query<any>(`UPDATE finance_invoices SET status = 'approved', approved_by = $3, approved_by_label = $4, approved_at = $5, updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING ${ICOLS}`, [i.id, c.org.orgId, c.actor.sub, c.actor.label, c.now.toISOString()])).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "invoice.approve", entityType: "invoice", entityId: i.id, before: { status: "draft" }, after: { status: "approved" }, requestId: c.reqId });
  return ok({ invoice: await detail(c, after) });
});

/** Issue: assigns the gapless number and posts Dr Receivables / Cr Revenue / Cr Tax payable. Revenue is recognised on issue (the only policy supported today). */
const issue = route("POST", "/invoices/:id/issue", { perm: "invoices:manage" }, async (c) => {
  const i = await load(c.q, c.org.orgId, c.params.id!, true);
  if (i.status === "issued") throw conflict("This invoice has already been issued", "already_issued");
  if (!(i.status === "approved" || (i.status === "draft" && !docApprovalRequired(c)))) throw conflict(i.status === "draft" ? "This invoice needs approval before it can be issued" : `A ${i.status} invoice cannot be issued`, i.status === "draft" ? "approval_required" : "invalid_status");
  const cust = (await c.q.query<any>("SELECT name, credit_limit, is_active FROM finance_customers WHERE id = $1 AND org_id = $2", [i.customer_id, c.org.orgId])).rows[0];
  if (!cust.is_active) throw unprocessable("The customer is inactive", "invalid_customer");
  if (cust.credit_limit !== null) {
    const out = fromDb((await c.q.query<any>("SELECT COALESCE(SUM(total - amount_paid),0) AS o FROM finance_invoices WHERE org_id = $1 AND customer_id = $2 AND status = 'issued'", [c.org.orgId, i.customer_id])).rows[0].o);
    if (out + fromDb(i.total) > fromDb(cust.credit_limit)) throw unprocessable(`Issuing this invoice would exceed ${cust.name}'s credit limit`, "credit_limit_exceeded", { outstanding: formatMoney(out), invoice_total: i.total, credit_limit: cust.credit_limit });
  }
  const ar = await controlAccount(c.q, c.org.orgId, "accounts_receivable");
  const lines = (await c.q.query<any>("SELECT account_id, net_amount FROM finance_invoice_lines WHERE invoice_id = $1 AND org_id = $2", [i.id, c.org.orgId])).rows;
  const taxes = (await c.q.query<any>("SELECT account_id, SUM(amount) AS amount FROM finance_invoice_taxes WHERE invoice_id = $1 AND org_id = $2 GROUP BY account_id", [i.id, c.org.orgId])).rows;
  const rev = new Map<number, bigint>(); for (const l of lines) rev.set(Number(l.account_id), (rev.get(Number(l.account_id)) ?? 0n) + fromDb(l.net_amount));
  const number = `INV-${ymd(i.invoice_date).slice(0, 4)}-${String(await nextNumber(c.q, c.org.orgId, `invoice:${ymd(i.invoice_date).slice(0, 4)}`)).padStart(6, "0")}`;
  const j = await postDocument(c, { date: ymd(i.invoice_date), description: `Sales invoice ${number} - ${cust.name}`, sourceModule: "finance.invoice", sourceRef: String(i.id),
    lines: [{ account_id: ar, debit: fromDb(i.total) }, ...[...rev].map(([account_id, amt]) => ({ account_id, credit: amt })), ...taxes.filter((t: any) => fromDb(t.amount) > 0n).map((t: any) => ({ account_id: Number(t.account_id), credit: fromDb(t.amount) }))] });
  const after = (await c.q.query<any>(`UPDATE finance_invoices SET status = 'issued', number = $3, journal_id = $4, issued_by = $5, issued_at = $6, updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING ${ICOLS}`, [i.id, c.org.orgId, number, j.id, c.actor.sub, c.now.toISOString()])).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "invoice.issue", entityType: "invoice", entityId: i.id, summary: `Issued ${number} (${j.reference}), total ${i.total}`, before: { status: i.status }, after: { status: "issued", number, journal: j.reference }, requestId: c.reqId });
  return ok({ invoice: await detail(c, after), journal: j.reference });
});

const cancel = route("POST", "/invoices/:id/cancel", { perm: "invoices:manage" }, async (c) => {
  const v = new V(asObject(c.body)); const reason = v.str("reason", { min: 3, max: 300 }); v.done();
  const i = await load(c.q, c.org.orgId, c.params.id!, true);
  if (!["draft", "approved"].includes(i.status)) throw conflict(i.status === "issued" ? "An issued invoice cannot be cancelled; raise a credit note instead" : `A ${i.status} invoice cannot be cancelled`, "invalid_status");
  const after = (await c.q.query<any>(`UPDATE finance_invoices SET status = 'cancelled', cancelled_by = $3, cancelled_at = $4, cancel_reason = $5, updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING ${ICOLS}`, [i.id, c.org.orgId, c.actor.sub, c.now.toISOString(), reason])).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "invoice.cancel", entityType: "invoice", entityId: i.id, summary: reason, before: { status: i.status }, after: { status: "cancelled" }, requestId: c.reqId });
  return ok({ invoice: await detail(c, after) });
});

/** Shared by the invoice shortcut and the multi-invoice receipt endpoint. Dr Bank / Cr Receivables, allocated to specific invoices. */
export async function recordReceipt(c: Ctx, a: { customerId: number; date: string; bankAccountId: number; method: string; reference?: string; notes?: string; allocations: Array<{ invoiceId: number; amount: bigint }> }) {
  if (!a.allocations.length) throw unprocessable("Allocate the receipt to at least one invoice", "allocation_required");
  const amount = a.allocations.reduce((s, x) => s + x.amount, 0n);
  if (amount <= 0n || a.allocations.some((x) => x.amount <= 0n)) throw unprocessable("Allocation amounts must be greater than zero", "validation_failed");
  if (new Set(a.allocations.map((x) => x.invoiceId)).size !== a.allocations.length) throw unprocessable("Each invoice can appear only once per receipt", "validation_failed");
  await assertBankAccount(c.q, c.org.orgId, a.bankAccountId);
  const invs = new Map<number, any>();
  for (const al of [...a.allocations].sort((x, y) => x.invoiceId - y.invoiceId)) { // fixed lock order avoids deadlocks
    const i = (await c.q.query<any>("SELECT id, number, customer_id, status, total, amount_paid, invoice_date FROM finance_invoices WHERE id = $1 AND org_id = $2 FOR UPDATE", [al.invoiceId, c.org.orgId])).rows[0];
    if (!i || Number(i.customer_id) !== a.customerId) throw unprocessable(`Invoice ${al.invoiceId} does not belong to this customer`, "invalid_invoice");
    if (i.status !== "issued") throw unprocessable(`Invoice ${i.number ?? i.id} is ${i.status}; only issued invoices can receive payments`, "invalid_invoice");
    const out = fromDb(i.total) - fromDb(i.amount_paid);
    if (al.amount > out) throw unprocessable(`The amount applied to ${i.number} exceeds its outstanding balance of ${formatMoney(out)}`, "exceeds_outstanding", { invoice: i.number, outstanding: formatMoney(out) });
    invs.set(al.invoiceId, i);
  }
  const ar = await controlAccount(c.q, c.org.orgId, "accounts_receivable");
  const year = a.date.slice(0, 4); const number = `RCT-${year}-${String(await nextNumber(c.q, c.org.orgId, `receipt:${year}`)).padStart(6, "0")}`;
  const cust = (await c.q.query<any>("SELECT name FROM finance_customers WHERE id = $1 AND org_id = $2", [a.customerId, c.org.orgId])).rows[0];
  const j = await postDocument(c, { date: a.date, description: `Customer receipt ${number} - ${cust.name}`, sourceModule: "finance.receipt", sourceRef: number, lines: [{ account_id: a.bankAccountId, debit: amount }, { account_id: ar, credit: amount }] });
  const pay = (await c.q.query<any>("INSERT INTO finance_payments (org_id, direction, number, customer_id, payment_date, amount, bank_account_id, method, reference, notes, journal_id, created_by, created_by_label) VALUES ($1,'receipt',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, number, payment_date, amount, method, reference", [c.org.orgId, number, a.customerId, a.date, formatMoney(amount), a.bankAccountId, a.method, a.reference ?? null, a.notes ?? null, j.id, c.actor.sub, c.actor.label])).rows[0];
  for (const al of a.allocations) {
    await c.q.query("INSERT INTO finance_payment_allocations (org_id, payment_id, invoice_id, amount) VALUES ($1,$2,$3,$4)", [c.org.orgId, pay.id, al.invoiceId, formatMoney(al.amount)]);
    await c.q.query("UPDATE finance_invoices SET amount_paid = amount_paid + $3, updated_at = now() WHERE id = $1 AND org_id = $2", [al.invoiceId, c.org.orgId, formatMoney(al.amount)]);
  }
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "receipt.create", entityType: "payment", entityId: pay.id, summary: `Receipt ${number} ${formatMoney(amount)} (${j.reference})`, after: { ...pay, allocations: a.allocations.map((x) => ({ invoice_id: x.invoiceId, amount: formatMoney(x.amount) })) }, requestId: c.reqId });
  return { payment: pay, journal: j.reference };
}

const METHODS = ["bank_transfer", "cash", "cheque", "mobile_money", "card", "other"] as const;
const payInvoice = route("POST", "/invoices/:id/payments", { perm: "invoices:manage" }, async (c) => {
  const v = new V(asObject(c.body)); const amount = v.money("amount"); const date = v.date("payment_date"); const bank = v.int("bank_account_id", { min: 1 }); const method = v.str("method", { optional: true, oneOf: METHODS }) ?? "bank_transfer"; const ref = v.str("reference", { optional: true, max: 120 }); v.done();
  const i = await load(c.q, c.org.orgId, c.params.id!);
  const r = await recordReceipt(c, { customerId: Number(i.customer_id), date: date!, bankAccountId: bank!, method, reference: ref, allocations: [{ invoiceId: Number(i.id), amount: amount! }] });
  return ok({ ...r, invoice: await detail(c, await load(c.q, c.org.orgId, i.id)) }, 201);
});

const receipt = route("POST", "/receipts", { perm: "invoices:manage" }, async (c) => {
  const b = asObject(c.body); const v = new V(b); const cust = v.int("customer_id", { min: 1 }); const date = v.date("payment_date"); const bank = v.int("bank_account_id", { min: 1 }); const method = v.str("method", { optional: true, oneOf: METHODS }) ?? "bank_transfer"; const ref = v.str("reference", { optional: true, max: 120 }); v.done();
  if (!Array.isArray(b.allocations)) throw unprocessable("allocations must be a list of { invoice_id, amount }", "validation_failed");
  const allocations = b.allocations.map((x: any, n: number) => { const av = new V(asObject(x), `allocations[${n}].`); const invoiceId = av.int("invoice_id", { min: 1 }); const amount = av.money("amount"); av.done(); return { invoiceId: invoiceId!, amount: amount! }; });
  const r = await recordReceipt(c, { customerId: cust!, date: date!, bankAccountId: bank!, method, reference: ref, allocations });
  return ok(r, 201);
});

export const invoiceRoutes: Route[] = [list, getOne, create, update, remove, approve, issue, cancel, payInvoice, receipt];
export { METHODS };
