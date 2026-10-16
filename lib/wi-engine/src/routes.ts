/**
 * The Website Intelligence HTTP surface, written once and mounted twice:
 *   - on the Express router of the API server;
 *   - on a tiny in-browser router for serverless local mode.
 * Handlers only touch the minimal request/response shapes below and the injected dependencies.
 */
import {
  ALL_TESTS, CATEGORY_IDS, CATEGORY_LABELS, DEFAULT_WEIGHTS, FINDING_STATUSES, PROFILE_PRESETS, REPORT_TYPES, SCORING_VERSION, STAGE_IDS, STAGE_LABELS, TASK_STATUSES, WEBSITE_TYPES, WEBSITE_TYPE_LABELS,
  buildRoadmap, compareAudits, parseAuditUrl, reportFileName, validateTransition, PRIORITY_FORMULA, SCORE_FORMULA, aggregateOutcomes,
  type AuditBundle, type CheckResult, type Finding, type FindingStatus, type FindingView, type Horizon, type TestStatus,
} from "@workspace/wi-core";
import { normalizeConfig } from "./config";
import { persistComparison } from "./engine";
import type { Explanation } from "./explain";
import { evaluateGate, findingsToCsv, findingsToSarif } from "./export";
import type { EngineRepo, WorkflowPatch } from "./repo";
import { buildRetestConfig } from "./retest";
import { hostAllowed, type WiSettings } from "./settings";

export interface ReqLike {
  auth?: { sub?: string; role?: string; email?: string } | null;
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: any;
  headers: Record<string, string | string[] | undefined>;
}
export interface ResLike {
  status(code: number): ResLike;
  json(body: unknown): ResLike | void;
  end(): ResLike | void;
  setHeader(name: string, value: string): unknown;
  type(t: string): ResLike;
  send(body: string): ResLike | void;
}
export type Handler = (req: ReqLike, res: ResLike) => unknown;
export interface RouterLike {
  get(path: string, handler: Handler): unknown;
  post(path: string, handler: Handler): unknown;
  put(path: string, handler: Handler): unknown;
  patch(path: string, handler: Handler): unknown;
  delete(path: string, handler: Handler): unknown;
}

export interface IntegrationStatus { id: string; label: string; status: "available" | "not_configured" | "unreachable"; detail: string; envVars: string[] }

export interface ApiDeps {
  repo: EngineRepo;
  settings: { load(): Promise<WiSettings>; save(patch: Partial<WiSettings>): Promise<{ ok: true; settings: WiSettings } | { ok: false; error: string }> };
  enqueue(auditId: string): void;
  cancel(auditId: string): Promise<void>;
  holdCredential(auditId: string, value: string): void;
  queueDepth(): { pending: number; active: number };
  integrations(): Promise<IntegrationStatus[]>;
  explain(f: Finding, enabled: boolean): Promise<Explanation>;
  /** Per-user quotas. Omitted in local mode, where one person runs audits in their own browser. */
  quota?: { countActive(ownerId: string): Promise<number>; countRecent(ownerId: string, minutes: number): Promise<number> };
}


