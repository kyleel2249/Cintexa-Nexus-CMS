import { route, ok, type Route, type Ctx } from "../core/route";
import { audit } from "../core/audit";
import { V, asObject, qstr, ymd } from "../core/validate";
import { conflict, forbidden, notFound, unprocessable } from "../core/errors";
import { formatMoney, fromDb } from "../core/money";
import { assertBankAccount, computeTax, controlAccount, docApprovalRequired, postDocument } from "./docs-common";
import { nextNumber } from "./journals";
import type { Q } from "../core/types";

const ECOLS = "e.id, e.number, e.expense_date, e.payee, e.description, e.reference, e.account_id, e.paid_from_account_id, e.tax_code_id, e.status, e.net_amount, e.tax_amount, e.recoverable_tax, e.total, e.journal_id, e.created_by_label, e.approved_by_label, e.approved_at, e.posted_at, e.cancel_reason, e.created_at, a.code AS account_code, a.name AS account_name, p.code AS paid_from_code, p.name AS paid_from_name, t.code AS tax_code";
const FROM = "finance_expenses e JOIN finance_accounts a ON a.id = e.account_id AND a.org_id = e.org_id JOIN finance_accounts p ON p.id = e.paid_from_account_id AND p.org_id = e.org_id LEFT JOIN finance_tax_codes t ON t.id = e.tax_code_id AND t.org_id = e.org_id";
async function load(q: Q, orgId: number, id: string | number, lock = false) {
  const x = (await q.query<any>(`SELECT ${ECOLS} FROM ${FROM} WHERE e.id = $1 AND e.org_id = $2${lock ? " FOR UPDATE OF e" : ""}`, [id, orgId])).rows[0];
  if (!x) throw notFound("Expense");
  return x;
}

const list = route("GET", "/expenses", { perm: "finance:read" }, async (c) => {
  const p: unknown[] = [c.org.orgId]; const w = ["e.org_id = $1"]; const st = qstr(c.query.status); const s = qstr(c.query.q);
  if (st) { p.push(st); w.push(`e.status = $${p.length}`); }
  if (s) { p.push(`%${s.toLowerCase()}%`); w.push(`(lower(e.payee) LIKE $${p.length} OR lower(e.description) LIKE $${p.length} OR lower(COALESCE(e.number,'')) LIKE $${p.length})`); }
  const limit = Math.min(200, Math.max(1, Number(qstr(c.query.limit)) || 50)); const offset = Math.max(0, Number(qstr(c.query.offset)) || 0);
  const total = Number((await c.q.query<any>(`SELECT count(*)::int AS n FROM finance_expenses e WHERE ${w.join(" AND ")}`, p)).rows[0].n);
  const items = (await c.q.query<any>(`SELECT ${ECOLS} FROM ${FROM} WHERE ${w.join(" AND ")} ORDER BY e.expense_date DESC, e.id DESC LIMIT ${limit} OFFSET ${offset}`, p)).rows;
  return ok({ items, total, limit, offset });
});
const getOne = route("GET", "/expenses/:id", { perm: "finance:read" }, async (c) => ok({ expense: await load(c.q, c.org.orgId, c.params.id!) }));

async function fields(c: Ctx, b: Record<string, any>) {
  const v = new V(b); const date = v.date("expense_date"); const payee = v.str("payee", { min: 2, max: 200 }); const desc = v.str("description", { min: 2, max: 500 }); const ref = v.str("reference", { optional: true, max: 120 });
  const accountId = v.int("account_id", { min: 1 }); const paidFrom = v.int("paid_from_account_id", { min: 1 }); const net = v.money("net_amount"); const taxId = v.int("tax_code_id", { optional: true, min: 1 }) ?? null; v.done();
  if (net! <= 0n) throw unprocessable("net_amount must be greater than zero", "validation_failed");
  const acct = (await c.q.query<any>("SELECT type, is_active, allow_posting, code FROM finance_accounts WHERE id = $1 AND org_id = $2", [accountId, c.org.orgId])).rows[0];
  if (!acct || !acct.is_active || !acct.allow_posting || !["expense", "asset"].includes(acct.type)) throw unprocessable("Choose an active expense (or asset) account for the category", "invalid_account");
  await assertBankAccount(c.q, c.org.orgId, paidFrom!);
  const parts = taxId ? await computeTax(c.q, c.org.orgId, taxId, net!, date!) : [];
  const tax = parts.reduce((s, x) => s + x.amount, 0n); const rec = parts.filter((x) => x.recoverable).reduce((s, x) => s + x.amount, 0n);
  return { date: date!, payee: payee!, desc: desc!, ref, accountId: accountId!, paidFrom: paidFrom!, taxId, net: net!, tax, rec, total: net! + tax };
}

