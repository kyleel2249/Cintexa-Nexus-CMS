import { route, ok, type Route } from "../core/route";
import { audit } from "../core/audit";
import { V, asObject, ymd } from "../core/validate";
import { conflict, unprocessable } from "../core/errors";
import type { Q } from "../core/types";

/**
 * Ghana standard-rated structure effective 1 Jan 2026 (VAT 15% + NHIL 2.5% + GETFund 2.5% = 20% combined), seeded as DATA - not code.
 * It is configuration the organisation owns: confirm rates, recoverability and effective dates with GRA / your tax adviser and edit as legislation changes.
 */
export async function seedGhanaTax(q: Q, orgId: number): Promise<void> {
  const acct = async (sub: string) => Number((await q.query<any>("SELECT id FROM finance_accounts WHERE org_id = $1 AND subtype = $2 ORDER BY code LIMIT 1", [orgId, sub])).rows[0]?.id ?? 0);
  const vat = await acct("vat_payable"); const nhil = await acct("nhil_payable"); const gf = await acct("getfund_payable");
  if (!vat || !nhil || !gf) throw unprocessable("The chart of accounts needs VAT, NHIL and GETFund payable accounts before Ghana tax can be seeded", "tax_accounts_missing");
  const ins = async (code: string, name: string, kind: string) => Number((await q.query<any>("INSERT INTO finance_tax_codes (org_id, code, name, kind) VALUES ($1,$2,$3,$4) ON CONFLICT (org_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id", [orgId, code, name, kind])).rows[0].id);
  const std = await ins("STD", "Standard rated (VAT + NHIL + GETFund)", "standard"); await ins("ZERO", "Zero-rated", "zero_rated"); await ins("EXEMPT", "Exempt", "exempt");
  const note = "Seeded for the Ghana standard-rated structure effective 1 Jan 2026 - verify with GRA / your tax adviser";
  for (const [comp, rate, account, rec] of [["VAT", "15.0000", vat, true], ["NHIL", "2.5000", nhil, false], ["GETFUND", "2.5000", gf, false]] as const)
    await q.query("INSERT INTO finance_tax_rates (org_id, tax_code_id, component, rate, effective_from, payable_account_id, recoverable, note) VALUES ($1,$2,$3,$4,'2026-01-01',$5,$6,$7) ON CONFLICT (org_id, tax_code_id, component, effective_from) DO NOTHING", [orgId, std, comp, rate, account, rec, note]);
}

const list = route("GET", "/tax-codes", { perm: "finance:read" }, async (c) => {
  const codes = (await c.q.query<any>("SELECT id, code, name, kind, is_active FROM finance_tax_codes WHERE org_id = $1 ORDER BY code", [c.org.orgId])).rows;
  const rates = (await c.q.query<any>("SELECT r.id, r.tax_code_id, r.component, r.rate, r.effective_from, r.effective_to, r.recoverable, r.note, a.code AS account_code, a.name AS account_name FROM finance_tax_rates r JOIN finance_accounts a ON a.id = r.payable_account_id AND a.org_id = r.org_id WHERE r.org_id = $1 ORDER BY r.tax_code_id, r.component, r.effective_from", [c.org.orgId])).rows;
  return ok({ items: codes.map((t: any) => ({ ...t, rates: rates.filter((r: any) => r.tax_code_id === t.id) })) });
});

const seed = route("POST", "/tax-codes/seed-ghana", { perm: "tax:manage" }, async (c) => {
  await seedGhanaTax(c.q, c.org.orgId);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "tax.seed", entityType: "tax_code", summary: "Seeded Ghana tax codes (effective 2026-01-01)", requestId: c.reqId });
  return ok({ seeded: true });
});

const addRate = route("POST", "/tax-rates", { perm: "tax:manage" }, async (c) => {
  const v = new V(asObject(c.body));
  const codeId = v.int("tax_code_id", { min: 1 }); const component = v.str("component", { max: 20, pattern: /^[A-Za-z0-9_]+$/ }); const rate = v.str("rate", { pattern: /^\d{1,3}(\.\d{1,4})?$/ });
  const from = v.date("effective_from"); const to = v.date("effective_to", true); const accountId = v.int("payable_account_id", { min: 1 }); const rec = v.bool("recoverable"); const note = v.str("note", { optional: true, max: 300 });
  v.done();
  if (Number(rate) > 100) throw unprocessable("rate cannot exceed 100", "validation_failed");
  if (to && to < from!) throw unprocessable("effective_to cannot be before effective_from", "validation_failed");
  const comp = component!.toUpperCase();
  const overlap = (await c.q.query("SELECT 1 FROM finance_tax_rates WHERE org_id = $1 AND tax_code_id = $2 AND component = $3 AND effective_from <= COALESCE($5::date, '9999-12-31'::date) AND COALESCE(effective_to, '9999-12-31'::date) >= $4::date", [c.org.orgId, codeId, comp, from, to ?? null])).rowCount;
  if (overlap) throw conflict("That rate overlaps an existing effective-dated rate for the same component. End the old rate first.", "rate_overlap");
  const r = (await c.q.query<any>("INSERT INTO finance_tax_rates (org_id, tax_code_id, component, rate, effective_from, effective_to, payable_account_id, recoverable, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, component, rate, effective_from, effective_to, recoverable", [c.org.orgId, codeId, comp, rate, from, to ?? null, accountId, rec ?? false, note ?? null])).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "tax.rate.add", entityType: "tax_rate", entityId: r.id, summary: `${comp} ${rate}% from ${from}`, after: r, requestId: c.reqId });
  return ok({ rate: r }, 201);
});

const endRate = route("PATCH", "/tax-rates/:id", { perm: "tax:manage" }, async (c) => {
  const v = new V(asObject(c.body)); const to = v.date("effective_to"); v.done();
  const before = (await c.q.query<any>("SELECT id, component, effective_from, effective_to FROM finance_tax_rates WHERE id = $1 AND org_id = $2 FOR UPDATE", [c.params.id, c.org.orgId])).rows[0];
  if (!before) throw unprocessable("Rate not found", "not_found");
  if (to! < ymd(before.effective_from)) throw unprocessable("effective_to cannot be before effective_from", "validation_failed");
  // documents already dated inside the window keep the tax they were computed with (stored on the document); this only affects new documents
  await c.q.query("UPDATE finance_tax_rates SET effective_to = $3 WHERE id = $1 AND org_id = $2", [before.id, c.org.orgId, to]);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "tax.rate.end", entityType: "tax_rate", entityId: before.id, before, after: { effective_to: to }, requestId: c.reqId });
  return ok({ ended: true });
});

export const taxRoutes: Route[] = [list, seed, addRate, endRate];
