import { v, parse } from "../core/validate";
import { created, noContent, csv, type Route } from "../core/router";
import { notFound, conflict, badRequest, forbidden } from "../core/errors";
import { audit, diff } from "../core/audit";
import { nextNumber } from "../core/numbering";
import { can, assertOwnerAccess, scopeOf } from "../core/rbac";
import { pageOf, orderBy, str, d10, toCsv } from "../core/http";
import { normalizeCompany, similarity } from "../domain/dedupe";
import { Where, scopeSql, loadOwned, changeOwner, buildUpdate, TEXT_ARRAY, textArrayParam } from "./common";
import { accountHealth } from "./health-data";
import type { Actor, Queryable } from "../core/types";

const KINDS = ["company", "individual"] as const;
const STATUSES = ["prospect", "active", "inactive", "churned"] as const;
const ROLES = ["contact", "decision_maker", "influencer", "billing", "technical", "champion"] as const;

const accountFields = {
  name: v.string({ min: 2, max: 160 }), kind: v.withDefault(v.enumOf(KINDS), "company"), status: v.withDefault(v.enumOf(STATUSES), "prospect"),
  classification: v.optional(v.string({ max: 60 })), industry: v.optional(v.string({ max: 80 })), segment: v.optional(v.string({ max: 80 })), company_size: v.optional(v.string({ max: 40 })),
  website: v.optional(v.string({ max: 200 })), phone: v.optional(v.phone()), email: v.optional(v.email()), address_line: v.optional(v.string({ max: 200 })), city: v.optional(v.string({ max: 80 })),
  region: v.optional(v.string({ max: 80 })), country: v.optional(v.string({ max: 80 })), postal_code: v.optional(v.string({ max: 20 })), territory_id: v.optional(v.id()), owner_id: v.optional(v.id()),
  tags: v.withDefault(v.array(v.string({ min: 1, max: 40 }), { max: 30 }), []), currency: v.withDefault(v.string({ min: 3, max: 3, upper: true, pattern: /^[A-Z]{3}$/ }), "USD"),
  payment_terms_days: v.withDefault(v.int({ min: 0, max: 365 }), 30), credit_limit: v.optional(v.money()), reorder_interval_days: v.optional(v.int({ min: 1, max: 1825 })),
  consent_email: v.withDefault(v.boolean(), false), consent_whatsapp: v.withDefault(v.boolean(), false), notes: v.optional(v.string({ max: 8000, raw: true })),
  allow_duplicate: v.withDefault(v.boolean(), false),
};
const accountCreate = v.object(accountFields);
const accountPatch = v.object({
  name: v.optional(v.string({ min: 2, max: 160 })), kind: v.optional(v.enumOf(KINDS)), status: v.optional(v.enumOf(STATUSES)), classification: v.nullable(v.string({ max: 60 })), industry: v.nullable(v.string({ max: 80 })),
  segment: v.nullable(v.string({ max: 80 })), company_size: v.nullable(v.string({ max: 40 })), website: v.nullable(v.string({ max: 200 })), phone: v.nullable(v.phone()), email: v.nullable(v.email()),
  address_line: v.nullable(v.string({ max: 200 })), city: v.nullable(v.string({ max: 80 })), region: v.nullable(v.string({ max: 80 })), country: v.nullable(v.string({ max: 80 })), postal_code: v.nullable(v.string({ max: 20 })),
  territory_id: v.nullable(v.id()), tags: v.optional(v.array(v.string({ min: 1, max: 40 }), { max: 30 })), currency: v.optional(v.string({ min: 3, max: 3, upper: true, pattern: /^[A-Z]{3}$/ })),
  payment_terms_days: v.optional(v.int({ min: 0, max: 365 })), credit_limit: v.nullable(v.money()), reorder_interval_days: v.nullable(v.int({ min: 1, max: 1825 })), next_engagement_on: v.nullable(v.date()),
  consent_email: v.optional(v.boolean()), consent_whatsapp: v.optional(v.boolean()), notes: v.nullable(v.string({ max: 8000, raw: true })),
});

