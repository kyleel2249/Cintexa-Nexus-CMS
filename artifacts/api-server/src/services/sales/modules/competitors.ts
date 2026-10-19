import { v, parse } from "../core/validate";
import { created, noContent, type Route } from "../core/router";
import { notFound, conflict, badRequest } from "../core/errors";
import { audit } from "../core/audit";
import { str } from "../core/http";
import { Where, buildUpdate } from "./common";

const KINDS = ["pricing", "product", "positioning", "objection", "observation", "win_loss"] as const;
const compFields = { name: v.string({ min: 2, max: 120 }), website: v.string({ max: 300, pattern: /^https?:\/\/[^\s]+$/i, patternMessage: "Enter a full http(s) URL" }), positioning: v.string({ max: 2000, raw: true }), value_proposition: v.string({ max: 2000, raw: true }), strengths: v.string({ max: 2000, raw: true }), weaknesses: v.string({ max: 2000, raw: true }) };
const map = { name: "name", website: "website", positioning: "positioning", value_proposition: "value_proposition", strengths: "strengths", weaknesses: "weaknesses" };
const intelBody = v.object({
  kind: v.enumOf(KINDS), title: v.string({ min: 2, max: 160 }), content: v.string({ min: 3, max: 4000, raw: true }), source: v.string({ min: 2, max: 200 }),
  source_url: v.optional(compFields.website), observed_on: v.date(), confidence: v.withDefault(v.enumOf(["low", "medium", "high"] as const), "low"),
});

