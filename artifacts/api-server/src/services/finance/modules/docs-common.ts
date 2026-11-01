import type { Ctx } from "../core/route";
import { audit } from "../core/audit";
import { HttpError, unprocessable } from "../core/errors";
import { formatMoney, fromDb } from "../core/money";
import { asObject, V, ymd } from "../core/validate";
import { hasPermission } from "../core/rbac";
import { insertJournal, loadPeriod, assertPostable, normaliseLines, postJournal, type Who } from "./journals";
import type { Q } from "../core/types";

/** integer division rounding half away from zero */
export const roundDiv = (n: bigint, d: bigint): bigint => { const neg = (n < 0n) !== (d < 0n); const a = n < 0n ? -n : n; const b = d < 0n ? -d : d; const q = (a * 2n + b) / (b * 2n); return neg ? -q : q; };

/** quantity as a 4-decimal scaled integer */
export function parseQty(v: unknown): bigint | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!/^\d{1,12}(\.\d{1,4})?$/.test(s)) return null;
  const [i, f = ""] = s.split("."); const n = BigInt(i + f.padEnd(4, "0"));
  return n > 0n ? n : null;
}
export const fmtQty = (q4: bigint): string => `${q4 / 10000n}.${String(q4 % 10000n).padStart(4, "0")}`;

export interface TaxPart { component: string; rate: string; amount: bigint; accountId: number; recoverable: boolean }
export interface BuiltLine { description: string; qty4: bigint; unitMinor: bigint; net: bigint; taxCodeId: number | null; tax: bigint; recoverableTax: bigint; accountId: number; parts: TaxPart[] }

/** Effective-dated tax: every component whose [effective_from, effective_to] window contains the document date applies. */
export async function computeTax(q: Q, orgId: number, taxCodeId: number, net: bigint, date: string): Promise<TaxPart[]> {
  const code = (await q.query<any>("SELECT id, code, kind, is_active FROM finance_tax_codes WHERE id = $1 AND org_id = $2", [taxCodeId, orgId])).rows[0];
  if (!code || !code.is_active) throw unprocessable("Unknown or inactive tax code", "invalid_tax_code");
  if (code.kind === "zero_rated" || code.kind === "exempt") return [];
  const rates = (await q.query<any>("SELECT component, rate, payable_account_id, recoverable FROM finance_tax_rates WHERE org_id = $1 AND tax_code_id = $2 AND effective_from <= $3::date AND (effective_to IS NULL OR effective_to >= $3::date) ORDER BY component", [orgId, taxCodeId, date])).rows;
  if (!rates.length) throw unprocessable(`Tax code ${code.code} has no rate in effect on ${date}. Add an effective-dated rate under Tax Configuration.`, "no_tax_rate_in_effect");
  return rates.map((r: any) => {
    const [ri, rf = ""] = String(r.rate).split("."); const rate4 = BigInt(ri + rf.padEnd(4, "0").slice(0, 4)); // percent scaled by 10^4
    return { component: r.component, rate: String(r.rate), amount: roundDiv(net * rate4, 1_000_000n), accountId: Number(r.payable_account_id), recoverable: Boolean(r.recoverable) };
  });
}

