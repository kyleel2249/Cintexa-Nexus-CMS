import { ensureSchema, pool } from "@workspace/db";
import type { CompetitorPatch, CompetitorRunRow, RecTransitionWrite } from "@workspace/wi-engine/repo";
import { emptyProgress, initialStages, newId, stripSecrets, type AuditPatch, type ListFilter, type NewAudit, type WorkflowPatch } from "@workspace/wi-engine/repo";

export { emptyProgress, initialStages, newId, stripSecrets };
export type { AuditPatch, ListFilter, NewAudit, WorkflowPatch };
import {
  AUDIT_SCHEMA_VERSION, SCORING_VERSION, STAGE_IDS,
  type AuditConfig, type AuditProgress, type AuditStatus, type AuditSummary, type CheckResult, type CoverageReport, type EnvironmentRecord,
  type Finding, type FindingStatus, type FindingWorkflow, type PageFacts, type PerformanceSample, type Recommendation, type RemediationTask, type RetestStatus,
  type CompetitorCandidate, type RecActor, type RecApproval, type RecEvent, type RecWorkflow, type VerificationEvidence, type ScoreBreakdown, type StageId, type StageState, type WebsiteType, type AuditProfile, type Horizon, type TaskStatus,
} from "@workspace/wi-core";

async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  await ensureSchema(pool);
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

function toSummary(r: any): AuditSummary {
  return {
    id: r.id, kind: r.kind, hostname: r.hostname, url: r.url, name: r.name, websiteType: r.website_type as WebsiteType, profile: r.profile as AuditProfile,
    status: r.status as AuditStatus, stage: r.stage as StageId | null, stages: r.stages ?? [], progress: { ...emptyProgress(), ...(r.progress ?? {}) },
    createdAt: iso(r.created_at) as string, startedAt: iso(r.started_at), completedAt: iso(r.completed_at), ownerId: r.owner_id, ownerEmail: r.owner_email,
    scoringVersion: r.scoring_version, scores: r.scores ?? null, previousAuditId: r.previous_audit_id, parentAuditId: r.parent_audit_id, error: r.error,
    config: stripSecrets(r.config), coverage: r.coverage ?? null, environment: r.environment ?? null, monitorId: r.monitor_id,
  };
}

export async function createAudit(a: NewAudit): Promise<AuditSummary> {
  const id = a.id ?? newId("aud");
  const rows = await q(
    `INSERT INTO wi_audits (id, owner_id, owner_email, workspace, hostname, url, name, kind, website_type, profile, status, stages, progress, config, scoring_version, schema_version, previous_audit_id, parent_audit_id, monitor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued',$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [id, a.ownerId, a.ownerEmail, a.workspace ?? null, a.hostname, a.cfg.url, a.cfg.name ?? null, a.kind ?? "audit", a.cfg.websiteType, a.cfg.profile, JSON.stringify(initialStages()), JSON.stringify(emptyProgress()), JSON.stringify(stripSecrets(a.cfg)), SCORING_VERSION, AUDIT_SCHEMA_VERSION, a.previousAuditId ?? null, a.parentAuditId ?? null, a.monitorId ?? null],
  );
  return toSummary(rows[0]);
}

export async function getAuditRow(id: string): Promise<any | null> {
  const rows = await q(`SELECT * FROM wi_audits WHERE id = $1 AND deleted_at IS NULL`, [id]);
  return rows[0] ?? null;
}

export async function getAudit(id: string): Promise<AuditSummary | null> {
  const r = await getAuditRow(id);
  return r ? toSummary(r) : null;
}

export async function listAudits(f: ListFilter): Promise<{ items: AuditSummary[]; total: number }> {
  const where: string[] = ["deleted_at IS NULL"];
  const p: unknown[] = [];
  if (!f.admin && f.ownerId) { p.push(f.ownerId); where.push(`owner_id = $${p.length}`); }
  if (f.hostname) { p.push(f.hostname.toLowerCase()); where.push(`hostname = $${p.length}`); }
  if (f.status) { p.push(f.status); where.push(`status = $${p.length}`); }
  if (f.kind) { p.push(f.kind); where.push(`kind = $${p.length}`); }
  if (f.search) { p.push(`%${f.search.toLowerCase()}%`); where.push(`(LOWER(hostname) LIKE $${p.length} OR LOWER(COALESCE(name,'')) LIKE $${p.length})`); }
  const total = Number((await q(`SELECT COUNT(*)::int AS n FROM wi_audits WHERE ${where.join(" AND ")}`, p))[0].n);
  p.push(Math.min(f.limit ?? 50, 200)); p.push(f.offset ?? 0);
  const rows = await q(`SELECT * FROM wi_audits WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p);
  return { items: rows.map(toSummary), total };
}

