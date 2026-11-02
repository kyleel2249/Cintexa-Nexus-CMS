/** Financial Intelligence Phase 6 - investors, share classes, shareholdings, contributions. */
import { route, ok, type Route } from "../core/route";
import { audit } from "../core/audit";
import { V, asObject, qstr, todayIn } from "../core/validate";
import { badRequest, conflict, notFound } from "../core/errors";
import { formatMoney, fromDb } from "../core/money";
import { nextNumber } from "./journals";

const INV = "id, code, name, investor_type, email, phone, tax_id, address, notes, is_active, created_by, created_at, updated_at";
const CLS = "id, code, name, class_type, par_value, authorized_shares, voting_rights, notes, is_active, created_at, updated_at";
const HLD = "id, investor_id, share_class_id, shares, issued_on, certificate_number, consideration, notes, created_by, created_at, updated_at";
const CNT = "id, investor_id, contribution_date, amount, currency, form, description, journal_id, shareholding_id, status, notes, created_by, created_at, updated_at";
const pctShares = (n: bigint, d: bigint): string | null => { if (d === 0n) return null; const x = (n * 10000n * 2n + (n < 0n ? -d : d)) / (d * 2n); const neg = x < 0n; const a = neg ? -x : x; return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`; };
const parseShares = (v: unknown): string | null => { if (typeof v === "number" && Number.isFinite(v) && v > 0) return String(Math.round(v * 10000) / 10000); if (typeof v === "string" && /^\d+(\.\d{1,4})?$/.test(v.trim()) && Number(v) > 0) return v.trim(); return null; };
const toMinor4 = (v: unknown): bigint => { const s = String(v ?? "0"); const [i, f = ""] = s.split("."); return BigInt((i || "0") + f.padEnd(4, "0").slice(0, 4)); };
const fromMinor4 = (m: bigint): string => { const neg = m < 0n; const a = neg ? -m : m; const str = a.toString().padStart(5, "0"); const whole = str.slice(0, -4); const frac = str.slice(-4).replace(/0+$/, ""); return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`; };

