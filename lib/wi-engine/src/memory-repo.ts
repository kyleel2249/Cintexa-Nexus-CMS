/**
 * In-memory implementation of the storage port, with export/import hooks so a host can persist it (IndexedDB in the browser).
 * Mirrors the SQL semantics of the Postgres store: soft delete, workflow carry-over, upserts keyed by URL/fingerprint.
 */
import { AUDIT_SCHEMA_VERSION, SCORING_VERSION } from "@workspace/wi-core";
import type { CompetitorCandidate } from "@workspace/wi-core";
import type {
  AuditSummary, CheckResult, Finding, FindingWorkflow, PageFacts, PerformanceSample, Recommendation, RemediationTask,
} from "@workspace/wi-core";
import {
  emptyProgress, initialStages, newId, stripSecrets,
  type AuditPatch, type AuditRow, type CompetitorPatch, type CompetitorRunRow, type EngineRepo, type EventRow, type ListFilter, type NewAudit, type PageRow, type ReportInput, type ReportRow, type TaskInput, type TaskPatch, type WorkflowPatch,
} from "./repo";

interface AuditRecord {
  summary: AuditSummary;
  workspace: string | null;
  cancelRequested: boolean;
  attempts: number;
  deleted: boolean;
  events: EventRow[];
  nextEventId: number;
  pages: Record<string, PageRow>;
  checks: Record<string, CheckResult[]>;
  performance: PerformanceSample[];
  findings: Finding[];
  recommendations: Recommendation[];
  workflows: Record<string, FindingWorkflow>;
  tasks: RemediationTask[];
  reports: ReportRow[];
}

/** JSON-safe form of one audit and everything that hangs off it. */
export type StoredAudit = AuditRecord;

