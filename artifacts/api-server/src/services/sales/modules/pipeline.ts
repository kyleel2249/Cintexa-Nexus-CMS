import { v, parse } from "../core/validate";
import { created, noContent, type Route, type DomainEvent } from "../core/router";
import { notFound, conflict, badRequest, validationFailed, unprocessable } from "../core/errors";
import { audit, diff } from "../core/audit";
import { nextNumber } from "../core/numbering";
import { can } from "../core/rbac";
import { pageOf, orderBy, str, d10 } from "../core/http";
import { cmp } from "../core/money";
import { Where, scopeSql, loadOwned, changeOwner } from "./common";
import { visibleAccount } from "./accounts";
import type { Actor, Queryable } from "../core/types";
import type { SalesSettings } from "../core/settings";

export const REQUIRED_FIELD_KEYS = ["contact_id", "expected_close_date", "next_action", "buying_criteria", "stakeholders", "risks", "amount", "source"] as const;
const FORECAST_CATS = ["omitted", "pipeline", "best_case", "commit", "closed"] as const;

interface StageRow {
  id: number;
  pipeline_id: number;
  name: string;
  position: number;
  probability: string;
  kind: "open" | "won" | "lost";
  forecast_category: (typeof FORECAST_CATS)[number];
  required_fields: string[];
  stalled_after_days: number;
}

export async function getStage(q: Queryable, id: number): Promise<StageRow> {
  const r = await q.query<StageRow>("SELECT * FROM sales_pipeline_stages WHERE id = $1 AND archived_at IS NULL", [id]);
  if (!r.rows[0]) throw notFound("Pipeline stage");
  return r.rows[0];
}

export async function defaultPipeline(q: Queryable, pipelineId?: number): Promise<{ pipelineId: number; stages: StageRow[] }> {
  if (!pipelineId) await ensureDefaultPipeline(q);
  const p = pipelineId
    ? (await q.query<{ id: number }>("SELECT id FROM sales_pipelines WHERE id = $1 AND archived_at IS NULL", [pipelineId])).rows[0]
    : (await q.query<{ id: number }>("SELECT id FROM sales_pipelines WHERE is_default AND archived_at IS NULL")).rows[0];
  if (!p) throw conflict("No sales pipeline is configured. Ask an administrator to create one in Sales Settings.", "no_pipeline");
  const stages = (await q.query<StageRow>("SELECT * FROM sales_pipeline_stages WHERE pipeline_id = $1 AND archived_at IS NULL ORDER BY position", [p.id])).rows;
  return { pipelineId: p.id, stages };
}

/** Seed the default pipeline once (idempotent). Called when settings/pipelines are first read. */
export async function ensureDefaultPipeline(q: Queryable): Promise<void> {
  const exists = (await q.query("SELECT 1 FROM sales_pipelines WHERE archived_at IS NULL LIMIT 1")).rows[0];
  if (exists) return;
  const p = await q.query<{ id: number }>("INSERT INTO sales_pipelines (name, is_default) VALUES ('Sales Pipeline', TRUE) ON CONFLICT DO NOTHING RETURNING id");
  if (!p.rows[0]) return; // another request seeded it
  const defaults: Array<[string, number, string, string, string[]]> = [
    ["Qualification", 10, "open", "pipeline", []], ["Discovery", 20, "open", "pipeline", []], ["Needs Analysis", 40, "open", "pipeline", ["contact_id"]],
    ["Proposal", 60, "open", "best_case", ["amount", "expected_close_date"]], ["Negotiation", 80, "open", "commit", ["amount", "expected_close_date", "next_action"]],
    ["Verbal Commitment", 90, "open", "commit", ["amount", "expected_close_date", "contact_id"]], ["Closed Won", 100, "won", "closed", ["amount"]], ["Closed Lost", 0, "lost", "omitted", []],
  ];
  let pos = 1;
  for (const [name, prob, kind, cat, req] of defaults) {
    await q.query(`INSERT INTO sales_pipeline_stages (pipeline_id, name, position, probability, kind, forecast_category, required_fields) VALUES ($1,$2,$3,$4,$5,$6,ARRAY(SELECT jsonb_array_elements_text($7::text::jsonb)))`, [p.rows[0].id, name, pos++, prob, kind, cat, JSON.stringify(req)]);
  }
}

export interface NewOpportunity {
  name: string;
  account_id: number;
  contact_id?: number | null;
  lead_id?: number | null;
  pipeline_id?: number;
  owner_id?: number | null;
  amount: string;
  currency?: string;
  expected_close_date?: string | null;
  source?: string | null;
  campaign_id?: number | null;
  notes?: string | null;
  next_action?: string | null;
}

