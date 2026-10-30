import { v, parse } from "../core/validate";
import { created, type Route } from "../core/router";
import { badRequest, forbidden, notFound, tooManyRequests, HttpError } from "../core/errors";
import { audit } from "../core/audit";
import { can } from "../core/rbac";
import { enqueue, startInBackground, recoverStale, LIMITS } from "./jobs";
import { configuredProviders } from "./search";
import { normaliseWebsite } from "./engine";
import { buildPlan, applyPlan, type EntityKind } from "./apply";
import { loadLead, rescore } from "../modules/leads";
import { visibleAccount } from "../modules/accounts";

const ENTITIES = ["lead", "account", "contact", "opportunity"] as const;
const WRITE_PERM: Record<(typeof ENTITIES)[number], string> = { lead: "leads:write", account: "accounts:write", contact: "contacts:write", opportunity: "opportunities:write" };

const clean = (s?: string) => (s ?? "").replace(/[\u0000-\u001f]/g, " ").trim();

export const researchRoutes: Route[] = [
  {
    // What is configured? Never reveals keys - only which providers exist and the active limits.
    method: "GET", path: "/research/status", permission: "ai:use", tx: false,
    async handler() {
      const L = LIMITS(), p = configuredProviders();
      return {
        enabled: L.enabled, searchProviders: p.map((x) => ({ id: x.id, label: x.label })), canSearchByName: p.length > 0, canResearchWebsite: L.enabled,
        limits: { perMemberPerHour: L.perMemberPerHour, concurrent: L.concurrent, maxPages: L.maxPages, cacheHours: L.cacheHours },
        setup: p.length ? null : "Researching from a website address works now. To also find a company from its name alone, set BRAVE_SEARCH_API_KEY, SERPER_API_KEY or TAVILY_API_KEY on the API server.",
      };
    },
  },
  {
    method: "POST", path: "/research/company", permission: "ai:use", tx: false,
    async handler({ q, db, actor, body, now, ip }) {
      const L = LIMITS();
      if (!L.enabled) throw new HttpError(503, "research_disabled", "Web research is switched off by an administrator.");
      const b = parse(v.object({
        company_name: v.optional(v.string({ max: 200 })), website: v.optional(v.string({ max: 300 })), country: v.optional(v.string({ max: 80 })), industry: v.optional(v.string({ max: 120 })),
        entity_type: v.optional(v.enumOf(ENTITIES)), entity_id: v.optional(v.id()), refresh: v.optional(v.boolean()),
      }), body);
      const input = { companyName: clean(b.company_name), website: clean(b.website), country: clean(b.country), industry: clean(b.industry) };
      if (!input.companyName && !input.website) throw badRequest("Enter a company name or a website to research.");
      if (input.website && !normaliseWebsite(input)) throw badRequest("That does not look like a valid website address.");
      if (b.entity_type && !can(actor, WRITE_PERM[b.entity_type] as any)) throw forbidden("You can only research for records you are allowed to edit.");
      const used = (await q.query<{ n: number }>("SELECT count(*)::int n FROM sales_research_jobs WHERE created_by_member = $1 AND created_at > now() - interval '1 hour'", [actor.memberId || -1])).rows[0]!.n;
      if (used >= L.perMemberPerHour) throw tooManyRequests(`Research limit reached (${L.perMemberPerHour} per hour). Try again later or reuse a recent result.`);
      const running = (await q.query<{ n: number }>("SELECT count(*)::int n FROM sales_research_jobs WHERE status IN ('researching','extracting','validating')")).rows[0]!.n;
      if (running >= L.concurrent) throw tooManyRequests("Several researches are already running. Wait a moment and try again.");
      const job = await db.tx(async (t) => {
        const j = await enqueue(t, { input, entityType: b.entity_type ?? null, entityId: b.entity_id ?? null, memberId: actor.memberId, label: actor.label, now, force: b.refresh === true });
        if (j.created) await audit(t, actor, { action: "research.start", entityType: b.entity_type ?? "research", entityId: b.entity_id ?? j.id, summary: `Started public-web research for "${input.companyName || input.website}"`, after: { jobId: j.id } });
        return j;
      });
      if (job.created) startInBackground(db, job.id);
      void ip;
      return created({ jobId: job.id, cached: job.cached });
    },
  },
  {
    method: "GET", path: "/research/jobs", permission: "ai:use", tx: false,
    async handler({ q, actor, query }) {
      const mine = !can(actor, "agents:run");
      const rows = (await q.query(`SELECT id, kind, entity_type, entity_id, status, progress, stage_detail, error, error_code, input, pages_fetched, created_by, created_at, finished_at FROM sales_research_jobs ${mine ? "WHERE created_by_member = $1" : ""} ORDER BY id DESC LIMIT 50`, mine ? [actor.memberId] : [])).rows;
      void query;
      return { items: rows };
    },
  },
  {
    method: "GET", path: "/research/jobs/:id", permission: "ai:use", tx: false,
    async handler({ q, actor, params }) {
      const id = parse(v.id(), params.id);
      await recoverStale(q);
      const job = (await q.query<any>("SELECT * FROM sales_research_jobs WHERE id = $1", [id])).rows[0];
      if (!job) throw notFound("Research job");
      if (job.created_by_member !== actor.memberId && !can(actor, "agents:run")) throw notFound("Research job");
      const evidence = (await q.query("SELECT id, field, value, kind, source_url, source_title, source_domain, excerpt, retrieved_at, confidence, confidence_basis, verification, conflict FROM sales_research_evidence WHERE job_id = $1 ORDER BY confidence DESC, id", [id])).rows;
      const decisions = (await q.query("SELECT field, proposed, previous, action, decided_by, decided_at FROM sales_autofill_decisions WHERE job_id = $1 ORDER BY id", [id])).rows;
      return { job: { id: job.id, status: job.status, progress: job.progress, stageDetail: job.stage_detail, error: job.error, errorCode: job.error_code, input: job.input, createdAt: job.created_at, finishedAt: job.finished_at, ageMinutes: job.finished_at ? Math.round((Date.now() - new Date(job.finished_at).getTime()) / 60000) : null, pagesFetched: job.pages_fetched, entityType: job.entity_type, entityId: job.entity_id }, result: job.result, evidence, decisions };
    },
  },
  {
    method: "POST", path: "/research/jobs/:id/cancel", permission: "ai:use", tx: false,
    async handler({ q, actor, params }) {
      const id = parse(v.id(), params.id);
      const j = (await q.query<any>("SELECT created_by_member, status FROM sales_research_jobs WHERE id = $1", [id])).rows[0];
      if (!j || (j.created_by_member !== actor.memberId && !can(actor, "agents:manage"))) throw notFound("Research job");
      if (["completed", "failed", "cancelled", "awaiting_review", "partial"].includes(j.status)) return { ok: true, status: j.status };
      await q.query("UPDATE sales_research_jobs SET cancel_requested = TRUE WHERE id = $1", [id]);
      await q.query("UPDATE sales_research_jobs SET status = 'cancelled', stage_detail = 'Cancelled', finished_at = now() WHERE id = $1 AND status = 'queued'", [id]);
      return { ok: true, status: "cancel_requested" };
    },
  },
  {
    // The browser applies values to the open form (so every existing validation still runs when the person saves). This records what was applied/rejected.
    method: "POST", path: "/research/jobs/:id/decisions", permission: "ai:use",
    async handler({ q, actor, params, body }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ decisions: v.array(v.object({ field: v.string({ max: 60 }), action: v.enumOf(["applied", "rejected", "cleared"] as const), previous: v.optional(v.string({ max: 2000, raw: true })) }), { max: 60 }) }), body);
      const j = (await q.query<any>("SELECT created_by_member, entity_type, entity_id, status FROM sales_research_jobs WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!j || (j.created_by_member !== actor.memberId && !can(actor, "agents:manage"))) throw notFound("Research job");
      if (j.entity_type && !can(actor, WRITE_PERM[j.entity_type as (typeof ENTITIES)[number]] as any)) throw forbidden();
      for (const d of b.decisions) {
        const ev = (await q.query<{ value: string }>("SELECT value FROM sales_research_evidence WHERE job_id = $1 AND field = $2 ORDER BY confidence DESC LIMIT 1", [id, d.field])).rows[0];
        await q.query("INSERT INTO sales_autofill_decisions (job_id, field, proposed, previous, action, decided_by) VALUES ($1,$2,$3,$4,$5,$6)", [id, d.field, ev?.value ?? null, d.previous ?? null, d.action, actor.label]);
      }
      const applied = b.decisions.filter((d) => d.action === "applied").length;
      if (applied && j.status === "awaiting_review") await q.query("UPDATE sales_research_jobs SET status = 'completed', stage_detail = 'Reviewed' WHERE id = $1", [id]);
      await audit(q, actor, { action: "research.decision", entityType: j.entity_type ?? "research", entityId: j.entity_id ?? id, summary: `${applied} researched value(s) applied, ${b.decisions.length - applied} not applied`, after: { jobId: id, decisions: b.decisions.map((d) => ({ field: d.field, action: d.action })) } });
      return { ok: true, applied };
    },
  },
  {
    // Bulk enrichment: one job per selected record (max 25). Jobs queue in the database and run a few at a time.
    method: "POST", path: "/research/bulk", permission: "ai:use", tx: false,
    async handler({ q, db, actor, body, now }) {
      const L = LIMITS();
      if (!L.enabled) throw new HttpError(503, "research_disabled", "Web research is switched off by an administrator.");
      const b = parse(v.object({ entity_type: v.enumOf(["lead", "account"] as const), ids: v.array(v.id(), { max: 25 }), refresh: v.optional(v.boolean()) }), body);
      if (!b.ids.length) throw badRequest("Select at least one record.");
      if (!can(actor, WRITE_PERM[b.entity_type] as any)) throw forbidden("You can only enrich records you are allowed to edit.");
      const used = (await q.query<{ n: number }>("SELECT count(*)::int n FROM sales_research_jobs WHERE created_by_member = $1 AND created_at > now() - interval '1 hour'", [actor.memberId || -1])).rows[0]!.n;
      let budget = Math.max(0, L.perMemberPerHour - used);
      const items: { entityId: number; label: string; jobId: number | null; cached?: boolean; state: "queued" | "skipped"; reason?: string }[] = [];
      const toStart: number[] = [];
      for (const id of [...new Set(b.ids)]) {
        let rec: any;
        try { rec = b.entity_type === "lead" ? await loadLead(q, actor, id) : await visibleAccount(q, actor, id); } catch { items.push({ entityId: id, label: `#${id}`, jobId: null, state: "skipped", reason: "not found or not yours" }); continue; }
        const label = b.entity_type === "lead" ? (rec.company || `${rec.first_name} ${rec.last_name ?? ""}`.trim()) : rec.name;
        if (b.entity_type === "lead" && rec.status === "converted") { items.push({ entityId: id, label, jobId: null, state: "skipped", reason: "converted leads are read-only" }); continue; }
        const input = { companyName: clean(b.entity_type === "lead" ? rec.company : rec.name), website: clean(rec.website) };
        if (!input.companyName && !input.website) { items.push({ entityId: id, label, jobId: null, state: "skipped", reason: "no company name or website to research" }); continue; }
        if (input.website && !normaliseWebsite(input)) input.website = "";
        if (budget <= 0) { items.push({ entityId: id, label, jobId: null, state: "skipped", reason: `hourly limit of ${L.perMemberPerHour} reached` }); continue; }
        const j = await db.tx(async (t) => {
          const r = await enqueue(t, { input, entityType: b.entity_type, entityId: id, memberId: actor.memberId, label: actor.label, now, force: b.refresh === true });
          return r;
        });
        if (!j.cached) budget--;
        if (j.created) toStart.push(j.id);
        items.push({ entityId: id, label, jobId: j.id, cached: j.cached, state: "queued" });
      }
      await audit(q, actor, { action: "research.bulk", entityType: b.entity_type, entityId: null, summary: `Queued web research for ${items.filter((i) => i.state === "queued").length} ${b.entity_type}(s)`, after: { ids: b.ids } });
      for (const id of toStart) startInBackground(db, id);
      return created({ items });
    },
  },
  {
    // What WOULD be filled for the record linked to this job: empty columns only, confident, validated values.
    method: "GET", path: "/research/jobs/:id/plan", permission: "ai:use", tx: false,
    async handler({ q, actor, params }) {
      const id = parse(v.id(), params.id);
      const job = (await q.query<any>("SELECT created_by_member, entity_type, entity_id, status, progress, stage_detail, error FROM sales_research_jobs WHERE id = $1", [id])).rows[0];
      if (!job || (job.created_by_member !== actor.memberId && !can(actor, "agents:run")) || !["lead", "account"].includes(job.entity_type ?? "")) throw notFound("Research job");
      if (!["awaiting_review", "completed", "partial"].includes(job.status)) return { status: job.status, progress: job.progress, stage: job.stage_detail, error: job.error, plan: null };
      const kind = job.entity_type as EntityKind;
      const rec = kind === "lead" ? await loadLead(q, actor, job.entity_id) : await visibleAccount(q, actor, job.entity_id);
      const ev = (await q.query<any>("SELECT field, value, kind, confidence, verification, source_url FROM sales_research_evidence WHERE job_id = $1", [id])).rows;
      return { status: job.status, plan: buildPlan(kind, rec, ev) };
    },
  },
  {
    method: "POST", path: "/research/jobs/:id/apply", permission: "ai:use",
    async handler({ q, actor, params, body, now, settings }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ fields: v.optional(v.array(v.string({ max: 40 }), { max: 20 })) }), body);
      const job = (await q.query<any>("SELECT created_by_member, entity_type, entity_id, status FROM sales_research_jobs WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!job || (job.created_by_member !== actor.memberId && !can(actor, "agents:manage")) || !["lead", "account"].includes(job.entity_type ?? "")) throw notFound("Research job");
      const kind = job.entity_type as EntityKind;
      if (!can(actor, WRITE_PERM[kind] as any)) throw forbidden();
      if (!["awaiting_review", "completed", "partial"].includes(job.status)) throw badRequest("This research is not finished yet.");
      const rec = kind === "lead" ? await loadLead(q, actor, job.entity_id, true) : await visibleAccount(q, actor, job.entity_id);
      if (kind === "lead" && rec.status === "converted") throw badRequest("A converted lead is read-only; edit the account or contact instead.");
      const ev = (await q.query<any>("SELECT field, value, kind, confidence, verification, source_url FROM sales_research_evidence WHERE job_id = $1", [id])).rows;
      const plan = buildPlan(kind, rec, ev);
      const out = await applyPlan(q, actor, kind, job.entity_id, plan, b.fields, id, kind === "lead" ? async () => { await rescore(q, job.entity_id, settings, now); } : undefined);
      if (out.applied.length) await q.query("UPDATE sales_research_jobs SET status = 'completed', stage_detail = 'Reviewed' WHERE id = $1 AND status = 'awaiting_review'", [id]);
      return { applied: out.applied.map((a) => ({ field: a.field, column: a.column, value: a.value })), skipped: plan.skipped };
    },
  },
];