const create = route("POST", "/expenses", { perm: "finance:create" }, async (c) => {
  const f = await fields(c, asObject(c.body));
  const r = (await c.q.query<any>("INSERT INTO finance_expenses (org_id, expense_date, payee, description, reference, account_id, paid_from_account_id, tax_code_id, net_amount, tax_amount, recoverable_tax, total, created_by, created_by_label) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id",
    [c.org.orgId, f.date, f.payee, f.desc, f.ref ?? null, f.accountId, f.paidFrom, f.taxId, formatMoney(f.net), formatMoney(f.tax), formatMoney(f.rec), formatMoney(f.total), c.actor.sub, c.actor.label])).rows[0];
  const x = await load(c.q, c.org.orgId, r.id);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "expense.create", entityType: "expense", entityId: x.id, summary: `Draft expense ${f.payee} ${formatMoney(f.total)}`, after: x, requestId: c.reqId });
  return ok({ expense: x }, 201);
});

const update = route("PATCH", "/expenses/:id", { perm: "finance:create" }, async (c) => {
  const cur = await load(c.q, c.org.orgId, c.params.id!, true);
  if (cur.status !== "draft") throw conflict(`Only draft expenses can be edited (this one is ${cur.status})`, "expense_not_editable");
  const own = (await c.q.query<any>("SELECT created_by FROM finance_expenses WHERE id = $1 AND org_id = $2", [cur.id, c.org.orgId])).rows[0];
  if (own.created_by !== c.actor.sub) throw forbidden("Only the person who entered an expense can edit it", "not_owner");
  const f = await fields(c, { ...cur, expense_date: ymd(cur.expense_date), net_amount: cur.net_amount, tax_code_id: cur.tax_code_id ?? undefined, ...asObject(c.body) });
  await c.q.query("UPDATE finance_expenses SET expense_date=$3, payee=$4, description=$5, reference=$6, account_id=$7, paid_from_account_id=$8, tax_code_id=$9, net_amount=$10, tax_amount=$11, recoverable_tax=$12, total=$13, updated_at=now() WHERE id=$1 AND org_id=$2",
    [cur.id, c.org.orgId, f.date, f.payee, f.desc, f.ref ?? cur.reference, f.accountId, f.paidFrom, f.taxId, formatMoney(f.net), formatMoney(f.tax), formatMoney(f.rec), formatMoney(f.total)]);
  const after = await load(c.q, c.org.orgId, cur.id);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "expense.update", entityType: "expense", entityId: cur.id, before: cur, after, requestId: c.reqId });
  return ok({ expense: after });
});

const remove = route("DELETE", "/expenses/:id", { perm: "finance:create" }, async (c) => {
  const x = await load(c.q, c.org.orgId, c.params.id!, true);
  if (x.status !== "draft") throw conflict("Only draft expenses can be deleted; cancel an approved one instead", "expense_not_deletable");
  await c.q.query("DELETE FROM finance_expenses WHERE id = $1 AND org_id = $2", [x.id, c.org.orgId]);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "expense.delete", entityType: "expense", entityId: x.id, before: x, requestId: c.reqId });
  return ok({ deleted: true });
});

const approve = route("POST", "/expenses/:id/approve", { perm: "expenses:approve" }, async (c) => {
  const x = await load(c.q, c.org.orgId, c.params.id!, true);
  if (x.status !== "draft") throw conflict(`Only draft expenses can be approved (this one is ${x.status})`, "invalid_status");
  const own = (await c.q.query<any>("SELECT created_by FROM finance_expenses WHERE id = $1 AND org_id = $2", [x.id, c.org.orgId])).rows[0];
  if (own.created_by === c.actor.sub && c.org.settings?.allow_self_approval !== true) throw forbidden("Separation of duties: you cannot approve an expense you entered", "separation_of_duties");
  await c.q.query("UPDATE finance_expenses SET status = 'approved', approved_by = $3, approved_by_label = $4, approved_at = $5, updated_at = now() WHERE id = $1 AND org_id = $2", [x.id, c.org.orgId, c.actor.sub, c.actor.label, c.now.toISOString()]);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "expense.approve", entityType: "expense", entityId: x.id, before: { status: "draft" }, after: { status: "approved" }, requestId: c.reqId });
  return ok({ expense: await load(c.q, c.org.orgId, x.id) });
});