export async function buildBundle(repo: EngineRepo, auditId: string, publicView = false): Promise<AuditBundle | null> {
  const audit = await repo.getAudit(auditId);
  if (!audit) return null;
  const [findings, recs, workflows, pages, performance, tasks] = await Promise.all([repo.loadFindings(auditId), repo.loadRecommendations(auditId), repo.loadWorkflows(auditId), repo.loadPages(auditId), repo.loadPerformance(auditId), repo.listTasks(auditId)]);
  const now = new Date().toISOString();
  const views: FindingView[] = findings.map((f) => ({
    ...f, id: f.fingerprint,
    workflow: workflows.get(f.fingerprint) ?? { id: f.fingerprint, auditId, fingerprint: f.fingerprint, status: "open", owner: null, notes: "", rationale: null, dueDate: null, retestStatus: "none", retestAuditId: null, verifiedAt: null, verifiedBy: null, verificationMethod: null, lineage: null, createdAt: now, updatedAt: now },
  }));
  let previous: AuditBundle["previous"] = null;
  let comparison: AuditBundle["comparison"] = null;
  if (audit.previousAuditId) {
    const prev = await repo.getAudit(audit.previousAuditId);
    if (prev) {
      previous = { id: prev.id, completedAt: prev.completedAt, overall: prev.scores?.overall ?? null };
      try {
        const [pf, pp, pc, cc] = await Promise.all([repo.loadFindings(prev.id), repo.loadPages(prev.id), repo.loadChecks(prev.id), repo.loadChecks(auditId)]);
        const st = (rs: CheckResult[]) => { const m: Record<string, TestStatus> = {}; for (const [id, o] of aggregateOutcomes(rs)) m[id] = o.status; return m; };
        comparison = compareAudits(
          { id: audit.id, scores: audit.scores, findings, pages: pages.map((p) => p.facts), testStatuses: st(cc), environment: `${audit.environment?.engineVersion ?? "?"}/${audit.environment?.pageSpeed ?? "?"}` },
          { id: prev.id, scores: prev.scores, findings: pf, pages: pp.map((p) => p.facts), testStatuses: st(pc), environment: `${prev.environment?.engineVersion ?? "?"}/${prev.environment?.pageSpeed ?? "?"}` },
        );
      } catch { comparison = null; }
    }
  }
  const safeAudit = publicView ? { ...audit, ownerEmail: null, ownerId: "", config: { ...audit.config, authorization: { ...audit.config.authorization, confirmedBy: "" } } } : audit;
  return { audit: safeAudit, findings: publicView ? views.map((v) => ({ ...v, workflow: { ...v.workflow, notes: "", owner: null, rationale: null } })) : views, recommendations: recs, roadmap: buildRoadmap(recs), pages: pages.map((p) => ({ facts: p.facts, score: p.score })), performance, tasks: publicView ? [] : tasks, previous, comparison, generatedAt: now };
}


export function registerWiRoutes(router: RouterLike, deps: ApiDeps): void {
  const repo = deps.repo;
  const countActive = (ownerId: string): Promise<number> => (deps.quota ? deps.quota.countActive(ownerId) : Promise.resolve(0));
  const countRecent = (ownerId: string, minutes: number): Promise<number> => (deps.quota ? deps.quota.countRecent(ownerId, minutes) : Promise.resolve(0));
const uid = (req: ReqLike): string => String(req.auth?.sub ?? "");
const isAdmin = (req: ReqLike): boolean => req.auth?.role === "admin";
const email = (req: ReqLike): string => req.auth?.email || uid(req);
const bad = (res: ResLike, error: string, status = 400, field?: string) => res.status(status).json({ error, ...(field ? { field } : {}) });

async function owned(req: ReqLike, res: ResLike, id: string) {
  const row = await repo.getAuditRow(id);
  if (!row || (row.owner_id !== uid(req) && !isAdmin(req))) { bad(res, "Audit not found.", 404); return null; }
  return row;
}

function parseLimit(v: unknown, d: number, max: number): number { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(1, Math.round(n))) : d; }


// ---------------------------------------------------------------------------
// Static routes (must precede /:id)
// ---------------------------------------------------------------------------

router.get("/meta", async (_req, res) => {
  const settings = await deps.settings.load();
  const byCat = Object.fromEntries(CATEGORY_IDS.map((c) => [c, ALL_TESTS.filter((t) => t.category === c).length]));
  res.json({
    scoringVersion: SCORING_VERSION, categories: CATEGORY_IDS.map((id) => ({ id, label: CATEGORY_LABELS[id], weight: settings.weights[id], defaultWeight: DEFAULT_WEIGHTS[id], tests: byCat[id] })),
    websiteTypes: WEBSITE_TYPES.map((id) => ({ id, label: WEBSITE_TYPE_LABELS[id] })), profiles: PROFILE_PRESETS, stages: STAGE_IDS.map((id) => ({ id, label: STAGE_LABELS[id] })),
    findingStatuses: FINDING_STATUSES, taskStatuses: TASK_STATUSES, reportTypes: REPORT_TYPES, limits: settings.limits, totalTests: ALL_TESTS.length, scoreFormula: SCORE_FORMULA, priorityFormula: PRIORITY_FORMULA,
    allowAuthenticatedScope: settings.allowAuthenticatedScope, allowPublicShare: settings.allowPublicShare, queue: deps.queueDepth(),
    modules: ["seo", "performance", "accessibility", "security", "content", "functionality", "structuredData", "localSeo", "ecommerce", "business", "analytics"],
  });
});