const contactBody = {
  account_id: v.optional(v.id()), first_name: v.string({ min: 1, max: 80 }), last_name: v.optional(v.string({ max: 80 })), email: v.optional(v.email()), phone: v.optional(v.phone()), job_title: v.optional(v.string({ max: 120 })),
  role: v.withDefault(v.enumOf(ROLES), "contact"), is_primary: v.withDefault(v.boolean(), false), consent_email: v.withDefault(v.boolean(), false), consent_whatsapp: v.withDefault(v.boolean(), false), notes: v.optional(v.string({ max: 4000, raw: true })),
};
const contactCreate = v.object(contactBody);
const contactPatch = v.object({
  account_id: v.nullable(v.id()), first_name: v.optional(v.string({ min: 1, max: 80 })), last_name: v.nullable(v.string({ max: 80 })), email: v.nullable(v.email()), phone: v.nullable(v.phone()), job_title: v.nullable(v.string({ max: 120 })),
  role: v.optional(v.enumOf(ROLES)), is_primary: v.optional(v.boolean()), consent_email: v.optional(v.boolean()), consent_whatsapp: v.optional(v.boolean()), unsubscribed: v.optional(v.boolean()), notes: v.nullable(v.string({ max: 4000, raw: true })),
});

const ACCOUNT_COLS: Record<string, string> = {
  name: "name", kind: "kind", status: "status", classification: "classification", industry: "industry", segment: "segment", company_size: "company_size", website: "website", phone: "phone", email: "email",
  address_line: "address_line", city: "city", region: "region", country: "country", postal_code: "postal_code", territory_id: "territory_id", currency: "currency", payment_terms_days: "payment_terms_days",
  credit_limit: "credit_limit", reorder_interval_days: "reorder_interval_days", next_engagement_on: "next_engagement_on", consent_email: "consent_email", consent_whatsapp: "consent_whatsapp", notes: "notes",
};

/** Find existing accounts with a very similar normalised name (for duplicate prevention). */
export async function findSimilarAccounts(q: Queryable, name: string, excludeId?: number): Promise<Array<{ id: number; name: string; number: string; similarity: number }>> {
  const norm = normalizeCompany(name);
  if (!norm) return [];
  const first = norm.split(" ")[0]!;
  const r = await q.query<{ id: number; name: string; number: string }>(
    `SELECT id, name, number FROM sales_accounts WHERE archived_at IS NULL AND merged_into_id IS NULL AND lower(name) LIKE $1 ${excludeId ? `AND id <> ${Number(excludeId)}` : ""} LIMIT 50`,
    [`%${first.replace(/[%_\\]/g, "")}%`],
  );
  return r.rows.map((x) => ({ ...x, similarity: Math.round(similarity(norm, normalizeCompany(x.name) ?? "") * 100) / 100 })).filter((x) => x.similarity >= 0.85).sort((a, b) => b.similarity - a.similarity);
}

export async function visibleAccount(q: Queryable, actor: Actor, id: number) {
  return loadOwned<any>(q, actor, "sales_accounts", id, "Account", { extraWhere: "archived_at IS NULL" });
}