export async function patchAudit(id: string, p: AuditPatch): Promise<void> {
  const sets: string[] = [];
  const v: unknown[] = [];
  const add = (col: string, val: unknown, json = false) => { v.push(json ? JSON.stringify(val) : val); sets.push(`${col} = $${v.length}`); };
  if (p.status !== undefined) add("status", p.status);
  if (p.stage !== undefined) add("stage", p.stage);
  if (p.stages !== undefined) add("stages", p.stages, true);
  if (p.progress !== undefined) add("progress", p.progress, true);
  if (p.scores !== undefined) add("scores", p.scores, true);
  if (p.coverage !== undefined) add("coverage", p.coverage, true);
  if (p.environment !== undefined) add("environment", p.environment, true);
  if (p.error !== undefined) add("error", p.error);
  if (p.startedAt !== undefined) add("started_at", p.startedAt);
  if (p.completedAt !== undefined) add("completed_at", p.completedAt);
  if (p.previousAuditId !== undefined) add("previous_audit_id", p.previousAuditId);
  if (p.heartbeat) sets.push("heartbeat_at = NOW()");
  if (!sets.length) return;
  v.push(id);
  await q(`UPDATE wi_audits SET ${sets.join(", ")} WHERE id = $${v.length}`, v);
}

export async function requestCancel(id: string): Promise<void> { await q(`UPDATE wi_audits SET cancel_requested = TRUE WHERE id = $1`, [id]); }
export async function isCancelRequested(id: string): Promise<boolean> { return Boolean((await q(`SELECT cancel_requested FROM wi_audits WHERE id = $1`, [id]))[0]?.cancel_requested); }
export async function resetForRetry(id: string): Promise<void> {
  await q(`DELETE FROM wi_pages WHERE audit_id = $1`, [id]);
  await q(`DELETE FROM wi_checks WHERE audit_id = $1`, [id]);
  await q(`DELETE FROM wi_performance WHERE audit_id = $1`, [id]);
  await q(`DELETE FROM wi_findings WHERE audit_id = $1`, [id]);
  await q(`DELETE FROM wi_recommendations WHERE audit_id = $1`, [id]);
  await q(`UPDATE wi_audits SET status='queued', stage=NULL, stages=$2, progress=$3, scores=NULL, coverage=NULL, error=NULL, cancel_requested=FALSE, started_at=NULL, completed_at=NULL, attempts=attempts+1 WHERE id=$1`, [id, JSON.stringify(initialStages()), JSON.stringify(emptyProgress())]);
}

export async function softDelete(id: string): Promise<void> { await q(`UPDATE wi_audits SET deleted_at = NOW(), share_token = NULL WHERE id = $1`, [id]); }
export async function hardDelete(id: string): Promise<void> { await q(`DELETE FROM wi_audits WHERE id = $1`, [id]); }

export async function purgeExpired(retentionDays: number): Promise<number> {
  const rows = await q(`DELETE FROM wi_audits WHERE (deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days') OR (created_at < NOW() - ($1 || ' days')::interval AND status IN ('completed','partial','failed','cancelled')) RETURNING id`, [String(retentionDays)]);
  return rows.length;
}

export async function setShareToken(id: string, token: string | null): Promise<void> { await q(`UPDATE wi_audits SET share_token = $2 WHERE id = $1`, [id, token]); }
export async function getByShareToken(token: string): Promise<AuditSummary | null> {
  const rows = await q(`SELECT * FROM wi_audits WHERE share_token = $1 AND deleted_at IS NULL AND status IN ('completed','partial')`, [token]);
  return rows[0] ? toSummary(rows[0]) : null;
}

/** Audits left in queued/running state, used to recover after a restart. */
export async function recoverable(staleSeconds: number): Promise<{ id: string; status: string; attempts: number }[]> {
  return q(`SELECT id, status, attempts FROM wi_audits WHERE deleted_at IS NULL AND (status = 'queued' OR (status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < NOW() - ($1 || ' seconds')::interval)))`, [String(staleSeconds)]);
}

export async function countActive(ownerId: string): Promise<number> { return Number((await q(`SELECT COUNT(*)::int AS n FROM wi_audits WHERE owner_id=$1 AND deleted_at IS NULL AND status IN ('queued','running')`, [ownerId]))[0].n); }
export async function countRecent(ownerId: string, minutes: number): Promise<number> { return Number((await q(`SELECT COUNT(*)::int AS n FROM wi_audits WHERE owner_id=$1 AND created_at > NOW() - ($2 || ' minutes')::interval`, [ownerId, String(minutes)]))[0].n); }
export async function previousCompleted(ownerId: string, hostname: string, beforeId: string | null): Promise<AuditSummary | null> {
  const rows = await q(`SELECT * FROM wi_audits WHERE owner_id=$1 AND hostname=$2 AND deleted_at IS NULL AND kind <> 'benchmark' AND status IN ('completed','partial') AND ($3::text IS NULL OR id <> $3) ORDER BY created_at DESC LIMIT 1`, [ownerId, hostname, beforeId]);
  return rows[0] ? toSummary(rows[0]) : null;
}