router.get("/catalog", (req, res) => {
  const cat = typeof req.query.category === "string" ? req.query.category : null;
  res.json({ total: ALL_TESTS.length, tests: ALL_TESTS.filter((t) => !cat || t.category === cat).map((t) => ({ id: t.id, category: t.category, subcategory: t.subcategory, title: t.title, measures: t.measures, severity: t.severity, scope: t.scope, method: t.method, requires: t.requires ?? null, wcag: t.wcag ?? [], gate: Boolean(t.gate), appliesToTypes: t.appliesToTypes ?? null, refs: t.refs, module: t.module })) });
});

router.get("/integrations", async (_req, res) => res.json({ integrations: await deps.integrations() }));

router.get("/stats", async (req, res) => {
  const admin = isAdmin(req);
  const { items, total } = await repo.listAudits({ ownerId: uid(req), admin, limit: 200 });
  const done = items.filter((a) => a.status === "completed" || a.status === "partial");
  const scored = done.filter((a) => a.scores?.overall != null);
  const sites = new Map<string, typeof done>();
  for (const a of done) if (a.kind !== "benchmark") sites.set(a.hostname, [...(sites.get(a.hostname) ?? []), a]);
  res.json({
    total, running: items.filter((a) => a.status === "running" || a.status === "queued").length, completed: done.length, failed: items.filter((a) => a.status === "failed").length,
    averageScore: scored.length ? Math.round((scored.reduce((s, a) => s + (a.scores?.overall ?? 0), 0) / scored.length) * 10) / 10 : null,
    sites: [...sites].map(([hostname, list]) => ({ hostname, audits: list.length, latest: { id: list[0].id, overall: list[0].scores?.overall ?? null, provisional: list[0].scores?.provisional ?? null, completedAt: list[0].completedAt, readiness: list[0].scores?.readiness.state ?? null }, previousOverall: list[1]?.scores?.overall ?? null })),
    recent: items.slice(0, 8),
  });
});

router.get("/trend", async (req, res) => {
  const hostname = typeof req.query.hostname === "string" ? req.query.hostname.toLowerCase() : "";
  if (!hostname) return bad(res, "hostname is required.", 400, "hostname");
  const { items } = await repo.listAudits({ ownerId: uid(req), admin: isAdmin(req), hostname, limit: 100 });
  res.json({ hostname, points: items.filter((a) => (a.status === "completed" || a.status === "partial") && a.kind !== "benchmark").reverse().map((a) => ({ id: a.id, at: a.completedAt, overall: a.scores?.overall ?? null, provisional: a.scores?.provisional ?? null, scoringVersion: a.scoringVersion, categories: Object.fromEntries((a.scores?.categories ?? []).map((c) => [c.category, c.score])) })) });
});

router.get("/settings", async (req, res) => { if (!isAdmin(req)) return bad(res, "Administrator access is required.", 403); res.json(await deps.settings.load()); });
router.put("/settings", async (req, res) => {
  if (!isAdmin(req)) return bad(res, "Administrator access is required.", 403);
  const r = await deps.settings.save(req.body ?? {});
  if (!r.ok) return bad(res, r.error, 400, "weights");
  res.json(r.settings);
});

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

router.get("/", async (req, res) => {
  const q = req.query;
  const r = await repo.listAudits({ ownerId: uid(req), admin: isAdmin(req), hostname: typeof q.hostname === "string" ? q.hostname : undefined, status: typeof q.status === "string" ? q.status : undefined, kind: typeof q.kind === "string" ? q.kind : undefined, search: typeof q.search === "string" ? q.search : undefined, limit: parseLimit(q.limit, 50, 200), offset: Math.max(0, Number(q.offset) || 0) });
  res.json(r);
});

