import { v, parse } from "../core/validate";
import { created, noContent, type Route } from "../core/router";
import { notFound, conflict, badRequest } from "../core/errors";
import { audit } from "../core/audit";
import { can, isManagerial } from "../core/rbac";
import { pageOf, str, d10 } from "../core/http";
import { renderTemplate } from "../domain/automation-engine";
import { Where, loadOwned, buildUpdate } from "./common";
import type { Actor, Queryable } from "../core/types";

const KINDS = ["article", "script", "discovery", "objection", "framework", "template", "negotiation", "closing", "onboarding", "training", "coaching", "pricing", "faq"] as const;
const STATUS = ["draft", "review", "published", "archived"] as const;
const FLOW: Record<string, string[]> = { draft: ["review", "archived"], review: ["draft", "published", "archived"], published: ["archived", "review"], archived: ["draft"] };

const artFields = {
  title: v.string({ min: 3, max: 200 }), kind: v.enumOf(KINDS), audience_role: v.string({ max: 40 }), product_id: v.id(), industry: v.string({ max: 80 }), segment: v.string({ max: 80 }), stage_name: v.string({ max: 80 }),
  body: v.string({ min: 3, max: 50_000, raw: true }), is_training: v.boolean(),
};
const artCreate = v.object({
  title: artFields.title, kind: v.withDefault(artFields.kind, "article"), audience_role: v.optional(artFields.audience_role), product_id: v.optional(artFields.product_id), industry: v.optional(artFields.industry),
  segment: v.optional(artFields.segment), stage_name: v.optional(artFields.stage_name), body: artFields.body, is_training: v.withDefault(artFields.is_training, false),
});
const artPatch = v.object({
  title: v.optional(artFields.title), kind: v.optional(artFields.kind), audience_role: v.optional(v.nullable(artFields.audience_role)), product_id: v.optional(v.nullable(artFields.product_id)), industry: v.optional(v.nullable(artFields.industry)),
  segment: v.optional(v.nullable(artFields.segment)), stage_name: v.optional(v.nullable(artFields.stage_name)), body: v.optional(artFields.body), is_training: v.optional(artFields.is_training),
});
const artCols = { title: "title", kind: "kind", audience_role: "audience_role", product_id: "product_id", industry: "industry", segment: "segment", stage_name: "stage_name", body: "body", is_training: "is_training" };

const ENTITY_TABLE: Record<string, [string, string]> = {
  lead: ["sales_leads", "Lead"], account: ["sales_accounts", "Account"], opportunity: ["sales_opportunities", "Opportunity"], quotation: ["sales_quotations", "Quotation"], order: ["sales_orders", "Order"],
};
const ENTITIES = Object.keys(ENTITY_TABLE) as [string, ...string[]];
const DOC_KINDS = ["quotation", "proposal", "order", "contract", "account_plan", "meeting_summary", "report", "commission_statement", "other"] as const;
const httpsUrl = () => v.string({ max: 1000, pattern: /^https:\/\/[^\s]+$/i, patternMessage: "Use a full https:// link" });

async function assertEntityAccess(q: Queryable, actor: Actor, type: string, id: number) {
  const t = ENTITY_TABLE[type];
  if (!t) throw badRequest("Unsupported record type");
  await loadOwned(q, actor, t[0], id, t[1]);
}

const canSeeAllDrafts = (actor: Actor) => can(actor, "playbook:write");