// ---- events
export async function addEvent(auditId: string, level: string, stage: string | null, message: string, data?: unknown): Promise<void> {
  try { await q(`INSERT INTO wi_events (audit_id, level, stage, message, data) VALUES ($1,$2,$3,$4,$5)`, [auditId, level, stage, message.slice(0, 1000), data === undefined ? null : JSON.stringify(data)]); } catch { /* logging must never break an audit */ }
}
export async function listEvents(auditId: string, afterId = 0, limit = 500): Promise<{ id: number; at: string; level: string; stage: string | null; message: string; data: unknown }[]> {
  const rows = await q(`SELECT id, at, level, stage, message, data FROM wi_events WHERE audit_id=$1 AND id > $2 ORDER BY id ASC LIMIT $3`, [auditId, afterId, Math.min(limit, 2000)]);
  return rows.map((r) => ({ id: Number(r.id), at: iso(r.at) as string, level: r.level, stage: r.stage, message: r.message, data: r.data }));
}

// ---- raw results
export async function savePage(auditId: string, facts: PageFacts, score: number | null, skippedReason?: string): Promise<void> {
  await q(`INSERT INTO wi_pages (audit_id, url, facts, score, skipped_reason) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (audit_id, url) DO UPDATE SET facts=EXCLUDED.facts, score=EXCLUDED.score, skipped_reason=EXCLUDED.skipped_reason`, [auditId, facts.url, JSON.stringify(facts), score, skippedReason ?? null]);
}
export async function updatePageScore(auditId: string, url: string, score: number | null): Promise<void> { await q(`UPDATE wi_pages SET score=$3 WHERE audit_id=$1 AND url=$2`, [auditId, url, score]); }
export async function saveChecks(auditId: string, url: string, results: CheckResult[]): Promise<void> {
  await q(`INSERT INTO wi_checks (audit_id, url, results) VALUES ($1,$2,$3) ON CONFLICT (audit_id, url) DO UPDATE SET results=EXCLUDED.results`, [auditId, url, JSON.stringify(results)]);
}
export async function loadChecks(auditId: string): Promise<CheckResult[]> { return (await q(`SELECT results FROM wi_checks WHERE audit_id=$1`, [auditId])).flatMap((r) => r.results as CheckResult[]); }
export async function loadPages(auditId: string): Promise<{ facts: PageFacts; score: number | null; skippedReason: string | null }[]> {
  return (await q(`SELECT facts, score, skipped_reason FROM wi_pages WHERE audit_id=$1 ORDER BY (facts->>'depth')::int, url`, [auditId])).map((r) => ({ facts: r.facts, score: r.score, skippedReason: r.skipped_reason }));
}
export async function savePerformance(auditId: string, samples: PerformanceSample[]): Promise<void> {
  await q(`DELETE FROM wi_performance WHERE audit_id=$1`, [auditId]);
  for (let i = 0; i < samples.length; i++) await q(`INSERT INTO wi_performance (audit_id, idx, data) VALUES ($1,$2,$3)`, [auditId, i, JSON.stringify(samples[i])]);
}
export async function loadPerformance(auditId: string): Promise<PerformanceSample[]> { return (await q(`SELECT data FROM wi_performance WHERE audit_id=$1 ORDER BY idx`, [auditId])).map((r) => r.data); }

