import { route, ok, type Route } from "../core/route";
import { audit } from "../core/audit";
import { V, asObject, qstr } from "../core/validate";
import { conflict, notFound, unprocessable } from "../core/errors";
import { fromDb, formatMoney } from "../core/money";

const COLS = "id, code, name, type, category, subtype, parent_id, normal_balance, currency, allow_posting, is_active, is_system, fs_mapping, description, created_at, updated_at";
const TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;

const list = route("GET", "/accounts", { perm: "finance:read" }, async (c) => {
  const type = qstr(c.query.type); const search = qstr(c.query.q); const active = qstr(c.query.active);
  const where = ["org_id = $1"]; const p: unknown[] = [c.org.orgId];
  if (type) { p.push(type); where.push(`type = $${p.length}`); }
  if (active === "true" || active === "false") { p.push(active === "true"); where.push(`is_active = $${p.length}`); }
  if (search) { p.push(`%${search.toLowerCase()}%`); where.push(`(lower(name) LIKE $${p.length} OR code LIKE $${p.length})`); }
  const rows = (await c.q.query<any>(`SELECT ${COLS} FROM finance_accounts WHERE ${where.join(" AND ")} ORDER BY code`, p)).rows;
  return ok({ items: rows });
});

const getOne = route("GET", "/accounts/:id", { perm: "finance:read" }, async (c) => {
  const a = (await c.q.query<any>(`SELECT ${COLS} FROM finance_accounts WHERE id = $1 AND org_id = $2`, [c.params.id, c.org.orgId])).rows[0];
  if (!a) throw notFound("Account");
  const t = (await c.q.query<any>("SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c FROM finance_ledger_entries WHERE org_id = $1 AND account_id = $2", [c.org.orgId, a.id])).rows[0];
  const net = fromDb(t.d) - fromDb(t.c);
  const bal = a.normal_balance === "debit" ? net : -net;
  return ok({ account: a, balance: formatMoney(bal) });
});

const create = route("POST", "/accounts", { perm: "finance:update" }, async (c) => {
  const v = new V(asObject(c.body));
  const code = v.str("code", { max: 20, pattern: /^[A-Za-z0-9._-]+$/ });
  const name = v.str("name", { min: 2, max: 160 });
  const type = v.str("type", { oneOf: TYPES });
  const category = v.str("category", { max: 60 });
  const subtype = v.str("subtype", { optional: true, max: 60 });
  const parentId = v.int("parent_id", { optional: true, min: 1 });
  const currency = v.str("currency", { optional: true, pattern: /^[A-Za-z]{3}$/ });
  const allowPosting = v.bool("allow_posting");
  const fs = v.str("fs_mapping", { optional: true, max: 40 });
  const description = v.str("description", { optional: true, max: 500 });
  v.done();
  let normal: string = type === "asset" || type === "expense" ? "debit" : "credit";
  if (subtype?.startsWith("contra")) normal = normal === "debit" ? "credit" : "debit";
  if (parentId) {
    const p = (await c.q.query<any>("SELECT type, allow_posting FROM finance_accounts WHERE id = $1 AND org_id = $2", [parentId, c.org.orgId])).rows[0];
    if (!p) throw unprocessable("Parent account not found in this organisation", "invalid_parent");
    if (p.type !== type) throw unprocessable("A child account must have the same type as its parent", "parent_type_mismatch");
  }
  const a = (await c.q.query<any>(
    `INSERT INTO finance_accounts (org_id, code, name, type, category, subtype, parent_id, normal_balance, currency, allow_posting, fs_mapping, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${COLS}`,
    [c.org.orgId, code, name, type, category, subtype ?? null, parentId ?? null, normal, currency?.toUpperCase() ?? null, allowPosting ?? true, fs ?? null, description ?? null])).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "account.create", entityType: "account", entityId: a.id, summary: `Created account ${code} ${name}`, after: a, requestId: c.reqId });
  return ok({ account: a }, 201);
});

const patch = route("PATCH", "/accounts/:id", { perm: "finance:update" }, async (c) => {
  const v = new V(asObject(c.body));
  const name = v.str("name", { optional: true, min: 2, max: 160 });
  const isActive = v.bool("is_active"); const allowPosting = v.bool("allow_posting");
  const fs = v.str("fs_mapping", { optional: true, max: 40 }); const description = v.str("description", { optional: true, max: 500 });
  const parentId = v.int("parent_id", { optional: true, min: 1 });
  v.done();
  const before = (await c.q.query<any>(`SELECT ${COLS} FROM finance_accounts WHERE id = $1 AND org_id = $2 FOR UPDATE`, [c.params.id, c.org.orgId])).rows[0];
  if (!before) throw notFound("Account");
  if (isActive === false && before.is_active) {
    const t = (await c.q.query<any>("SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c FROM finance_ledger_entries WHERE org_id = $1 AND account_id = $2", [c.org.orgId, before.id])).rows[0];
    if (fromDb(t.d) !== fromDb(t.c)) throw conflict("An account with a non-zero balance cannot be deactivated", "account_has_balance");
    if (before.is_system) throw conflict("System accounts used by automatic postings cannot be deactivated", "system_account");
  }
  if (parentId) {
    if (parentId === before.id) throw unprocessable("An account cannot be its own parent", "invalid_parent");
    const p = (await c.q.query<any>("SELECT type FROM finance_accounts WHERE id = $1 AND org_id = $2", [parentId, c.org.orgId])).rows[0];
    if (!p || p.type !== before.type) throw unprocessable("Parent must exist in this organisation with the same type", "invalid_parent");
  }
  const after = (await c.q.query<any>(
    `UPDATE finance_accounts SET name = COALESCE($3,name), is_active = COALESCE($4,is_active), allow_posting = COALESCE($5,allow_posting), fs_mapping = COALESCE($6,fs_mapping),
       description = COALESCE($7,description), parent_id = COALESCE($8,parent_id), updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING ${COLS}`,
    [before.id, c.org.orgId, name ?? null, isActive ?? null, allowPosting ?? null, fs ?? null, description ?? null, parentId ?? null])).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "account.update", entityType: "account", entityId: before.id, before, after, requestId: c.reqId });
  return ok({ account: after });
});

export const accountRoutes: Route[] = [list, getOne, create, patch];