/** Post: Dr expense (+ non-recoverable tax), Dr input tax, Cr the cash/bank account the money left from. */
const post = route("POST", "/expenses/:id/post", { perm: "finance:post" }, async (c) => {
  const x = await load(c.q, c.org.orgId, c.params.id!, true);
  if (x.status === "posted") throw conflict("This expense has already been posted", "already_posted");
  if (!(x.status === "approved" || (x.status === "draft" && !docApprovalRequired(c)))) throw conflict(x.status === "draft" ? "This expense needs approval before it can be posted" : `A ${x.status} expense cannot be posted`, x.status === "draft" ? "approval_required" : "invalid_status");
  const net = fromDb(x.net_amount); const rec = fromDb(x.recoverable_tax); const nonRec = fromDb(x.tax_amount) - rec;
  const inputTax = rec > 0n ? await controlAccount(c.q, c.org.orgId, "tax_recoverable") : 0;
  const year = ymd(x.expense_date).slice(0, 4); const number = `EXP-${year}-${String(await nextNumber(c.q, c.org.orgId, `expense:${year}`)).padStart(6, "0")}`;
  const j = await postDocument(c, { date: ymd(x.expense_date), description: `Expense ${number} - ${x.payee}: ${x.description}`, sourceModule: "finance.expense", sourceRef: String(x.id),
    lines: [{ account_id: Number(x.account_id), debit: net + nonRec }, ...(rec > 0n ? [{ account_id: inputTax, debit: rec }] : []), { account_id: Number(x.paid_from_account_id), credit: fromDb(x.total) }] });
  await c.q.query("UPDATE finance_expenses SET status = 'posted', number = $3, journal_id = $4, posted_by = $5, posted_at = $6, updated_at = now() WHERE id = $1 AND org_id = $2", [x.id, c.org.orgId, number, j.id, c.actor.sub, c.now.toISOString()]);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "expense.post", entityType: "expense", entityId: x.id, summary: `Posted ${number} (${j.reference}), ${x.total}`, before: { status: x.status }, after: { status: "posted", number, journal: j.reference }, requestId: c.reqId });
  return ok({ expense: await load(c.q, c.org.orgId, x.id), journal: j.reference });
});

const cancel = route("POST", "/expenses/:id/cancel", { perm: "finance:create" }, async (c) => {
  const v = new V(asObject(c.body)); const reason = v.str("reason", { min: 3, max: 300 }); v.done();
  const x = await load(c.q, c.org.orgId, c.params.id!, true);
  if (!["draft", "approved"].includes(x.status)) throw conflict(x.status === "posted" ? "A posted expense cannot be cancelled; reverse its journal instead" : `A ${x.status} expense cannot be cancelled`, "invalid_status");
  await c.q.query("UPDATE finance_expenses SET status = 'cancelled', cancelled_by = $3, cancelled_at = $4, cancel_reason = $5, updated_at = now() WHERE id = $1 AND org_id = $2", [x.id, c.org.orgId, c.actor.sub, c.now.toISOString(), reason]);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "expense.cancel", entityType: "expense", entityId: x.id, summary: reason, requestId: c.reqId });
  return ok({ expense: await load(c.q, c.org.orgId, x.id) });
});

const analysis = route("GET", "/expenses/analysis/by-category", { perm: "ledger:read" }, async (c) => {
  const from = qstr(c.query.from) ?? "1900-01-01"; const to = qstr(c.query.to) ?? "9999-12-31";
  const rows = (await c.q.query<any>("SELECT a.code, a.name, count(*)::int AS n, SUM(e.net_amount + (e.tax_amount - e.recoverable_tax)) AS cost FROM finance_expenses e JOIN finance_accounts a ON a.id = e.account_id AND a.org_id = e.org_id WHERE e.org_id = $1 AND e.status = 'posted' AND e.expense_date BETWEEN $2::date AND $3::date GROUP BY a.code, a.name ORDER BY cost DESC", [c.org.orgId, from, to])).rows;
  const total = rows.reduce((s: bigint, r: any) => s + fromDb(r.cost), 0n);
  return ok({ items: rows.map((r: any) => ({ ...r, share_pct: total > 0n ? Number(fromDb(r.cost) * 10000n / total) / 100 : 0 })), total: formatMoney(total) });
});

export const expenseRoutes: Route[] = [list, analysis, getOne, create, update, remove, approve, post, cancel];