export const accountRoutes: Route[] = [
  {
    method: "GET", path: "/accounts", permission: "accounts:read",
    async handler({ q, actor, query }) {
      const w = new Where().raw(scopeSql(actor, "a.owner_id")).raw("a.archived_at IS NULL AND a.merged_into_id IS NULL");
      w.search(str(query, "q"), ["a.name", "a.email", "a.number", "a.phone"]);
      for (const k of ["status", "segment", "industry", "country", "kind"]) if (str(query, k)) w.and(`a.${k} = ?`, str(query, k));
      if (str(query, "owner_id")) w.and("a.owner_id = ?", parse(v.id(), str(query, "owner_id")));
      if (str(query, "territory_id")) w.and("a.territory_id = ?", parse(v.id(), str(query, "territory_id")));
      if (str(query, "tag")) w.and(`? = ANY(a.tags)`, str(query, "tag"));
      if (str(query, "inactive_days")) w.and("(a.last_purchase_at IS NULL OR a.last_purchase_at < now() - (? || ' days')::interval)", String(parse(v.int({ min: 1, max: 3650 }), str(query, "inactive_days"))));
      const { page, pageSize, offset } = pageOf(query);
      const order = orderBy(query, { name: "a.name", created: "a.created_at", last_purchase: "a.last_purchase_at", status: "a.status" }, "name");
      const total = (await q.query<{ n: number }>(`SELECT count(*)::int n FROM sales_accounts a WHERE ${w.sql}`, w.params)).rows[0]!.n;
      const r = await q.query(
        `SELECT a.id, a.number, a.name, a.kind, a.status, a.industry, a.segment, a.country, a.owner_id, m.display_name AS owner_name, a.tags, a.last_purchase_at, a.expected_reorder_on, a.currency,
           (SELECT count(*)::int FROM sales_opportunities o WHERE o.account_id = a.id AND o.status = 'open' AND o.archived_at IS NULL) AS open_opportunities
         FROM sales_accounts a LEFT JOIN sales_members m ON m.id = a.owner_id WHERE ${w.sql} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`,
        w.params,
      );
      return { items: r.rows, total, page, pageSize };
    },
  },
  {
    method: "POST", path: "/accounts", permission: "accounts:write", idempotent: true,
    async handler({ q, actor, body, now, requestId, settings }) {
      const b = parse(accountCreate, body);
      const ownerId = b.owner_id !== undefined && can(actor, "accounts:assign") ? b.owner_id : actor.memberId;
      if (b.owner_id !== undefined && b.owner_id !== actor.memberId && !can(actor, "accounts:assign")) throw forbidden("You cannot assign accounts to other people");
      if (!b.allow_duplicate) {
        const dups = await findSimilarAccounts(q, b.name);
        if (dups.length) throw conflict("A very similar account already exists", "possible_duplicate", { candidates: dups });
      }
      const number = await nextNumber(q, "account", now, { yearly: false, prefix: settings.numbering.accountPrefix });
      const r = await q.query<{ id: number }>(
        `INSERT INTO sales_accounts (number, name, kind, status, classification, industry, segment, company_size, website, phone, email, address_line, city, region, country, postal_code, territory_id, owner_id, tags, currency,
           payment_terms_days, credit_limit, reorder_interval_days, consent_email, consent_whatsapp, consent_recorded_at, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,${TEXT_ARRAY("$19")},$20,$21,$22,$23,$24,$25,CASE WHEN $24 OR $25 THEN now() END,$26,$27) RETURNING id`,
        [number, b.name, b.kind, b.status, b.classification ?? null, b.industry ?? null, b.segment ?? null, b.company_size ?? null, b.website ?? null, b.phone ?? null, b.email ?? null, b.address_line ?? null, b.city ?? null,
          b.region ?? null, b.country ?? null, b.postal_code ?? null, b.territory_id ?? null, ownerId, textArrayParam(b.tags), b.currency, b.payment_terms_days, b.credit_limit ?? null, b.reorder_interval_days ?? null,
          b.consent_email, b.consent_whatsapp, b.notes ?? null, actor.label],
      );
      const id = r.rows[0]!.id;
      await audit(q, actor, { action: "account.create", entityType: "account", entityId: id, summary: `Created account ${number} ${b.name}`, after: { ...b, owner_id: ownerId } }, requestId);
      return created({ id, number });
    },
  },
  {
    method: "GET", path: "/accounts/export.csv", permission: "accounts:export",
    async handler({ q, actor, requestId }) {
      const rows = await q.query(`SELECT a.number, a.name, a.kind, a.status, a.industry, a.segment, a.country, a.email, a.phone, m.display_name AS owner, a.created_at FROM sales_accounts a LEFT JOIN sales_members m ON m.id = a.owner_id WHERE ${scopeSql(actor, "a.owner_id")} AND a.archived_at IS NULL ORDER BY a.number LIMIT 20000`);
      await audit(q, actor, { action: "account.export", entityType: "account", summary: `Exported ${rows.rows.length} accounts` }, requestId);
      return csv("accounts.csv", toCsv(["number", "name", "kind", "status", "industry", "segment", "country", "email", "phone", "owner", "created_at"], rows.rows));
    },
    tx: false,
  },
  {
    method: "GET", path: "/accounts/:id", permission: "accounts:read",
    async handler({ q, actor, params, now, settings }) {
      const id = parse(v.id(), params.id);
      const account = await visibleAccount(q, actor, id);
      const owner = account.owner_id ? (await q.query("SELECT id, display_name FROM sales_members WHERE id = $1", [account.owner_id])).rows[0] : null;
      const contacts = (await q.query("SELECT id, first_name, last_name, email, phone, job_title, role, is_primary, consent_email, consent_whatsapp, unsubscribed_at FROM sales_contacts WHERE account_id = $1 AND archived_at IS NULL ORDER BY is_primary DESC, first_name", [id])).rows;
      const out: Record<string, unknown> = { account: { ...account, owner }, contacts, health: await accountHealth(q, id, settings.retention, now) };
      if (can(actor, "opportunities:read")) out.opportunities = (await q.query("SELECT id, number, name, status, amount, currency, probability, expected_close_date, stage_id FROM sales_opportunities WHERE account_id = $1 AND archived_at IS NULL ORDER BY created_at DESC LIMIT 25", [id])).rows;
      if (can(actor, "quotations:read")) out.quotations = (await q.query("SELECT id, number, version, status, total, currency, validity_date FROM sales_quotations WHERE account_id = $1 AND status <> 'superseded' ORDER BY created_at DESC LIMIT 25", [id])).rows;
      if (can(actor, "orders:read")) {
        out.orders = (await q.query("SELECT id, number, status, total, currency, payment_status, invoice_status, booked_at FROM sales_orders WHERE account_id = $1 ORDER BY created_at DESC LIMIT 25", [id])).rows;
        // lifetime value is only summed within a currency (no silent FX); returns reduce it, cancellations are excluded
        out.lifetime = (await q.query(
          `SELECT currency, count(*)::int AS orders, COALESCE(sum(net_total),0)::text AS booked, COALESCE(sum(returned_total),0)::text AS returned,
             (COALESCE(sum(net_total),0) - COALESCE(sum(returned_total),0))::text AS lifetime_value, min(booked_at) AS first_order_at, max(booked_at) AS last_order_at
           FROM sales_orders WHERE account_id = $1 AND booked_at IS NOT NULL AND status <> 'cancelled' GROUP BY currency ORDER BY currency`, [id])).rows;
      }
      if (can(actor, "retention:read")) {
        out.feedback = (await q.query("SELECT id, kind, rating, status, subject, created_at FROM sales_feedback WHERE account_id = $1 ORDER BY created_at DESC LIMIT 20", [id])).rows;
        out.plans = (await q.query("SELECT id, title, status, review_on FROM sales_account_plans WHERE account_id = $1 ORDER BY created_at DESC", [id])).rows;
        out.renewals = (await q.query("SELECT id, description, renewal_on, expected_amount, status FROM sales_renewals WHERE account_id = $1 ORDER BY renewal_on", [id])).rows;
      }
      // unified timeline - only sections the actor may read
      const parts: string[] = [`SELECT 'activity' AS kind, a.id, a.subject AS title, a.type || ' · ' || a.status AS detail, COALESCE(a.completed_at, a.start_at, a.due_at, a.created_at) AS at FROM sales_activities a WHERE a.account_id = $1`];
      if (can(actor, "opportunities:read")) parts.push(`SELECT 'opportunity', o.id, o.number || ' ' || o.name, o.status, o.created_at FROM sales_opportunities o WHERE o.account_id = $1`);
      if (can(actor, "quotations:read")) parts.push(`SELECT 'quotation', x.id, x.number, x.status, x.created_at FROM sales_quotations x WHERE x.account_id = $1`);
      if (can(actor, "orders:read")) parts.push(`SELECT 'order', s.id, s.number, s.status, COALESCE(s.booked_at, s.created_at) FROM sales_orders s WHERE s.account_id = $1`);
      if (can(actor, "retention:read")) parts.push(`SELECT 'feedback', f.id, f.subject, f.kind, f.created_at FROM sales_feedback f WHERE f.account_id = $1`);
      out.timeline = (await q.query(`SELECT * FROM (${parts.join(" UNION ALL ")}) t ORDER BY at DESC LIMIT 100`, [id])).rows;
      void scopeOf;
      return out;
    },
  },
  {
    method: "PATCH", path: "/accounts/:id", permission: "accounts:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const cur = await loadOwned<any>(q, actor, "sales_accounts", id, "Account", { forUpdate: true, extraWhere: "archived_at IS NULL" });
      const b = parse(accountPatch, body);
      const consentChanged = (b.consent_email !== undefined && b.consent_email !== cur.consent_email) || (b.consent_whatsapp !== undefined && b.consent_whatsapp !== cur.consent_whatsapp);
      const upd = buildUpdate(b as Record<string, unknown>, ACCOUNT_COLS);
      if (b.tags) {
        await q.query(`UPDATE sales_accounts SET tags = ${TEXT_ARRAY("$2")} WHERE id = $1`, [id, textArrayParam(b.tags)]);
      }
      if (upd) await q.query(`UPDATE sales_accounts SET ${upd.set}, ${consentChanged ? "consent_recorded_at = now()," : ""} updated_at = now() WHERE id = $1`, [id, ...upd.params]);
      const d = diff(cur, { ...cur, ...b });
      await audit(q, actor, { action: "account.update", entityType: "account", entityId: id, summary: `Updated account ${cur.number}`, before: d.before, after: d.after }, requestId);
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/accounts/:id/assign", permission: "accounts:assign",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ owner_id: v.id(), reason: v.optional(v.string({ max: 300 })) }), body);
      await loadOwned(q, actor, "sales_accounts", id, "Account", { forUpdate: true });
      await changeOwner(q, actor, "account", "sales_accounts", id, b.owner_id, b.reason, requestId);
      return { ok: true };
    },
  },
  {
    method: "DELETE", path: "/accounts/:id", permission: "accounts:delete",
    async handler({ q, actor, params, requestId }) {
      const id = parse(v.id(), params.id);
      await loadOwned(q, actor, "sales_accounts", id, "Account", { forUpdate: true });
      const open = (await q.query<{ n: number }>("SELECT (SELECT count(*) FROM sales_opportunities WHERE account_id = $1 AND status = 'open' AND archived_at IS NULL) + (SELECT count(*) FROM sales_orders WHERE account_id = $1 AND status NOT IN ('completed','cancelled')) AS n", [id])).rows[0]!.n;
      if (Number(open) > 0) throw conflict("This account has open opportunities or orders. Close or cancel them before archiving.", "account_in_use");
      await q.query("UPDATE sales_accounts SET archived_at = now(), updated_at = now() WHERE id = $1", [id]);
      await audit(q, actor, { action: "account.archive", entityType: "account", entityId: id, summary: "Archived account" }, requestId);
      return noContent();
    },
  },
  // ───── contacts
  {
    method: "GET", path: "/contacts", permission: "contacts:read",
    async handler({ q, actor, query }) {
      const w = new Where().raw("c.archived_at IS NULL");
      if (scopeOf(actor) !== "all") w.raw(`(${scopeSql(actor, "a.owner_id")} OR ${scopeSql(actor, "c.owner_id")})`);
      w.search(str(query, "q"), ["c.first_name", "c.last_name", "c.email", "c.phone", "a.name"]);
      if (str(query, "account_id")) w.and("c.account_id = ?", parse(v.id(), str(query, "account_id")));
      if (str(query, "role")) w.and("c.role = ?", str(query, "role"));
      const { page, pageSize, offset } = pageOf(query);
      const total = (await q.query<{ n: number }>(`SELECT count(*)::int n FROM sales_contacts c LEFT JOIN sales_accounts a ON a.id = c.account_id WHERE ${w.sql}`, w.params)).rows[0]!.n;
      const r = await q.query(`SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.job_title, c.role, c.is_primary, c.account_id, a.name AS account_name, c.consent_email, c.consent_whatsapp, c.unsubscribed_at
        FROM sales_contacts c LEFT JOIN sales_accounts a ON a.id = c.account_id WHERE ${w.sql} ORDER BY c.first_name, c.last_name LIMIT ${pageSize} OFFSET ${offset}`, w.params);
      return { items: r.rows, total, page, pageSize };
    },
  },
  {
    method: "POST", path: "/contacts", permission: "contacts:write", idempotent: true,
    async handler({ q, actor, body, requestId }) {
      const b = parse(contactCreate, body);
      if (b.account_id) await visibleAccount(q, actor, b.account_id);
      if (b.is_primary && b.account_id) await q.query("UPDATE sales_contacts SET is_primary = FALSE WHERE account_id = $1 AND is_primary", [b.account_id]);
      const r = await q.query<{ id: number }>(
        `INSERT INTO sales_contacts (account_id, first_name, last_name, email, phone, job_title, role, is_primary, owner_id, consent_email, consent_whatsapp, consent_recorded_at, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $10 OR $11 THEN now() END,$12,$13) RETURNING id`,
        [b.account_id ?? null, b.first_name, b.last_name ?? null, b.email ?? null, b.phone ?? null, b.job_title ?? null, b.role, b.is_primary, actor.memberId, b.consent_email, b.consent_whatsapp, b.notes ?? null, actor.label],
      );
      await audit(q, actor, { action: "contact.create", entityType: "contact", entityId: r.rows[0]!.id, summary: `Created contact ${b.first_name} ${b.last_name ?? ""}`.trim(), after: b }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "PATCH", path: "/contacts/:id", permission: "contacts:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const cur = (await q.query("SELECT c.*, a.owner_id AS account_owner FROM sales_contacts c LEFT JOIN sales_accounts a ON a.id = c.account_id WHERE c.id = $1 AND c.archived_at IS NULL FOR UPDATE OF c", [id])).rows[0];
      if (!cur) throw notFound("Contact");
      if (scopeOf(actor) !== "all") {
        try { assertOwnerAccess(actor, cur.account_owner ?? null, "Contact"); } catch { assertOwnerAccess(actor, cur.owner_id ?? null, "Contact"); }
      }
      const b = parse(contactPatch, body);
      if (b.account_id) await visibleAccount(q, actor, b.account_id);
      const accountId = b.account_id === undefined ? cur.account_id : b.account_id;
      if (b.is_primary && accountId) await q.query("UPDATE sales_contacts SET is_primary = FALSE WHERE account_id = $1 AND is_primary AND id <> $2", [accountId, id]);
      const patch: Record<string, unknown> = { ...b };
      delete patch.unsubscribed;
      const upd = buildUpdate(patch, { account_id: "account_id", first_name: "first_name", last_name: "last_name", email: "email", phone: "phone", job_title: "job_title", role: "role", is_primary: "is_primary", consent_email: "consent_email", consent_whatsapp: "consent_whatsapp", notes: "notes" });
      const extra = b.unsubscribed === true ? ", unsubscribed_at = now(), consent_email = FALSE, consent_whatsapp = FALSE" : b.unsubscribed === false ? ", unsubscribed_at = NULL" : "";
      if (upd || extra) await q.query(`UPDATE sales_contacts SET ${upd ? upd.set + "," : ""} updated_at = now() ${extra} WHERE id = $1`, [id, ...(upd?.params ?? [])]);
      await audit(q, actor, { action: "contact.update", entityType: "contact", entityId: id, summary: "Updated contact", before: diff(cur, { ...cur, ...b }).before, after: diff(cur, { ...cur, ...b }).after }, requestId);
      return { ok: true };
    },
  },
  {
    method: "DELETE", path: "/contacts/:id", permission: "contacts:write",
    async handler({ q, actor, params, requestId }) {
      const id = parse(v.id(), params.id);
      const cur = (await q.query("SELECT c.id, c.owner_id, a.owner_id AS account_owner FROM sales_contacts c LEFT JOIN sales_accounts a ON a.id = c.account_id WHERE c.id = $1 AND c.archived_at IS NULL", [id])).rows[0];
      if (!cur) throw notFound("Contact");
      if (scopeOf(actor) !== "all") {
        try { assertOwnerAccess(actor, cur.account_owner ?? null, "Contact"); } catch { assertOwnerAccess(actor, cur.owner_id ?? null, "Contact"); }
      }
      await q.query("UPDATE sales_contacts SET archived_at = now(), is_primary = FALSE WHERE id = $1", [id]);
      await audit(q, actor, { action: "contact.archive", entityType: "contact", entityId: id }, requestId);
      return noContent();
    },
  },
  {
    method: "GET", path: "/accounts-meta", permission: "accounts:read",
    async handler({ q }) {
      const r = await q.query("SELECT DISTINCT segment FROM sales_accounts WHERE segment IS NOT NULL AND archived_at IS NULL ORDER BY 1");
      const t = await q.query("SELECT DISTINCT unnest(tags) AS tag FROM sales_accounts WHERE archived_at IS NULL ORDER BY 1");
      return { segments: r.rows.map((x: any) => x.segment), tags: t.rows.map((x: any) => x.tag) };
    },
  },
];

void d10;
void badRequest;
void notFound;