router.post("/", async (req, res) => {
  const settings = await deps.settings.load();
  const r = normalizeConfig(req.body ?? {}, settings.limits, { userEmail: email(req), allowAuthenticated: settings.allowAuthenticatedScope });
  if (!r.ok || !r.cfg) return bad(res, r.error ?? "Invalid configuration.", 400, r.field);
  const host = new URL(r.cfg.url).hostname.toLowerCase();
  const allowed = hostAllowed(host, settings);
  if (!allowed.ok) return bad(res, allowed.reason ?? "Host not permitted.", 403, "url");
  const idem = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"].slice(0, 100) : null;
  if (idem) {
    const recent = await repo.listAudits({ ownerId: uid(req), admin: false, limit: 20 });
    const dupe = recent.items.find((a) => (a.config as unknown as { idempotencyKey?: string }).idempotencyKey === idem);
    if (dupe) return res.status(200).json(dupe);
    (r.cfg as unknown as { idempotencyKey?: string }).idempotencyKey = idem;
  }
  if (!isAdmin(req)) {
    if ((await countActive(uid(req))) >= settings.limits.maxActiveAuditsPerUser) return bad(res, `You already have ${settings.limits.maxActiveAuditsPerUser} audits running. Wait for one to finish or cancel it.`, 429);
    if ((await countRecent(uid(req), 60)) >= settings.limits.maxAuditsPerUserPerHour) return bad(res, "Hourly audit limit reached. Try again later.", 429);
  }
  const prev = await repo.previousCompleted(uid(req), host, null);
  const audit = await repo.createAudit({ ownerId: uid(req), ownerEmail: req.auth?.email ?? null, hostname: host, cfg: r.cfg, previousAuditId: prev?.id ?? null, workspace: r.cfg.workspace ?? null });
  if (r.credential) deps.holdCredential(audit.id, r.credential);
  await repo.addEvent(audit.id, "info", null, `Audit queued by ${email(req)} (${r.cfg.profile} profile, up to ${r.cfg.maxPages} pages).`);
  deps.enqueue(audit.id);
  res.status(202).json(audit);
});

// ---------------------------------------------------------------------------
// Single audit
// ---------------------------------------------------------------------------

router.get("/:id", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  res.json(await repo.getAudit(row.id));
});

router.get("/:id/bundle", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  res.json(await buildBundle(repo, row.id));
});

router.get("/:id/events", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const audit = await repo.getAudit(row.id);
  res.json({ status: audit?.status, stage: audit?.stage, stages: audit?.stages, progress: audit?.progress, events: await repo.listEvents(row.id, Number(req.query.after) || 0, parseLimit(req.query.limit, 500, 2000)) });
});

router.post("/:id/cancel", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  if (row.status !== "queued" && row.status !== "running") return bad(res, "Only queued or running audits can be cancelled.", 409);
  await deps.cancel(row.id);
  await repo.addEvent(row.id, "warn", row.stage, `Cancellation requested by ${email(req)}.`);
  res.status(202).json(await repo.getAudit(row.id));
});

router.post("/:id/retry", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  if (!["failed", "cancelled", "partial"].includes(row.status)) return bad(res, "Only failed, cancelled or partial audits can be retried.", 409);
  await repo.resetForRetry(row.id);
  await repo.addEvent(row.id, "info", null, `Retry requested by ${email(req)}. Credentials for authenticated scope are never kept, so the retry runs unauthenticated.`);
  deps.enqueue(row.id);
  res.status(202).json(await repo.getAudit(row.id));
});

router.delete("/:id", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  if (row.status === "running" || row.status === "queued") await deps.cancel(row.id);
  if (req.query.permanent === "true") await repo.hardDelete(row.id); else await repo.softDelete(row.id);
  res.status(204).end();
});