export async function createOpportunity(q: Queryable, actor: Actor, c: { now: Date; settings: SalesSettings; requestId: string; events: DomainEvent[] }, input: NewOpportunity): Promise<{ id: number; number: string }> {
  const { stages, pipelineId } = await defaultPipeline(q, input.pipeline_id);
  const first = stages.find((s) => s.kind === "open");
  if (!first) throw conflict("The pipeline has no open stage", "no_open_stage");
  const owner = input.owner_id === undefined ? actor.memberId : input.owner_id;
  const acct = (await q.query<{ territory_id: number | null; currency: string }>("SELECT territory_id, currency FROM sales_accounts WHERE id = $1", [input.account_id])).rows[0];
  if (!acct) throw notFound("Account");
  const team = owner ? (await q.query<{ team_id: number | null }>("SELECT team_id FROM sales_members WHERE id = $1", [owner])).rows[0]?.team_id ?? null : null;
  if (c.settings.pipeline.requireCloseDate && !input.expected_close_date) throw validationFailed([{ path: "expected_close_date", message: "Expected close date is required" }]);
  const number = await nextNumber(q, "opportunity", c.now, { yearly: c.settings.numbering.yearly, prefix: c.settings.numbering.opportunityPrefix });
  const r = await q.query<{ id: number }>(
    `INSERT INTO sales_opportunities (number, name, account_id, contact_id, lead_id, owner_id, team_id, territory_id, pipeline_id, stage_id, source, campaign_id, amount, currency, probability, forecast_category,
       expected_close_date, notes, next_action, created_by, last_activity_at, stage_entered_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20, now(), now()) RETURNING id`,
    [number, input.name, input.account_id, input.contact_id ?? null, input.lead_id ?? null, owner, team, acct.territory_id, pipelineId, first.id, input.source ?? null, input.campaign_id ?? null, input.amount,
      input.currency ?? acct.currency, first.probability, first.forecast_category, input.expected_close_date ?? null, input.notes ?? null, input.next_action ?? null, actor.label],
  );
  const id = r.rows[0]!.id;
  await q.query("INSERT INTO sales_opportunity_stage_history (opportunity_id, from_stage_id, to_stage_id, amount, expected_close_date, changed_by, note) VALUES ($1,NULL,$2,$3,$4,$5,'Created')", [id, first.id, input.amount, input.expected_close_date ?? null, actor.label]);
  await audit(q, actor, { action: "opportunity.create", entityType: "opportunity", entityId: id, summary: `Created opportunity ${number} ${input.name}`, after: input }, c.requestId);
  c.events.push({ type: "opportunity.created", entityType: "opportunity", entityId: id });
  return { id, number };
}

const oppCreate = v.object({
  name: v.string({ min: 2, max: 200 }), account_id: v.id(), contact_id: v.optional(v.id()), pipeline_id: v.optional(v.id()), owner_id: v.optional(v.id()), amount: v.money(), currency: v.optional(v.string({ min: 3, max: 3, upper: true, pattern: /^[A-Z]{3}$/ })),
  expected_close_date: v.optional(v.date()), source: v.optional(v.string({ max: 60 })), campaign_id: v.optional(v.id()), notes: v.optional(v.string({ max: 8000, raw: true })), next_action: v.optional(v.string({ max: 300 })),
});
const oppPatch = v.object({
  name: v.optional(v.string({ min: 2, max: 200 })), contact_id: v.nullable(v.id()), amount: v.optional(v.money()), currency: v.optional(v.string({ min: 3, max: 3, upper: true })), expected_close_date: v.nullable(v.date()),
  source: v.nullable(v.string({ max: 60 })), campaign_id: v.nullable(v.id()), next_action: v.nullable(v.string({ max: 300 })), next_action_date: v.nullable(v.date()), buying_criteria: v.nullable(v.string({ max: 4000, raw: true })),
  objections: v.nullable(v.string({ max: 4000, raw: true })), stakeholders: v.nullable(v.string({ max: 4000, raw: true })), risks: v.nullable(v.string({ max: 4000, raw: true })), notes: v.nullable(v.string({ max: 8000, raw: true })),
  forecast_category: v.optional(v.enumOf(FORECAST_CATS)), probability: v.optional(v.number({ min: 0, max: 100 })), reset_probability: v.optional(v.boolean()),
});
const moveBody = v.object({ stage_id: v.id(), note: v.optional(v.string({ max: 500 })), lost_reason: v.optional(v.string({ min: 3, max: 300 })), lost_competitor_id: v.optional(v.id()) });
const stagesBody = v.object({
  name: v.optional(v.string({ min: 2, max: 80 })),
  stages: v.array(v.object({
    id: v.optional(v.id()), name: v.string({ min: 2, max: 60 }), probability: v.number({ min: 0, max: 100 }), kind: v.enumOf(["open", "won", "lost"] as const),
    forecast_category: v.withDefault(v.enumOf(FORECAST_CATS), "pipeline"), required_fields: v.withDefault(v.array(v.enumOf(REQUIRED_FIELD_KEYS), { max: 10 }), []), stalled_after_days: v.withDefault(v.int({ min: 1, max: 365 }), 14),
  }), { min: 3, max: 20 }),
});

