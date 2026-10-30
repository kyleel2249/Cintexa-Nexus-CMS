import { randomBytes } from "../core/portable";
import { v, parse } from "../core/validate";
import { created, noContent, csv, PUBLIC_ACTOR, type Route, type DomainEvent } from "../core/router";
import { notFound, conflict, badRequest, validationFailed, unprocessable, forbidden } from "../core/errors";
import { audit, diff } from "../core/audit";
import { nextNumber } from "../core/numbering";
import { can, assertOwnerAccess } from "../core/rbac";
import { pageOf, orderBy, str, toCsv, d10 } from "../core/http";
import { csvToObjects } from "../core/csv-parse";
import { scoreLead, priorityFromScore } from "../domain/lead-scoring";
import { rankDuplicates, normalizeEmail, normalizePhone, normalizeCompany, type Dedupable } from "../domain/dedupe";
import { assertTransition } from "../domain/state-machines";
import { pickRoundRobin, matchTerritory, type TerritoryRule } from "../domain/assignment";
import { Where, scopeSql, loadOwned, changeOwner } from "./common";
import { findSimilarAccounts } from "./accounts";
import { createOpportunity } from "./pipeline";
import type { Actor, Queryable } from "../core/types";
import type { SalesSettings } from "../core/settings";

const STATUSES = ["new", "contacted", "qualified", "nurturing", "converted", "disqualified"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const SOURCES = ["manual", "web_form", "referral", "event", "campaign", "partner", "cold", "import", "whatsapp", "email"] as const;

const leadFields = {
  first_name: v.string({ min: 1, max: 80 }), last_name: v.optional(v.string({ max: 80 })), email: v.optional(v.email()), phone: v.optional(v.phone()), company: v.optional(v.string({ max: 160 })),
  job_title: v.optional(v.string({ max: 120 })), industry: v.optional(v.string({ max: 80 })), segment: v.optional(v.string({ max: 80 })), country: v.optional(v.string({ max: 80 })), region: v.optional(v.string({ max: 80 })),
  source: v.withDefault(v.enumOf(SOURCES), "manual"), campaign_id: v.optional(v.id()), product_interest: v.optional(v.string({ max: 200 })), budget: v.optional(v.money()), estimated_value: v.optional(v.money()),
  owner_id: v.optional(v.id()), priority: v.optional(v.enumOf(PRIORITIES)), consent_email: v.withDefault(v.boolean(), false), consent_whatsapp: v.withDefault(v.boolean(), false),
  notes: v.optional(v.string({ max: 8000, raw: true })), referrer_account_id: v.optional(v.id()), allow_duplicate: v.withDefault(v.boolean(), false),
};
const leadCreate = v.object(leadFields);
const leadPatch = v.object({
  first_name: v.optional(v.string({ min: 1, max: 80 })), last_name: v.nullable(v.string({ max: 80 })), email: v.nullable(v.email()), phone: v.nullable(v.phone()), company: v.nullable(v.string({ max: 160 })),
  job_title: v.nullable(v.string({ max: 120 })), industry: v.nullable(v.string({ max: 80 })), segment: v.nullable(v.string({ max: 80 })), country: v.nullable(v.string({ max: 80 })), region: v.nullable(v.string({ max: 80 })),
  source: v.optional(v.enumOf(SOURCES)), campaign_id: v.nullable(v.id()), product_interest: v.nullable(v.string({ max: 200 })), budget: v.nullable(v.money()), estimated_value: v.nullable(v.money()),
  priority: v.optional(v.enumOf(PRIORITIES)), consent_email: v.optional(v.boolean()), consent_whatsapp: v.optional(v.boolean()), notes: v.nullable(v.string({ max: 8000, raw: true })),
  next_action: v.nullable(v.string({ max: 300 })), next_follow_up_at: v.nullable(v.timestamp()),
});
const LEAD_COLS: Record<string, string> = {
  first_name: "first_name", last_name: "last_name", email: "email", phone: "phone", company: "company", job_title: "job_title", industry: "industry", segment: "segment", country: "country", region: "region",
  source: "source", campaign_id: "campaign_id", product_interest: "product_interest", budget: "budget", estimated_value: "estimated_value", priority: "priority", consent_email: "consent_email",
  consent_whatsapp: "consent_whatsapp", notes: "notes", next_action: "next_action", next_follow_up_at: "next_follow_up_at",
};

interface Ctx { now: Date; settings: SalesSettings; requestId: string; events: DomainEvent[] }

async function candidatesFor(q: Queryable, lead: { email?: string | null; phone?: string | null; company?: string | null }, excludeId?: number): Promise<Array<Dedupable & { number: string; status: string; owner_id: number | null }>> {
  const email = normalizeEmail(lead.email);
  const phone = normalizePhone(lead.phone);
  const company = normalizeCompany(lead.company);
  const clauses: string[] = [];
  const p: unknown[] = [];
  if (email) { p.push(email); clauses.push(`lower(email) = $${p.length}`); const local = email.split("@")[0]!; p.push(`${local}@%`); clauses.push(`lower(email) LIKE $${p.length}`); }
  if (phone) { p.push(`%${phone.slice(-7)}`); clauses.push(`regexp_replace(COALESCE(phone,''), '[^0-9]', '', 'g') LIKE $${p.length}`); }
  if (company) { p.push(`%${company.split(" ")[0]!.replace(/[%_\\]/g, "")}%`); clauses.push(`lower(company) LIKE $${p.length}`); }
  if (!clauses.length) return [];
  const r = await q.query<any>(`SELECT id, number, status, owner_id, first_name, last_name, email, phone, company FROM sales_leads WHERE archived_at IS NULL AND merged_into_id IS NULL ${excludeId ? `AND id <> ${Number(excludeId)}` : ""} AND (${clauses.join(" OR ")}) LIMIT 100`, p);
  return r.rows;
}

export async function findLeadDuplicates(q: Queryable, settings: SalesSettings, lead: Dedupable, excludeId?: number) {
  const cands = await candidatesFor(q, lead, excludeId);
  const ranked = rankDuplicates(lead, cands, settings.leads.dedupe);
  return ranked.map((m) => ({ ...m, lead: cands.find((c) => c.id === m.id)! })).map((m) => ({ id: m.id, number: m.lead.number, name: [m.lead.first_name, m.lead.last_name].filter(Boolean).join(" "), status: m.lead.status, confidence: m.confidence, reasons: m.reasons }));
}

async function territoryRules(q: Queryable): Promise<TerritoryRule[]> {
  const t = (await q.query<any>("SELECT id, name, countries, regions, industries FROM sales_territories WHERE archived_at IS NULL")).rows;
  const m = (await q.query<any>("SELECT tm.territory_id, tm.member_id, tm.is_primary FROM sales_territory_members tm JOIN sales_members s ON s.id = tm.member_id AND s.active")).rows;
  return t.map((x) => ({ id: x.id, name: x.name, countries: x.countries ?? [], regions: x.regions ?? [], industries: x.industries ?? [], members: m.filter((y) => y.territory_id === x.id).map((y) => ({ memberId: y.member_id, isPrimary: y.is_primary })) }));
}

/** Decide an owner according to settings. Returns null (unassigned) rather than guessing when no rule applies. */
export async function routeLead(q: Queryable, settings: SalesSettings, lead: { country?: string | null; region?: string | null; industry?: string | null }): Promise<{ ownerId: number | null; territoryId: number | null; note?: string }> {
  const mode = settings.leads.assignment;
  if (mode === "manual") return { ownerId: null, territoryId: null };
  let pool: number[] | null = null;
  let territoryId: number | null = null;
  let note: string | undefined;
  if (mode === "territory") {
    const m = matchTerritory(await territoryRules(q), lead);
    territoryId = m.territory?.id ?? null;
    if (m.ownerId !== null && m.territory && m.territory.members.length <= 1) return { ownerId: m.ownerId, territoryId, note: m.note };
    if (!m.territory) return { ownerId: null, territoryId: null, note: m.note };
    pool = m.territory.members.map((x) => x.memberId);
    note = m.note;
    if (!pool.length) return { ownerId: null, territoryId, note: note ?? "The matching territory has no active members" };
  }
  const reps = (await q.query<{ id: number }>("SELECT id FROM sales_members WHERE active AND role IN ('sales_rep','sales_manager')")).rows.map((x) => x.id).filter((id) => !pool || pool.includes(id));
  if (!reps.length) return { ownerId: null, territoryId, note: "No active sales reps available" };
  const load = (await q.query<{ owner_id: number; n: number; last: string | null }>(
    "SELECT owner_id, count(*) FILTER (WHERE status IN ('new','contacted','qualified','nurturing'))::int n, max(created_at) AS last FROM sales_leads WHERE archived_at IS NULL AND owner_id IS NOT NULL GROUP BY owner_id")).rows;
  const ownerId = pickRoundRobin(reps.map((id) => { const l = load.find((x) => x.owner_id === id); return { id, openLeads: l?.n ?? 0, lastAssignedAt: l?.last ?? null }; }));
  return { ownerId, territoryId, note };
}

export interface LeadInput {
  first_name: string; last_name?: string; email?: string; phone?: string; company?: string; job_title?: string; industry?: string; segment?: string; country?: string; region?: string;
  source: string; campaign_id?: number; product_interest?: string; budget?: string; estimated_value?: string; owner_id?: number; priority?: string; consent_email: boolean; consent_whatsapp: boolean;
  notes?: string; referrer_account_id?: number; utm?: Record<string, string>;
}

export async function createLead(q: Queryable, actor: Actor, c: Ctx, input: LeadInput, opts: { allowDuplicate: boolean; explicitOwner?: boolean }): Promise<{ id: number; number: string; ownerId: number | null; score: number }> {
  if (!input.email && !input.phone) throw validationFailed([{ path: "email", message: "Provide an email address or a phone number so the lead can be contacted" }]);
  if (!opts.allowDuplicate) {
    const dups = await findLeadDuplicates(q, c.settings, { id: 0, ...input });
    if (dups.length) throw conflict("This looks like an existing lead", "possible_duplicate", { candidates: dups.slice(0, 5) });
  }
  let ownerId: number | null = null;
  let territoryId: number | null = null;
  if (opts.explicitOwner && input.owner_id) ownerId = input.owner_id;
  else {
    const r = await routeLead(q, c.settings, input);
    ownerId = r.ownerId;
    territoryId = r.territoryId;
  }
  if (ownerId === null && actor.memberId > 0 && c.settings.leads.assignment === "manual" && actor.role === "sales_rep") ownerId = actor.memberId;
  if (ownerId !== null && !(await q.query("SELECT 1 FROM sales_members WHERE id = $1 AND active", [ownerId])).rows[0]) throw badRequest("The selected owner is not an active sales member");
  if (input.campaign_id && !(await q.query("SELECT 1 FROM sales_campaigns WHERE id = $1", [input.campaign_id])).rows[0]) throw badRequest("Campaign not found");
  const team = ownerId ? (await q.query<{ team_id: number | null }>("SELECT team_id FROM sales_members WHERE id = $1", [ownerId])).rows[0]?.team_id ?? null : null;
  const { score, breakdown } = scoreLead({ ...input, status: "new", created_at: c.now.toISOString() }, c.settings.leads.scoring, c.now);
  const number = await nextNumber(q, "lead", c.now, { yearly: c.settings.numbering.yearly, prefix: c.settings.numbering.leadPrefix });
  const followUp = new Date(c.now.getTime() + c.settings.leads.followUpDays * 86_400_000).toISOString();
  const r = await q.query<{ id: number }>(
    `INSERT INTO sales_leads (number, first_name, last_name, email, phone, company, job_title, industry, segment, country, region, territory_id, source, campaign_id, product_interest, budget, estimated_value,
       owner_id, team_id, priority, score, score_breakdown, consent_email, consent_whatsapp, consent_recorded_at, notes, utm, referrer_account_id, next_follow_up_at, next_action, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::text::jsonb,$23,$24,CASE WHEN $23 OR $24 THEN now() END,$25,$26::text::jsonb,$27,$28,'Make first contact',$29) RETURNING id`,
    [number, input.first_name, input.last_name ?? null, input.email ?? null, input.phone ?? null, input.company ?? null, input.job_title ?? null, input.industry ?? null, input.segment ?? null, input.country ?? null,
      input.region ?? null, territoryId, input.source, input.campaign_id ?? null, input.product_interest ?? null, input.budget ?? null, input.estimated_value ?? null, ownerId, team,
      input.priority ?? priorityFromScore(score), score, JSON.stringify(breakdown), input.consent_email, input.consent_whatsapp, input.notes ?? null, JSON.stringify(input.utm ?? {}),
      input.referrer_account_id ?? null, followUp, actor.label],
  );
  const id = r.rows[0]!.id;
  if (input.campaign_id) {
    await q.query("INSERT INTO sales_campaign_members (campaign_id, lead_id, status) VALUES ($1,$2,'responded') ON CONFLICT DO NOTHING", [input.campaign_id, id]);
    await q.query("INSERT INTO sales_touches (campaign_id, lead_id, kind, utm) VALUES ($1,$2,'lead_created',$3::text::jsonb)", [input.campaign_id, id, JSON.stringify(input.utm ?? {})]);
  }
  if (ownerId) {
    await q.query(
      `INSERT INTO sales_activities (type, subject, owner_id, lead_id, due_at, priority, dedupe_key, created_by) VALUES ('follow_up',$1,$2,$3,$4,$5,$6,'system') ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [`Make first contact with ${input.first_name}${input.last_name ? " " + input.last_name : ""}`, ownerId, id, new Date(c.now.getTime() + c.settings.leads.responseSlaHours * 3_600_000).toISOString(), input.priority ?? priorityFromScore(score), `lead-followup:${id}:initial`],
    );
    await q.query("INSERT INTO sales_ownership_history (entity_type, entity_id, from_owner_id, to_owner_id, changed_by, reason) VALUES ('lead',$1,NULL,$2,$3,'Initial assignment')", [id, ownerId, actor.label]);
  }
  await audit(q, actor, { action: "lead.create", entityType: "lead", entityId: id, summary: `Created lead ${number}`, after: { ...input, owner_id: ownerId, score } }, c.requestId);
  c.events.push({ type: "lead.created", entityType: "lead", entityId: id });
  if (ownerId) c.events.push({ type: "lead.assigned", entityType: "lead", entityId: id, data: { owner_id: ownerId } });
  return { id, number, ownerId, score };
}

export async function rescore(q: Queryable, id: number, settings: SalesSettings, now: Date): Promise<number> {
  const l = (await q.query<any>("SELECT * FROM sales_leads WHERE id = $1", [id])).rows[0];
  const { score, breakdown } = scoreLead(l, settings.leads.scoring, now);
  await q.query("UPDATE sales_leads SET score = $2, score_breakdown = $3::text::jsonb WHERE id = $1", [id, score, JSON.stringify(breakdown)]);
  return score;
}

const LEAD_LIST = `l.id, l.number, l.first_name, l.last_name, l.email, l.phone, l.company, l.source, l.status, l.priority, l.score, l.owner_id, m.display_name AS owner_name, l.country, l.campaign_id,
  l.estimated_value, l.next_follow_up_at, l.last_contact_at, l.created_at,
  (l.status IN ('new','contacted') AND l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at < now()) AS overdue,
  (l.first_response_at IS NULL AND l.status = 'new') AS awaiting_first_response`;

function leadFilters(actor: Actor, query: Record<string, string | string[] | undefined>): Where {
  const w = new Where().raw(`(${scopeSql(actor, "l.owner_id")} OR (l.owner_id IS NULL AND ${can(actor, "leads:assign") || actor.role === "sales_rep" ? "TRUE" : "FALSE"}))`).raw("l.archived_at IS NULL AND l.merged_into_id IS NULL");
  w.search(str(query, "q"), ["l.first_name", "l.last_name", "l.email", "l.company", "l.number", "l.phone"]);
  for (const k of ["status", "priority", "source", "country"]) if (str(query, k)) w.and(`l.${k} = ?`, str(query, k));
  if (str(query, "owner_id")) w.and("l.owner_id = ?", parse(v.id(), str(query, "owner_id")));
  if (str(query, "unassigned") === "true") w.raw("l.owner_id IS NULL");
  if (str(query, "campaign_id")) w.and("l.campaign_id = ?", parse(v.id(), str(query, "campaign_id")));
  if (str(query, "min_score")) w.and("l.score >= ?", parse(v.int({ min: 0, max: 100 }), str(query, "min_score")));
  if (str(query, "created_from")) w.and("l.created_at >= ?::date", parse(v.date(), str(query, "created_from")));
  if (str(query, "created_to")) w.and("l.created_at < (?::date + 1)", parse(v.date(), str(query, "created_to")));
  if (str(query, "overdue") === "true") w.raw("l.status IN ('new','contacted') AND l.next_follow_up_at < now()");
  return w;
}

const touchBody = v.object({
  channel: v.enumOf(["call", "email", "meeting", "visit", "demo", "note"] as const), subject: v.string({ min: 2, max: 200 }), notes: v.optional(v.string({ max: 4000, raw: true })), outcome: v.optional(v.string({ max: 300 })),
  next_action: v.optional(v.string({ max: 300 })), next_follow_up_at: v.optional(v.timestamp()),
});
const statusBody = v.object({ status: v.enumOf(STATUSES), reason: v.optional(v.string({ min: 3, max: 300 })), note: v.optional(v.string({ max: 500 })) });
const convertBody = v.object({
  account_id: v.optional(v.id()), account_name: v.optional(v.string({ min: 2, max: 160 })), allow_duplicate_account: v.withDefault(v.boolean(), false), create_opportunity: v.withDefault(v.boolean(), true),
  opportunity_name: v.optional(v.string({ min: 2, max: 200 })), opportunity_amount: v.optional(v.money()), expected_close_date: v.optional(v.date()), pipeline_id: v.optional(v.id()),
});
const mergeBody = v.object({ duplicate_id: v.id(), keep: v.withDefault(v.record(v.enumOf(["primary", "duplicate"] as const)), {}) });
const formBody = v.object({ name: v.string({ min: 2, max: 120 }), campaign_id: v.optional(v.id()), owner_id: v.optional(v.id()), source: v.withDefault(v.string({ min: 2, max: 40 }), "web_form"), require_consent: v.withDefault(v.boolean(), true), active: v.withDefault(v.boolean(), true) });
const publicSubmit = v.object({
  first_name: v.string({ min: 1, max: 80 }), last_name: v.optional(v.string({ max: 80 })), email: v.optional(v.email()), phone: v.optional(v.phone()), company: v.optional(v.string({ max: 160 })),
  message: v.optional(v.string({ max: 2000 })), consent: v.withDefault(v.boolean(), false), website: v.optional(v.string({ max: 200 })),
  utm_source: v.optional(v.string({ max: 100 })), utm_medium: v.optional(v.string({ max: 100 })), utm_campaign: v.optional(v.string({ max: 100 })),
});

const IMPORT_MAP: Record<string, string> = {
  first_name: "first_name", firstname: "first_name", "first name": "first_name", last_name: "last_name", lastname: "last_name", "last name": "last_name", email: "email", phone: "phone", company: "company",
  job_title: "job_title", title: "job_title", industry: "industry", country: "country", region: "region", source: "source", notes: "notes", estimated_value: "estimated_value", budget: "budget",
};

export const leadRoutes: Route[] = [
  {
    method: "GET", path: "/leads", permission: "leads:read",
    async handler({ q, actor, query }) {
      const w = leadFilters(actor, query);
      const { page, pageSize, offset } = pageOf(query);
      const order = orderBy(query, { created: "l.created_at", score: "l.score", name: "l.first_name", status: "l.status", followup: "l.next_follow_up_at", value: "l.estimated_value" }, "created");
      const total = (await q.query<{ n: number }>(`SELECT count(*)::int n FROM sales_leads l WHERE ${w.sql}`, w.params)).rows[0]!.n;
      const r = await q.query(`SELECT ${LEAD_LIST} FROM sales_leads l LEFT JOIN sales_members m ON m.id = l.owner_id WHERE ${w.sql} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`, w.params);
      const funnel = (await q.query<{ status: string; n: number }>(`SELECT l.status, count(*)::int n FROM sales_leads l WHERE ${w.sql} GROUP BY l.status`, w.params)).rows;
      return { items: r.rows, total, page, pageSize, byStatus: Object.fromEntries(funnel.map((f) => [f.status, f.n])) };
    },
  },
  {
    method: "POST", path: "/leads", permission: "leads:write", idempotent: true,
    async handler({ q, actor, body, now, settings, requestId, events }) {
      const b = parse(leadCreate, body);
      const explicit = b.owner_id !== undefined;
      if (explicit && b.owner_id !== actor.memberId && !can(actor, "leads:assign")) throw forbidden("You cannot assign leads to other people");
      const res = await createLead(q, actor, { now, settings, requestId, events }, b, { allowDuplicate: b.allow_duplicate, explicitOwner: explicit });
      return created(res);
    },
  },
  {
    method: "GET", path: "/leads/export.csv", permission: "leads:export", tx: false,
    async handler({ q, actor, query, requestId }) {
      const w = leadFilters(actor, query);
      const rows = await q.query(`SELECT l.number, l.first_name, l.last_name, l.email, l.phone, l.company, l.source, l.status, l.priority, l.score, m.display_name AS owner, l.country, l.created_at FROM sales_leads l LEFT JOIN sales_members m ON m.id = l.owner_id WHERE ${w.sql} ORDER BY l.number LIMIT 20000`, w.params);
      await audit(q, actor, { action: "lead.export", entityType: "lead", summary: `Exported ${rows.rows.length} leads` }, requestId);
      return csv("leads.csv", toCsv(["number", "first_name", "last_name", "email", "phone", "company", "source", "status", "priority", "score", "owner", "country", "created_at"], rows.rows));
    },
  },
  {
    method: "POST", path: "/leads/import", permission: "leads:import",
    async handler({ q, actor, body, now, settings, requestId, events }) {
      const b = parse(v.object({ csv: v.string({ min: 5, max: 2_000_000, raw: true }), dry_run: v.withDefault(v.boolean(), true), skip_duplicates: v.withDefault(v.boolean(), true) }), body);
      let rows: Array<Record<string, string>>;
      try { rows = csvToObjects(b.csv, 2000); } catch (e) { throw badRequest(e instanceof Error ? e.message : "The file could not be read as CSV"); }
      if (!rows.length) throw badRequest("The file has no data rows");
      const results: Array<{ row: number; status: "ok" | "duplicate" | "invalid"; message?: string }> = [];
      let createdN = 0;
      const seen = new Set<string>();
      for (let i = 0; i < rows.length; i++) {
        const raw: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(rows[i]!)) { const key = IMPORT_MAP[k.trim().toLowerCase()]; if (key && val.trim()) raw[key] = val.trim(); }
        try {
          const parsed = parse(v.object({ ...leadFields, source: v.withDefault(v.string({ max: 40 }), "import") }), raw);
          const key = normalizeEmail(parsed.email) ?? normalizePhone(parsed.phone) ?? "";
          if (key && seen.has(key)) { results.push({ row: i + 2, status: "duplicate", message: "Duplicate within the file" }); continue; }
          if (key) seen.add(key);
          if (!parsed.email && !parsed.phone) throw validationFailed([{ path: "email", message: "Email or phone required" }]);
          const dups = await findLeadDuplicates(q, settings, { id: 0, ...parsed });
          if (dups.length && b.skip_duplicates) { results.push({ row: i + 2, status: "duplicate", message: `Matches ${dups[0]!.number}` }); continue; }
          if (!b.dry_run) {
            const src = (SOURCES as readonly string[]).includes(parsed.source) ? parsed.source : "import";
            await createLead(q, actor, { now, settings, requestId, events }, { ...parsed, source: src, consent_email: false, consent_whatsapp: false }, { allowDuplicate: true });
            createdN++;
          }
          results.push({ row: i + 2, status: "ok" });
        } catch (e: any) {
          results.push({ row: i + 2, status: "invalid", message: e?.details?.issues?.map((x: any) => `${x.path}: ${x.message}`).join("; ") ?? e?.message ?? "Invalid row" });
        }
      }
      const summary = { total: rows.length, ok: results.filter((r) => r.status === "ok").length, duplicates: results.filter((r) => r.status === "duplicate").length, invalid: results.filter((r) => r.status === "invalid").length };
      if (!b.dry_run) {
        await q.query("INSERT INTO sales_import_jobs (entity, member_id, total_rows, created_rows, skipped_rows, failed_rows, errors) VALUES ('lead',$1,$2,$3,$4,$5,$6::text::jsonb)", [actor.memberId || null, summary.total, createdN, summary.duplicates, summary.invalid, JSON.stringify(results.filter((r) => r.status === "invalid").slice(0, 100))]);
        await audit(q, actor, { action: "lead.import", entityType: "lead", summary: `Imported ${createdN} of ${summary.total} leads` }, requestId);
      }
      return { dryRun: b.dry_run, created: createdN, summary, results: results.filter((r) => r.status !== "ok").slice(0, 200) };
    },
  },
  {
    method: "GET", path: "/leads/:id", permission: "leads:read",
    async handler({ q, actor, params, settings }) {
      const id = parse(v.id(), params.id);
      const lead = await loadLead(q, actor, id);
      const activities = (await q.query("SELECT id, type, subject, status, due_at, completed_at, outcome, description FROM sales_activities WHERE lead_id = $1 ORDER BY COALESCE(completed_at, due_at, created_at) DESC LIMIT 100", [id])).rows;
      const owner = lead.owner_id ? (await q.query("SELECT id, display_name FROM sales_members WHERE id = $1", [lead.owner_id])).rows[0] : null;
      const history = (await q.query("SELECT * FROM sales_ownership_history WHERE entity_type = 'lead' AND entity_id = $1 ORDER BY at DESC", [id])).rows;
      const duplicates = await findLeadDuplicates(q, settings, lead, id);
      const touches = (await q.query("SELECT t.kind, t.at, c.name AS campaign FROM sales_touches t JOIN sales_campaigns c ON c.id = t.campaign_id WHERE t.lead_id = $1 ORDER BY t.at DESC LIMIT 20", [id])).rows;
      return { lead: { ...lead, owner }, activities, ownershipHistory: history, duplicates, touches, transitions: allowedNext(lead.status) };
    },
  },
  {
    method: "PATCH", path: "/leads/:id", permission: "leads:write",
    async handler({ q, actor, params, body, now, settings, requestId }) {
      const id = parse(v.id(), params.id);
      const cur = await loadLead(q, actor, id, true);
      if (cur.status === "converted") throw conflict("A converted lead is read-only; edit the account or contact instead", "lead_converted");
      const b = parse(leadPatch, body);
      const sets: string[] = [];
      const p: unknown[] = [id];
      for (const [k, col] of Object.entries(LEAD_COLS)) if ((b as any)[k] !== undefined) { p.push((b as any)[k]); sets.push(`${col} = $${p.length}`); }
      const merged = { ...cur, ...b };
      if (!merged.email && !merged.phone) throw validationFailed([{ path: "email", message: "A lead needs an email address or a phone number" }]);
      const consentChanged = (b.consent_email !== undefined && b.consent_email !== cur.consent_email) || (b.consent_whatsapp !== undefined && b.consent_whatsapp !== cur.consent_whatsapp);
      if (!sets.length) return { ok: true };
      await q.query(`UPDATE sales_leads SET ${sets.join(", ")}, ${consentChanged ? "consent_recorded_at = now()," : ""} updated_at = now() WHERE id = $1`, p);
      const score = await rescore(q, id, settings, now);
      const d = diff(cur, merged);
      await audit(q, actor, { action: "lead.update", entityType: "lead", entityId: id, summary: `Updated lead ${cur.number}`, before: d.before, after: d.after }, requestId);
      return { ok: true, score };
    },
  },
  {
    method: "POST", path: "/leads/:id/status", permission: "leads:write",
    async handler({ q, actor, params, body, requestId, events }) {
      const id = parse(v.id(), params.id);
      const b = parse(statusBody, body);
      const cur = await loadLead(q, actor, id, true);
      if (b.status === "converted") throw badRequest("Use the convert action to convert a lead");
      assertTransition("lead", LEAD_TRANSITIONS_REF, cur.status, b.status);
      if (b.status === "disqualified" && !b.reason) throw validationFailed([{ path: "reason", message: "A disqualification reason is required" }]);
      await q.query(`UPDATE sales_leads SET status = $2, disqualification_reason = $3, updated_at = now() WHERE id = $1`, [id, b.status, b.status === "disqualified" ? b.reason : null]);
      if (b.status === "disqualified") await q.query("UPDATE sales_activities SET status = 'cancelled', updated_at = now() WHERE lead_id = $1 AND status = 'open'", [id]);
      await audit(q, actor, { action: "lead.status", entityType: "lead", entityId: id, summary: `${cur.number}: ${cur.status} → ${b.status}${b.reason ? ` (${b.reason})` : ""}`, before: { status: cur.status }, after: { status: b.status } }, requestId);
      events.push({ type: "lead.status_changed", entityType: "lead", entityId: id, data: { from: cur.status, to: b.status } });
      return { ok: true, status: b.status };
    },
  },
  {
    method: "POST", path: "/leads/:id/touch", permission: "leads:write",
    async handler({ q, actor, params, body, now, settings, requestId, events }) {
      const id = parse(v.id(), params.id);
      const b = parse(touchBody, body);
      const cur = await loadLead(q, actor, id, true);
      if (["converted", "disqualified"].includes(cur.status)) throw conflict(`This lead is ${cur.status}`, "lead_closed");
      const type = b.channel === "note" ? "note" : b.channel;
      const act = await q.query<{ id: number }>(
        `INSERT INTO sales_activities (type, subject, description, owner_id, lead_id, status, completed_at, outcome, created_by) VALUES ($1,$2,$3,$4,$5,'done',$6,$7,$8) RETURNING id`,
        [type, b.subject, b.notes ?? null, actor.memberId || cur.owner_id, id, now.toISOString(), b.outcome ?? null, actor.label],
      );
      const next = b.next_follow_up_at ?? new Date(now.getTime() + settings.leads.followUpDays * 86_400_000).toISOString();
      const advance = cur.status === "new" && b.channel !== "note";
      await q.query(`UPDATE sales_leads SET last_contact_at = $2, first_response_at = COALESCE(first_response_at, CASE WHEN $4 THEN $2::timestamptz END), status = CASE WHEN $4 THEN 'contacted' ELSE status END,
        next_action = COALESCE($5, next_action), next_follow_up_at = $3, updated_at = now() WHERE id = $1`, [id, now.toISOString(), next, advance, b.next_action ?? null]);
      await q.query("UPDATE sales_activities SET status = 'done', completed_at = $2, outcome = COALESCE(outcome, 'Completed by contact log'), updated_at = now() WHERE lead_id = $1 AND status = 'open' AND dedupe_key = $3", [id, now.toISOString(), `lead-followup:${id}:initial`]);
      const score = await rescore(q, id, settings, now);
      await audit(q, actor, { action: "lead.touch", entityType: "lead", entityId: id, summary: `Logged ${b.channel}: ${b.subject}` }, requestId);
      events.push({ type: "lead.contacted", entityType: "lead", entityId: id });
      return created({ activityId: act.rows[0]!.id, status: advance ? "contacted" : cur.status, score });
    },
  },
  {
    method: "POST", path: "/leads/:id/assign", permission: "leads:assign",
    async handler({ q, actor, params, body, requestId, events }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ owner_id: v.id(), reason: v.optional(v.string({ max: 300 })) }), body);
      const cur = await loadLead(q, actor, id, true);
      if (cur.status === "converted") throw conflict("A converted lead cannot be reassigned", "lead_converted");
      await changeOwner(q, actor, "lead", "sales_leads", id, b.owner_id, b.reason, requestId);
      await q.query("UPDATE sales_leads SET team_id = (SELECT team_id FROM sales_members WHERE id = $2) WHERE id = $1", [id, b.owner_id]);
      await q.query("UPDATE sales_activities SET owner_id = $2 WHERE lead_id = $1 AND status = 'open'", [id, b.owner_id]);
      events.push({ type: "lead.assigned", entityType: "lead", entityId: id, data: { owner_id: b.owner_id } });
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/leads/:id/claim", permission: "leads:write",
    async handler({ q, actor, params, requestId, events }) {
      const id = parse(v.id(), params.id);
      if (!actor.memberId) throw forbidden("Only a sales member can claim a lead");
      const row = (await q.query<any>("SELECT * FROM sales_leads WHERE id = $1 AND archived_at IS NULL AND merged_into_id IS NULL FOR UPDATE", [id])).rows[0];
      if (!row) throw notFound("Lead");
      if (row.owner_id !== null) throw conflict("This lead already has an owner", "already_assigned");
      if (["converted", "disqualified"].includes(row.status)) throw conflict(`This lead is ${row.status}`, "lead_closed");
      await changeOwner(q, actor, "lead", "sales_leads", id, actor.memberId, "Claimed from the unassigned queue", requestId);
      await q.query("UPDATE sales_leads SET team_id = (SELECT team_id FROM sales_members WHERE id = $2) WHERE id = $1", [id, actor.memberId]);
      events.push({ type: "lead.assigned", entityType: "lead", entityId: id, data: { owner_id: actor.memberId } });
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/leads/:id/rescore", permission: "leads:write",
    async handler({ q, actor, params, now, settings }) {
      const id = parse(v.id(), params.id);
      await loadLead(q, actor, id, true);
      const score = await rescore(q, id, settings, now);
      const row = (await q.query<{ score_breakdown: unknown }>("SELECT score_breakdown FROM sales_leads WHERE id = $1", [id])).rows[0]!;
      return { score, breakdown: row.score_breakdown };
    },
  },
  {
    method: "POST", path: "/leads/:id/merge", permission: "leads:merge",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(mergeBody, body);
      if (b.duplicate_id === id) throw badRequest("Choose a different lead to merge");
      // lock in id order to avoid deadlocks when two merges run at once
      const [a, z] = [id, b.duplicate_id].sort((x, y) => x - y);
      await q.query("SELECT id FROM sales_leads WHERE id IN ($1,$2) ORDER BY id FOR UPDATE", [a, z]);
      const primary = await loadLead(q, actor, id);
      const dup = await loadLead(q, actor, b.duplicate_id);
      if (primary.status === "converted" || dup.status === "converted") throw conflict("Converted leads cannot be merged", "lead_converted");
      const fields = ["last_name", "email", "phone", "company", "job_title", "industry", "segment", "country", "region", "product_interest", "budget", "estimated_value", "notes"] as const;
      const patch: Record<string, unknown> = {};
      for (const f of fields) {
        const pref = b.keep[f];
        if ((pref === "duplicate" && dup[f] != null) || (primary[f] == null && dup[f] != null)) patch[f] = dup[f];
      }
      const keys = Object.keys(patch);
      if (keys.length) await q.query(`UPDATE sales_leads SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [id, ...keys.map((k) => patch[k])]);
      await q.query("UPDATE sales_activities SET lead_id = $1 WHERE lead_id = $2", [id, b.duplicate_id]);
      await q.query("UPDATE sales_touches SET lead_id = $1 WHERE lead_id = $2", [id, b.duplicate_id]);
      await q.query("UPDATE sales_campaign_members SET lead_id = $1 WHERE lead_id = $2 AND NOT EXISTS (SELECT 1 FROM sales_campaign_members x WHERE x.lead_id = $1 AND x.campaign_id = sales_campaign_members.campaign_id)", [id, b.duplicate_id]);
      await q.query("DELETE FROM sales_campaign_members WHERE lead_id = $1", [b.duplicate_id]);
      await q.query("UPDATE sales_leads SET merged_into_id = $2, archived_at = now(), status = CASE WHEN status = 'converted' THEN status ELSE 'disqualified' END, disqualification_reason = 'Merged into ' || $3, updated_at = now() WHERE id = $1", [b.duplicate_id, id, primary.number]);
      await audit(q, actor, { action: "lead.merge", entityType: "lead", entityId: id, summary: `Merged ${dup.number} into ${primary.number}`, before: { primary, duplicate: dup }, after: patch }, requestId);
      return { ok: true, mergedFields: keys };
    },
  },
  {
    method: "POST", path: "/leads/:id/convert", permission: "leads:write", idempotent: true,
    async handler({ q, actor, params, body, now, settings, requestId, events }) {
      const id = parse(v.id(), params.id);
      const b = parse(convertBody, body);
      const lead = await loadLead(q, actor, id, true);
      if (lead.status === "converted") throw conflict("This lead has already been converted", "already_converted", { account_id: lead.converted_account_id, opportunity_id: lead.converted_opportunity_id });
      if (lead.status !== "qualified") throw unprocessable("Only a qualified lead can be converted. Qualify it first.", "not_qualified");
      let accountId: number;
      let accountCreated = false;
      if (b.account_id) {
        const a = (await q.query<{ id: number; owner_id: number | null }>("SELECT id, owner_id FROM sales_accounts WHERE id = $1 AND archived_at IS NULL AND merged_into_id IS NULL", [b.account_id])).rows[0];
        if (!a) throw notFound("Account");
        accountId = a.id;
      } else {
        const name = b.account_name ?? lead.company ?? [lead.first_name, lead.last_name].filter(Boolean).join(" ");
        if (!b.allow_duplicate_account) {
          const dups = await findSimilarAccounts(q, name);
          if (dups.length) throw conflict("A very similar account already exists. Pick it, or confirm to create a new one.", "possible_duplicate_account", { candidates: dups });
        }
        const number = await nextNumber(q, "account", now, { yearly: false, prefix: settings.numbering.accountPrefix });
        const ins = await q.query<{ id: number }>(
          `INSERT INTO sales_accounts (number, name, kind, status, industry, segment, email, phone, country, region, territory_id, owner_id, currency, consent_email, consent_whatsapp, consent_recorded_at, created_by)
           VALUES ($1,$2,$3,'prospect',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
          [number, name, lead.company ? "company" : "individual", lead.industry, lead.segment, lead.email, lead.phone, lead.country, lead.region, lead.territory_id, lead.owner_id ?? (actor.memberId || null), settings.business.currency, lead.consent_email, lead.consent_whatsapp, lead.consent_recorded_at, actor.label],
        );
        accountId = ins.rows[0]!.id;
        accountCreated = true;
      }
      const hasPrimary = (await q.query("SELECT 1 FROM sales_contacts WHERE account_id = $1 AND is_primary AND archived_at IS NULL", [accountId])).rows[0];
      const existingContact = lead.email ? (await q.query<{ id: number }>("SELECT id FROM sales_contacts WHERE account_id = $1 AND lower(email) = lower($2) AND archived_at IS NULL LIMIT 1", [accountId, lead.email])).rows[0] : undefined;
      let contactId: number;
      if (existingContact) contactId = existingContact.id;
      else {
        const c = await q.query<{ id: number }>(
          `INSERT INTO sales_contacts (account_id, first_name, last_name, email, phone, job_title, is_primary, owner_id, consent_email, consent_whatsapp, consent_recorded_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [accountId, lead.first_name, lead.last_name, lead.email, lead.phone, lead.job_title, !hasPrimary, lead.owner_id, lead.consent_email, lead.consent_whatsapp, lead.consent_recorded_at, actor.label],
        );
        contactId = c.rows[0]!.id;
      }
      let oppId: number | null = null;
      let oppNumber: string | null = null;
      if (b.create_opportunity) {
        const amount = b.opportunity_amount ?? lead.estimated_value ?? lead.budget ?? "0.00";
        const closeDate = b.expected_close_date ?? d10(new Date(now.getTime() + 30 * 86_400_000));
        const o = await createOpportunity(q, actor, { now, settings, requestId, events }, {
          name: b.opportunity_name ?? `${lead.company ?? lead.first_name} – ${lead.product_interest ?? "New opportunity"}`, account_id: accountId, contact_id: contactId, lead_id: id,
          pipeline_id: b.pipeline_id, owner_id: lead.owner_id ?? actor.memberId ?? null, amount, expected_close_date: closeDate, source: lead.source, campaign_id: lead.campaign_id,
        });
        oppId = o.id;
        oppNumber = o.number;
      }
      await q.query("UPDATE sales_activities SET account_id = $2, contact_id = $3, opportunity_id = $4 WHERE lead_id = $1", [id, accountId, contactId, oppId]);
      await q.query("UPDATE sales_leads SET status = 'converted', converted_account_id = $2, converted_contact_id = $3, converted_opportunity_id = $4, converted_at = $5, updated_at = now() WHERE id = $1", [id, accountId, contactId, oppId, now.toISOString()]);
      await q.query("UPDATE sales_campaign_members SET status = 'converted' WHERE lead_id = $1", [id]);
      await audit(q, actor, { action: "lead.convert", entityType: "lead", entityId: id, summary: `Converted ${lead.number} → account ${accountId}${oppNumber ? `, opportunity ${oppNumber}` : ""}`, after: { accountId, contactId, oppId, accountCreated } }, requestId);
      events.push({ type: "lead.converted", entityType: "lead", entityId: id, data: { account_id: accountId, opportunity_id: oppId } });
      return { ok: true, accountId, contactId, opportunityId: oppId, opportunityNumber: oppNumber, accountCreated };
    },
  },
  {
    method: "DELETE", path: "/leads/:id", permission: "leads:delete",
    async handler({ q, actor, params, requestId }) {
      const id = parse(v.id(), params.id);
      const cur = await loadLead(q, actor, id, true);
      if (cur.status === "converted") throw conflict("A converted lead is part of the sales history and cannot be archived", "lead_converted");
      await q.query("UPDATE sales_leads SET archived_at = now(), updated_at = now() WHERE id = $1", [id]);
      await q.query("UPDATE sales_activities SET status = 'cancelled' WHERE lead_id = $1 AND status = 'open'", [id]);
      await audit(q, actor, { action: "lead.archive", entityType: "lead", entityId: id, summary: `Archived ${cur.number}` }, requestId);
      return noContent();
    },
  },
  // ───── web forms (admin)
  {
    method: "GET", path: "/lead-forms", permission: "leads:import", tx: false,
    async handler({ q }) {
      return { items: (await q.query("SELECT id, name, token, campaign_id, owner_id, source, require_consent, active, submissions, created_at FROM sales_lead_forms ORDER BY created_at DESC")).rows };
    },
  },
  {
    method: "POST", path: "/lead-forms", permission: "leads:import",
    async handler({ q, actor, body, requestId }) {
      const b = parse(formBody, body);
      const token = randomBytes(18).toString("base64url");
      const r = await q.query<{ id: number }>("INSERT INTO sales_lead_forms (name, token, campaign_id, owner_id, source, require_consent, active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id", [b.name, token, b.campaign_id ?? null, b.owner_id ?? null, b.source, b.require_consent, b.active]);
      await audit(q, actor, { action: "lead_form.create", entityType: "lead_form", entityId: r.rows[0]!.id, summary: `Created lead form ${b.name}` }, requestId);
      return created({ id: r.rows[0]!.id, token });
    },
  },
  {
    method: "PATCH", path: "/lead-forms/:id", permission: "leads:import",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ active: v.optional(v.boolean()), name: v.optional(v.string({ min: 2, max: 120 })), require_consent: v.optional(v.boolean()) }), body);
      const r = await q.query("UPDATE sales_lead_forms SET active = COALESCE($2, active), name = COALESCE($3, name), require_consent = COALESCE($4, require_consent), updated_at = now() WHERE id = $1 RETURNING id", [id, b.active ?? null, b.name ?? null, b.require_consent ?? null]);
      if (!r.rows[0]) throw notFound("Lead form");
      await audit(q, actor, { action: "lead_form.update", entityType: "lead_form", entityId: id, summary: "Updated lead form", after: b }, requestId);
      return { ok: true };
    },
  },
  // ───── web forms (public)
  {
    method: "GET", path: "/public/lead-forms/:token", permission: null, public: true, tx: false,
    async handler({ q, params }) {
      const f = (await q.query<any>("SELECT name, require_consent FROM sales_lead_forms WHERE token = $1 AND active", [params.token])).rows[0];
      if (!f) throw notFound("Form");
      return { name: f.name, requireConsent: f.require_consent };
    },
  },
  {
    method: "POST", path: "/public/lead-forms/:token/submit", permission: null, public: true,
    async handler({ q, params, body, now, settings, requestId, events }) {
      const f = (await q.query<any>("SELECT * FROM sales_lead_forms WHERE token = $1 AND active FOR UPDATE", [params.token])).rows[0];
      if (!f) throw notFound("Form");
      const b = parse(publicSubmit, body);
      if (b.website) return { ok: true }; // honeypot: pretend success, store nothing
      if (f.require_consent && !b.consent) throw validationFailed([{ path: "consent", message: "Please agree to be contacted" }]);
      if (!b.email && !b.phone) throw validationFailed([{ path: "email", message: "Enter an email address or a phone number" }]);
      let leadNumber: string | null = null;
      try {
        const res = await createLead(q, PUBLIC_ACTOR, { now, settings, requestId, events }, {
          first_name: b.first_name, last_name: b.last_name, email: b.email, phone: b.phone, company: b.company, source: f.source, campaign_id: f.campaign_id ?? undefined, notes: b.message,
          consent_email: !!b.email && b.consent, consent_whatsapp: false, owner_id: f.owner_id ?? undefined,
          utm: Object.fromEntries(Object.entries({ source: b.utm_source, medium: b.utm_medium, campaign: b.utm_campaign }).filter(([, x]) => x)) as Record<string, string>,
        }, { allowDuplicate: false, explicitOwner: !!f.owner_id });
        leadNumber = res.number;
      } catch (e: any) {
        // A repeat submission is not an error for the visitor and must not reveal whether the person is already known.
        if (e?.code !== "possible_duplicate") throw e;
      }
      await q.query("UPDATE sales_lead_forms SET submissions = submissions + 1 WHERE id = $1", [f.id]);
      void leadNumber;
      return created({ ok: true });
    },
  },
  {
    method: "GET", path: "/lead-meta", permission: "leads:read", tx: false,
    async handler() {
      return { statuses: STATUSES, priorities: PRIORITIES, sources: SOURCES };
    },
  },
];

import { LEAD_TRANSITIONS as LEAD_TRANSITIONS_REF } from "../domain/state-machines";

function allowedNext(status: string): string[] {
  return [...((LEAD_TRANSITIONS_REF as Record<string, readonly string[]>)[status] ?? [])];
}

export async function loadLead(q: Queryable, actor: Actor, id: number, forUpdate = false): Promise<any> {
  const r = await q.query<any>(`SELECT * FROM sales_leads WHERE id = $1 AND archived_at IS NULL ${forUpdate ? "FOR UPDATE" : ""}`, [id]);
  const row = r.rows[0];
  if (!row) throw notFound("Lead");
  // unassigned leads are visible to people who can assign or claim them
  if (row.owner_id === null && (can(actor, "leads:assign") || actor.role === "sales_rep")) return row;
  assertOwnerAccess(actor, row.owner_id, "Lead");
  return row;
}