// ---- findings
router.get("/:id/findings", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const q = req.query;
  const [findings, workflows] = await Promise.all([repo.loadFindings(row.id), repo.loadWorkflows(row.id)]);
  const now = new Date().toISOString();
  const text = typeof q.q === "string" ? q.q.toLowerCase() : "";
  const list = findings.filter((f) => {
    if (typeof q.category === "string" && q.category && f.category !== q.category) return false;
    if (typeof q.severity === "string" && q.severity && f.severity !== q.severity) return false;
    if (typeof q.kind === "string" && q.kind && f.kind !== q.kind) return false;
    if (typeof q.horizon === "string" && q.horizon && f.horizon !== q.horizon) return false;
    if (typeof q.confidence === "string" && q.confidence && f.confidence !== q.confidence) return false;
    if (typeof q.tag === "string" && q.tag && !f.tags.includes(q.tag)) return false;
    if (typeof q.url === "string" && q.url && !f.affectedUrls.some((u) => u.includes(q.url as string))) return false;
    if (typeof q.effort === "string" && q.effort && f.effort !== q.effort) return false;
    const wf = workflows.get(f.fingerprint);
    if (typeof q.status === "string" && q.status && (wf?.status ?? "open") !== q.status) return false;
    if (typeof q.owner === "string" && q.owner && wf?.owner !== q.owner) return false;
    if (typeof q.lineage === "string" && q.lineage && wf?.lineage !== q.lineage) return false;
    if (text && !`${f.title} ${f.description} ${f.testId} ${f.actual ?? ""}`.toLowerCase().includes(text)) return false;
    return true;
  });
  const items: FindingView[] = list.map((f) => ({ ...f, id: f.fingerprint, workflow: workflows.get(f.fingerprint) ?? { id: f.fingerprint, auditId: row.id, fingerprint: f.fingerprint, status: "open", owner: null, notes: "", rationale: null, dueDate: null, retestStatus: "none", retestAuditId: null, verifiedAt: null, verifiedBy: null, verificationMethod: null, lineage: null, createdAt: now, updatedAt: now } }));
  res.json({ total: items.length, items });
});

router.get("/:id/findings/:fp", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const f = (await repo.loadFindings(row.id)).find((x) => x.fingerprint === req.params.fp);
  if (!f) return bad(res, "Finding not found.", 404);
  res.json({ ...f, id: f.fingerprint, workflow: await repo.getWorkflow(row.id, f.fingerprint) });
});

router.patch("/:id/findings/:fp", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const fp = String(req.params.fp);
  const f = (await repo.loadFindings(row.id)).find((x) => x.fingerprint === fp);
  const wf = await repo.getWorkflow(row.id, fp);
  if (!f || !wf) return bad(res, "Finding not found.", 404);
  const b = req.body ?? {};
  const patch: WorkflowPatch = {};
  if (typeof b.owner === "string" || b.owner === null) patch.owner = b.owner ? String(b.owner).slice(0, 120) : null;
  if (typeof b.notes === "string") patch.notes = b.notes.slice(0, 4000);
  if (typeof b.dueDate === "string" || b.dueDate === null) { if (b.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate)) return bad(res, "dueDate must be YYYY-MM-DD.", 400, "dueDate"); patch.dueDate = b.dueDate || null; }
  if (b.status !== undefined) {
    if (!(FINDING_STATUSES as readonly string[]).includes(b.status)) return bad(res, "Unknown status.", 400, "status");
    const to = b.status as FindingStatus;
    const manual = b.manualVerification && typeof b.manualVerification === "object" ? { by: email(req), notes: String(b.manualVerification.notes ?? "") } : null;
    const v = validateTransition({ from: wf.status, to, rationale: typeof b.rationale === "string" ? b.rationale : wf.rationale, retestStatus: wf.retestStatus, manualVerification: manual });
    if (!v.ok) return bad(res, v.error ?? "Transition not allowed.", 422, "status");
    patch.status = to;
    if (typeof b.rationale === "string") patch.rationale = b.rationale.slice(0, 2000);
    if (to === "verified") { patch.verifiedAt = new Date(); patch.verifiedBy = manual ? email(req) : wf.verifiedBy ?? `retest ${wf.retestAuditId}`; patch.verificationMethod = v.verificationMethod ?? null; if (manual) patch.notes = `${wf.notes ? `${wf.notes}\n` : ""}Manual verification by ${email(req)}: ${manual.notes}`.slice(0, 4000); }
    if (to === "open" || to === "retest_required") { patch.verifiedAt = null; patch.verifiedBy = null; patch.verificationMethod = null; }
  } else if (typeof b.rationale === "string") patch.rationale = b.rationale.slice(0, 2000);
  res.json(await repo.patchWorkflow(row.id, fp, patch));
});