const listInvestors = route("GET", "/investors", { perm: "ledger:read" }, async (c) => {
  const p: unknown[] = [c.org.orgId]; const w = ["org_id = $1"]; const s = qstr(c.query.q); const a = qstr(c.query.active);
  if (s) { p.push(`%${s.toLowerCase()}%`); w.push(`(lower(name) LIKE $${p.length} OR lower(code) LIKE $${p.length} OR lower(COALESCE(email,'')) LIKE $${p.length})`); }
  if (a === "true" || a === "false") { p.push(a === "true"); w.push(`is_active = $${p.length}`); }
  const limit = Math.min(500, Math.max(1, Number(qstr(c.query.limit)) || 100)); const offset = Math.max(0, Number(qstr(c.query.offset)) || 0);
  const total = Number((await c.q.query<any>(`SELECT count(*)::int AS n FROM finance_investors WHERE ${w.join(" AND ")}`, p)).rows[0].n);
  const items = (await c.q.query<any>(`SELECT ${INV} FROM finance_investors WHERE ${w.join(" AND ")} ORDER BY name LIMIT ${limit} OFFSET ${offset}`, p)).rows;
  return ok({ items, total, limit, offset });
});
const getInvestor = route("GET", "/investors/:id", { perm: "ledger:read" }, async (c) => {
  const r = (await c.q.query<any>(`SELECT ${INV} FROM finance_investors WHERE id = $1 AND org_id = $2`, [c.params.id, c.org.orgId])).rows[0];
  if (!r) throw notFound("Investor");
  const holdings = (await c.q.query<any>(`SELECT h.id, h.shares, h.issued_on, h.certificate_number, h.consideration, sc.id AS share_class_id, sc.code AS class_code, sc.name AS class_name, sc.class_type FROM finance_shareholdings h JOIN finance_share_classes sc ON sc.id = h.share_class_id AND sc.org_id = h.org_id WHERE h.org_id = $1 AND h.investor_id = $2 ORDER BY h.issued_on, h.id`, [c.org.orgId, r.id])).rows;
  const contributions = (await c.q.query<any>(`SELECT ${CNT} FROM finance_capital_contributions WHERE org_id = $1 AND investor_id = $2 AND status <> 'void' ORDER BY contribution_date DESC, id DESC`, [c.org.orgId, r.id])).rows;
  const contribTotal = contributions.reduce((s: bigint, x: any) => s + fromDb(x.amount), 0n);
  return ok({ investor: r, shareholdings: holdings, contributions: contributions.map((x: any) => ({ ...x, amount: formatMoney(fromDb(x.amount)) })), contribution_total: formatMoney(contribTotal) });
});
const createInvestor = route("POST", "/investors", { perm: "finance:create" }, async (c) => {
  const b = asObject(c.body); const v = new V(b);
  const name = v.str("name", { min: 1, max: 200 });
  const investor_type = v.str("investor_type", { optional: true, oneOf: ["individual","company","fund","other"] }) ?? "individual";
  const email = v.str("email", { optional: true, max: 200 }); const phone = v.str("phone", { optional: true, max: 50 });
  const tax_id = v.str("tax_id", { optional: true, max: 80 }); const notes = v.str("notes", { optional: true, max: 2000 });
  const codeIn = v.str("code", { optional: true, max: 40 }); v.done();
  const code = codeIn ?? `INV-${String(await nextNumber(c.q, c.org.orgId, "investor")).padStart(4, "0")}`;
  try {
    const r = (await c.q.query<any>(`INSERT INTO finance_investors (org_id, code, name, investor_type, email, phone, tax_id, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${INV}`, [c.org.orgId, code, name, investor_type, email ?? null, phone ?? null, tax_id ?? null, notes ?? null, c.actor.sub])).rows[0];
    await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "investor.create", entityType: "finance_investor", entityId: r.id, summary: `Investor ${r.code} ${r.name}`, after: r, requestId: c.reqId });
    return ok({ investor: r }, 201);
  } catch (e: any) { if (e?.code === "23505") throw conflict("Investor code already exists", "duplicate_code"); throw e; }
});
const patchInvestor = route("PATCH", "/investors/:id", { perm: "finance:update" }, async (c) => {
  const before = (await c.q.query<any>(`SELECT ${INV} FROM finance_investors WHERE id = $1 AND org_id = $2`, [c.params.id, c.org.orgId])).rows[0];
  if (!before) throw notFound("Investor");
  const b = asObject(c.body); const v = new V(b);
  const name = v.str("name", { optional: true, min: 1, max: 200 });
  const investor_type = v.str("investor_type", { optional: true, oneOf: ["individual","company","fund","other"] });
  const email = v.str("email", { optional: true, max: 200 }); const phone = v.str("phone", { optional: true, max: 50 });
  const tax_id = v.str("tax_id", { optional: true, max: 80 }); const notes = v.str("notes", { optional: true, max: 2000 }); const is_active = v.bool("is_active"); v.done();
  const r = (await c.q.query<any>(`UPDATE finance_investors SET name = COALESCE($3,name), investor_type = COALESCE($4,investor_type), email = COALESCE($5,email), phone = COALESCE($6,phone), tax_id = COALESCE($7,tax_id), notes = COALESCE($8,notes), is_active = COALESCE($9,is_active), updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING ${INV}`, [c.params.id, c.org.orgId, name ?? null, investor_type ?? null, email ?? null, phone ?? null, tax_id ?? null, notes ?? null, is_active ?? null])).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "investor.update", entityType: "finance_investor", entityId: r.id, before, after: r, requestId: c.reqId });
  return ok({ investor: r });
});
const listClasses = route("GET", "/share-classes", { perm: "ledger:read" }, async (c) => {
  const active = qstr(c.query.active); const w = ["org_id = $1"]; const p: unknown[] = [c.org.orgId];
  if (active === "true" || active === "false") { p.push(active === "true"); w.push(`is_active = $${p.length}`); }
  return ok({ items: (await c.q.query<any>(`SELECT ${CLS} FROM finance_share_classes WHERE ${w.join(" AND ")} ORDER BY code`, p)).rows });
});
const createClass = route("POST", "/share-classes", { perm: "finance:create" }, async (c) => {
  const b = asObject(c.body); const v = new V(b);
  const name = v.str("name", { min: 1, max: 200 });
  const class_type = v.str("class_type", { optional: true, oneOf: ["ordinary","preference","other"] }) ?? "ordinary";
  const codeIn = v.str("code", { optional: true, max: 40 }); const voting_rights = v.bool("voting_rights") ?? true;
  const notes = v.str("notes", { optional: true, max: 2000 }); v.done();
  const code = codeIn ?? `CLS-${String(await nextNumber(c.q, c.org.orgId, "share_class")).padStart(3, "0")}`;
  let par_value: string | null = null; let authorized_shares: string | null = null;
  if (b.par_value != null) { const pv = parseShares(b.par_value); if (!pv) throw badRequest("par_value must be positive"); par_value = pv; }
  if (b.authorized_shares != null) { const as = parseShares(b.authorized_shares); if (!as) throw badRequest("authorized_shares must be positive"); authorized_shares = as; }
  try {
    const r = (await c.q.query<any>(`INSERT INTO finance_share_classes (org_id, code, name, class_type, par_value, authorized_shares, voting_rights, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${CLS}`, [c.org.orgId, code, name, class_type, par_value, authorized_shares, voting_rights, notes ?? null])).rows[0];
    await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "share_class.create", entityType: "finance_share_class", entityId: r.id, summary: `Share class ${r.code}`, after: r, requestId: c.reqId });
    return ok({ share_class: r }, 201);
  } catch (e: any) { if (e?.code === "23505") throw conflict("Share class code already exists", "duplicate_code"); throw e; }
});
const patchClass = route("PATCH", "/share-classes/:id", { perm: "finance:update" }, async (c) => {
  const before = (await c.q.query<any>(`SELECT ${CLS} FROM finance_share_classes WHERE id = $1 AND org_id = $2`, [c.params.id, c.org.orgId])).rows[0];
  if (!before) throw notFound("Share class");
  const b = asObject(c.body); const v = new V(b);
  const name = v.str("name", { optional: true, min: 1, max: 200 });
  const class_type = v.str("class_type", { optional: true, oneOf: ["ordinary","preference","other"] });
  const voting_rights = v.bool("voting_rights"); const notes = v.str("notes", { optional: true, max: 2000 }); const is_active = v.bool("is_active"); v.done();
  const r = (await c.q.query<any>(`UPDATE finance_share_classes SET name = COALESCE($3,name), class_type = COALESCE($4,class_type), voting_rights = COALESCE($5,voting_rights), notes = COALESCE($6,notes), is_active = COALESCE($7,is_active), updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING ${CLS}`, [c.params.id, c.org.orgId, name ?? null, class_type ?? null, voting_rights ?? null, notes ?? null, is_active ?? null])).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "share_class.update", entityType: "finance_share_class", entityId: r.id, before, after: r, requestId: c.reqId });
  return ok({ share_class: r });
});
const listHoldings = route("GET", "/shareholdings", { perm: "ledger:read" }, async (c) => {
  const investorId = qstr(c.query.investor_id); const classId = qstr(c.query.share_class_id);
  const p: unknown[] = [c.org.orgId]; const w = ["h.org_id = $1"];
  if (investorId) { p.push(Number(investorId)); w.push(`h.investor_id = $${p.length}`); }
  if (classId) { p.push(Number(classId)); w.push(`h.share_class_id = $${p.length}`); }
  const items = (await c.q.query<any>(`SELECT h.id, h.investor_id, h.share_class_id, h.shares, h.issued_on, h.certificate_number, h.consideration, h.notes, h.created_at, i.code AS investor_code, i.name AS investor_name, sc.code AS class_code, sc.name AS class_name, sc.class_type FROM finance_shareholdings h JOIN finance_investors i ON i.id = h.investor_id AND i.org_id = h.org_id JOIN finance_share_classes sc ON sc.id = h.share_class_id AND sc.org_id = h.org_id WHERE ${w.join(" AND ")} ORDER BY h.issued_on, h.id`, p)).rows;
  return ok({ items });
});
const createHolding = route("POST", "/shareholdings", { perm: "finance:create" }, async (c) => {
  const b = asObject(c.body); const v = new V(b);
  const investor_id = v.int("investor_id", { min: 1 }); const share_class_id = v.int("share_class_id", { min: 1 });
  const issued_on = v.date("issued_on");
  const consideration = v.str("consideration", { optional: true, oneOf: ["cash","asset","services","bonus","transfer","other"] }) ?? "cash";
  const certificate_number = v.str("certificate_number", { optional: true, max: 80 }); const notes = v.str("notes", { optional: true, max: 2000 }); v.done();
  const shares = parseShares(b.shares); if (!shares) throw badRequest("shares must be a positive number (up to 4 decimals)");
  if (!(await c.q.query<any>(`SELECT id FROM finance_investors WHERE id = $1 AND org_id = $2`, [investor_id, c.org.orgId])).rows[0]) throw notFound("Investor");
  const cls = (await c.q.query<any>(`SELECT id, authorized_shares FROM finance_share_classes WHERE id = $1 AND org_id = $2`, [share_class_id, c.org.orgId])).rows[0];
  if (!cls) throw notFound("Share class");
  if (cls.authorized_shares != null) {
    const issued = (await c.q.query<any>(`SELECT COALESCE(SUM(shares),0) AS n FROM finance_shareholdings WHERE org_id = $1 AND share_class_id = $2`, [c.org.orgId, share_class_id])).rows[0];
    if (Number(issued.n) + Number(shares) > Number(cls.authorized_shares)) throw conflict(`Issuing ${shares} would exceed authorized shares (${cls.authorized_shares})`, "authorized_exceeded");
  }
  const r = (await c.q.query<any>(`INSERT INTO finance_shareholdings (org_id, investor_id, share_class_id, shares, issued_on, certificate_number, consideration, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${HLD}`, [c.org.orgId, investor_id, share_class_id, shares, issued_on, certificate_number ?? null, consideration, notes ?? null, c.actor.sub])).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "shareholding.create", entityType: "finance_shareholding", entityId: r.id, summary: `Issued ${shares} shares to investor ${investor_id}`, after: r, requestId: c.reqId });
  return ok({ shareholding: r }, 201);
});
const capTable = route("GET", "/cap-table", { perm: "ledger:read" }, async (c) => {
  const rows = (await c.q.query<any>(`SELECT h.investor_id, i.code AS investor_code, i.name AS investor_name, i.investor_type, i.is_active, h.share_class_id, sc.code AS class_code, sc.name AS class_name, sc.class_type, sc.voting_rights, SUM(h.shares) AS shares FROM finance_shareholdings h JOIN finance_investors i ON i.id = h.investor_id AND i.org_id = h.org_id JOIN finance_share_classes sc ON sc.id = h.share_class_id AND sc.org_id = h.org_id WHERE h.org_id = $1 GROUP BY h.investor_id, i.code, i.name, i.investor_type, i.is_active, h.share_class_id, sc.code, sc.name, sc.class_type, sc.voting_rights ORDER BY sc.code, i.name`, [c.org.orgId])).rows;
  const classTotals = new Map<number, bigint>();
  for (const r of rows) { const id = Number(r.share_class_id); classTotals.set(id, (classTotals.get(id) ?? 0n) + toMinor4(r.shares)); }
  const grand = [...classTotals.values()].reduce((a, b) => a + b, 0n);
  const holdings = rows.map((r: any) => { const sharesMinor = toMinor4(r.shares); const classTotal = classTotals.get(Number(r.share_class_id)) ?? 0n; return { investor_id: Number(r.investor_id), investor_code: r.investor_code, investor_name: r.investor_name, investor_type: r.investor_type, is_active: r.is_active, share_class_id: Number(r.share_class_id), class_code: r.class_code, class_name: r.class_name, class_type: r.class_type, voting_rights: r.voting_rights, shares: fromMinor4(sharesMinor), ownership_pct_of_class: pctShares(sharesMinor, classTotal), ownership_pct_of_total: pctShares(sharesMinor, grand) }; });
  const classes = (await c.q.query<any>(`SELECT sc.id, sc.code, sc.name, sc.class_type, sc.authorized_shares, sc.voting_rights, COALESCE((SELECT SUM(h.shares) FROM finance_shareholdings h WHERE h.org_id = sc.org_id AND h.share_class_id = sc.id), 0) AS issued_shares FROM finance_share_classes sc WHERE sc.org_id = $1 AND sc.is_active = TRUE ORDER BY sc.code`, [c.org.orgId])).rows.map((r: any) => ({ id: Number(r.id), code: r.code, name: r.name, class_type: r.class_type, authorized_shares: r.authorized_shares != null ? String(r.authorized_shares) : null, issued_shares: String(r.issued_shares), voting_rights: r.voting_rights }));
  return ok({ has_shareholdings: holdings.length > 0, total_shares_issued: fromMinor4(grand), classes, holdings, note: "Ownership percentages are derived solely from recorded shareholdings." });
});
const listContributions = route("GET", "/contributions", { perm: "ledger:read" }, async (c) => {
  const investorId = qstr(c.query.investor_id); const p: unknown[] = [c.org.orgId]; const w = ["c.org_id = $1", "c.status <> 'void'"];
  if (investorId) { p.push(Number(investorId)); w.push(`c.investor_id = $${p.length}`); }
  const items = (await c.q.query<any>(`SELECT c.id, c.investor_id, c.contribution_date, c.amount, c.currency, c.form, c.description, c.journal_id, c.shareholding_id, c.status, c.notes, c.created_at, i.code AS investor_code, i.name AS investor_name FROM finance_capital_contributions c JOIN finance_investors i ON i.id = c.investor_id AND i.org_id = c.org_id WHERE ${w.join(" AND ")} ORDER BY c.contribution_date DESC, c.id DESC`, p)).rows.map((r: any) => ({ ...r, amount: formatMoney(fromDb(r.amount)) }));
  return ok({ items });
});
const createContribution = route("POST", "/contributions", { perm: "finance:create" }, async (c) => {
  const b = asObject(c.body); const v = new V(b);
  const investor_id = v.int("investor_id", { min: 1 }); const contribution_date = v.date("contribution_date");
  const amountMinor = v.money("amount"); const form = v.str("form", { optional: true, oneOf: ["cash","asset","services","other"] }) ?? "cash";
  const description = v.str("description", { optional: true, max: 500 }); const notes = v.str("notes", { optional: true, max: 2000 });
  const shareholding_id = v.int("shareholding_id", { optional: true, min: 1 }); const journal_id = v.int("journal_id", { optional: true, min: 1 });
  const currencyIn = v.str("currency", { optional: true, min: 3, max: 3 }); v.done();
  if (amountMinor == null || amountMinor <= 0n) throw badRequest("amount must be positive");
  const org = (await c.q.query<any>(`SELECT functional_currency FROM finance_organisations WHERE id = $1`, [c.org.orgId])).rows[0];
  const currency = currencyIn ?? org?.functional_currency ?? "GHS";
  if (!(await c.q.query<any>(`SELECT id FROM finance_investors WHERE id = $1 AND org_id = $2`, [investor_id, c.org.orgId])).rows[0]) throw notFound("Investor");
  if (shareholding_id && !(await c.q.query<any>(`SELECT id FROM finance_shareholdings WHERE id = $1 AND org_id = $2 AND investor_id = $3`, [shareholding_id, c.org.orgId, investor_id])).rows[0]) throw notFound("Shareholding");
  if (journal_id && !(await c.q.query<any>(`SELECT id FROM finance_journals WHERE id = $1 AND org_id = $2 AND status = 'posted'`, [journal_id, c.org.orgId])).rows[0]) throw notFound("Posted journal");
  const status = journal_id || shareholding_id ? "linked" : "recorded";
  const r = (await c.q.query<any>(`INSERT INTO finance_capital_contributions (org_id, investor_id, contribution_date, amount, currency, form, description, journal_id, shareholding_id, status, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${CNT}`, [c.org.orgId, investor_id, contribution_date, formatMoney(amountMinor), currency, form, description ?? null, journal_id ?? null, shareholding_id ?? null, status, notes ?? null, c.actor.sub])).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "contribution.create", entityType: "finance_capital_contribution", entityId: r.id, summary: `Contribution ${formatMoney(amountMinor)} ${currency}`, after: r, requestId: c.reqId });
  return ok({ contribution: { ...r, amount: formatMoney(fromDb(r.amount)) } }, 201);
});
const voidContribution = route("POST", "/contributions/:id/void", { perm: "finance:update" }, async (c) => {
  const r = (await c.q.query<any>(`UPDATE finance_capital_contributions SET status = 'void', updated_at = now() WHERE id = $1 AND org_id = $2 AND status <> 'void' RETURNING ${CNT}`, [c.params.id, c.org.orgId])).rows[0];
  if (!r) throw notFound("Contribution");
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "contribution.void", entityType: "finance_capital_contribution", entityId: r.id, summary: "Contribution voided", after: r, requestId: c.reqId });
  return ok({ contribution: { ...r, amount: formatMoney(fromDb(r.amount)) } });
});
const capitalSummary = route("GET", "/capital/summary", { perm: "ledger:read" }, async (c) => {
  const investors = Number((await c.q.query<any>(`SELECT count(*)::int AS n FROM finance_investors WHERE org_id = $1 AND is_active = TRUE`, [c.org.orgId])).rows[0].n);
  const classes = Number((await c.q.query<any>(`SELECT count(*)::int AS n FROM finance_share_classes WHERE org_id = $1 AND is_active = TRUE`, [c.org.orgId])).rows[0].n);
  const holdings = Number((await c.q.query<any>(`SELECT count(*)::int AS n FROM finance_shareholdings WHERE org_id = $1`, [c.org.orgId])).rows[0].n);
  const contrib = (await c.q.query<any>(`SELECT COALESCE(SUM(amount),0) AS total, count(*)::int AS n FROM finance_capital_contributions WHERE org_id = $1 AND status <> 'void'`, [c.org.orgId])).rows[0];
  const org = (await c.q.query<any>(`SELECT timezone, functional_currency FROM finance_organisations WHERE id = $1`, [c.org.orgId])).rows[0];
  const today = todayIn(org.timezone, c.now);
  const equity = (await c.q.query<any>(`SELECT COALESCE(SUM(e.credit - e.debit),0) AS bal FROM finance_ledger_entries e JOIN finance_accounts a ON a.id = e.account_id AND a.org_id = e.org_id WHERE e.org_id = $1 AND e.entry_date <= $2::date AND a.type = 'equity'`, [c.org.orgId, today])).rows[0];
  return ok({ currency: org.functional_currency, as_of: today, active_investors: investors, share_classes: classes, shareholding_records: holdings, contribution_count: Number(contrib.n), contribution_total: formatMoney(fromDb(contrib.total)), ledger_equity: formatMoney(fromDb(equity.bal)), has_cap_table: holdings > 0, note: "Ledger equity is accounting balance only. Ownership exists only where shareholdings are recorded." });
});
export const capitalRoutes: Route[] = [
  listInvestors, getInvestor, createInvestor, patchInvestor,
  listClasses, createClass, patchClass,
  listHoldings, createHolding, capTable,
  listContributions, createContribution, voidContribution,
  capitalSummary,
];
