import { route, ok, type Route, type Ctx } from "../core/route";
import { audit } from "../core/audit";
import { V, asObject, todayIn } from "../core/validate";
import { FINANCE_ROLES, ROLE_PERMISSIONS, hasPermission } from "../core/rbac";
import { conflict, notFound, forbidden } from "../core/errors";
import { GHANA_SME_COA } from "./coa-template";
import { createFiscalYear } from "./periods";
import type { Q } from "../core/types";

const ORG_COLS = "id, legal_name, trading_name, registration_number, tax_id, country, functional_currency, timezone, fiscal_year_start_month, accounting_method, accounting_framework, address, contact, branding, settings, created_at, updated_at";
export const DEFAULT_SETTINGS = { journal_approval_required: true, allow_self_approval: false };

export async function seedChart(q: Q, orgId: number): Promise<number> {
  const ids = new Map<string, number>();
  for (const a of GHANA_SME_COA) {
    const normal = a.type === "asset" || a.type === "expense" ? "debit" : "credit";
    const contra = a.subtype?.startsWith("contra");
    const nb = contra ? (normal === "debit" ? "credit" : "debit") : normal;
    const r = await q.query<{ id: number }>(
      `INSERT INTO finance_accounts (org_id, code, name, type, category, subtype, parent_id, normal_balance, allow_posting, is_system, fs_mapping)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [orgId, a.code, a.name, a.type, a.category, a.subtype ?? null, a.parent ? ids.get(a.parent) ?? null : null, nb, a.post ?? true, a.system ?? false, a.fs ?? null]);
    ids.set(a.code, Number(r.rows[0]!.id));
  }
  return GHANA_SME_COA.length;
}

const create = route("POST", "/organisations", { needsOrg: false, platformAdmin: true }, async (c: Ctx) => {
  const v = new V(asObject(c.body));
  const legal = v.str("legal_name", { min: 2, max: 200 });
  const trading = v.str("trading_name", { optional: true, max: 200 });
  const reg = v.str("registration_number", { optional: true, max: 80 });
  const tax = v.str("tax_id", { optional: true, max: 80 });
  const country = v.str("country", { optional: true, pattern: /^[A-Za-z]{2}$/ }) ?? "GH";
  const currency = v.str("functional_currency", { optional: true, pattern: /^[A-Za-z]{3}$/ }) ?? "GHS";
  const tz = v.str("timezone", { optional: true, max: 60 }) ?? "Africa/Accra";
  const startMonth = v.int("fiscal_year_start_month", { optional: true, min: 1, max: 12 }) ?? 1;
  const method = v.str("accounting_method", { optional: true, oneOf: ["accrual", "cash"] }) ?? "accrual";
  const framework = v.str("accounting_framework", { optional: true, oneOf: ["ifrs", "ifrs_sme", "gaap_local"] }) ?? "ifrs_sme";
  const template = v.str("chart_template", { optional: true, oneOf: ["ghana_sme", "empty"] }) ?? "ghana_sme";
  const firstYear = v.int("first_fiscal_year", { optional: true, min: 1990, max: 2200 });
  v.done();
  const b = asObject(c.body);
  const org = (await c.q.query<any>(
    `INSERT INTO finance_organisations (legal_name, trading_name, registration_number, tax_id, country, functional_currency, timezone, fiscal_year_start_month, accounting_method, accounting_framework, address, contact, settings, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING ${ORG_COLS}`,
    [legal, trading ?? null, reg ?? null, tax ?? null, country.toUpperCase(), currency.toUpperCase(), tz, startMonth, method, framework,
      JSON.stringify(b.address ?? {}), JSON.stringify(b.contact ?? {}), JSON.stringify(DEFAULT_SETTINGS), c.actor.sub])).rows[0];
  const orgId = Number(org.id);
  await c.q.query("INSERT INTO finance_members (org_id, user_sub, email, display_name, role) VALUES ($1,$2,$3,$4,'organisation_owner')", [orgId, c.actor.sub, c.actor.email || `${c.actor.sub}@unknown.invalid`, c.actor.label]);
  const accounts = template === "ghana_sme" ? await seedChart(c.q, orgId) : 0;
  const today = todayIn(tz, c.now);
  const y = firstYear ?? Number(today.slice(0, 4));
  const startYear = startMonth > Number(today.slice(5, 7)) && !firstYear ? y - 1 : y;
  const fy = await createFiscalYear(c.q, orgId, startYear, startMonth);
  await audit(c.q, { orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "organisation.create", entityType: "organisation", entityId: orgId, summary: `Created organisation ${legal}`, after: { ...org, accounts_seeded: accounts, fiscal_year: fy.name }, requestId: c.reqId });
  return ok({ organisation: org, accounts_seeded: accounts, fiscal_year: fy }, 201);
});

const list = route("GET", "/organisations", { needsOrg: false }, async (c: Ctx) => {
  const rows = (await c.q.query<any>(
    `SELECT o.id, o.legal_name, o.trading_name, o.country, o.functional_currency, m.role FROM finance_organisations o
       JOIN finance_members m ON m.org_id = o.id AND (m.user_sub = $1 OR lower(m.email) = lower($2)) AND m.status = 'active'
      WHERE o.archived_at IS NULL ORDER BY o.legal_name`, [c.actor.sub, c.actor.email])).rows;
  return ok({ items: rows });
});

const getOne = route("GET", "/organisation", { perm: "finance:read" }, async (c) => {
  const o = (await c.q.query<any>(`SELECT ${ORG_COLS} FROM finance_organisations WHERE id = $1`, [c.org.orgId])).rows[0];
  if (!o) throw notFound("Organisation");
  return ok({ organisation: o, role: c.org.role });
});

const patch = route("PATCH", "/organisation", { perm: "finance:admin" }, async (c) => {
  const v = new V(asObject(c.body));
  const f = {
    trading_name: v.str("trading_name", { optional: true, max: 200 }), registration_number: v.str("registration_number", { optional: true, max: 80 }), tax_id: v.str("tax_id", { optional: true, max: 80 }),
    timezone: v.str("timezone", { optional: true, max: 60 }), accounting_method: v.str("accounting_method", { optional: true, oneOf: ["accrual", "cash"] }),
    accounting_framework: v.str("accounting_framework", { optional: true, oneOf: ["ifrs", "ifrs_sme", "gaap_local"] }), legal_name: v.str("legal_name", { optional: true, min: 2, max: 200 }),
  };
  v.done();
  const b = asObject(c.body);
  const before = (await c.q.query<any>(`SELECT ${ORG_COLS} FROM finance_organisations WHERE id = $1 FOR UPDATE`, [c.org.orgId])).rows[0];
  let settings = before.settings ?? {};
  if (b.settings !== undefined) {
    const s = asObject(b.settings); const sv = new V(s, "settings.");
    const a = sv.bool("journal_approval_required"); const self = sv.bool("allow_self_approval"); sv.done();
    settings = { ...settings, ...(a !== undefined ? { journal_approval_required: a } : {}), ...(self !== undefined ? { allow_self_approval: self } : {}) };
  }
  const after = (await c.q.query<any>(
    `UPDATE finance_organisations SET legal_name = COALESCE($2, legal_name), trading_name = COALESCE($3, trading_name), registration_number = COALESCE($4, registration_number), tax_id = COALESCE($5, tax_id),
       timezone = COALESCE($6, timezone), accounting_method = COALESCE($7, accounting_method), accounting_framework = COALESCE($8, accounting_framework),
       address = COALESCE($9::jsonb, address), contact = COALESCE($10::jsonb, contact), settings = $11::jsonb, updated_at = now() WHERE id = $1 RETURNING ${ORG_COLS}`,
    [c.org.orgId, f.legal_name ?? null, f.trading_name ?? null, f.registration_number ?? null, f.tax_id ?? null, f.timezone ?? null, f.accounting_method ?? null, f.accounting_framework ?? null,
      b.address === undefined ? null : JSON.stringify(b.address), b.contact === undefined ? null : JSON.stringify(b.contact), JSON.stringify(settings)])).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "organisation.update", entityType: "organisation", entityId: c.org.orgId, before, after, requestId: c.reqId });
  return ok({ organisation: after });
});

const members = route("GET", "/members", { perm: "finance:admin" }, async (c) =>
  ok({ items: (await c.q.query<any>("SELECT id, email, display_name, role, status, created_at FROM finance_members WHERE org_id = $1 ORDER BY email", [c.org.orgId])).rows }));

const addMember = route("POST", "/members", { perm: "finance:admin" }, async (c) => {
  const v = new V(asObject(c.body));
  const email = v.str("email", { max: 200, pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/ });
  const role = v.str("role", { oneOf: FINANCE_ROLES });
  const name = v.str("display_name", { optional: true, max: 120 });
  v.done();
  // only an owner can mint another owner / only owners may grant roles they do not hold
  if (role === "organisation_owner" && c.org.role !== "organisation_owner") throw forbidden("Only an organisation owner can grant the owner role");
  const exists = (await c.q.query("SELECT 1 FROM finance_members WHERE org_id = $1 AND lower(email) = lower($2)", [c.org.orgId, email])).rowCount;
  if (exists) throw conflict("That person is already a member of this organisation", "already_member");
  const m = (await c.q.query<any>("INSERT INTO finance_members (org_id, email, display_name, role) VALUES ($1,$2,$3,$4) RETURNING id, email, display_name, role, status", [c.org.orgId, email, name ?? null, role])).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "member.add", entityType: "member", entityId: m.id, summary: `Added ${email} as ${role}`, after: m, requestId: c.reqId });
  return ok({ member: m }, 201);
});

const patchMember = route("PATCH", "/members/:id", { perm: "finance:admin" }, async (c) => {
  const v = new V(asObject(c.body));
  const role = v.str("role", { optional: true, oneOf: FINANCE_ROLES });
  const status = v.str("status", { optional: true, oneOf: ["active", "suspended"] });
  v.done();
  const before = (await c.q.query<any>("SELECT id, email, role, status FROM finance_members WHERE id = $1 AND org_id = $2 FOR UPDATE", [c.params.id, c.org.orgId])).rows[0];
  if (!before) throw notFound("Member");
  if ((role === "organisation_owner" || before.role === "organisation_owner") && c.org.role !== "organisation_owner") throw forbidden("Only an organisation owner can change an owner");
  const after = { ...before, role: role ?? before.role, status: status ?? before.status };
  if (before.role === "organisation_owner" && (after.role !== "organisation_owner" || after.status !== "active")) {
    const owners = (await c.q.query<any>("SELECT count(*)::int AS n FROM finance_members WHERE org_id = $1 AND role = 'organisation_owner' AND status = 'active' AND id <> $2", [c.org.orgId, before.id])).rows[0].n;
    if (!owners) throw conflict("An organisation must keep at least one active owner", "last_owner");
  }
  await c.q.query("UPDATE finance_members SET role = $1, status = $2, updated_at = now() WHERE id = $3 AND org_id = $4", [after.role, after.status, before.id, c.org.orgId]);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "member.update", entityType: "member", entityId: before.id, before, after, requestId: c.reqId });
  return ok({ member: after });
});

const perms = route("GET", "/permissions", { needsOrg: false }, async (c) => ok({ roles: ROLE_PERMISSIONS }));
const me = route("GET", "/me", { perm: "finance:read" }, async (c) => ok({ role: c.org.role, permissions: ROLE_PERMISSIONS[c.org.role as keyof typeof ROLE_PERMISSIONS] ?? [], can: { post: hasPermission(c.org.role, "finance:post"), approve: hasPermission(c.org.role, "finance:approve") } }));

export const organisationRoutes: Route[] = [create, list, getOne, patch, members, addMember, patchMember, perms, me];
