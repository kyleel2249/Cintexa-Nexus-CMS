import { route, ok, type Route, type Ctx } from "../core/route";
import { qstr, todayIn, ymd } from "../core/validate";
import { badRequest, notFound } from "../core/errors";
import { formatMoney, fromDb } from "../core/money";

const BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
const bucketOf = (days: number) => (days <= 0 ? "current" : days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "d90_plus") as (typeof BUCKETS)[number];
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86_400_000);

async function ageing(c: Ctx, kind: "customer" | "supplier") {
  const org = (await c.q.query<any>("SELECT timezone FROM finance_organisations WHERE id = $1", [c.org.orgId])).rows[0];
  const asOf = qstr(c.query.as_of) ?? todayIn(org.timezone, c.now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw badRequest("as_of must be YYYY-MM-DD");
  const [docT, partyT, partyCol, dateCol, status, ctlSub, side] = kind === "customer" ? ["finance_invoices", "finance_customers", "customer_id", "invoice_date", "issued", "accounts_receivable", "debit"] : ["finance_bills", "finance_suppliers", "supplier_id", "bill_date", "posted", "accounts_payable", "credit"];
  const allocCol = kind === "customer" ? "invoice_id" : "bill_id";
  // outstanding AS AT the date: total less allocations from payments dated on/before it
  const rows = (await c.q.query<any>(
    `SELECT d.id, d.number, d.${partyCol} AS party_id, p.name AS party_name, d.due_date, d.total, COALESCE(SUM(a.amount) FILTER (WHERE pay.payment_date <= $2::date), 0) AS paid
       FROM ${docT} d JOIN ${partyT} p ON p.id = d.${partyCol} AND p.org_id = d.org_id
       LEFT JOIN finance_payment_allocations a ON a.${allocCol} = d.id AND a.org_id = d.org_id LEFT JOIN finance_payments pay ON pay.id = a.payment_id AND pay.org_id = a.org_id
      WHERE d.org_id = $1 AND d.status = '${status}' AND d.${dateCol} <= $2::date GROUP BY d.id, d.number, d.${partyCol}, p.name, d.due_date, d.total ORDER BY p.name, d.due_date`, [c.org.orgId, asOf])).rows;
  const parties = new Map<number, any>(); const totals: Record<string, bigint> = { current: 0n, d1_30: 0n, d31_60: 0n, d61_90: 0n, d90_plus: 0n, total: 0n };
  for (const r of rows) {
    const out = fromDb(r.total) - fromDb(r.paid); if (out <= 0n) continue;
    const b = bucketOf(dayDiff(asOf, ymd(r.due_date)));
    const p = parties.get(Number(r.party_id)) ?? { party_id: Number(r.party_id), party_name: r.party_name, current: 0n, d1_30: 0n, d31_60: 0n, d61_90: 0n, d90_plus: 0n, total: 0n, documents: [] as any[] };
    p[b] += out; p.total += out; totals[b]! += out; totals.total! += out;
    p.documents.push({ id: Number(r.id), number: r.number, due_date: ymd(r.due_date), days_past_due: Math.max(0, dayDiff(asOf, ymd(r.due_date))), outstanding: formatMoney(out), bucket: b });
    parties.set(Number(r.party_id), p);
  }
  const fmt = (o: any) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "bigint" ? formatMoney(v) : v]));
  // the sub-ledger must agree with the general-ledger control account; a difference means someone posted manually to the control account
  const ctl = (await c.q.query<any>(`SELECT COALESCE(SUM(e.debit),0) AS d, COALESCE(SUM(e.credit),0) AS c FROM finance_ledger_entries e JOIN finance_accounts a ON a.id = e.account_id AND a.org_id = e.org_id WHERE e.org_id = $1 AND a.subtype = '${ctlSub}' AND e.entry_date <= $2::date`, [c.org.orgId, asOf])).rows[0];
  const control = side === "debit" ? fromDb(ctl.d) - fromDb(ctl.c) : fromDb(ctl.c) - fromDb(ctl.d);
  return { as_of: asOf, currency: c.org.functionalCurrency, buckets: BUCKETS, items: [...parties.values()].map(fmt), totals: fmt(totals), control_account_balance: formatMoney(control), difference: formatMoney(control - totals.total!), reconciled: control === totals.total };
}
const receivables = route("GET", "/receivables/ageing", { perm: "ledger:read" }, async (c) => ok(await ageing(c, "customer")));
const payables = route("GET", "/payables/ageing", { perm: "ledger:read" }, async (c) => ok(await ageing(c, "supplier")));