// ---- derived
export async function replaceFindings(auditId: string, findings: Finding[], lineage: Map<string, "new" | "recurring" | null>): Promise<void> {
  await q(`DELETE FROM wi_findings WHERE audit_id=$1`, [auditId]);
  for (const f of findings) {
    await q(`INSERT INTO wi_findings (audit_id, fingerprint, test_id, category, severity, kind, priority, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [auditId, f.fingerprint, f.testId, f.category, f.severity, f.kind, f.priorityScore, JSON.stringify(f)]);
    if (f.kind === "defect") await q(`INSERT INTO wi_finding_workflow (id, audit_id, fingerprint, lineage) VALUES ($1,$2,$3,$4) ON CONFLICT (audit_id, fingerprint) DO UPDATE SET lineage=EXCLUDED.lineage`, [newId("fw"), auditId, f.fingerprint, lineage.get(f.fingerprint) ?? null]);
  }
}
export async function saveRecommendations(auditId: string, recs: Recommendation[]): Promise<void> {
  await q(`DELETE FROM wi_recommendations WHERE audit_id=$1`, [auditId]);
  for (const r of recs) await q(`INSERT INTO wi_recommendations (audit_id, fingerprint, rank, data) VALUES ($1,$2,$3,$4)`, [auditId, r.fingerprint, r.rank, JSON.stringify(r)]);
}
export async function loadFindings(auditId: string): Promise<Finding[]> { return (await q(`SELECT data FROM wi_findings WHERE audit_id=$1 ORDER BY priority DESC, test_id`, [auditId])).map((r) => r.data); }
export async function loadRecommendations(auditId: string): Promise<Recommendation[]> { return (await q(`SELECT data FROM wi_recommendations WHERE audit_id=$1 ORDER BY rank`, [auditId])).map((r) => r.data); }

function toWorkflow(r: any): FindingWorkflow {
  return { id: r.id, auditId: r.audit_id, fingerprint: r.fingerprint, status: r.status, owner: r.owner, notes: r.notes ?? "", rationale: r.rationale, dueDate: r.due_date ? new Date(r.due_date).toISOString().slice(0, 10) : null, retestStatus: r.retest_status, retestAuditId: r.retest_audit_id, verifiedAt: iso(r.verified_at), verifiedBy: r.verified_by, verificationMethod: r.verification_method, lineage: r.lineage, createdAt: iso(r.created_at) as string, updatedAt: iso(r.updated_at) as string };
}
export async function loadWorkflows(auditId: string): Promise<Map<string, FindingWorkflow>> { return new Map((await q(`SELECT * FROM wi_finding_workflow WHERE audit_id=$1`, [auditId])).map((r) => [r.fingerprint, toWorkflow(r)])); }
export async function getWorkflow(auditId: string, fingerprint: string): Promise<FindingWorkflow | null> { const r = (await q(`SELECT * FROM wi_finding_workflow WHERE audit_id=$1 AND fingerprint=$2`, [auditId, fingerprint]))[0]; return r ? toWorkflow(r) : null; }

export async function patchWorkflow(auditId: string, fingerprint: string, p: WorkflowPatch): Promise<FindingWorkflow | null> {
  const cols: Record<string, string> = { status: "status", owner: "owner", notes: "notes", rationale: "rationale", dueDate: "due_date", retestStatus: "retest_status", retestAuditId: "retest_audit_id", verifiedAt: "verified_at", verifiedBy: "verified_by", verificationMethod: "verification_method" };
  const sets: string[] = ["updated_at = NOW()"];
  const v: unknown[] = [];
  for (const [k, col] of Object.entries(cols)) if ((p as Record<string, unknown>)[k] !== undefined) { v.push((p as Record<string, unknown>)[k]); sets.push(`${col} = $${v.length}`); }
  v.push(auditId, fingerprint);
  const rows = await q(`UPDATE wi_finding_workflow SET ${sets.join(", ")} WHERE audit_id=$${v.length - 1} AND fingerprint=$${v.length} RETURNING *`, v);
  return rows[0] ? toWorkflow(rows[0]) : null;
}

/** Carries workflow state (owner, notes, accepted risk) onto a newer audit for findings that recur. */
export async function carryWorkflow(fromAuditId: string, toAuditId: string): Promise<number> {
  const rows = await q(`UPDATE wi_finding_workflow n SET owner = o.owner, notes = o.notes, due_date = o.due_date,
      status = CASE WHEN o.status IN ('accepted_risk','dismissed') THEN o.status WHEN o.status IN ('verified','fixed','retest_required') THEN 'open' ELSE o.status END,
      rationale = CASE WHEN o.status IN ('accepted_risk','dismissed') THEN o.rationale ELSE NULL END
    FROM wi_finding_workflow o WHERE o.audit_id=$1 AND n.audit_id=$2 AND o.fingerprint=n.fingerprint RETURNING n.id`, [fromAuditId, toAuditId]);
  return rows.length;
}

// ---- tasks
function toTask(r: any): RemediationTask { return { id: r.id, auditId: r.audit_id, fingerprint: r.fingerprint, title: r.title, description: r.description, owner: r.owner, dueDate: r.due_date ? new Date(r.due_date).toISOString().slice(0, 10) : null, status: r.status, horizon: r.horizon, notes: r.notes, createdBy: r.created_by, createdAt: iso(r.created_at) as string, updatedAt: iso(r.updated_at) as string }; }
export async function listTasks(auditId: string): Promise<RemediationTask[]> { return (await q(`SELECT * FROM wi_tasks WHERE audit_id=$1 ORDER BY created_at`, [auditId])).map(toTask); }
export async function createTask(t: { auditId: string; fingerprint?: string | null; title: string; description?: string; owner?: string | null; dueDate?: string | null; horizon?: Horizon; createdBy?: string | null }): Promise<RemediationTask> {
  return toTask((await q(`INSERT INTO wi_tasks (id, audit_id, fingerprint, title, description, owner, due_date, horizon, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [newId("tsk"), t.auditId, t.fingerprint ?? null, t.title, t.description ?? "", t.owner ?? null, t.dueDate ?? null, t.horizon ?? "short", t.createdBy ?? null]))[0]);
}
export async function patchTask(id: string, auditId: string, p: { title?: string; description?: string; owner?: string | null; dueDate?: string | null; status?: TaskStatus; notes?: string; horizon?: Horizon }): Promise<RemediationTask | null> {
  const cols: Record<string, string> = { title: "title", description: "description", owner: "owner", dueDate: "due_date", status: "status", notes: "notes", horizon: "horizon" };
  const sets = ["updated_at = NOW()"]; const v: unknown[] = [];
  for (const [k, col] of Object.entries(cols)) if ((p as Record<string, unknown>)[k] !== undefined) { v.push((p as Record<string, unknown>)[k]); sets.push(`${col} = $${v.length}`); }
  v.push(id, auditId);
  const rows = await q(`UPDATE wi_tasks SET ${sets.join(", ")} WHERE id=$${v.length - 1} AND audit_id=$${v.length} RETURNING *`, v);
  return rows[0] ? toTask(rows[0]) : null;
}
export async function deleteTask(id: string, auditId: string): Promise<void> { await q(`DELETE FROM wi_tasks WHERE id=$1 AND audit_id=$2`, [id, auditId]); }