const OPP_SELECT = `o.id, o.number, o.name, o.account_id, a.name AS account_name, o.contact_id, o.owner_id, m.display_name AS owner_name, o.pipeline_id, o.stage_id, s.name AS stage_name, s.position AS stage_position,
  o.status, o.amount, o.currency, o.probability, o.forecast_category, o.expected_close_date, o.closed_at, o.next_action, o.next_action_date, o.last_activity_at, o.stage_entered_at, o.created_at,
  (o.status = 'open' AND COALESCE(o.last_activity_at, o.stage_entered_at) < now() - (s.stalled_after_days || ' days')::interval) AS stalled,
  (o.status = 'open' AND o.expected_close_date IS NOT NULL AND o.expected_close_date < CURRENT_DATE) AS overdue`;
const OPP_FROM = `FROM sales_opportunities o JOIN sales_accounts a ON a.id = o.account_id JOIN sales_pipeline_stages s ON s.id = o.stage_id LEFT JOIN sales_members m ON m.id = o.owner_id`;

function oppFilters(actor: Actor, query: Record<string, string | string[] | undefined>): Where {
  const w = new Where().raw(scopeSql(actor, "o.owner_id")).raw("o.archived_at IS NULL");
  w.search(str(query, "q"), ["o.name", "o.number", "a.name"]);
  if (str(query, "status")) w.and("o.status = ?", str(query, "status"));
  if (str(query, "stage_id")) w.and("o.stage_id = ?", parse(v.id(), str(query, "stage_id")));
  if (str(query, "pipeline_id")) w.and("o.pipeline_id = ?", parse(v.id(), str(query, "pipeline_id")));
  if (str(query, "owner_id")) w.and("o.owner_id = ?", parse(v.id(), str(query, "owner_id")));
  if (str(query, "account_id")) w.and("o.account_id = ?", parse(v.id(), str(query, "account_id")));
  if (str(query, "close_from")) w.and("o.expected_close_date >= ?::date", parse(v.date(), str(query, "close_from")));
  if (str(query, "close_to")) w.and("o.expected_close_date <= ?::date", parse(v.date(), str(query, "close_to")));
  if (str(query, "forecast_category")) w.and("o.forecast_category = ?", str(query, "forecast_category"));
  if (str(query, "stalled") === "true") w.raw("o.status = 'open' AND COALESCE(o.last_activity_at, o.stage_entered_at) < now() - (s.stalled_after_days || ' days')::interval");
  if (str(query, "overdue") === "true") w.raw("o.status = 'open' AND o.expected_close_date < CURRENT_DATE");
  return w;
}

function missingRequired(opp: any, stage: StageRow, competitorCount: number): string[] {
  const missing: string[] = [];
  for (const f of stage.required_fields ?? []) {
    const val = opp[f];
    if (f === "amount") { if (!val || cmp(String(val), "0.00") <= 0) missing.push(f); }
    else if (val === null || val === undefined || String(val).trim() === "") missing.push(f);
  }
  void competitorCount;
  return missing;
}