router.post("/:id/findings/:fp/explain", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const f = (await repo.loadFindings(row.id)).find((x) => x.fingerprint === req.params.fp);
  if (!f) return bad(res, "Finding not found.", 404);
  res.json(await deps.explain(f, (await deps.settings.load()).aiExplanations));
});

router.post("/:id/retest", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  if (!["completed", "partial"].includes(row.status)) return bad(res, "Only finished audits can be retested.", 409);
  const parent = (await repo.getAudit(row.id)) as NonNullable<Awaited<ReturnType<typeof repo.getAudit>>>;
  const wanted: string[] = Array.isArray(req.body?.fingerprints) ? req.body.fingerprints.map(String) : req.body?.fingerprint ? [String(req.body.fingerprint)] : [];
  const all = (await repo.loadFindings(row.id)).filter((f) => f.kind === "defect");
  const selected = wanted.length ? all.filter((f) => wanted.includes(f.fingerprint)) : all.filter((f) => f.horizon === "immediate");
  if (!selected.length) return bad(res, "No matching findings to retest.", 404, "fingerprints");
  const settings = await deps.settings.load();
  if (!isAdmin(req) && (await countActive(uid(req))) >= settings.limits.maxActiveAuditsPerUser) return bad(res, "Too many audits are running. Try again shortly.", 429);
  const cfg = buildRetestConfig(parent, selected, email(req));
  const audit = await repo.createAudit({ ownerId: row.owner_id, ownerEmail: req.auth?.email ?? null, hostname: row.hostname, cfg, kind: "retest", parentAuditId: row.id, workspace: row.workspace });
  for (const f of selected) await repo.patchWorkflow(row.id, f.fingerprint, { status: "retest_required", retestStatus: "none", retestAuditId: audit.id });
  await repo.addEvent(audit.id, "info", null, `Retest of ${selected.length} finding(s) from audit ${row.id}.`);
  deps.enqueue(audit.id);
  res.status(202).json(audit);
});

// ---- recommendations and tasks
router.get("/:id/recommendations", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const recs = await repo.loadRecommendations(row.id);
  const h = typeof req.query.horizon === "string" ? (req.query.horizon as Horizon) : null;
  res.json({ recommendations: h ? recs.filter((r) => r.horizon === h) : recs, roadmap: buildRoadmap(recs), formula: PRIORITY_FORMULA });
});

router.get("/:id/tasks", async (req, res) => { const row = await owned(req, res, String(req.params.id)); if (!row) return; res.json({ tasks: await repo.listTasks(row.id) }); });
router.post("/:id/tasks", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const b = req.body ?? {};
  let title = typeof b.title === "string" ? b.title.trim().slice(0, 300) : "";
  let description = typeof b.description === "string" ? b.description.slice(0, 4000) : "";
  let horizon: Horizon = ["immediate", "short", "strategic"].includes(b.horizon) ? b.horizon : "short";
  if (b.fingerprint) {
    const rec = (await repo.loadRecommendations(row.id)).find((r) => r.fingerprint === b.fingerprint);
    if (!rec) return bad(res, "Recommendation not found.", 404, "fingerprint");
    title ||= rec.title; description ||= `${rec.problem}\n\nImplementation: ${rec.implementation}\n\nVerification: ${rec.verification}`; horizon = rec.horizon;
  }
  if (!title) return bad(res, "A task title is required.", 400, "title");
  if (b.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate)) return bad(res, "dueDate must be YYYY-MM-DD.", 400, "dueDate");
  res.status(201).json(await repo.createTask({ auditId: row.id, fingerprint: b.fingerprint ?? null, title, description, owner: typeof b.owner === "string" ? b.owner.slice(0, 120) : null, dueDate: b.dueDate ?? null, horizon, createdBy: email(req) }));
});
router.patch("/:id/tasks/:taskId", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const b = req.body ?? {};
  if (b.status !== undefined && !(TASK_STATUSES as readonly string[]).includes(b.status)) return bad(res, "Unknown task status.", 400, "status");
  if (b.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate)) return bad(res, "dueDate must be YYYY-MM-DD.", 400, "dueDate");
  const t = await repo.patchTask(String(req.params.taskId), row.id, { title: typeof b.title === "string" ? b.title.slice(0, 300) : undefined, description: typeof b.description === "string" ? b.description.slice(0, 4000) : undefined, owner: b.owner === null || typeof b.owner === "string" ? b.owner : undefined, dueDate: b.dueDate === null || typeof b.dueDate === "string" ? b.dueDate : undefined, status: b.status, notes: typeof b.notes === "string" ? b.notes.slice(0, 4000) : undefined, horizon: ["immediate", "short", "strategic"].includes(b.horizon) ? b.horizon : undefined });
  if (!t) return bad(res, "Task not found.", 404);
  res.json(t);
});
router.delete("/:id/tasks/:taskId", async (req, res) => { const row = await owned(req, res, String(req.params.id)); if (!row) return; await repo.deleteTask(String(req.params.taskId), row.id); res.status(204).end(); });