// ---- reports / comparisons / monitors
export async function saveReport(r: { auditId: string; type: string; filename: string; bytes: number; pages: number; sha256: string | null; createdBy: string | null; meta?: unknown }): Promise<{ id: string; createdAt: string }> {
  const id = newId("rpt");
  const rows = await q(`INSERT INTO wi_reports (id, audit_id, type, filename, bytes, pages, sha256, created_by, meta) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING created_at`, [id, r.auditId, r.type, r.filename, r.bytes, r.pages, r.sha256, r.createdBy, JSON.stringify(r.meta ?? {})]);
  return { id, createdAt: iso(rows[0].created_at) as string };
}
export async function listReports(auditId: string) { return (await q(`SELECT id, type, filename, bytes, pages, sha256, created_by, created_at, meta FROM wi_reports WHERE audit_id=$1 ORDER BY created_at DESC`, [auditId])).map((r) => ({ id: r.id, type: r.type, filename: r.filename, bytes: r.bytes, pages: r.pages, sha256: r.sha256, createdBy: r.created_by, createdAt: iso(r.created_at), meta: r.meta })); }
export async function saveComparison(ownerId: string, currentId: string, previousId: string, data: unknown): Promise<void> {
  await q(`INSERT INTO wi_comparisons (id, owner_id, current_id, previous_id, data) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (current_id, previous_id) DO UPDATE SET data=EXCLUDED.data, created_at=NOW()`, [newId("cmp"), ownerId, currentId, previousId, JSON.stringify(data)]);
}

