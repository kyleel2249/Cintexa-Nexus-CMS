import { route, ok, type Route } from "../core/route";
import { audit } from "../core/audit";
import { V, asObject, qstr } from "../core/validate";
import { conflict, notFound } from "../core/errors";
import { formatMoney } from "../core/money";
import { nextNumber } from "./journals";

/** Customers and suppliers share one implementation; they are separate tenant-scoped tables. */
function partyRoutes(kind: "customer" | "supplier"): Route[] {
  const table = kind === "customer" ? "finance_customers" : "finance_suppliers"; const base = kind === "customer" ? "/customers" : "/suppliers"; const prefix = kind === "customer" ? "CUS" : "SUP";
  const cols = `id, code, name, classification, email, phone, tax_id, address, payment_terms_days, ${kind === "customer" ? "credit_limit, " : ""}currency, is_active, created_at`;
  const list = route("GET", base, { perm: "finance:read" }, async (c) => {
    const p: unknown[] = [c.org.orgId]; const w = ["org_id = $1"]; const s = qstr(c.query.q); const a = qstr(c.query.active);
    if (s) { p.push(`%${s.toLowerCase()}%`); w.push(`(lower(name) LIKE $${p.length} OR lower(code) LIKE $${p.length} OR lower(COALESCE(email,'')) LIKE $${p.length})`); }
    if (a === "true" || a === "false") { p.push(a === "true"); w.push(`is_active = $${p.length}`); }
    const limit = Math.min(500, Math.max(1, Number(qstr(c.query.limit)) || 100)); const offset = Math.max(0, Number(qstr(c.query.offset)) || 0);
    const total = Number((await c.q.query<any>(`SELECT count(*)::int AS n FROM ${table} WHERE ${w.join(" AND ")}`, p)).rows[0].n);
    const items = (await c.q.query<any>(`SELECT ${cols} FROM ${table} WHERE ${w.join(" AND ")} ORDER BY name LIMIT ${limit} OFFSET ${offset}`, p)).rows;
    return ok({ items, total, limit, offset });
  });
  const getOne = route("GET", `${base}/:id`, { perm: "finance:read" }, async (c) => {
    const r = (await c.q.query<any>(`SELECT ${cols} FROM ${table} WHERE id = $1 AND org_id = $2`, [c.params.id, c.org.orgId])).rows[0];
    if (!r) throw notFound(kind === "customer" ? "Customer" : "Supplier");
    const docs = kind === "customer"
      ? (await c.q.query<any>("SELECT COALESCE(SUM(total - amount_paid),0) AS outstanding, count(*)::int AS n FROM finance_invoices WHERE org_id = $1 AND customer_id = $2 AND status = 'issued'", [c.org.orgId, r.id])).rows[0]
      : (await c.q.query<any>("SELECT COALESCE(SUM(total - amount_paid),0) AS outstanding, count(*)::int AS n FROM finance_bills WHERE org_id = $1 AND supplier_id = $2 AND status = 'posted'", [c.org.orgId, r.id])).rows[0];
    return ok({ [kind]: r, outstanding: docs.outstanding, open_documents: docs.n });
  });
  const fields = (v: V) => ({
    name: v.str("name", { min: 2, max: 200 }), classification: v.str("classification", { optional: true, max: 60 }), email: v.str("email", { optional: true, max: 200, pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/ }),
    phone: v.str("phone", { optional: true, max: 40 }), tax_id: v.str("tax_id", { optional: true, max: 60 }), terms: v.int("payment_terms_days", { optional: true, min: 0, max: 365 }),
    credit: kind === "customer" ? v.money("credit_limit", { optional: true }) : undefined,
  });
  const create = route("POST", base, { perm: "finance:update" }, async (c) => {
    const b = asObject(c.body); const v = new V(b); const code = v.str("code", { optional: true, max: 30, pattern: /^[A-Za-z0-9._-]+$/ }); const f = fields(v); v.done();
    const finalCode = code ?? `${prefix}-${String(await nextNumber(c.q, c.org.orgId, kind)).padStart(4, "0")}`;
    const dup = (await c.q.query(`SELECT 1 FROM ${table} WHERE org_id = $1 AND code = $2`, [c.org.orgId, finalCode])).rowCount;
    if (dup) throw conflict(`Code ${finalCode} is already used`, "duplicate_code");
    const params: unknown[] = [c.org.orgId, finalCode, f.name, f.classification ?? null, f.email ?? null, f.phone ?? null, f.tax_id ?? null, JSON.stringify(b.address ?? {}), f.terms ?? 30];
    if (kind === "customer") params.push(f.credit === undefined ? null : formatMoney(f.credit));
    const r = (await c.q.query<any>(`INSERT INTO ${table} (org_id, code, name, classification, email, phone, tax_id, address, payment_terms_days${kind === "customer" ? ", credit_limit" : ""}) VALUES (${params.map((_, i) => `$${i + 1}`).join(",")}) RETURNING ${cols}`, params)).rows[0];
    await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: `${kind}.create`, entityType: kind, entityId: r.id, summary: `Created ${kind} ${r.code} ${r.name}`, after: r, requestId: c.reqId });
    return ok({ [kind]: r }, 201);
  });
  const patch = route("PATCH", `${base}/:id`, { perm: "finance:update" }, async (c) => {
    const b = asObject(c.body); const v = new V(b); const name = v.str("name", { optional: true, min: 2, max: 200 });
    const email = v.str("email", { optional: true, max: 200, pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/ }); const phone = v.str("phone", { optional: true, max: 40 }); const tax = v.str("tax_id", { optional: true, max: 60 });
    const terms = v.int("payment_terms_days", { optional: true, min: 0, max: 365 }); const active = v.bool("is_active"); const cls = v.str("classification", { optional: true, max: 60 });
    const credit = kind === "customer" ? v.money("credit_limit", { optional: true }) : undefined; v.done();
    const before = (await c.q.query<any>(`SELECT ${cols} FROM ${table} WHERE id = $1 AND org_id = $2 FOR UPDATE`, [c.params.id, c.org.orgId])).rows[0];
    if (!before) throw notFound(kind === "customer" ? "Customer" : "Supplier");
    const sets = ["name = COALESCE($3,name)", "email = COALESCE($4,email)", "phone = COALESCE($5,phone)", "tax_id = COALESCE($6,tax_id)", "payment_terms_days = COALESCE($7,payment_terms_days)", "is_active = COALESCE($8,is_active)", "classification = COALESCE($9,classification)", "updated_at = now()"];
    const params: unknown[] = [before.id, c.org.orgId, name ?? null, email ?? null, phone ?? null, tax ?? null, terms ?? null, active ?? null, cls ?? null];
    if (kind === "customer") { params.push(credit === undefined ? null : formatMoney(credit)); sets.push(`credit_limit = COALESCE($${params.length},credit_limit)`); }
    const after = (await c.q.query<any>(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = $1 AND org_id = $2 RETURNING ${cols}`, params)).rows[0];
    await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: `${kind}.update`, entityType: kind, entityId: before.id, before, after, requestId: c.reqId });
    return ok({ [kind]: after });
  });
  return [list, getOne, create, patch];
}
export const partyRouteList: Route[] = [...partyRoutes("customer"), ...partyRoutes("supplier")];