// ---- reports
router.get("/:id/report", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  res.json({ reports: await repo.listReports(row.id), suggestedFileName: reportFileName(row.hostname), types: REPORT_TYPES });
});
router.post("/:id/report", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const b = req.body ?? {};
  if (!(REPORT_TYPES as readonly string[]).includes(b.type)) return bad(res, "Unknown report type.", 400, "type");
  if (!Number.isFinite(Number(b.bytes)) || Number(b.bytes) < 1000) return bad(res, "The generated file is missing or too small to be a valid report.", 422, "bytes");
  if (!Number.isFinite(Number(b.pages)) || Number(b.pages) < 1) return bad(res, "The generated file has no pages.", 422, "pages");
  const filename = typeof b.filename === "string" && /^CINTEXA-NEXUS-Website-Audit-[A-Za-z0-9.-]+-\d{4}-\d{2}-\d{2}(-[a-z]+)?\.pdf$/.test(b.filename) ? b.filename : reportFileName(row.hostname);
  const saved = await repo.saveReport({ auditId: row.id, type: b.type, filename, bytes: Math.round(Number(b.bytes)), pages: Math.round(Number(b.pages)), sha256: typeof b.sha256 === "string" && /^[a-f0-9]{64}$/.test(b.sha256) ? b.sha256 : null, createdBy: email(req), meta: { scoringVersion: SCORING_VERSION, sections: Array.isArray(b.sections) ? b.sections.slice(0, 40).map(String) : [] } });
  res.status(201).json({ ...saved, filename });
});

// ---- exports and CI gate
router.get("/:id/export", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const format = String(req.query.format ?? "json");
  if (!["json", "csv", "sarif"].includes(format)) return bad(res, "format must be json, csv or sarif.", 400, "format");
  const bundle = await buildBundle(repo, row.id); if (!bundle) return bad(res, "Audit not found.", 404);
  const base = reportFileName(row.hostname).replace(/\.pdf$/, "").replace("Website-Audit", "Findings");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-disposition", `attachment; filename="${base}.${format === "sarif" ? "sarif" : format}"`);
  if (format === "csv") { res.type("text/csv; charset=utf-8").send(findingsToCsv(bundle)); return; }
  if (format === "sarif") { res.type("application/sarif+json").send(JSON.stringify(findingsToSarif(bundle, SCORING_VERSION), null, 2)); return; }
  res.type("application/json").send(JSON.stringify(bundle, null, 2));
});

/** CI/CD quality gate. 200 always carries the verdict; add strict=1 to get HTTP 422 on failure so `curl --fail` can break a pipeline. */
router.get("/:id/gate", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const num = (v: unknown, d: number | null, lo: number, hi: number): number | null => { if (v === undefined || v === "") return d; const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const bundle = await buildBundle(repo, row.id); if (!bundle) return bad(res, "Audit not found.", 404);
  const result = evaluateGate(bundle, { minScore: num(req.query.minScore, 70, 0, 100), maxCritical: num(req.query.maxCritical, 0, 0, 1000) ?? 0, maxHigh: num(req.query.maxHigh, null, 0, 1000), requireComplete: req.query.requireComplete !== "0" });
  res.status(req.query.strict === "1" && !result.passed ? 422 : 200).json(result);
});