export interface MonitorRow { id: string; ownerId: string; workspace: string | null; url: string; hostname: string; name: string | null; config: AuditConfig; frequency: "daily" | "weekly" | "monthly"; enabled: boolean; notify: { email?: string[]; webhook?: boolean; scoreDropThreshold?: number }; nextRunAt: string | null; lastRunAt: string | null; lastAuditId: string | null; lastScore: number | null; createdAt: string }
const toMonitor = (r: any): MonitorRow => ({ id: r.id, ownerId: r.owner_id, workspace: r.workspace, url: r.url, hostname: r.hostname, name: r.name, config: r.config, frequency: r.frequency, enabled: r.enabled, notify: r.notify ?? {}, nextRunAt: iso(r.next_run_at), lastRunAt: iso(r.last_run_at), lastAuditId: r.last_audit_id, lastScore: r.last_score, createdAt: iso(r.created_at) as string });
export const nextRun = (freq: string, from = new Date()) => new Date(from.getTime() + (freq === "daily" ? 1 : freq === "monthly" ? 30 : 7) * 86_400_000);
export async function createMonitor(m: { ownerId: string; workspace?: string | null; cfg: AuditConfig; hostname: string; frequency: string; notify: MonitorRow["notify"] }): Promise<MonitorRow> {
  return toMonitor((await q(`INSERT INTO wi_monitors (id, owner_id, workspace, url, hostname, name, config, frequency, notify, next_run_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [newId("mon"), m.ownerId, m.workspace ?? null, m.cfg.url, m.hostname, m.cfg.name ?? null, JSON.stringify(stripSecrets(m.cfg)), m.frequency, JSON.stringify(m.notify), nextRun(m.frequency)]))[0]);
}
export async function listMonitors(ownerId: string | null): Promise<MonitorRow[]> { return (await q(ownerId ? `SELECT * FROM wi_monitors WHERE owner_id=$1 ORDER BY created_at DESC` : `SELECT * FROM wi_monitors ORDER BY created_at DESC`, ownerId ? [ownerId] : [])).map(toMonitor); }
export async function getMonitor(id: string): Promise<MonitorRow | null> { const r = (await q(`SELECT * FROM wi_monitors WHERE id=$1`, [id]))[0]; return r ? toMonitor(r) : null; }
export async function patchMonitor(id: string, p: { enabled?: boolean; frequency?: string; notify?: MonitorRow["notify"]; name?: string | null; lastRunAt?: Date; lastAuditId?: string; lastScore?: number | null; nextRunAt?: Date }): Promise<MonitorRow | null> {
  const cols: Record<string, [string, boolean]> = { enabled: ["enabled", false], frequency: ["frequency", false], notify: ["notify", true], name: ["name", false], lastRunAt: ["last_run_at", false], lastAuditId: ["last_audit_id", false], lastScore: ["last_score", false], nextRunAt: ["next_run_at", false] };
  const sets = ["updated_at = NOW()"]; const v: unknown[] = [];
  for (const [k, [col, json]] of Object.entries(cols)) { const val = (p as Record<string, unknown>)[k]; if (val !== undefined) { v.push(json ? JSON.stringify(val) : val); sets.push(`${col} = $${v.length}`); } }
  v.push(id);
  const rows = await q(`UPDATE wi_monitors SET ${sets.join(", ")} WHERE id=$${v.length} RETURNING *`, v);
  return rows[0] ? toMonitor(rows[0]) : null;
}
export async function deleteMonitor(id: string): Promise<void> { await q(`DELETE FROM wi_monitors WHERE id=$1`, [id]); }
export async function dueMonitors(): Promise<MonitorRow[]> { return (await q(`SELECT * FROM wi_monitors WHERE enabled AND next_run_at IS NOT NULL AND next_run_at <= NOW() ORDER BY next_run_at LIMIT 10`)).map(toMonitor); }


// ---- competitors (scoped to owner + audited site hostname, keyed by canonical domain)
const toCompetitor = (r: any): CompetitorCandidate => ({
  domain: r.domain, url: r.url, name: r.name, classification: r.classification, classificationReason: r.classification_reason, status: r.status, sources: r.sources ?? [], evidence: r.evidence ?? [],
  confidence: Number(r.confidence), breakdown: r.breakdown, industry: r.industry, market: r.market, userConfirmed: r.user_confirmed, firstDiscoveredAt: iso(r.first_discovered_at) as string, lastVerifiedAt: iso(r.last_verified_at),
});
export async function listCompetitors(ownerId: string, hostname: string): Promise<CompetitorCandidate[]> {
  return (await q(`SELECT * FROM wi_competitors WHERE owner_id=$1 AND site_hostname=$2 ORDER BY confidence DESC, domain`, [ownerId, hostname.toLowerCase()])).map(toCompetitor);
}
export async function upsertCompetitors(ownerId: string, hostname: string, list: CompetitorCandidate[]): Promise<void> {
  for (const c of list) {
    await q(
      `INSERT INTO wi_competitors (owner_id, site_hostname, domain, url, name, classification, classification_reason, status, sources, evidence, confidence, breakdown, industry, market, user_confirmed, first_discovered_at, last_verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (owner_id, site_hostname, domain) DO UPDATE SET url=EXCLUDED.url, name=EXCLUDED.name, classification=EXCLUDED.classification, classification_reason=EXCLUDED.classification_reason, status=EXCLUDED.status,
         sources=EXCLUDED.sources, evidence=EXCLUDED.evidence, confidence=EXCLUDED.confidence, breakdown=EXCLUDED.breakdown, industry=EXCLUDED.industry, market=EXCLUDED.market,
         user_confirmed=EXCLUDED.user_confirmed, last_verified_at=EXCLUDED.last_verified_at, updated_at=NOW()`,
      [ownerId, hostname.toLowerCase(), c.domain, c.url, c.name, c.classification, c.classificationReason, c.status, JSON.stringify(c.sources), JSON.stringify(c.evidence.slice(0, 40)), c.confidence, JSON.stringify(c.breakdown), c.industry, c.market, c.userConfirmed, c.firstDiscoveredAt, c.lastVerifiedAt],
    );
  }
}
export async function patchCompetitor(ownerId: string, hostname: string, domain: string, p: CompetitorPatch): Promise<CompetitorCandidate | null> {
  const sets = ["user_confirmed = TRUE", "updated_at = NOW()"]; const v: unknown[] = [];
  const add = (col: string, val: unknown) => { v.push(val); sets.push(`${col} = $${v.length}`); };
  if (p.status) add("status", p.status);
  if (p.classification) { add("classification", p.classification); add("classification_reason", "Classification set by a person."); }
  if ("name" in p) add("name", p.name ?? null);
  if ("industry" in p) add("industry", p.industry ?? null);
  if ("market" in p) add("market", p.market ?? null);
  v.push(ownerId, hostname.toLowerCase(), domain);
  const rows = await q(`UPDATE wi_competitors SET ${sets.join(", ")} WHERE owner_id=$${v.length - 2} AND site_hostname=$${v.length - 1} AND domain=$${v.length} RETURNING *`, v);
  return rows[0] ? toCompetitor(rows[0]) : null;
}
export async function deleteCompetitor(ownerId: string, hostname: string, domain: string): Promise<boolean> {
  return (await q(`DELETE FROM wi_competitors WHERE owner_id=$1 AND site_hostname=$2 AND domain=$3 RETURNING domain`, [ownerId, hostname.toLowerCase(), domain])).length > 0;
}
const toRun = (r: any): CompetitorRunRow => ({ id: r.id, ownerId: r.owner_id, hostname: r.site_hostname, auditId: r.audit_id, status: r.status, provider: r.provider, queries: r.queries ?? [], summary: r.summary, startedAt: iso(r.started_at) as string, finishedAt: iso(r.finished_at), error: r.error });
export async function createCompetitorRun(r: { ownerId: string; hostname: string; auditId: string | null; provider: string | null; queries: string[] }): Promise<CompetitorRunRow> {
  return toRun((await q(`INSERT INTO wi_competitor_runs (id, owner_id, site_hostname, audit_id, provider, queries) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [newId("crun"), r.ownerId, r.hostname.toLowerCase(), r.auditId, r.provider, JSON.stringify(r.queries)]))[0]);
}
export async function finishCompetitorRun(id: string, p: { status: CompetitorRunRow["status"]; summary: unknown; error?: string | null }): Promise<void> {
  await q(`UPDATE wi_competitor_runs SET status=$2, summary=$3, error=$4, finished_at=NOW() WHERE id=$1`, [id, p.status, JSON.stringify(p.summary ?? null), p.error ?? null]);
}
export async function listCompetitorRuns(ownerId: string, hostname: string, limit = 20): Promise<CompetitorRunRow[]> {
  return (await q(`SELECT * FROM wi_competitor_runs WHERE owner_id=$1 AND site_hostname=$2 ORDER BY started_at DESC LIMIT $3`, [ownerId, hostname.toLowerCase(), Math.min(limit, 100)])).map(toRun);
}


// ---- recommendation lifecycle (approval workflow). A recommendation without a row is implicitly NEW.
const toRecWorkflow = (r: any): RecWorkflow => ({
  auditId: r.audit_id, fingerprint: r.fingerprint, status: r.status, assignee: r.assignee, version: Number(r.version), requestedBy: r.requested_by, requestedAt: iso(r.requested_at),
  decidedBy: r.decided_by, decidedAt: iso(r.decided_at), decisionNote: r.decision_note, implementedBy: r.implemented_by, implementedAt: iso(r.implemented_at),
  verifiedBy: r.verified_by, verifiedAt: iso(r.verified_at), verification: r.verification ?? null, createdAt: iso(r.created_at) as string, updatedAt: iso(r.updated_at) as string,
});
const toRecEvent = (r: any): RecEvent => ({ id: Number(r.id), at: iso(r.at) as string, auditId: r.audit_id, fingerprint: r.fingerprint, actorKind: r.actor_kind, actorId: r.actor_id, action: r.action, from: r.from_status, to: r.to_status, note: r.note, evidence: r.evidence ?? null });
const toRecApproval = (r: any): RecApproval => ({ id: r.id, auditId: r.audit_id, fingerprint: r.fingerprint, requestedBy: r.requested_by, requestedAt: iso(r.requested_at) as string, decision: r.decision, decidedBy: r.decided_by, decidedAt: iso(r.decided_at), note: r.note });
const REC_COLS: Record<string, [string, boolean]> = {
  status: ["status", false], assignee: ["assignee", false], requestedBy: ["requested_by", false], requestedAt: ["requested_at", false], decidedBy: ["decided_by", false], decidedAt: ["decided_at", false],
  decisionNote: ["decision_note", false], implementedBy: ["implemented_by", false], implementedAt: ["implemented_at", false], verifiedBy: ["verified_by", false], verifiedAt: ["verified_at", false], verification: ["verification", true],
};
const recEventSelect = "$1::text, $2::text, $6::text, $7::text, $8::text, $4::text, $3::text, $9::text, $10::jsonb";
const recEventColumns = "(audit_id, fingerprint, actor_kind, actor_id, action, from_status, to_status, note, evidence)";

export async function loadRecWorkflows(auditId: string): Promise<Map<string, RecWorkflow>> {
  return new Map((await q(`SELECT * FROM wi_rec_workflow WHERE audit_id=$1`, [auditId])).map((r) => [r.fingerprint as string, toRecWorkflow(r)]));
}
export async function getRecWorkflow(auditId: string, fingerprint: string): Promise<RecWorkflow | null> {
  const r = (await q(`SELECT * FROM wi_rec_workflow WHERE audit_id=$1 AND fingerprint=$2`, [auditId, fingerprint]))[0];
  return r ? toRecWorkflow(r) : null;
}
/** Compare-and-set in ONE statement: the row change and its audit-trail entry commit together or not at all. */
export async function transitionRec(w: RecTransitionWrite): Promise<RecWorkflow | null> {
  if (w.expectFrom === "NEW" && (w.expectVersion === null || w.expectVersion === 0)) await q(`INSERT INTO wi_rec_workflow (audit_id, fingerprint) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [w.auditId, w.fingerprint]);
  const sets: string[] = ["version = version + 1", "updated_at = NOW()"];
  const v: unknown[] = [w.auditId, w.fingerprint, w.patch.status, w.expectFrom, w.expectVersion, w.actor.kind, w.actor.id, w.action, w.note, w.evidence ? JSON.stringify(w.evidence) : null];
  for (const [k, val] of Object.entries(w.patch)) {
    const col = REC_COLS[k];
    if (!col || val === undefined) continue;
    if (k === "status") { sets.push("status = $3"); continue; }
    v.push(col[1] && val !== null ? JSON.stringify(val) : val);
    sets.push(`${col[0]} = $${v.length}`);
  }
  const rows = await q(
    `WITH upd AS (UPDATE wi_rec_workflow SET ${sets.join(", ")} WHERE audit_id=$1 AND fingerprint=$2 AND status=$4 AND ($5::int IS NULL OR version=$5::int) RETURNING *),
          ev AS (INSERT INTO wi_rec_events ${recEventColumns} SELECT ${recEventSelect} FROM upd)
     SELECT * FROM upd`, v);
  return rows[0] ? toRecWorkflow(rows[0]) : null;
}
export async function insertRecWorkflow(w: RecWorkflow, event: { actor: RecActor; action: string; note: string | null }): Promise<boolean> {
  const rows = await q(
    `WITH ins AS (INSERT INTO wi_rec_workflow (audit_id, fingerprint, status, assignee, requested_by, requested_at, decided_by, decided_at, decision_note, implemented_by, implemented_at, verified_by, verified_at, verification)
                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING RETURNING audit_id)
     INSERT INTO wi_rec_events ${recEventColumns} SELECT $1::text, $2::text, $15::text, $16::text, $17::text, NULL::text, $3::text, $18::text, NULL::jsonb FROM ins RETURNING id`,
    [w.auditId, w.fingerprint, w.status, w.assignee, w.requestedBy, w.requestedAt, w.decidedBy, w.decidedAt, w.decisionNote, w.implementedBy, w.implementedAt, w.verifiedBy, w.verifiedAt,
      w.verification ? JSON.stringify(w.verification) : null, event.actor.kind, event.actor.id, event.action, event.note],
  );
  return rows.length > 0;
}
export async function recordRecEvent(auditId: string, fingerprint: string, e: { actor: RecActor; action: string; note: string | null; evidence?: VerificationEvidence | null }, patch: { assignee?: string | null } = {}): Promise<RecWorkflow> {
  await q(`INSERT INTO wi_rec_workflow (audit_id, fingerprint) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [auditId, fingerprint]);
  const hasAssignee = "assignee" in patch;
  const rows = await q(
    `WITH upd AS (UPDATE wi_rec_workflow SET ${hasAssignee ? "assignee = $8::text," : ""} version = version + 1, updated_at = NOW() WHERE audit_id=$1 AND fingerprint=$2 RETURNING *),
          ev AS (INSERT INTO wi_rec_events ${recEventColumns} SELECT $1::text, $2::text, $3::text, $4::text, $5::text, status, status, $6::text, $7::jsonb FROM upd)
     SELECT * FROM upd`,
    [auditId, fingerprint, e.actor.kind, e.actor.id, e.action, e.note, e.evidence ? JSON.stringify(e.evidence) : null, ...(hasAssignee ? [patch.assignee ?? null] : [])],
  );
  return toRecWorkflow(rows[0]);
}
export async function listRecEvents(auditId: string, fingerprint: string, limit = 200): Promise<RecEvent[]> {
  return (await q(`SELECT * FROM (SELECT * FROM wi_rec_events WHERE audit_id=$1 AND fingerprint=$2 ORDER BY id DESC LIMIT $3) t ORDER BY id`, [auditId, fingerprint, Math.min(limit, 500)])).map(toRecEvent);
}
export async function createRecApproval(a: { auditId: string; fingerprint: string; requestedBy: string }): Promise<RecApproval> {
  return toRecApproval((await q(`INSERT INTO wi_rec_approvals (id, audit_id, fingerprint, requested_by) VALUES ($1,$2,$3,$4) RETURNING *`, [newId("rapp"), a.auditId, a.fingerprint, a.requestedBy]))[0]);
}
export async function decideRecApproval(auditId: string, fingerprint: string, d: { decision: "approved" | "rejected" | "deferred"; decidedBy: string; note: string | null }): Promise<RecApproval | null> {
  const r = (await q(
    `UPDATE wi_rec_approvals SET decision=$3, decided_by=$4, decided_at=NOW(), note=$5
     WHERE id = (SELECT id FROM wi_rec_approvals WHERE audit_id=$1 AND fingerprint=$2 AND decision IS NULL ORDER BY requested_at DESC LIMIT 1) RETURNING *`,
    [auditId, fingerprint, d.decision, d.decidedBy, d.note]))[0];
  return r ? toRecApproval(r) : null;
}
export async function listRecApprovals(auditId: string, fingerprint: string): Promise<RecApproval[]> {
  return (await q(`SELECT * FROM wi_rec_approvals WHERE audit_id=$1 AND fingerprint=$2 ORDER BY requested_at DESC`, [auditId, fingerprint])).map(toRecApproval);
}
