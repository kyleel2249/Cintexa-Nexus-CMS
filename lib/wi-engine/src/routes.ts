/**
 * The Website Intelligence HTTP surface, written once and mounted twice:
 *   - on the Express router of the API server;
 *   - on a tiny in-browser router for serverless local mode.
 * Handlers only touch the minimal request/response shapes below and the injected dependencies.
 */
import {
  ALL_TESTS, CATEGORY_IDS, CATEGORY_LABELS, DEFAULT_WEIGHTS, FINDING_STATUSES, PROFILE_PRESETS, REPORT_TYPES, SCORING_VERSION, STAGE_IDS, STAGE_LABELS, TASK_STATUSES, WEBSITE_TYPES, WEBSITE_TYPE_LABELS,
  buildRoadmap, compareAudits, parseAuditUrl, reportFileName, validateTransition, PRIORITY_FORMULA, SCORE_FORMULA, aggregateOutcomes,
  COMPETITOR_CLASSES, COMPETITOR_CLASS_LABELS, REC_STATUSES, REC_STATUS_DESCRIPTIONS, REC_STATUS_LABELS, buildBenchmarkReport, emptyRecWorkflow, COMPETITOR_STATUSES, DEFAULT_SELECTION, benchmarkSampleNote, canonicalDomain, median, selectForComparison,
  type RecActor, type RecStatus, type VerificationEvidence,
  type AuditBundle, type CheckResult, type Finding, type FindingStatus, type FindingView, type Horizon, type TestStatus,
} from "@workspace/wi-core";
import { normalizeConfig } from "./config";
import { addManualCompetitor, isDiscoveryRunning, startDiscoveryInBackground } from "./competitor-discovery";
import { assignRecommendation, getWorkflowOrNew, startVerification, transitionRecommendation, viewFor } from "./recommendation-lifecycle";
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

const clampNum = (v: unknown, d: number, lo: number, hi: number): number => { if (v === undefined || v === "" || v === null) return d; const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };

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