export async function buildLines(q: Q, orgId: number, raw: unknown, date: string, kind: "sales" | "purchase"): Promise<{ lines: BuiltLine[]; subtotal: bigint; tax: bigint; total: bigint }> {
  if (!Array.isArray(raw) || raw.length < 1) throw new HttpError(422, "validation_failed", "At least one line is required", { issues: [{ path: "lines", message: "At least one line is required" }] });
  if (raw.length > 200) throw unprocessable("At most 200 lines are allowed", "too_many_lines");
  const issues: { path: string; message: string }[] = []; const out: BuiltLine[] = [];
  const defaultAcct = kind === "sales" ? (await q.query<any>("SELECT id FROM finance_accounts WHERE org_id = $1 AND subtype = 'sales' AND is_active ORDER BY code LIMIT 1", [orgId])).rows[0]?.id : undefined;
  for (let i = 0; i < raw.length; i++) {
    const src = asObject(raw[i]); const v = new V(src, `lines[${i}].`);
    const description = v.str("description", { min: 1, max: 300 }); const qty4 = parseQty(src.quantity ?? "1"); const unit = v.money("unit_price");
    if (qty4 === null) issues.push({ path: `lines[${i}].quantity`, message: "quantity must be greater than zero (max 4 decimals)" });
    let taxCodeId = v.int("tax_code_id", { optional: true, min: 1 }) ?? null;
    const taxCode = v.str("tax_code", { optional: true, max: 20 });
    let accountId = v.int("account_id", { optional: true, min: 1 }) ?? (defaultAcct ? Number(defaultAcct) : undefined);
    issues.push(...v.issues);
    if (!taxCodeId && taxCode) { const t = (await q.query<any>("SELECT id FROM finance_tax_codes WHERE org_id = $1 AND code = $2", [orgId, taxCode])).rows[0]; if (!t) issues.push({ path: `lines[${i}].tax_code`, message: `Unknown tax code ${taxCode}` }); else taxCodeId = Number(t.id); }
    if (!accountId) issues.push({ path: `lines[${i}].account_id`, message: "account_id is required" });
    if (issues.length || qty4 === null || unit === undefined || !accountId || !description) continue;
    const acct = (await q.query<any>("SELECT type, is_active, allow_posting, code FROM finance_accounts WHERE id = $1 AND org_id = $2", [accountId, orgId])).rows[0];
    if (!acct || !acct.is_active || !acct.allow_posting) { issues.push({ path: `lines[${i}].account_id`, message: "Account not found, inactive or not postable" }); continue; }
    if (kind === "sales" && acct.type !== "revenue") { issues.push({ path: `lines[${i}].account_id`, message: `Account ${acct.code} is not a revenue account` }); continue; }
    if (kind === "purchase" && !["expense", "asset"].includes(acct.type)) { issues.push({ path: `lines[${i}].account_id`, message: `Account ${acct.code} must be an expense or asset account` }); continue; }
    const net = roundDiv(qty4 * unit, 10000n);
    const parts = taxCodeId ? await computeTax(q, orgId, taxCodeId, net, date) : [];
    const tax = parts.reduce((s, p) => s + p.amount, 0n); const rec = parts.filter((p) => p.recoverable).reduce((s, p) => s + p.amount, 0n);
    out.push({ description, qty4, unitMinor: unit, net, taxCodeId, tax, recoverableTax: rec, accountId, parts });
  }
  if (issues.length) throw new HttpError(422, "validation_failed", `${issues.length} fields are invalid`, { issues });
  const subtotal = out.reduce((s, l) => s + l.net, 0n); const tax = out.reduce((s, l) => s + l.tax, 0n);
  if (subtotal + tax <= 0n) throw unprocessable("The document total must be greater than zero", "zero_total");
  return { lines: out, subtotal, tax, total: subtotal + tax };
}

/** the control account for a subtype (e.g. accounts_receivable) */
export async function controlAccount(q: Q, orgId: number, subtype: string): Promise<number> {
  const a = (await q.query<any>("SELECT id FROM finance_accounts WHERE org_id = $1 AND subtype = $2 AND is_active AND allow_posting ORDER BY code LIMIT 1", [orgId, subtype])).rows[0];
  if (!a) throw unprocessable(`No active ${subtype.replace(/_/g, " ")} account is configured in the chart of accounts`, "control_account_missing");
  return Number(a.id);
}
export async function assertBankAccount(q: Q, orgId: number, id: number): Promise<void> {
  const a = (await q.query<any>("SELECT subtype, is_active, allow_posting FROM finance_accounts WHERE id = $1 AND org_id = $2", [id, orgId])).rows[0];
  if (!a || !a.is_active || !a.allow_posting || !["cash", "bank", "mobile_money"].includes(a.subtype)) throw unprocessable("bank_account_id must be an active cash, bank or mobile-money account", "invalid_bank_account");
}

export interface Posting { type?: string; date: string; description: string; sourceModule: string; sourceRef: string; lines: Array<{ account_id: number; debit?: bigint; credit?: bigint; description?: string }> }
/** Creates and posts the automated journal for a business document. Idempotent per (source_module, source_ref). */
export async function postDocument(c: Ctx, p: Posting): Promise<any> {
  const who: Who = { orgId: c.org.orgId, sub: c.actor.sub, label: c.actor.label };
  const existing = (await c.q.query<any>("SELECT id, reference, status FROM finance_journals WHERE org_id = $1 AND source_module = $2 AND source_ref = $3 AND journal_type <> 'reversal'", [who.orgId, p.sourceModule, p.sourceRef])).rows[0];
  if (existing) throw new HttpError(409, "already_posted", `${p.sourceModule} ${p.sourceRef} has already been posted (${existing.reference})`);
  const { lines } = await normaliseLines(c.q, who.orgId, p.lines.map((l) => ({ account_id: l.account_id, description: l.description, debit: formatMoney(l.debit ?? 0n), credit: formatMoney(l.credit ?? 0n) })));
  const can = hasPermission(c.org.role, "period:override");
  const period = await loadPeriod(c.q, who.orgId, p.date); assertPostable(period, can);
  const j = await insertJournal(c.q, who, { type: p.type ?? "automated", date: p.date, description: p.description, lines, sourceModule: p.sourceModule, sourceRef: p.sourceRef }, period);
  const posted = await postJournal(c.q, who, Number(j.id), c.now, can);
  await audit(c.q, { orgId: who.orgId, actorId: who.sub, actorLabel: who.label, action: "journal.post", entityType: "journal", entityId: posted.id, summary: `Posted ${posted.reference} for ${p.sourceModule} ${p.sourceRef}`, requestId: c.reqId, sourceModule: p.sourceModule });
  return posted;
}

export const docApprovalRequired = (c: Ctx) => c.org.settings?.document_approval_required !== false;
export const money = (v: unknown) => fromDb(v);
export { ymd };