// ---- comparison
router.get("/:id/comparison", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const against = typeof req.query.against === "string" ? req.query.against : row.previous_audit_id;
  if (!against) return res.json({ comparison: null, reason: "There is no earlier audit of this site to compare with." });
  const other = await owned(req, res, against); if (!other) return;
  await persistComparison(row.id, other.id, row.owner_id);
  const [a, b] = await Promise.all([buildBundle(repo, row.id), buildBundle(repo, other.id)]);
  if (!a || !b) return bad(res, "Audit not found.", 404);
  const { compareAudits: cmp } = await import("@workspace/wi-core");
  const st = async (id: string) => { const m: Record<string, TestStatus> = {}; for (const [k, o] of aggregateOutcomes(await repo.loadChecks(id))) m[k] = o.status; return m; };
  const env = (x: typeof a.audit) => `${x.environment?.engineVersion ?? "?"}/${x.environment?.pageSpeed ?? "?"}`;
  res.json({ comparison: cmp({ id: a.audit.id, scores: a.audit.scores, findings: a.findings, pages: a.pages.map((p) => p.facts), testStatuses: await st(row.id), environment: env(a.audit) }, { id: b.audit.id, scores: b.audit.scores, findings: b.findings, pages: b.pages.map((p) => p.facts), testStatuses: await st(other.id), environment: env(b.audit) }), current: { id: a.audit.id, completedAt: a.audit.completedAt }, previous: { id: b.audit.id, completedAt: b.audit.completedAt } });
});

// ---- competitor benchmarking
router.post("/:id/benchmark", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const settings = await deps.settings.load();
  const parsed = parseAuditUrl(String(req.body?.url ?? ""));
  if (!parsed.ok || !parsed.url) return bad(res, parsed.error ?? "Invalid URL.", 400, "url");
  if (req.body?.authorization?.confirmed !== true) return bad(res, "Confirm that a passive, public-page benchmark of this site is acceptable. Only publicly reachable pages are requested, robots.txt is respected, and crawling is limited to a small sample.", 400, "authorization");
  const host = parsed.url.hostname.toLowerCase();
  const allowed = hostAllowed(host, settings);
  if (!allowed.ok) return bad(res, allowed.reason ?? "Host not permitted.", 403, "url");
  if (!isAdmin(req) && (await countActive(uid(req))) >= settings.limits.maxActiveAuditsPerUser) return bad(res, "Too many audits are running. Try again shortly.", 429);
  const r = normalizeConfig({ url: parsed.url.toString(), name: req.body?.name ?? host, websiteType: row.website_type, profile: "standard", maxPages: Math.min(Number(req.body?.maxPages) || 10, 15), maxDepth: 1, devices: ["mobile"], externalLinkCheck: false, authorization: req.body.authorization, modules: { ...row.config.modules, security: true } }, settings.limits, { userEmail: email(req), allowAuthenticated: false });
  if (!r.ok || !r.cfg) return bad(res, r.error ?? "Invalid configuration.", 400, r.field);
  const audit = await repo.createAudit({ ownerId: row.owner_id, ownerEmail: req.auth?.email ?? null, hostname: host, cfg: r.cfg, kind: "benchmark", parentAuditId: row.id, workspace: row.workspace });
  await repo.addEvent(audit.id, "info", null, `Competitor benchmark against ${row.hostname}, requested by ${email(req)}. Passive, public-page sample only.`);
  deps.enqueue(audit.id);
  res.status(202).json(audit);
});
router.get("/:id/benchmarks", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const own = await repo.getAudit(row.id);
  const all = await repo.listAudits({ ownerId: row.owner_id, admin: true, kind: "benchmark", limit: 100 });
  const list = all.items.filter((a) => a.parentAuditId === row.id);
  const row_ = (a: NonNullable<typeof own>) => ({ id: a.id, hostname: a.hostname, status: a.status, overall: a.scores?.overall ?? null, provisional: a.scores?.provisional ?? null, coverage: a.scores?.coverage ?? null, categories: Object.fromEntries((a.scores?.categories ?? []).map((c) => [c.category, c.score])), pagesSampled: a.progress.inspected });
  res.json({ own: own ? row_(own) : null, competitors: list.map(row_), note: "Benchmarks compare a small passive sample of public pages. Scores are comparable only where coverage is similar; treat gaps as prompts for investigation, not rankings." });
});
}