export const enablementRoutes: Route[] = [
  // ───── playbook
  {
    method: "GET", path: "/playbook", permission: "playbook:read", tx: false,
    async handler({ q, actor, query }) {
      const pg = pageOf(query);
      const w = new Where();
      if (!canSeeAllDrafts(actor)) w.raw("a.status = 'published'");
      else if (str(query, "status")) w.and("a.status = ?", parse(v.enumOf(STATUS), str(query, "status")));
      else w.raw("a.status <> 'archived'");
      if (str(query, "kind")) w.and("a.kind = ?", parse(v.enumOf(KINDS), str(query, "kind")));
      if (str(query, "product_id")) w.and("a.product_id = ?", parse(v.id(), str(query, "product_id")));
      if (str(query, "stage")) w.and("a.stage_name = ?", str(query, "stage"));
      if (str(query, "industry")) w.and("lower(a.industry) = lower(?)", str(query, "industry"));
      if (str(query, "training") === "true") w.raw("a.is_training");
      let rank = "a.updated_at";
      if (str(query, "q")) { w.and("a.search_text @@ plainto_tsquery('simple', ?)", str(query, "q")); rank = `ts_rank(a.search_text, plainto_tsquery('simple', $${w.params.length})) DESC, a.updated_at`; }
      const total = (await q.query<{ n: number }>(`SELECT count(*)::int n FROM sales_playbook_articles a WHERE ${w.sql}`, w.params)).rows[0]!.n;
      const items = (await q.query(`SELECT a.id, a.title, a.kind, a.audience_role, a.product_id, a.industry, a.segment, a.stage_name, a.status, a.version, a.is_training, a.published_at, a.updated_at,
        left(a.body, 240) AS excerpt, ${actor.memberId ? `EXISTS (SELECT 1 FROM sales_training_completions c WHERE c.article_id = a.id AND c.member_id = ${Number(actor.memberId)})` : "FALSE"} AS completed
        FROM sales_playbook_articles a WHERE ${w.sql} ORDER BY ${rank} DESC LIMIT $${w.next()} OFFSET $${w.next() + 1}`, [...w.params, pg.pageSize, pg.offset])).rows;
      return { items, total, page: pg.page, pageSize: pg.pageSize };
    },
  },
  {
    method: "GET", path: "/training/progress", permission: "playbook:read", tx: false,
    async handler({ q, actor }) {
      const total = (await q.query<{ n: number }>("SELECT count(*)::int n FROM sales_playbook_articles WHERE status = 'published' AND is_training")).rows[0]!.n;
      const ids = isManagerial(actor) ? "TRUE" : `m.id = ${Number(actor.memberId) || -1}`;
      const rows = (await q.query(`SELECT m.id AS member_id, m.display_name, count(c.article_id)::int AS completed FROM sales_members m LEFT JOIN sales_training_completions c ON c.member_id = m.id AND c.article_id IN (SELECT id FROM sales_playbook_articles WHERE status = 'published' AND is_training) WHERE m.active AND ${ids} GROUP BY m.id, m.display_name ORDER BY m.display_name`)).rows;
      return { totalCourses: total, items: rows.map((r: any) => ({ ...r, total, percent: total ? Math.round((r.completed / total) * 100) : null })) };
    },
  },
  {
    method: "POST", path: "/playbook", permission: "playbook:write", idempotent: true,
    async handler({ q, actor, body, requestId }) {
      const b = parse(artCreate, body);
      if (b.product_id && !(await q.query("SELECT 1 FROM sales_products WHERE id = $1", [b.product_id])).rows[0]) throw badRequest("Product not found");
      const r = await q.query<{ id: number }>("INSERT INTO sales_playbook_articles (title, kind, audience_role, product_id, industry, segment, stage_name, body, is_training, owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
        [b.title, b.kind, b.audience_role ?? null, b.product_id ?? null, b.industry ?? null, b.segment ?? null, b.stage_name ?? null, b.body, b.is_training, actor.memberId || null]);
      await q.query("INSERT INTO sales_playbook_versions (article_id, version, title, body, saved_by) VALUES ($1,1,$2,$3,$4)", [r.rows[0]!.id, b.title, b.body, actor.label]);
      await audit(q, actor, { action: "playbook.create", entityType: "playbook", entityId: r.rows[0]!.id, summary: `Drafted "${b.title}"` }, requestId);
      return created({ id: r.rows[0]!.id, status: "draft" });
    },
  },
  {
    method: "GET", path: "/playbook/:id", permission: "playbook:read", tx: false,
    async handler({ q, actor, params }) {
      const id = parse(v.id(), params.id);
      const a = (await q.query<any>("SELECT a.*, p.name AS product_name FROM sales_playbook_articles a LEFT JOIN sales_products p ON p.id = a.product_id WHERE a.id = $1", [id])).rows[0];
      if (!a || (a.status !== "published" && !canSeeAllDrafts(actor))) throw notFound("Article");
      delete a.search_text;
      const completed = actor.memberId ? (await q.query("SELECT article_version, completed_at FROM sales_training_completions WHERE article_id = $1 AND member_id = $2", [id, actor.memberId])).rows[0] ?? null : null;
      const versions = canSeeAllDrafts(actor) ? (await q.query("SELECT version, title, saved_by, saved_at FROM sales_playbook_versions WHERE article_id = $1 ORDER BY version DESC", [id])).rows : undefined;
      return { article: a, completion: completed, versions, completionOutdated: completed ? completed.article_version < a.version : false };
    },
  },
  {
    method: "PATCH", path: "/playbook/:id", permission: "playbook:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(artPatch, body) as Record<string, unknown>;
      const cur = (await q.query<any>("SELECT * FROM sales_playbook_articles WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!cur) throw notFound("Article");
      if (cur.status === "archived") throw conflict("Restore the article to draft before editing it", "invalid_state");
      const upd = buildUpdate(b, artCols);
      if (!upd) return { ok: true, version: cur.version };
      const contentChanged = (b.title !== undefined && b.title !== cur.title) || (b.body !== undefined && b.body !== cur.body);
      const version = contentChanged ? cur.version + 1 : cur.version;
      // an edit to published content goes back to review unless the editor may publish
      const status = contentChanged && cur.status === "published" && !can(actor, "playbook:publish") ? "review" : cur.status;
      await q.query(`UPDATE sales_playbook_articles SET ${upd.set}, version = $${upd.params.length + 2}, status = $${upd.params.length + 3}, updated_at = now() WHERE id = $1`, [id, ...upd.params, version, status]);
      if (contentChanged) await q.query("INSERT INTO sales_playbook_versions (article_id, version, title, body, saved_by) VALUES ($1,$2,$3,$4,$5)", [id, version, (b.title as string) ?? cur.title, (b.body as string) ?? cur.body, actor.label]);
      await audit(q, actor, { action: "playbook.update", entityType: "playbook", entityId: id, summary: `Edited "${cur.title}"${contentChanged ? ` (v${version})` : ""}${status !== cur.status ? "; returned to review" : ""}` }, requestId);
      return { ok: true, version, status };
    },
  },
  {
    method: "POST", path: "/playbook/:id/status", permission: "playbook:write",
    async handler({ q, actor, params, body, now, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ status: v.enumOf(STATUS) }), body);
      const cur = (await q.query<any>("SELECT id, title, status FROM sales_playbook_articles WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!cur) throw notFound("Article");
      if (!(FLOW[cur.status] ?? []).includes(b.status)) throw conflict(`An article cannot go from ${cur.status} to ${b.status}`, "invalid_state");
      if (b.status === "published" && !can(actor, "playbook:publish")) throw conflict("Publishing needs the publish permission", "forbidden");
      await q.query("UPDATE sales_playbook_articles SET status = $2, published_at = CASE WHEN $2 = 'published' THEN $3::timestamptz ELSE published_at END, updated_at = now() WHERE id = $1", [id, b.status, now.toISOString()]);
      await audit(q, actor, { action: `playbook.${b.status}`, entityType: "playbook", entityId: id, summary: `"${cur.title}" ${cur.status} → ${b.status}` }, requestId);
      return { ok: true, status: b.status };
    },
  },
  {
    method: "POST", path: "/playbook/:id/complete", permission: "playbook:read",
    async handler({ q, actor, params }) {
      const id = parse(v.id(), params.id);
      if (!actor.memberId) throw badRequest("Only sales members can record training");
      const a = (await q.query<any>("SELECT version, is_training FROM sales_playbook_articles WHERE id = $1 AND status = 'published'", [id])).rows[0];
      if (!a) throw notFound("Article");
      if (!a.is_training) throw badRequest("This article is not a training item");
      await q.query("INSERT INTO sales_training_completions (article_id, member_id, article_version) VALUES ($1,$2,$3) ON CONFLICT (article_id, member_id) DO UPDATE SET article_version = EXCLUDED.article_version, completed_at = now()", [id, actor.memberId, a.version]);
      return { ok: true, version: a.version };
    },
  },
  // ───── documents
  {
    method: "GET", path: "/documents", permission: "documents:read", tx: false,
    async handler({ q, actor, query }) {
      const type = parse(v.enumOf(ENTITIES), str(query, "entity_type"));
      const id = parse(v.id(), str(query, "entity_id"));
      await assertEntityAccess(q, actor, type, id);
      const w = new Where().raw("d.archived_at IS NULL").and("d.entity_type = ?", type).and("d.entity_id = ?", id);
      if (!can(actor, "documents:restricted")) w.raw("NOT d.restricted");
      return { items: (await q.query(`SELECT d.id, d.kind, d.title, d.url, d.mime_type, d.size_bytes, d.version, d.restricted, d.signature_status, d.signature_ref, d.signed_at, d.created_by, d.created_at FROM sales_documents d WHERE ${w.sql} ORDER BY d.created_at DESC`, w.params)).rows };
    },
  },
  {
    method: "POST", path: "/documents", permission: "documents:write", idempotent: true,
    async handler({ q, actor, body, requestId }) {
      const b = parse(v.object({
        entity_type: v.enumOf(ENTITIES), entity_id: v.id(), kind: v.withDefault(v.enumOf(DOC_KINDS), "other"), title: v.string({ min: 2, max: 200 }), url: httpsUrl(),
        mime_type: v.optional(v.string({ max: 100 })), size_bytes: v.optional(v.int({ min: 0, max: 2_000_000_000 })), content_hash: v.optional(v.string({ max: 128 })), restricted: v.withDefault(v.boolean(), false),
      }), body);
      await assertEntityAccess(q, actor, b.entity_type, b.entity_id);
      if (b.restricted && !can(actor, "documents:restricted")) throw conflict("You cannot mark documents as restricted", "forbidden");
      const r = await q.query<{ id: number }>("INSERT INTO sales_documents (kind, title, entity_type, entity_id, url, mime_type, size_bytes, content_hash, restricted, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
        [b.kind, b.title, b.entity_type, b.entity_id, b.url, b.mime_type ?? null, b.size_bytes ?? null, b.content_hash ?? null, b.restricted, actor.label]);
      await audit(q, actor, { action: "document.create", entityType: b.entity_type, entityId: b.entity_id, summary: `Linked document "${b.title}"` }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "POST", path: "/documents/:id/version", permission: "documents:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ url: httpsUrl(), size_bytes: v.optional(v.int({ min: 0, max: 2_000_000_000 })), content_hash: v.optional(v.string({ max: 128 })) }), body);
      const d = (await q.query<any>("SELECT * FROM sales_documents WHERE id = $1 AND archived_at IS NULL FOR UPDATE", [id])).rows[0];
      if (!d || (d.restricted && !can(actor, "documents:restricted"))) throw notFound("Document");
      await assertEntityAccess(q, actor, d.entity_type, d.entity_id);
      if (d.signature_status === "signed") throw conflict("A signed document cannot be replaced. Add a new document instead.", "document_signed");
      await q.query("UPDATE sales_documents SET url = $2, size_bytes = COALESCE($3, size_bytes), content_hash = COALESCE($4, content_hash), version = version + 1, updated_at = now() WHERE id = $1", [id, b.url, b.size_bytes ?? null, b.content_hash ?? null]);
      await audit(q, actor, { action: "document.version", entityType: d.entity_type, entityId: d.entity_id, summary: `New version ${d.version + 1} of "${d.title}" (previous link: ${d.url})` }, requestId);
      return { ok: true, version: d.version + 1 };
    },
  },
  {
    method: "POST", path: "/documents/:id/signature", permission: "documents:write",
    async handler({ q, actor, params, body, now, settings, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ status: v.enumOf(["requested", "signed", "declined"] as const), reference: v.string({ min: 2, max: 200 }), evidence: v.string({ min: 3, max: 500 }) }), body);
      const d = (await q.query<any>("SELECT * FROM sales_documents WHERE id = $1 AND archived_at IS NULL FOR UPDATE", [id])).rows[0];
      if (!d || (d.restricted && !can(actor, "documents:restricted"))) throw notFound("Document");
      await assertEntityAccess(q, actor, d.entity_type, d.entity_id);
      if (d.signature_status === "signed") throw conflict("Already recorded as signed", "already_signed");
      await q.query("UPDATE sales_documents SET signature_status = $2, signature_ref = $3, signed_at = CASE WHEN $2 = 'signed' THEN $4::timestamptz ELSE NULL END, updated_at = now() WHERE id = $1", [id, b.status, b.reference, now.toISOString()]);
      await audit(q, actor, { action: `document.signature_${b.status}`, entityType: d.entity_type, entityId: d.entity_id, summary: `Signature ${b.status} recorded manually by ${actor.label} for "${d.title}" (ref ${b.reference}; evidence: ${b.evidence})` }, requestId);
      return { ok: true, status: b.status, verified: false, note: settings.integrations.esignature.enabled ? "Recorded by staff. It is not verified by the e-signature provider." : "Recorded manually by staff. No e-signature provider is connected, so this is not independently verified." };
    },
  },
  {
    method: "DELETE", path: "/documents/:id", permission: "documents:write",
    async handler({ q, actor, params, requestId }) {
      const id = parse(v.id(), params.id);
      const d = (await q.query<any>("SELECT * FROM sales_documents WHERE id = $1 AND archived_at IS NULL FOR UPDATE", [id])).rows[0];
      if (!d || (d.restricted && !can(actor, "documents:restricted"))) throw notFound("Document");
      await assertEntityAccess(q, actor, d.entity_type, d.entity_id);
      await q.query("UPDATE sales_documents SET archived_at = now() WHERE id = $1", [id]);
      await audit(q, actor, { action: "document.archive", entityType: d.entity_type, entityId: d.entity_id, summary: `Archived document "${d.title}"` }, requestId);
      return noContent();
    },
  },
  // ───── document templates
  {
    method: "GET", path: "/document-templates", permission: "documents:read", tx: false,
    async handler({ q, query }) {
      const w = new Where();
      if (str(query, "kind")) w.and("kind = ?", str(query, "kind"));
      return { items: (await q.query(`SELECT id, kind, name, body, active FROM sales_document_templates WHERE ${w.sql} ORDER BY kind, name`, w.params)).rows };
    },
  },
  {
    method: "POST", path: "/document-templates", permission: "documents:write",
    async handler({ q, actor, body, requestId }) {
      const b = parse(v.object({ kind: v.enumOf(["quotation", "proposal", "order", "contract", "account_plan", "meeting_summary", "report", "commission_statement"] as const), name: v.string({ min: 2, max: 120 }), body: v.string({ min: 3, max: 50_000, raw: true }) }), body);
      const r = await q.query<{ id: number }>("INSERT INTO sales_document_templates (kind, name, body) VALUES ($1,$2,$3) RETURNING id", [b.kind, b.name, b.body]);
      await audit(q, actor, { action: "document_template.create", entityType: "document_template", entityId: r.rows[0]!.id, summary: `Created template ${b.name}` }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "PATCH", path: "/document-templates/:id", permission: "documents:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ name: v.optional(v.string({ min: 2, max: 120 })), body: v.optional(v.string({ min: 3, max: 50_000, raw: true })), active: v.optional(v.boolean()) }), body) as Record<string, unknown>;
      const upd = buildUpdate(b, { name: "name", body: "body", active: "active" });
      if (!upd) return { ok: true };
      const r = await q.query(`UPDATE sales_document_templates SET ${upd.set}, updated_at = now() WHERE id = $1 RETURNING id`, [id, ...upd.params]);
      if (!r.rows[0]) throw notFound("Template");
      await audit(q, actor, { action: "document_template.update", entityType: "document_template", entityId: id, summary: "Updated template" }, requestId);
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/document-templates/:id/render", permission: "documents:read",
    async handler({ q, actor, params, body, settings }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ entity_type: v.enumOf(ENTITIES), entity_id: v.id() }), body);
      const t = (await q.query<any>("SELECT * FROM sales_document_templates WHERE id = $1 AND active", [id])).rows[0];
      if (!t) throw notFound("Template");
      const [table, label] = ENTITY_TABLE[b.entity_type]!;
      const row = await loadOwned<any>(q, actor, table, b.entity_id, label);
      const ctx: Record<string, unknown> = { ...row, today: d10(new Date()), currency: settings.business.currency };
      if (row.account_id) ctx.account = (await q.query("SELECT name, industry, country FROM sales_accounts WHERE id = $1", [row.account_id])).rows[0] ?? {};
      for (const k of ["cost_total", "gross_profit", "margin", "margin_percent"]) if (!can(actor, "cost:read")) delete ctx[k];
      const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
      const text = renderTemplate(t.body, ctx);
      return { name: t.name, text, html: `<div style="white-space:pre-wrap;font-family:system-ui,sans-serif">${esc(text)}</div>`, note: "Unknown placeholders render empty. Nothing is stored or sent." };
    },
  },
];