async function statement(c: Ctx, kind: "customer" | "supplier") {
  const [partyT, docT, dateCol, status, partyCol] = kind === "customer" ? ["finance_customers", "finance_invoices", "invoice_date", "issued", "customer_id"] : ["finance_suppliers", "finance_bills", "bill_date", "posted", "supplier_id"];
  const party = (await c.q.query<any>(`SELECT id, code, name FROM ${partyT} WHERE id = $1 AND org_id = $2`, [c.params.id, c.org.orgId])).rows[0];
  if (!party) throw notFound(kind === "customer" ? "Customer" : "Supplier");
  const from = qstr(c.query.from) ?? "1900-01-01"; const to = qstr(c.query.to) ?? "9999-12-31";
  const docs = (await c.q.query<any>(`SELECT ${dateCol} AS date, number, total AS amount, 'document' AS kind FROM ${docT} WHERE org_id = $1 AND ${partyCol} = $2 AND status = '${status}' AND ${dateCol} <= $3::date`, [c.org.orgId, party.id, to])).rows;
  const pays = (await c.q.query<any>(`SELECT payment_date AS date, number, amount, 'payment' AS kind FROM finance_payments WHERE org_id = $1 AND ${partyCol} = $2 AND payment_date <= $3::date`, [c.org.orgId, party.id, to])).rows;
  const all = [...docs, ...pays].map((r: any) => ({ date: ymd(r.date), number: r.number, kind: r.kind, amount: fromDb(r.amount) })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === "document" ? -1 : 1));
  let bal = 0n; let opening = 0n; const lines: any[] = [];
  for (const r of all) { const delta = r.kind === "document" ? r.amount : -r.amount; if (r.date < from) { opening += delta; bal += delta; continue; } bal += delta; lines.push({ date: r.date, number: r.number, type: r.kind === "document" ? (kind === "customer" ? "Invoice" : "Bill") : kind === "customer" ? "Receipt" : "Payment", charges: r.kind === "document" ? formatMoney(r.amount) : "0.00", payments: r.kind === "payment" ? formatMoney(r.amount) : "0.00", balance: formatMoney(bal) }); }
  return { party, from: from === "1900-01-01" ? null : from, to: to === "9999-12-31" ? null : to, opening_balance: formatMoney(opening), closing_balance: formatMoney(bal), lines };
}
const custStatement = route("GET", "/customers/:id/statement", { perm: "finance:read" }, async (c) => ok(await statement(c, "customer")));
const supStatement = route("GET", "/suppliers/:id/statement", { perm: "finance:read" }, async (c) => ok(await statement(c, "supplier")));

const payments = route("GET", "/payments", { perm: "finance:read" }, async (c) => {
  const dir = qstr(c.query.direction); const p: unknown[] = [c.org.orgId]; let w = "p.org_id = $1"; if (dir === "receipt" || dir === "payment") { p.push(dir); w += ` AND p.direction = $${p.length}`; }
  const limit = Math.min(200, Math.max(1, Number(qstr(c.query.limit)) || 50)); const offset = Math.max(0, Number(qstr(c.query.offset)) || 0);
  const total = Number((await c.q.query<any>(`SELECT count(*)::int AS n FROM finance_payments p WHERE ${w}`, p)).rows[0].n);
  const items = (await c.q.query<any>(`SELECT p.id, p.direction, p.number, p.payment_date, p.amount, p.method, p.reference, COALESCE(cu.name, su.name) AS party_name, a.code AS bank_code, a.name AS bank_name, j.reference AS journal_reference
    FROM finance_payments p LEFT JOIN finance_customers cu ON cu.id = p.customer_id AND cu.org_id = p.org_id LEFT JOIN finance_suppliers su ON su.id = p.supplier_id AND su.org_id = p.org_id
    JOIN finance_accounts a ON a.id = p.bank_account_id AND a.org_id = p.org_id JOIN finance_journals j ON j.id = p.journal_id AND j.org_id = p.org_id WHERE ${w} ORDER BY p.payment_date DESC, p.id DESC LIMIT ${limit} OFFSET ${offset}`, p)).rows;
  return ok({ items, total, limit, offset });
});

export const ageingRoutes: Route[] = [receivables, payables, custStatement, supStatement, payments];