/** Creates a targeted retest audit for the selected defects and moves any implemented recommendations to VERIFYING. */
async function startRetest(req: ReqLike, row: Record<string, any>, selected: Finding[]): Promise<{ ok: true; audit: Awaited<ReturnType<EngineRepo["createAudit"]>> } | { ok: false; status: number; error: string }> {
  const parent = (await repo.getAudit(row.id)) as NonNullable<Awaited<ReturnType<typeof repo.getAudit>>>;
  const settings = await deps.settings.load();
  if (!isAdmin(req) && (await countActive(uid(req))) >= settings.limits.maxActiveAuditsPerUser) return { ok: false, status: 429, error: "Too many audits are running. Try again shortly." };
  const cfg = buildRetestConfig(parent, selected, email(req));
  const audit = await repo.createAudit({ ownerId: row.owner_id, ownerEmail: req.auth?.email ?? null, hostname: row.hostname, cfg, kind: "retest", parentAuditId: row.id, workspace: row.workspace });
  for (const f of selected) await repo.patchWorkflow(row.id, f.fingerprint, { status: "retest_required", retestStatus: "none", retestAuditId: audit.id });
  await repo.addEvent(audit.id, "info", null, `Retest of ${selected.length} finding(s) from audit ${row.id}.`);
  await startVerification(row.id, selected.map((f) => f.fingerprint), audit.id);
  deps.enqueue(audit.id);
  return { ok: true, audit };
}
router.post("/:id/retest", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  if (!["completed", "partial"].includes(row.status)) return bad(res, "Only finished audits can be retested.", 409);
  const wanted: string[] = Array.isArray(req.body?.fingerprints) ? req.body.fingerprints.map(String) : req.body?.fingerprint ? [String(req.body.fingerprint)] : [];
  const all = (await repo.loadFindings(row.id)).filter((f) => f.kind === "defect");
  const selected = wanted.length ? all.filter((f) => wanted.includes(f.fingerprint)) : all.filter((f) => f.horizon === "immediate");
  if (!selected.length) return bad(res, "No matching findings to retest.", 404, "fingerprints");
  const r = await startRetest(req, row, selected);
  if (!r.ok) return bad(res, r.error, r.status);
  res.status(202).json(r.audit);
});
const recActor = (req: ReqLike, row: Record<string, any>): RecActor => ({ kind: "user", id: email(req), isOwner: row.owner_id === uid(req), isAdmin: isAdmin(req) });
router.get("/:id/recommendations", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const recs = await repo.loadRecommendations(row.id);
  const h = typeof req.query.horizon === "string" ? (req.query.horizon as Horizon) : null;
  const [wfs, settings] = await Promise.all([repo.loadRecWorkflows(row.id), deps.settings.load()]);
  const actor = recActor(req, row);
  const view = (fp: string) => viewFor(wfs.get(fp) ?? emptyRecWorkflow(row.id, fp), actor, { requireSeparateApprover: settings.requireSeparateApprover });
  const counts = Object.fromEntries(REC_STATUSES.map((s) => [s, 0])) as Record<RecStatus, number>;
  for (const r of recs) counts[view(r.fingerprint).workflow.status]++;
  const items = (h ? recs.filter((r) => r.horizon === h) : recs).map((r) => { const v = view(r.fingerprint); return { ...r, workflow: v.workflow, allowed: v.allowed, execution: v.execution }; });
  res.json({ recommendations: items, roadmap: buildRoadmap(recs), formula: PRIORITY_FORMULA, counts, statuses: REC_STATUSES.map((s) => ({ id: s, label: REC_STATUS_LABELS[s], description: REC_STATUS_DESCRIPTIONS[s] })), requireSeparateApprover: settings.requireSeparateApprover });
});
const TRANSITION_STATUS: Record<string, number> = { not_found: 404 };
router.post("/:id/recommendations/:fp/transition", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const body = req.body ?? {};
  const to = String(body.to ?? "");
  if (!(REC_STATUSES as readonly string[]).includes(to)) return bad(res, "Unknown status.", 400, "to");
  const note = body.note === undefined || body.note === null ? null : String(body.note).slice(0, 2000);
  const expectedVersion = body.expectedVersion === undefined || body.expectedVersion === null ? null : Number(body.expectedVersion);
  if (expectedVersion !== null && !Number.isInteger(expectedVersion)) return bad(res, "expectedVersion must be a whole number.", 400, "expectedVersion");
  let evidence: VerificationEvidence | null = null;
  if (to === "VERIFIED") {
    const e = body.evidence ?? {};
    const method = String(e.method ?? "");
    if (!["manual", "retest", "rescan"].includes(method)) return bad(res, "Verification needs evidence: a retest or rescan audit, or a documented manual check.", 400, "evidence");
    evidence = { method: method as VerificationEvidence["method"], outcome: "passed", ...(typeof e.auditId === "string" ? { auditId: e.auditId } : {}), ...(typeof e.testId === "string" ? { testId: e.testId } : {}) };
    if (method !== "manual") {
      // A user-supplied citation is checked against the cited audit's real results; it cannot simply be asserted.
      const cited = evidence.auditId ? await repo.getAuditRow(evidence.auditId) : null;
      if (!cited || cited.owner_id !== row.owner_id || cited.hostname !== row.hostname || !["completed", "partial"].includes(cited.status)) return bad(res, "The cited audit was not found for this site, or has not finished.", 400, "evidence");
      const finding = (await repo.loadFindings(row.id)).find((f) => f.fingerprint === String(req.params.fp));
      const o = finding ? aggregateOutcomes(await repo.loadChecks(cited.id)).get(finding.testId) : undefined;
      if (!o || (o.status !== "passed" && o.status !== "not_applicable")) return bad(res, "The cited audit does not show this test passing, so it cannot verify the recommendation.", 400, "evidence");
      evidence.testId = finding?.testId;
    }
  }
  const r = await transitionRecommendation({ auditId: row.id, fingerprint: String(req.params.fp), to: to as RecStatus, actor: recActor(req, row), note, evidence, expectedVersion });
  if (!r.ok) return res.status(TRANSITION_STATUS[r.code] ?? r.status).json({ error: r.error, code: r.code, ...(r.current ? { workflow: r.current } : {}) });
  await repo.addEvent(row.id, "info", null, `Recommendation ${String(req.params.fp).slice(0, 12)} moved to ${REC_STATUS_LABELS[to as RecStatus]} by ${email(req)}.`);
  const settings = await deps.settings.load();
  const v = viewFor(r.workflow, recActor(req, row), { requireSeparateApprover: settings.requireSeparateApprover });
  res.json({ workflow: v.workflow, allowed: v.allowed, execution: v.execution, approval: r.approval });
});
router.patch("/:id/recommendations/:fp", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const a = req.body?.assignee;
  if (a !== null && typeof a !== "string") return bad(res, "assignee must be text, or null to clear it.", 400, "assignee");
  const r = await assignRecommendation({ auditId: row.id, fingerprint: String(req.params.fp), actor: recActor(req, row), assignee: a });
  if (!r.ok) return bad(res, r.error, r.status);
  res.json({ workflow: r.workflow });
});
router.get("/:id/recommendations/:fp/history", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const fp = String(req.params.fp);
  if (!(await repo.loadRecommendations(row.id)).some((r) => r.fingerprint === fp)) return bad(res, "Recommendation not found.", 404);
  const [events, approvals, workflow] = await Promise.all([repo.listRecEvents(row.id, fp), repo.listRecApprovals(row.id, fp), getWorkflowOrNew(row.id, fp)]);
  res.json({ workflow, events, approvals });
});
/** Starts independent verification: a targeted retest of this recommendation's finding. The result, not the requester, decides the status. */
router.post("/:id/recommendations/:fp/verify", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  if (!["completed", "partial"].includes(row.status)) return bad(res, "Only finished audits can be retested.", 409);
  const fp = String(req.params.fp);
  const finding = (await repo.loadFindings(row.id)).find((f) => f.fingerprint === fp && f.kind === "defect");
  if (!finding) return bad(res, "Recommendation not found.", 404);
  const wf = await getWorkflowOrNew(row.id, fp);
  if (wf.status !== "IMPLEMENTED" && wf.status !== "VERIFYING") return bad(res, "Only implemented recommendations can be verified. Mark it implemented first.", 409);
  const r = await startRetest(req, row, [finding]);
  if (!r.ok) return bad(res, r.error, r.status);
  res.status(202).json(r.audit);
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
/** Creates one passive benchmark audit of a competitor. Shared by the single-URL and the approved-competitors endpoints. */
async function startBenchmarkAudit(req: ReqLike, row: Record<string, any>, rawUrl: string, name: unknown, maxPagesIn: unknown): Promise<{ ok: true; audit: Awaited<ReturnType<EngineRepo["createAudit"]>> } | { ok: false; status: number; error: string; field?: string }> {
  const settings = await deps.settings.load();
  const parsed = parseAuditUrl(String(rawUrl ?? ""));
  if (!parsed.ok || !parsed.url) return { ok: false, status: 400, error: parsed.error ?? "Invalid URL.", field: "url" };
  const host = parsed.url.hostname.toLowerCase();
  const allowed = hostAllowed(host, settings);
  if (!allowed.ok) return { ok: false, status: 403, error: allowed.reason ?? "Host not permitted.", field: "url" };
  if (!isAdmin(req) && (await countActive(uid(req))) >= settings.limits.maxActiveAuditsPerUser) return { ok: false, status: 429, error: "Too many audits are running. Try again shortly." };
  const r = normalizeConfig({ url: parsed.url.toString(), name: name ?? host, websiteType: row.website_type, profile: "standard", maxPages: Math.min(Number(maxPagesIn) || 10, 15), maxDepth: 1, devices: ["mobile"], externalLinkCheck: false, authorization: req.body.authorization, modules: { ...row.config.modules, security: true } }, settings.limits, { userEmail: email(req), allowAuthenticated: false });
  if (!r.ok || !r.cfg) return { ok: false, status: 400, error: r.error ?? "Invalid configuration.", field: r.field };
  const audit = await repo.createAudit({ ownerId: row.owner_id, ownerEmail: req.auth?.email ?? null, hostname: host, cfg: r.cfg, kind: "benchmark", parentAuditId: row.id, workspace: row.workspace });
  await repo.addEvent(audit.id, "info", null, `Competitor benchmark against ${row.hostname}, requested by ${email(req)}. Passive, public-page sample only.`);
  deps.enqueue(audit.id);
  return { ok: true, audit };
}
const BENCHMARK_CONSENT = "Confirm that a passive, public-page benchmark of this site is acceptable. Only publicly reachable pages are requested, robots.txt is respected, and crawling is limited to a small sample.";
router.post("/:id/benchmark", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const parsed = parseAuditUrl(String(req.body?.url ?? ""));
  if (!parsed.ok || !parsed.url) return bad(res, parsed.error ?? "Invalid URL.", 400, "url");
  if (req.body?.authorization?.confirmed !== true) return bad(res, BENCHMARK_CONSENT, 400, "authorization");
  const r = await startBenchmarkAudit(req, row, String(req.body?.url ?? ""), req.body?.name, req.body?.maxPages);
  if (!r.ok) return bad(res, r.error, r.status, r.field);
  res.status(202).json(r.audit);
});
// ---- competitors (automatic discovery, review, and benchmarking of the approved set)
const competitorView = (c: import("@workspace/wi-core").CompetitorCandidate) => ({ ...c, classificationLabel: COMPETITOR_CLASS_LABELS[c.classification] });
router.get("/:id/competitors", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const [list, runs, integrations, benchAudits] = await Promise.all([
    repo.listCompetitors(row.owner_id, row.hostname), repo.listCompetitorRuns(row.owner_id, row.hostname, 10), deps.integrations(),
    repo.listAudits({ ownerId: row.owner_id, admin: true, kind: "benchmark", limit: 200 }),
  ]);
  const search = integrations.find((i) => i.id === "search_provider") ?? null;
  const benchByDomain = new Map<string, { id: string; status: string; overall: number | null }>();
  for (const a of benchAudits.items.filter((x) => x.parentAuditId === row.id)) { const d = canonicalDomain(a.hostname); if (d) benchByDomain.set(d, { id: a.id, status: a.status, overall: a.scores?.overall ?? null }); }
  const selected = new Set(selectForComparison(list).map((c) => c.domain));
  res.json({
    hostname: row.hostname,
    searchProvider: search ? { status: search.status, detail: search.detail, envVars: search.envVars } : null,
    discoveryRunning: isDiscoveryRunning(row.owner_id, row.hostname) || runs.some((r) => r.status === "running" && Date.now() - Date.parse(r.startedAt) < 10 * 60_000),
    defaults: { maxDiscover: DEFAULT_SELECTION.maxDiscover, maxCompare: DEFAULT_SELECTION.maxCompare, minConfidence: DEFAULT_SELECTION.minConfidence },
    classes: COMPETITOR_CLASSES.map((c) => ({ id: c, label: COMPETITOR_CLASS_LABELS[c] })),
    competitors: list.map((c) => ({ ...competitorView(c), selected: selected.has(c.domain), benchmark: benchByDomain.get(c.domain) ?? null })),
    runs,
  });
});
router.post("/:id/competitors/discover", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  if (row.kind !== "audit") return bad(res, "Competitor discovery runs from a primary audit of the site.", 400);
  if (row.status !== "completed" && row.status !== "partial") return bad(res, "Wait for the audit to finish. Discovery uses the audited pages to work out what the site is about.", 409);
  const started = startDiscoveryInBackground({ ownerId: row.owner_id, auditId: row.id, hostname: row.hostname, options: { maxDiscover: clampNum(req.body?.maxDiscover, DEFAULT_SELECTION.maxDiscover, 1, 50), maxCompare: clampNum(req.body?.maxCompare, DEFAULT_SELECTION.maxCompare, 1, 25) }, onError: (e) => { void repo.addEvent(row.id, "warn", null, `Competitor discovery failed: ${e.message}`); } });
  if (!started) return bad(res, "Competitor discovery is already running for this site.", 409);
  await repo.addEvent(row.id, "info", null, `Competitor discovery requested by ${email(req)}.`);
  res.status(202).json({ started: true });
});
router.post("/:id/competitors", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const r = await addManualCompetitor({ ownerId: row.owner_id, hostname: row.hostname, url: String(req.body?.url ?? ""), name: typeof req.body?.name === "string" ? req.body.name.slice(0, 120) : null, industry: typeof req.body?.industry === "string" ? req.body.industry.slice(0, 120) : null });
  if (!r.ok) return bad(res, r.error, 400, "url");
  res.status(201).json(competitorView(r.candidate));
});
router.patch("/:id/competitors/:domain", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const body = req.body ?? {};
  const patch: import("./repo").CompetitorPatch = {};
  if (body.status !== undefined) { if (!(COMPETITOR_STATUSES as readonly string[]).includes(body.status) || body.status === "unverifiable") return bad(res, "Status must be pending, approved or rejected.", 400, "status"); patch.status = body.status; }
  if (body.classification !== undefined) { if (!(COMPETITOR_CLASSES as readonly string[]).includes(body.classification)) return bad(res, "Unknown classification.", 400, "classification"); patch.classification = body.classification; }
  for (const k of ["name", "industry", "market"] as const) if (body[k] !== undefined) { if (body[k] !== null && typeof body[k] !== "string") return bad(res, `${k} must be text.`, 400, k); patch[k] = body[k] === null ? null : String(body[k]).trim().slice(0, 120) || null; }
  const updated = await repo.patchCompetitor(row.owner_id, row.hostname, String(req.params.domain).toLowerCase(), patch);
  if (!updated) return bad(res, "Competitor not found.", 404);
  await repo.addEvent(row.id, "info", null, `Competitor ${updated.domain} updated by ${email(req)}${patch.status ? ` (status: ${patch.status})` : ""}.`);
  res.json(competitorView(updated));
});
router.delete("/:id/competitors/:domain", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  if (!(await repo.deleteCompetitor(row.owner_id, row.hostname, String(req.params.domain).toLowerCase()))) return bad(res, "Competitor not found.", 404);
  res.status(204).end();
});
/** Starts passive benchmark audits for the approved competitors (or, when none are approved, the automatic selection) that have not been measured yet. */
router.post("/:id/competitors/benchmark", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  if (req.body?.authorization?.confirmed !== true) return bad(res, BENCHMARK_CONSENT, 400, "authorization");
  const list = await repo.listCompetitors(row.owner_id, row.hostname);
  const approved = list.filter((c) => c.status === "approved");
  const targets = (approved.length ? approved : selectForComparison(list)).slice(0, DEFAULT_SELECTION.maxCompare);
  if (!targets.length) return bad(res, "There are no approved or eligible competitors to benchmark yet.", 409);
  const existing = await repo.listAudits({ ownerId: row.owner_id, admin: true, kind: "benchmark", limit: 200 });
  const done = new Set(existing.items.filter((a) => a.parentAuditId === row.id && a.status !== "failed" && a.status !== "cancelled").map((a) => canonicalDomain(a.hostname)));
  const started: string[] = []; const skipped: { domain: string; reason: string }[] = [];
  for (const c of targets) {
    if (done.has(c.domain)) { skipped.push({ domain: c.domain, reason: "Already benchmarked." }); continue; }
    const r = await startBenchmarkAudit(req, row, c.url, c.name ?? c.domain, req.body?.maxPages);
    if (r.ok) started.push(c.domain); else skipped.push({ domain: c.domain, reason: r.error });
    if (!r.ok && r.status === 429) break;
  }
  res.status(started.length ? 202 : 200).json({ started, skipped });
});
router.get("/:id/benchmarks", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const own = await repo.getAudit(row.id);
  const all = await repo.listAudits({ ownerId: row.owner_id, admin: true, kind: "benchmark", limit: 100 });
  const list = all.items.filter((a) => a.parentAuditId === row.id);
  const row_ = (a: NonNullable<typeof own>) => ({ id: a.id, hostname: a.hostname, status: a.status, overall: a.scores?.overall ?? null, provisional: a.scores?.provisional ?? null, coverage: a.scores?.coverage ?? null, categories: Object.fromEntries((a.scores?.categories ?? []).map((c) => [c.category, c.score])), pagesSampled: a.progress.inspected, scoringVersion: a.scoringVersion });
  const rows = list.map(row_);
  const sample = benchmarkSampleNote(rows);
  const peerMedian = sample.level === "none" || sample.level === "insufficient" ? null : median(rows.map((r) => r.overall).filter((n): n is number => typeof n === "number"));
  const ownRow = own ? row_(own) : null;
  const report = buildBenchmarkReport(ownRow, rows.filter((r) => r.status === "completed" || r.status === "partial"));
  res.json({ own: ownRow, competitors: rows, sample, peerMedian, report, note: "Benchmarks compare a small passive sample of public pages. Scores are comparable only where coverage is similar; treat gaps as prompts for investigation, not rankings." });
});
}