export const competitorRoutes: Route[] = [
  {
    method: "GET", path: "/competitors", permission: "competitors:read", tx: false,
    async handler({ q, query }) {
      const w = new Where().raw("c.archived_at IS NULL").search(str(query, "q"), ["c.name"]);
      const items = (await q.query(`SELECT c.*, (SELECT count(*)::int FROM sales_competitor_intel i WHERE i.competitor_id = c.id AND i.archived_at IS NULL) AS intel_count,
        (SELECT count(*)::int FROM sales_opportunity_competitors oc WHERE oc.competitor_id = c.id) AS opportunities FROM sales_competitors c WHERE ${w.sql} ORDER BY c.name`, w.params)).rows;
      return { items };
    },
  },
  {
    method: "POST", path: "/competitors", permission: "competitors:write", idempotent: true,
    async handler({ q, actor, body, requestId }) {
      const b = parse(v.object({ name: compFields.name, website: v.optional(compFields.website), positioning: v.optional(compFields.positioning), value_proposition: v.optional(compFields.value_proposition), strengths: v.optional(compFields.strengths), weaknesses: v.optional(compFields.weaknesses) }), body);
      const r = await q.query<{ id: number }>("INSERT INTO sales_competitors (name, website, positioning, value_proposition, strengths, weaknesses) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [b.name, b.website ?? null, b.positioning ?? null, b.value_proposition ?? null, b.strengths ?? null, b.weaknesses ?? null]);
      await audit(q, actor, { action: "competitor.create", entityType: "competitor", entityId: r.rows[0]!.id, summary: `Added competitor ${b.name}` }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "GET", path: "/competitors/:id", permission: "competitors:read", tx: false,
    async handler({ q, params }) {
      const id = parse(v.id(), params.id);
      const c = (await q.query<any>("SELECT * FROM sales_competitors WHERE id = $1", [id])).rows[0];
      if (!c) throw notFound("Competitor");
      const intel = (await q.query("SELECT * FROM sales_competitor_intel WHERE competitor_id = $1 AND archived_at IS NULL ORDER BY observed_on DESC, id DESC", [id])).rows;
      const record = (await q.query<any>(`SELECT count(*)::int present, count(*) FILTER (WHERE outcome = 'won_against')::int won_against, count(*) FILTER (WHERE outcome = 'lost_to')::int lost_to FROM sales_opportunity_competitors WHERE competitor_id = $1`, [id])).rows[0];
      return { competitor: c, intel, record, note: "Intelligence is only as good as its source. Items show who recorded them, the source, confidence and whether a manager verified them." };
    },
  },
  {
    method: "PATCH", path: "/competitors/:id", permission: "competitors:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object(Object.fromEntries(Object.entries(compFields).map(([k, s]) => [k, v.optional(v.nullable(s as any))])) as any), body) as Record<string, unknown>;
      if (b.name === null) throw badRequest("A competitor needs a name");
      const upd = buildUpdate(b, map);
      if (!upd) return { ok: true };
      const r = await q.query(`UPDATE sales_competitors SET ${upd.set}, updated_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id`, [id, ...upd.params]);
      if (!r.rows[0]) throw notFound("Competitor");
      await audit(q, actor, { action: "competitor.update", entityType: "competitor", entityId: id, summary: "Updated competitor", after: b }, requestId);
      return { ok: true };
    },
  },
  {
    method: "DELETE", path: "/competitors/:id", permission: "competitors:write",
    async handler({ q, actor, params, requestId }) {
      const id = parse(v.id(), params.id);
      const r = await q.query("UPDATE sales_competitors SET archived_at = now(), updated_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id", [id]);
      if (!r.rows[0]) throw notFound("Competitor");
      await audit(q, actor, { action: "competitor.archive", entityType: "competitor", entityId: id, summary: "Archived competitor" }, requestId);
      return noContent();
    },
  },
  {
    method: "POST", path: "/competitors/:id/intel", permission: "competitors:write", idempotent: true,
    async handler({ q, actor, params, body, now, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(intelBody, body);
      if (!(await q.query("SELECT 1 FROM sales_competitors WHERE id = $1 AND archived_at IS NULL", [id])).rows[0]) throw notFound("Competitor");
      if (Date.parse(b.observed_on) > now.getTime() + 86_400_000) throw badRequest("The observation date is in the future");
      const r = await q.query<{ id: number }>("INSERT INTO sales_competitor_intel (competitor_id, kind, title, content, source, source_url, observed_on, confidence, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id", [id, b.kind, b.title, b.content, b.source, b.source_url ?? null, b.observed_on, b.confidence, actor.label]);
      await audit(q, actor, { action: "competitor_intel.create", entityType: "competitor_intel", entityId: r.rows[0]!.id, summary: `${b.kind}: ${b.title} (unverified, ${b.confidence} confidence)` }, requestId);
      return created({ id: r.rows[0]!.id, verified: false });
    },
  },
  {
    method: "POST", path: "/competitor-intel/:id/verify", permission: "competitors:verify",
    async handler({ q, actor, params, requestId }) {
      const id = parse(v.id(), params.id);
      const row = (await q.query<any>("SELECT id, created_by, verified FROM sales_competitor_intel WHERE id = $1 AND archived_at IS NULL FOR UPDATE", [id])).rows[0];
      if (!row) throw notFound("Intelligence item");
      if (row.verified) throw conflict("Already verified", "already_verified");
      if (row.created_by === actor.label) throw conflict("A different person must verify this item", "self_verification");
      await q.query("UPDATE sales_competitor_intel SET verified = TRUE, verified_by = $2, verified_at = now(), updated_at = now() WHERE id = $1", [id, actor.label]);
      await audit(q, actor, { action: "competitor_intel.verify", entityType: "competitor_intel", entityId: id, summary: "Verified competitor intelligence" }, requestId);
      return { ok: true };
    },
  },
  {
    method: "DELETE", path: "/competitor-intel/:id", permission: "competitors:write",
    async handler({ q, actor, params, requestId }) {
      const id = parse(v.id(), params.id);
      const r = await q.query("UPDATE sales_competitor_intel SET archived_at = now(), updated_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id", [id]);
      if (!r.rows[0]) throw notFound("Intelligence item");
      await audit(q, actor, { action: "competitor_intel.archive", entityType: "competitor_intel", entityId: id, summary: "Archived intelligence item" }, requestId);
      return noContent();
    },
  },
];