const nowIso = () => new Date().toISOString();
const dateOnly = (v: string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const MAX_EVENTS = 2000;

export class MemoryRepo implements EngineRepo {
  private readonly audits = new Map<string, AuditRecord>();
  private readonly comparisons = new Map<string, unknown>();
  /** Competitors and discovery runs are held in memory only in local mode (not persisted to IndexedDB). */
  private readonly competitors = new Map<string, Map<string, CompetitorCandidate>>();
  private readonly competitorRuns: CompetitorRunRow[] = [];

  constructor(private readonly onChange: (auditId: string, kind: "write" | "delete") => void = () => undefined) {}

  // ---- persistence hooks
  exportAudit(id: string): StoredAudit | null { const r = this.audits.get(id); return r ? JSON.parse(JSON.stringify(r)) as StoredAudit : null; }
  importAudit(rec: StoredAudit): void { this.audits.set(rec.summary.id, rec); }
  allIds(): string[] { return [...this.audits.keys()]; }
  private touch(id: string, kind: "write" | "delete" = "write") { this.onChange(id, kind); }
  private rec(id: string): AuditRecord | undefined { return this.audits.get(id); }
  private live(id: string): AuditRecord | undefined { const r = this.audits.get(id); return r && !r.deleted ? r : undefined; }

  // ---- audits
  async createAudit(a: NewAudit): Promise<AuditSummary> {
    const id = a.id ?? newId("aud");
    const summary: AuditSummary = {
      id, kind: a.kind ?? "audit", hostname: a.hostname, url: a.cfg.url, name: a.cfg.name ?? null, websiteType: a.cfg.websiteType, profile: a.cfg.profile,
      status: "queued", stage: null, stages: initialStages(), progress: emptyProgress(), createdAt: nowIso(), startedAt: null, completedAt: null,
      ownerId: a.ownerId, ownerEmail: a.ownerEmail, scoringVersion: SCORING_VERSION, scores: null, previousAuditId: a.previousAuditId ?? null, parentAuditId: a.parentAuditId ?? null,
      error: null, config: stripSecrets(a.cfg), coverage: null, environment: null, monitorId: a.monitorId ?? null,
    };
    this.audits.set(id, { summary, workspace: a.workspace ?? null, cancelRequested: false, attempts: 0, deleted: false, events: [], nextEventId: 1, pages: {}, checks: {}, performance: [], findings: [], recommendations: [], workflows: {}, tasks: [], reports: [] });
    this.touch(id);
    return structuredClone(summary);
  }
  async getAuditRow(id: string): Promise<AuditRow | null> {
    const r = this.live(id); if (!r) return null;
    const s = r.summary;
    return { ...structuredClone(s), owner_id: s.ownerId, owner_email: s.ownerEmail, website_type: s.websiteType, previous_audit_id: s.previousAuditId, parent_audit_id: s.parentAuditId, monitor_id: s.monitorId, share_token: null, workspace: r.workspace, cancel_requested: r.cancelRequested, attempts: r.attempts };
  }
  async getAudit(id: string): Promise<AuditSummary | null> { const r = this.live(id); return r ? structuredClone(r.summary) : null; }
  async listAudits(f: ListFilter): Promise<{ items: AuditSummary[]; total: number }> {
    const q = f.search?.toLowerCase();
    let list = [...this.audits.values()].filter((r) => !r.deleted).map((r) => r.summary);
    if (!f.admin && f.ownerId) list = list.filter((a) => a.ownerId === f.ownerId);
    if (f.hostname) list = list.filter((a) => a.hostname === f.hostname!.toLowerCase());
    if (f.status) list = list.filter((a) => a.status === f.status);
    if (f.kind) list = list.filter((a) => a.kind === f.kind);
    if (q) list = list.filter((a) => a.hostname.toLowerCase().includes(q) || (a.name ?? "").toLowerCase().includes(q));
    list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    const total = list.length;
    const off = f.offset ?? 0; const lim = Math.min(f.limit ?? 50, 200);
    return { items: structuredClone(list.slice(off, off + lim)), total };
  }
  async patchAudit(id: string, p: AuditPatch): Promise<void> {
    const r = this.rec(id); if (!r) return;
    const s = r.summary;
    if (p.status !== undefined) s.status = p.status;
    if (p.stage !== undefined) s.stage = p.stage;
    if (p.stages !== undefined) s.stages = structuredClone(p.stages);
    if (p.progress !== undefined) s.progress = { ...p.progress };
    if (p.scores !== undefined) s.scores = p.scores ? structuredClone(p.scores) : null;
    if (p.coverage !== undefined) s.coverage = p.coverage ? structuredClone(p.coverage) : null;
    if (p.environment !== undefined) s.environment = p.environment ? structuredClone(p.environment) : null;
    if (p.error !== undefined) s.error = p.error;
    if (p.startedAt !== undefined) s.startedAt = iso(p.startedAt);
    if (p.completedAt !== undefined) s.completedAt = iso(p.completedAt);
    if (p.previousAuditId !== undefined) s.previousAuditId = p.previousAuditId;
    this.touch(id);
  }
  async requestCancel(id: string): Promise<void> { const r = this.rec(id); if (r) { r.cancelRequested = true; this.touch(id); } }
  async isCancelRequested(id: string): Promise<boolean> { return Boolean(this.rec(id)?.cancelRequested); }
  async resetForRetry(id: string): Promise<void> {
    const r = this.rec(id); if (!r) return;
    r.pages = {}; r.checks = {}; r.performance = []; r.findings = []; r.recommendations = [];
    Object.assign(r.summary, { status: "queued", stage: null, stages: initialStages(), progress: emptyProgress(), scores: null, coverage: null, error: null, startedAt: null, completedAt: null });
    r.cancelRequested = false; r.attempts += 1;
    this.touch(id);
  }
  async softDelete(id: string): Promise<void> { const r = this.rec(id); if (r) { r.deleted = true; this.touch(id); } }
  async hardDelete(id: string): Promise<void> { if (this.audits.delete(id)) this.touch(id, "delete"); }
  async previousCompleted(ownerId: string, hostname: string, beforeId: string | null): Promise<AuditSummary | null> {
    const c = [...this.audits.values()].filter((r) => !r.deleted).map((r) => r.summary)
      .filter((a) => a.ownerId === ownerId && a.hostname === hostname && a.kind !== "benchmark" && (a.status === "completed" || a.status === "partial") && (beforeId === null || a.id !== beforeId))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return c[0] ? structuredClone(c[0]) : null;
  }

  // ---- events
  async addEvent(auditId: string, level: string, stage: string | null, message: string, data?: unknown): Promise<void> {
    const r = this.rec(auditId); if (!r) return;
    r.events.push({ id: r.nextEventId++, at: nowIso(), level, stage, message: message.slice(0, 1000), data: data === undefined ? null : data });
    if (r.events.length > MAX_EVENTS) r.events.splice(0, r.events.length - MAX_EVENTS);
    this.touch(auditId);
  }
  async listEvents(auditId: string, afterId = 0, limit = 500): Promise<EventRow[]> {
    const r = this.rec(auditId); if (!r) return [];
    return r.events.filter((e) => e.id > afterId).slice(0, Math.min(limit, 2000)).map((e) => ({ ...e }));
  }

  // ---- raw results
  async savePage(auditId: string, facts: PageFacts, score: number | null, skippedReason?: string): Promise<void> {
    const r = this.rec(auditId); if (!r) return;
    r.pages[facts.url] = { facts: structuredClone(facts), score, skippedReason: skippedReason ?? null };
    this.touch(auditId);
  }
  async updatePageScore(auditId: string, url: string, score: number | null): Promise<void> { const p = this.rec(auditId)?.pages[url]; if (p) { p.score = score; this.touch(auditId); } }
  async saveChecks(auditId: string, url: string, results: CheckResult[]): Promise<void> { const r = this.rec(auditId); if (r) { r.checks[url] = structuredClone(results); this.touch(auditId); } }
  async loadChecks(auditId: string): Promise<CheckResult[]> { return structuredClone(Object.values(this.rec(auditId)?.checks ?? {}).flat()); }
  async loadPages(auditId: string): Promise<PageRow[]> {
    return structuredClone(Object.values(this.rec(auditId)?.pages ?? {}).sort((a, b) => a.facts.depth - b.facts.depth || (a.facts.url < b.facts.url ? -1 : a.facts.url > b.facts.url ? 1 : 0)));
  }
  async savePerformance(auditId: string, samples: PerformanceSample[]): Promise<void> { const r = this.rec(auditId); if (r) { r.performance = structuredClone(samples); this.touch(auditId); } }
  async loadPerformance(auditId: string): Promise<PerformanceSample[]> { return structuredClone(this.rec(auditId)?.performance ?? []); }

  // ---- derived
  async replaceFindings(auditId: string, findings: Finding[], lineage: Map<string, "new" | "recurring" | null>): Promise<void> {
    const r = this.rec(auditId); if (!r) return;
    r.findings = structuredClone(findings).sort((a, b) => b.priorityScore - a.priorityScore || (a.testId < b.testId ? -1 : 1));
    const t = nowIso();
    for (const f of findings) {
      if (f.kind !== "defect") continue;
      const cur = r.workflows[f.fingerprint];
      if (cur) cur.lineage = lineage.get(f.fingerprint) ?? null;
      else r.workflows[f.fingerprint] = { id: newId("fw"), auditId, fingerprint: f.fingerprint, status: "open", owner: null, notes: "", rationale: null, dueDate: null, retestStatus: "none", retestAuditId: null, verifiedAt: null, verifiedBy: null, verificationMethod: null, lineage: lineage.get(f.fingerprint) ?? null, createdAt: t, updatedAt: t };
    }
    this.touch(auditId);
  }
  async saveRecommendations(auditId: string, recs: Recommendation[]): Promise<void> { const r = this.rec(auditId); if (r) { r.recommendations = structuredClone(recs).sort((a, b) => a.rank - b.rank); this.touch(auditId); } }
  async loadFindings(auditId: string): Promise<Finding[]> { return structuredClone(this.rec(auditId)?.findings ?? []); }
  async loadRecommendations(auditId: string): Promise<Recommendation[]> { return structuredClone(this.rec(auditId)?.recommendations ?? []); }

  // ---- workflow
  async loadWorkflows(auditId: string): Promise<Map<string, FindingWorkflow>> { return new Map(Object.entries(structuredClone(this.rec(auditId)?.workflows ?? {}))); }
  async getWorkflow(auditId: string, fingerprint: string): Promise<FindingWorkflow | null> { const w = this.rec(auditId)?.workflows[fingerprint]; return w ? structuredClone(w) : null; }
  async patchWorkflow(auditId: string, fingerprint: string, p: WorkflowPatch): Promise<FindingWorkflow | null> {
    const w = this.rec(auditId)?.workflows[fingerprint]; if (!w) return null;
    if (p.status !== undefined) w.status = p.status;
    if (p.owner !== undefined) w.owner = p.owner;
    if (p.notes !== undefined) w.notes = p.notes;
    if (p.rationale !== undefined) w.rationale = p.rationale;
    if (p.dueDate !== undefined) w.dueDate = dateOnly(p.dueDate);
    if (p.retestStatus !== undefined) w.retestStatus = p.retestStatus;
    if (p.retestAuditId !== undefined) w.retestAuditId = p.retestAuditId;
    if (p.verifiedAt !== undefined) w.verifiedAt = iso(p.verifiedAt);
    if (p.verifiedBy !== undefined) w.verifiedBy = p.verifiedBy;
    if (p.verificationMethod !== undefined) w.verificationMethod = p.verificationMethod;
    w.updatedAt = nowIso();
    this.touch(auditId);
    return structuredClone(w);
  }
  /** Same rules as the SQL version: owner, notes and due date carry over; accepted/dismissed keep their status and rationale; verified/fixed items reopen. */
  async carryWorkflow(fromAuditId: string, toAuditId: string): Promise<number> {
    const from = this.rec(fromAuditId), to = this.rec(toAuditId); if (!from || !to) return 0;
    let n = 0;
    for (const [fp, o] of Object.entries(from.workflows)) {
      const w = to.workflows[fp]; if (!w) continue;
      w.owner = o.owner; w.notes = o.notes; w.dueDate = o.dueDate;
      w.status = o.status === "accepted_risk" || o.status === "dismissed" ? o.status : ["verified", "fixed", "retest_required"].includes(o.status) ? "open" : o.status;
      w.rationale = o.status === "accepted_risk" || o.status === "dismissed" ? o.rationale : null;
      n++;
    }
    if (n) this.touch(toAuditId);
    return n;
  }

  // ---- tasks
  async listTasks(auditId: string): Promise<RemediationTask[]> { return structuredClone(this.rec(auditId)?.tasks ?? []); }
  async createTask(t: TaskInput): Promise<RemediationTask> {
    const r = this.rec(t.auditId); if (!r) throw new Error("Audit not found.");
    const now = nowIso();
    const task: RemediationTask = { id: newId("tsk"), auditId: t.auditId, fingerprint: t.fingerprint ?? null, title: t.title, description: t.description ?? "", owner: t.owner ?? null, dueDate: dateOnly(t.dueDate), status: "todo", horizon: t.horizon ?? "short", notes: "", createdBy: t.createdBy ?? null, createdAt: now, updatedAt: now };
    r.tasks.push(task); this.touch(t.auditId);
    return structuredClone(task);
  }
  async patchTask(id: string, auditId: string, p: TaskPatch): Promise<RemediationTask | null> {
    const t = this.rec(auditId)?.tasks.find((x) => x.id === id); if (!t) return null;
    if (p.title !== undefined) t.title = p.title;
    if (p.description !== undefined) t.description = p.description;
    if (p.owner !== undefined) t.owner = p.owner;
    if (p.dueDate !== undefined) t.dueDate = dateOnly(p.dueDate);
    if (p.status !== undefined) t.status = p.status;
    if (p.notes !== undefined) t.notes = p.notes;
    if (p.horizon !== undefined) t.horizon = p.horizon;
    t.updatedAt = nowIso(); this.touch(auditId);
    return structuredClone(t);
  }
  async deleteTask(id: string, auditId: string): Promise<void> { const r = this.rec(auditId); if (r) { r.tasks = r.tasks.filter((x) => x.id !== id); this.touch(auditId); } }

  // ---- reports and comparisons
  async saveReport(rep: ReportInput): Promise<{ id: string; createdAt: string }> {
    const r = this.rec(rep.auditId); if (!r) throw new Error("Audit not found.");
    const row: ReportRow = { id: newId("rpt"), type: rep.type, filename: rep.filename, bytes: rep.bytes, pages: rep.pages, sha256: rep.sha256, createdBy: rep.createdBy, createdAt: nowIso(), meta: rep.meta ?? {} };
    r.reports.unshift(row); this.touch(rep.auditId);
    return { id: row.id, createdAt: row.createdAt };
  }
  async listReports(auditId: string): Promise<ReportRow[]> { return structuredClone(this.rec(auditId)?.reports ?? []); }
  async saveComparison(_ownerId: string, currentId: string, previousId: string, data: unknown): Promise<void> { this.comparisons.set(`${currentId}:${previousId}`, data); }

  // ---- competitors
  private compKey(ownerId: string, hostname: string): string { return `${ownerId}\u0000${hostname.toLowerCase()}`; }
  async listCompetitors(ownerId: string, hostname: string): Promise<CompetitorCandidate[]> { return structuredClone([...(this.competitors.get(this.compKey(ownerId, hostname))?.values() ?? [])]); }
  async upsertCompetitors(ownerId: string, hostname: string, list: CompetitorCandidate[]): Promise<void> {
    const k = this.compKey(ownerId, hostname);
    const m = this.competitors.get(k) ?? new Map<string, CompetitorCandidate>();
    for (const c of list) m.set(c.domain, structuredClone(c));
    this.competitors.set(k, m);
  }
  async patchCompetitor(ownerId: string, hostname: string, domain: string, p: CompetitorPatch): Promise<CompetitorCandidate | null> {
    const cur = this.competitors.get(this.compKey(ownerId, hostname))?.get(domain);
    if (!cur) return null;
    const next: CompetitorCandidate = { ...cur, ...(p.status ? { status: p.status } : {}), ...(p.classification ? { classification: p.classification, classificationReason: "Classification set by a person." } : {}), ...("name" in p ? { name: p.name ?? null } : {}), ...("industry" in p ? { industry: p.industry ?? null } : {}), ...("market" in p ? { market: p.market ?? null } : {}), userConfirmed: true };
    this.competitors.get(this.compKey(ownerId, hostname))!.set(domain, next);
    return structuredClone(next);
  }
  async deleteCompetitor(ownerId: string, hostname: string, domain: string): Promise<boolean> { return this.competitors.get(this.compKey(ownerId, hostname))?.delete(domain) ?? false; }
  async createCompetitorRun(r: { ownerId: string; hostname: string; auditId: string | null; provider: string | null; queries: string[] }): Promise<CompetitorRunRow> {
    const row: CompetitorRunRow = { id: newId("crun"), ownerId: r.ownerId, hostname: r.hostname.toLowerCase(), auditId: r.auditId, status: "running", provider: r.provider, queries: r.queries, summary: null, startedAt: nowIso(), finishedAt: null, error: null };
    this.competitorRuns.push(row);
    return structuredClone(row);
  }
  async finishCompetitorRun(id: string, p: { status: CompetitorRunRow["status"]; summary: unknown; error?: string | null }): Promise<void> {
    const row = this.competitorRuns.find((r) => r.id === id);
    if (row) { row.status = p.status; row.summary = structuredClone(p.summary); row.error = p.error ?? null; row.finishedAt = nowIso(); }
  }
  async listCompetitorRuns(ownerId: string, hostname: string, limit = 20): Promise<CompetitorRunRow[]> {
    return structuredClone(this.competitorRuns.filter((r) => r.ownerId === ownerId && r.hostname === hostname.toLowerCase()).slice(-limit).reverse());
  }
}