export const pipelineRoutes: Route[] = [
  {
    method: "GET", path: "/pipelines", permission: "opportunities:read", tx: false,
    async handler({ db }) {
      await db.tx((t) => ensureDefaultPipeline(t));
      const p = (await db.query("SELECT id, name, is_default FROM sales_pipelines WHERE archived_at IS NULL ORDER BY is_default DESC, name")).rows as any[];
      const stages = (await db.query("SELECT * FROM sales_pipeline_stages WHERE archived_at IS NULL ORDER BY pipeline_id, position")).rows as any[];
      return { items: p.map((x) => ({ ...x, stages: stages.filter((s) => s.pipeline_id === x.id) })), requiredFieldOptions: REQUIRED_FIELD_KEYS };
    },
  },
  {
    method: "POST", path: "/pipelines", permission: "pipeline:configure",
    async handler({ q, actor, body, requestId }) {
      const b = parse(v.object({ name: v.string({ min: 2, max: 80 }) }), body);
      const r = await q.query<{ id: number }>("INSERT INTO sales_pipelines (name) VALUES ($1) RETURNING id", [b.name]);
      const id = r.rows[0]!.id;
      const base: Array<[string, number, string, string]> = [["Qualification", 10, "open", "pipeline"], ["Proposal", 50, "open", "best_case"], ["Closed Won", 100, "won", "closed"], ["Closed Lost", 0, "lost", "omitted"]];
      let pos = 1;
      for (const [n, p, k, c] of base) await q.query("INSERT INTO sales_pipeline_stages (pipeline_id, name, position, probability, kind, forecast_category) VALUES ($1,$2,$3,$4,$5,$6)", [id, n, pos++, p, k, c]);
      await audit(q, actor, { action: "pipeline.create", entityType: "pipeline", entityId: id, summary: `Created pipeline ${b.name}` }, requestId);
      return created({ id });
    },
  },
  {
    method: "PUT", path: "/pipelines/:id/stages", permission: "pipeline:configure",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(stagesBody, body);
      if (!(await q.query("SELECT 1 FROM sales_pipelines WHERE id = $1 AND archived_at IS NULL FOR UPDATE", [id])).rows[0]) throw notFound("Pipeline");
      const names = new Set<string>();
      const issues: Array<{ path: string; message: string }> = [];
      b.stages.forEach((s, i) => {
        const k = s.name.toLowerCase();
        if (names.has(k)) issues.push({ path: `stages[${i}].name`, message: "Stage names must be unique" });
        names.add(k);
        if (s.kind === "won" && s.probability !== 100) issues.push({ path: `stages[${i}].probability`, message: "A won stage must be 100%" });
        if (s.kind === "lost" && s.probability !== 0) issues.push({ path: `stages[${i}].probability`, message: "A lost stage must be 0%" });
        if (s.kind === "open" && (s.probability <= 0 || s.probability >= 100)) issues.push({ path: `stages[${i}].probability`, message: "Open stages must be between 0% and 100% (exclusive)" });
      });
      if (!b.stages.some((s) => s.kind === "open")) issues.push({ path: "stages", message: "At least one open stage is required" });
      if (!b.stages.some((s) => s.kind === "won")) issues.push({ path: "stages", message: "A won stage is required" });
      if (!b.stages.some((s) => s.kind === "lost")) issues.push({ path: "stages", message: "A lost stage is required" });
      // finals must come after every open stage so the funnel reads left to right
      const lastOpen = b.stages.map((s) => s.kind).lastIndexOf("open");
      const firstFinal = b.stages.findIndex((s) => s.kind !== "open");
      if (firstFinal !== -1 && firstFinal < lastOpen) issues.push({ path: "stages", message: "Won and lost stages must come after all open stages" });
      if (issues.length) throw validationFailed(issues);

      const existing = (await q.query<{ id: number }>("SELECT id FROM sales_pipeline_stages WHERE pipeline_id = $1 AND archived_at IS NULL", [id])).rows.map((x) => x.id);
      const keep = new Set(b.stages.filter((s) => s.id).map((s) => s.id as number));
      for (const sid of keep) if (!existing.includes(sid)) throw badRequest(`Stage ${sid} does not belong to this pipeline`);
      const removed = existing.filter((x) => !keep.has(x));
      for (const rid of removed) {
        const used = (await q.query<{ n: number }>("SELECT count(*)::int n FROM sales_opportunities WHERE stage_id = $1", [rid])).rows[0]!.n;
        if (used > 0) throw conflict(`Stage "${(await q.query<{ name: string }>("SELECT name FROM sales_pipeline_stages WHERE id = $1", [rid])).rows[0]?.name}" still has ${used} opportunit${used === 1 ? "y" : "ies"}. Move them first.`, "stage_in_use");
        await q.query("UPDATE sales_pipeline_stages SET archived_at = now(), name = name || ' (removed ' || id || ')' WHERE id = $1", [rid]);
      }
      let pos = 1;
      for (const s of b.stages) {
        if (s.id) await q.query(`UPDATE sales_pipeline_stages SET name=$2, position=$3, probability=$4, kind=$5, forecast_category=$6, required_fields=ARRAY(SELECT jsonb_array_elements_text($7::text::jsonb)), stalled_after_days=$8 WHERE id=$1`, [s.id, s.name, pos, s.probability, s.kind, s.forecast_category, JSON.stringify(s.required_fields), s.stalled_after_days]);
        else await q.query(`INSERT INTO sales_pipeline_stages (pipeline_id, name, position, probability, kind, forecast_category, required_fields, stalled_after_days) VALUES ($1,$2,$3,$4,$5,$6,ARRAY(SELECT jsonb_array_elements_text($7::text::jsonb)),$8)`, [id, s.name, pos, s.probability, s.kind, s.forecast_category, JSON.stringify(s.required_fields), s.stalled_after_days]);
        pos++;
      }
      if (b.name) await q.query("UPDATE sales_pipelines SET name = $2, updated_at = now() WHERE id = $1", [id, b.name]);
      await audit(q, actor, { action: "pipeline.configure", entityType: "pipeline", entityId: id, summary: `Reconfigured pipeline stages (${b.stages.length} stages)`, after: b.stages }, requestId);
      return { ok: true };
    },
  },
  // ───────── opportunities
  {
    method: "GET", path: "/opportunities", permission: "opportunities:read",
    async handler({ q, actor, query }) {
      const w = oppFilters(actor, query);
      const { page, pageSize, offset } = pageOf(query);
      const order = orderBy(query, { created: "o.created_at", amount: "o.amount", close: "o.expected_close_date", name: "o.name", stage: "s.position", updated: "o.updated_at" }, "created");
      const total = (await q.query<{ n: number; amount: string; weighted: string }>(`SELECT count(*)::int n, COALESCE(sum(o.amount),0)::text amount, COALESCE(sum(o.amount * o.probability / 100),0)::text weighted ${OPP_FROM} WHERE ${w.sql}`, w.params)).rows[0]!;
      const r = await q.query(`SELECT ${OPP_SELECT} ${OPP_FROM} WHERE ${w.sql} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`, w.params);
      return { items: r.rows, total: total.n, totals: { amount: total.amount, weighted: total.weighted }, page, pageSize };
    },
  },
  {
    method: "GET", path: "/pipeline/board", permission: "opportunities:read",
    async handler({ db, actor, query }) {
      await db.tx((t) => ensureDefaultPipeline(t));
      const { pipelineId, stages } = await defaultPipeline(db, str(query, "pipeline_id") ? parse(v.id(), str(query, "pipeline_id")) : undefined);
      const w = oppFilters(actor, query).and("o.pipeline_id = ?", pipelineId);
      w.raw("o.status = 'open'");
      const totals = (await db.query<{ stage_id: number; n: number; amount: string; weighted: string }>(`SELECT o.stage_id, count(*)::int n, COALESCE(sum(o.amount),0)::text amount, COALESCE(sum(o.amount*o.probability/100),0)::text weighted ${OPP_FROM} WHERE ${w.sql} GROUP BY o.stage_id`, w.params)).rows;
      const columns = [];
      for (const s of stages.filter((x) => x.kind === "open")) {
        const cards = (await db.query(`SELECT ${OPP_SELECT} ${OPP_FROM} WHERE ${w.sql} AND o.stage_id = ${Number(s.id)} ORDER BY o.amount DESC, o.id LIMIT 50`, w.params)).rows;
        const t = totals.find((x) => x.stage_id === s.id);
        columns.push({ stage: s, count: t?.n ?? 0, amount: t?.amount ?? "0.00", weighted: t?.weighted ?? "0.00", cards });
      }
      return { pipelineId, columns, finalStages: stages.filter((x) => x.kind !== "open") };
    },
  },
  {
    method: "GET", path: "/pipeline/analytics", permission: "opportunities:read",
    async handler({ db, actor, query, now }) {
      const { pipelineId, stages } = await defaultPipeline(db, str(query, "pipeline_id") ? parse(v.id(), str(query, "pipeline_id")) : undefined);
      const scope = scopeSql(actor, "o.owner_id");
      // funnel: how many opportunities ever reached each stage (or beyond, by position)
      const reached = (await db.query<{ stage_id: number; n: number }>(
        `SELECT h.to_stage_id AS stage_id, count(DISTINCT h.opportunity_id)::int n FROM sales_opportunity_stage_history h JOIN sales_opportunities o ON o.id = h.opportunity_id
         WHERE o.pipeline_id = $1 AND ${scope} GROUP BY h.to_stage_id`, [pipelineId])).rows;
      const aging = (await db.query<{ stage_id: number; avg_days: string | null; n: number }>(
        `SELECT o.stage_id, avg(EXTRACT(EPOCH FROM ($2::timestamptz - o.stage_entered_at)) / 86400)::numeric(10,1)::text AS avg_days, count(*)::int n FROM sales_opportunities o
         WHERE o.pipeline_id = $1 AND o.status = 'open' AND o.archived_at IS NULL AND ${scope} GROUP BY o.stage_id`, [pipelineId, now.toISOString()])).rows;
      const open = stages.filter((s) => s.kind === "open");
      const funnel = open.map((s, i) => {
        const n = reached.find((r) => r.stage_id === s.id)?.n ?? 0;
        const prev = i === 0 ? null : open.slice(0, i).reduce((m, p) => Math.max(m, reached.find((r) => r.stage_id === p.id)?.n ?? 0), 0);
        const a = aging.find((x) => x.stage_id === s.id);
        return { stage_id: s.id, name: s.name, reached: n, conversionFromPrevious: prev ? Math.round((n / prev) * 1000) / 10 : null, openNow: a?.n ?? 0, avgDaysInStage: a?.avg_days ? Number(a.avg_days) : null };
      });
      const won = reached.find((r) => r.stage_id === stages.find((s) => s.kind === "won")?.id)?.n ?? 0;
      const lost = reached.find((r) => r.stage_id === stages.find((s) => s.kind === "lost")?.id)?.n ?? 0;
      const pipeline = (await db.query<{ amount: string; weighted: string }>(`SELECT COALESCE(sum(o.amount),0)::text amount, COALESCE(sum(o.amount*o.probability/100),0)::text weighted FROM sales_opportunities o WHERE o.pipeline_id=$1 AND o.status='open' AND o.archived_at IS NULL AND ${scope}`, [pipelineId])).rows[0]!;
      return { pipelineId, funnel, won, lost, winRate: won + lost ? Math.round((won / (won + lost)) * 1000) / 10 : null, openAmount: pipeline.amount, weightedAmount: pipeline.weighted, definitions: { weighted: "amount × stage probability ÷ 100 (amounts exclude tax and are not currency-converted)" } };
    },
  },
  {
    method: "POST", path: "/opportunities", permission: "opportunities:write", idempotent: true,
    async handler({ q, actor, body, now, settings, requestId, events }) {
      const b = parse(oppCreate, body);
      await visibleAccount(q, actor, b.account_id);
      if (b.owner_id !== undefined && b.owner_id !== actor.memberId && !can(actor, "opportunities:assign")) throw badRequest("You cannot assign opportunities to other people");
      if (b.contact_id) {
        const c = (await q.query("SELECT 1 FROM sales_contacts WHERE id = $1 AND account_id = $2 AND archived_at IS NULL", [b.contact_id, b.account_id])).rows[0];
        if (!c) throw badRequest("The contact does not belong to this account");
      }
      return created(await createOpportunity(q, actor, { now, settings, requestId, events }, b));
    },
  },
  {
    method: "GET", path: "/opportunities/:id", permission: "opportunities:read",
    async handler({ q, actor, params }) {
      const id = parse(v.id(), params.id);
      const opp = await loadOwned<any>(q, actor, "sales_opportunities", id, "Opportunity", { extraWhere: "archived_at IS NULL" });
      const row = (await q.query(`SELECT ${OPP_SELECT} ${OPP_FROM} WHERE o.id = $1`, [id])).rows[0] as any;
      const history = (await q.query("SELECT h.*, f.name AS from_stage, t.name AS to_stage FROM sales_opportunity_stage_history h LEFT JOIN sales_pipeline_stages f ON f.id = h.from_stage_id JOIN sales_pipeline_stages t ON t.id = h.to_stage_id WHERE h.opportunity_id = $1 ORDER BY h.at, h.id", [id])).rows;
      const changes = (await q.query("SELECT * FROM sales_opportunity_changes WHERE opportunity_id = $1 ORDER BY at DESC, id DESC LIMIT 50", [id])).rows;
      const products = (await q.query("SELECT op.*, p.name, p.sku FROM sales_opportunity_products op JOIN sales_products p ON p.id = op.product_id WHERE op.opportunity_id = $1 ORDER BY op.id", [id])).rows;
      const competitors = (await q.query("SELECT oc.*, c.name FROM sales_opportunity_competitors oc JOIN sales_competitors c ON c.id = oc.competitor_id WHERE oc.opportunity_id = $1", [id])).rows;
      const activities = (await q.query("SELECT id, type, subject, status, due_at, completed_at, outcome FROM sales_activities WHERE opportunity_id = $1 ORDER BY COALESCE(completed_at, due_at, created_at) DESC LIMIT 50", [id])).rows;
      const out: Record<string, unknown> = { opportunity: { ...opp, ...row }, history, changes, products, competitors, activities };
      if (can(actor, "quotations:read")) out.quotations = (await q.query("SELECT id, number, version, status, total, currency, validity_date FROM sales_quotations WHERE opportunity_id = $1 AND status <> 'superseded' ORDER BY created_at DESC", [id])).rows;
      return out;
    },
  },
  {
    method: "PATCH", path: "/opportunities/:id", permission: "opportunities:write",
    async handler({ q, actor, params, body, requestId, events }) {
      const id = parse(v.id(), params.id);
      const cur = await loadOwned<any>(q, actor, "sales_opportunities", id, "Opportunity", { forUpdate: true, extraWhere: "archived_at IS NULL" });
      const b = parse(oppPatch, body);
      const closed = cur.status !== "open";
      const financialChange = b.amount !== undefined || b.expected_close_date !== undefined || b.forecast_category !== undefined || b.probability !== undefined || b.contact_id !== undefined;
      if (closed && financialChange) throw conflict("A closed opportunity's amount, dates and forecast cannot be edited. Reopen it first.", "opportunity_closed");
      if (b.contact_id) {
        if (!(await q.query("SELECT 1 FROM sales_contacts WHERE id = $1 AND account_id = $2 AND archived_at IS NULL", [b.contact_id, cur.account_id])).rows[0]) throw badRequest("The contact does not belong to this account");
      }
      const sets: string[] = [];
      const p: unknown[] = [id];
      const add = (col: string, val: unknown) => { p.push(val); sets.push(`${col} = $${p.length}`); };
      for (const k of ["name", "contact_id", "currency", "source", "campaign_id", "next_action", "next_action_date", "buying_criteria", "objections", "stakeholders", "risks", "notes", "forecast_category"] as const) if ((b as any)[k] !== undefined) add(k, (b as any)[k]);
      if (b.amount !== undefined && cmp(b.amount, cur.amount) !== 0) {
        add("amount", b.amount);
        events.push({ type: "opportunity.amount_changed", entityType: "opportunity", entityId: id, data: { from: cur.amount, to: b.amount } });
        await q.query("INSERT INTO sales_opportunity_changes (opportunity_id, field, old_value, new_value, changed_by) VALUES ($1,'amount',$2,$3,$4)", [id, cur.amount, b.amount, actor.label]);
      }
      if (b.expected_close_date !== undefined && d10(b.expected_close_date) !== d10(cur.expected_close_date)) {
        add("expected_close_date", b.expected_close_date);
        if (b.expected_close_date && cur.expected_close_date && d10(b.expected_close_date)! > d10(cur.expected_close_date)!) sets.push("close_date_changes = close_date_changes + 1");
        await q.query("INSERT INTO sales_opportunity_changes (opportunity_id, field, old_value, new_value, changed_by) VALUES ($1,'expected_close_date',$2,$3,$4)", [id, d10(cur.expected_close_date), b.expected_close_date ? d10(b.expected_close_date) : null, actor.label]);
      }
      if (b.reset_probability) {
        const st = await getStage(q, cur.stage_id);
        add("probability", st.probability);
        sets.push("probability_overridden = FALSE");
      } else if (b.probability !== undefined) {
        add("probability", b.probability);
        sets.push("probability_overridden = TRUE");
      }
      if (!sets.length) return { ok: true };
      await q.query(`UPDATE sales_opportunities SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, p);
      const d = diff(cur, { ...cur, ...b });
      await audit(q, actor, { action: "opportunity.update", entityType: "opportunity", entityId: id, summary: `Updated opportunity ${cur.number}`, before: d.before, after: d.after }, requestId);
      return { ok: true, amountChanged: b.amount !== undefined && cmp(b.amount, cur.amount) !== 0 };
    },
  },
  {
    method: "POST", path: "/opportunities/:id/move", permission: "opportunities:write",
    async handler({ q, actor, params, body, now, requestId, events }) {
      const id = parse(v.id(), params.id);
      const b = parse(moveBody, body);
      const cur = await loadOwned<any>(q, actor, "sales_opportunities", id, "Opportunity", { forUpdate: true, extraWhere: "archived_at IS NULL" });
      const target = await getStage(q, b.stage_id);
      if (target.pipeline_id !== cur.pipeline_id) throw badRequest("The stage belongs to a different pipeline");
      if (target.id === cur.stage_id) return { ok: true, unchanged: true };
      if (cur.status !== "open" && !can(actor, "opportunities:override_close")) throw conflict("This opportunity is closed. Only a manager can reopen it.", "opportunity_closed");
      const competitorCount = (await q.query<{ n: number }>("SELECT count(*)::int n FROM sales_opportunity_competitors WHERE opportunity_id = $1", [id])).rows[0]!.n;
      const missing = missingRequired(cur, target, competitorCount);
      if (missing.length) throw unprocessable(`Complete these fields before moving to "${target.name}": ${missing.join(", ")}`, "required_fields_missing", { missing });
      if (target.kind === "lost" && !b.lost_reason) throw validationFailed([{ path: "lost_reason", message: "A lost reason is required" }]);
      if (target.kind === "won") {
        const acct = (await q.query<{ status: string }>("SELECT status FROM sales_accounts WHERE id = $1", [cur.account_id])).rows[0];
        if (acct?.status === "prospect") await q.query("UPDATE sales_accounts SET status = 'active', updated_at = now() WHERE id = $1", [cur.account_id]);
      }
      const status = target.kind === "open" ? "open" : target.kind;
      // Manual probability overrides survive moves between open stages; closing always resolves to 100/0.
      const keepOverride = cur.probability_overridden && target.kind === "open";
      await q.query(
        `UPDATE sales_opportunities SET stage_id = $2, status = $3, probability = $4, probability_overridden = $5, forecast_category = $6, stage_entered_at = now(),
           closed_at = CASE WHEN $3 = 'open' THEN NULL ELSE $7::timestamptz END, lost_reason = $8, lost_competitor_id = $9, updated_at = now(), last_activity_at = now() WHERE id = $1`,
        [id, target.id, status, keepOverride ? cur.probability : target.probability, keepOverride, target.forecast_category, now.toISOString(), target.kind === "lost" ? b.lost_reason ?? null : null, target.kind === "lost" ? b.lost_competitor_id ?? null : null],
      );
      await q.query("INSERT INTO sales_opportunity_stage_history (opportunity_id, from_stage_id, to_stage_id, amount, expected_close_date, changed_by, note) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, cur.stage_id, target.id, cur.amount, cur.expected_close_date, actor.label, b.note ?? b.lost_reason ?? null]);
      if (target.kind === "lost" && b.lost_competitor_id) {
        await q.query(`INSERT INTO sales_opportunity_competitors (opportunity_id, competitor_id, outcome) VALUES ($1,$2,'lost_to') ON CONFLICT (opportunity_id, competitor_id) DO UPDATE SET outcome = 'lost_to'`, [id, b.lost_competitor_id]);
      }
      await audit(q, actor, { action: target.kind === "won" ? "opportunity.won" : target.kind === "lost" ? "opportunity.lost" : "opportunity.move", entityType: "opportunity", entityId: id, summary: `${cur.number}: ${cur.stage_id} → ${target.name}${target.kind === "won" ? " (won; no invoice or payment is created by closing)" : ""}`, before: { stage_id: cur.stage_id, status: cur.status }, after: { stage_id: target.id, status } }, requestId);
      events.push({ type: "opportunity.stage_changed", entityType: "opportunity", entityId: id, data: { from_stage_id: cur.stage_id, to_stage_id: target.id, to_stage: target.name, status } });
      return { ok: true, status, stage: target.name, note: target.kind === "won" ? "Closing an opportunity does not create an invoice or record any payment. Create a sales order from an approved quotation to continue." : undefined };
    },
  },
  {
    method: "PUT", path: "/opportunities/:id/products", permission: "opportunities:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      await loadOwned(q, actor, "sales_opportunities", id, "Opportunity", { forUpdate: true });
      const b = parse(v.object({ products: v.array(v.object({ product_id: v.id(), quantity: v.number({ min: 0.0001, max: 1e9 }), unit_price: v.money() }), { max: 100 }) }), body);
      if (new Set(b.products.map((p) => p.product_id)).size !== b.products.length) throw badRequest("Each product can be listed once");
      await q.query("DELETE FROM sales_opportunity_products WHERE opportunity_id = $1", [id]);
      for (const p of b.products) await q.query("INSERT INTO sales_opportunity_products (opportunity_id, product_id, quantity, unit_price) VALUES ($1,$2,$3,$4)", [id, p.product_id, p.quantity, p.unit_price]);
      await audit(q, actor, { action: "opportunity.products", entityType: "opportunity", entityId: id, summary: `Set ${b.products.length} product(s)` }, requestId);
      return { ok: true };
    },
  },
  {
    method: "PUT", path: "/opportunities/:id/competitors", permission: "opportunities:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      await loadOwned(q, actor, "sales_opportunities", id, "Opportunity", { forUpdate: true });
      const b = parse(v.object({ competitors: v.array(v.object({ competitor_id: v.id(), outcome: v.withDefault(v.enumOf(["present", "won_against", "lost_to"] as const), "present"), notes: v.optional(v.string({ max: 500 })) }), { max: 20 }) }), body);
      await q.query("DELETE FROM sales_opportunity_competitors WHERE opportunity_id = $1", [id]);
      for (const c of b.competitors) await q.query("INSERT INTO sales_opportunity_competitors (opportunity_id, competitor_id, outcome, notes) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [id, c.competitor_id, c.outcome, c.notes ?? null]);
      await audit(q, actor, { action: "opportunity.competitors", entityType: "opportunity", entityId: id, summary: `Set ${b.competitors.length} competitor(s)` }, requestId);
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/opportunities/:id/assign", permission: "opportunities:assign",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ owner_id: v.id(), reason: v.optional(v.string({ max: 300 })) }), body);
      await loadOwned(q, actor, "sales_opportunities", id, "Opportunity", { forUpdate: true });
      await changeOwner(q, actor, "opportunity", "sales_opportunities", id, b.owner_id, b.reason, requestId);
      await q.query("UPDATE sales_opportunities SET team_id = (SELECT team_id FROM sales_members WHERE id = $2) WHERE id = $1", [id, b.owner_id]);
      return { ok: true };
    },
  },
  {
    method: "DELETE", path: "/opportunities/:id", permission: "opportunities:write",
    async handler({ q, actor, params, requestId }) {
      const id = parse(v.id(), params.id);
      const cur = await loadOwned<any>(q, actor, "sales_opportunities", id, "Opportunity", { forUpdate: true, extraWhere: "archived_at IS NULL" });
      const linked = (await q.query<{ n: number }>("SELECT (SELECT count(*) FROM sales_quotations WHERE opportunity_id = $1 AND status NOT IN ('superseded','cancelled','rejected','expired')) + (SELECT count(*) FROM sales_orders WHERE opportunity_id = $1 AND status <> 'cancelled') AS n", [id])).rows[0]!.n;
      if (Number(linked) > 0) throw conflict("This opportunity has active quotations or orders and cannot be archived", "opportunity_in_use");
      await q.query("UPDATE sales_opportunities SET archived_at = now(), updated_at = now() WHERE id = $1", [id]);
      await audit(q, actor, { action: "opportunity.archive", entityType: "opportunity", entityId: id, summary: `Archived ${cur.number}` }, requestId);
      return noContent();
    },
  },
];
