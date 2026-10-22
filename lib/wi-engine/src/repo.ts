import { STAGE_IDS } from "@workspace/wi-core";
import type { CompetitorCandidate, CompetitorClass, CompetitorStatus, RecActor, RecApproval, RecEvent, RecStatus, RecWorkflow, VerificationEvidence } from "@workspace/wi-core";
import type {
  AuditConfig, AuditProgress, AuditStatus, AuditSummary, CheckResult, CoverageReport, EnvironmentRecord, Finding, FindingStatus, FindingWorkflow, Horizon, PageFacts, PerformanceSample,
  Recommendation, RemediationTask, RetestStatus, ScoreBreakdown, StageId, StageState, TaskStatus,
} from "@workspace/wi-core";

export const newId = (prefix: string): string => `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
export const emptyProgress = (): AuditProgress => ({ discovered: 0, inspected: 0, failed: 0, skipped: 0, findings: 0, requests: 0 });
export const initialStages = (): StageState[] => STAGE_IDS.map((id) => ({ id, status: "pending" as const }));

/** The credential itself is never persisted; this guards against a leak if a caller ever passes one. */
export function stripSecrets(cfg: AuditConfig): AuditConfig {
  const c = JSON.parse(JSON.stringify(cfg ?? {})) as AuditConfig & { authenticated?: { credential?: string } };
  if (c.authenticated) delete c.authenticated.credential;
  return c;
}

export interface NewAudit {
  id?: string; ownerId: string; ownerEmail: string | null; hostname: string; cfg: AuditConfig; kind?: "audit" | "benchmark" | "retest";
  previousAuditId?: string | null; parentAuditId?: string | null; monitorId?: string | null; workspace?: string | null;
}
export interface ListFilter { ownerId?: string; hostname?: string; status?: string; kind?: string; limit?: number; offset?: number; admin?: boolean; search?: string }
export interface AuditPatch {
  status?: AuditStatus; stage?: StageId | null; stages?: StageState[]; progress?: AuditProgress; scores?: ScoreBreakdown | null; coverage?: CoverageReport | null;
  environment?: EnvironmentRecord | null; error?: string | null; startedAt?: Date | null; completedAt?: Date | null; previousAuditId?: string | null; heartbeat?: boolean;
}
export interface WorkflowPatch { status?: FindingStatus; owner?: string | null; notes?: string; rationale?: string | null; dueDate?: string | null; retestStatus?: RetestStatus; retestAuditId?: string | null; verifiedAt?: Date | null; verifiedBy?: string | null; verificationMethod?: "retest" | "manual" | null }
export interface TaskInput { auditId: string; fingerprint?: string | null; title: string; description?: string; owner?: string | null; dueDate?: string | null; horizon?: Horizon; createdBy?: string | null }
export interface TaskPatch { title?: string; description?: string; owner?: string | null; dueDate?: string | null; status?: TaskStatus; notes?: string; horizon?: Horizon }
export interface ReportInput { auditId: string; type: string; filename: string; bytes: number; pages: number; sha256: string | null; createdBy: string | null; meta?: unknown }
export interface ReportRow { id: string; type: string; filename: string; bytes: number; pages: number; sha256: string | null; createdBy: string | null; createdAt: string; meta: unknown }
export interface EventRow { id: number; at: string; level: string; stage: string | null; message: string; data: unknown }
export interface PageRow { facts: PageFacts; score: number | null; skippedReason: string | null }

export interface CompetitorRunRow {
  id: string; ownerId: string; hostname: string; auditId: string | null; status: "running" | "completed" | "partial" | "failed";
  provider: string | null; queries: string[]; summary: unknown; startedAt: string; finishedAt: string | null; error: string | null;
}

/** Raw audit row as the router reads it (snake_case ownership fields). */
export type AuditRow = Record<string, any>;

/** Storage port. Implemented by Postgres on the API server and by an in-browser store in local mode. */
export interface EngineRepo {
  createAudit(a: NewAudit): Promise<AuditSummary>;
  getAuditRow(id: string): Promise<AuditRow | null>;
  getAudit(id: string): Promise<AuditSummary | null>;
  listAudits(f: ListFilter): Promise<{ items: AuditSummary[]; total: number }>;
  patchAudit(id: string, p: AuditPatch): Promise<void>;
  requestCancel(id: string): Promise<void>;
  isCancelRequested(id: string): Promise<boolean>;
  resetForRetry(id: string): Promise<void>;
  softDelete(id: string): Promise<void>;
  hardDelete(id: string): Promise<void>;
  previousCompleted(ownerId: string, hostname: string, beforeId: string | null): Promise<AuditSummary | null>;
  addEvent(auditId: string, level: string, stage: string | null, message: string, data?: unknown): Promise<void>;
  listEvents(auditId: string, afterId?: number, limit?: number): Promise<EventRow[]>;
  savePage(auditId: string, facts: PageFacts, score: number | null, skippedReason?: string): Promise<void>;
  updatePageScore(auditId: string, url: string, score: number | null): Promise<void>;
  saveChecks(auditId: string, url: string, results: CheckResult[]): Promise<void>;
  loadChecks(auditId: string): Promise<CheckResult[]>;
  loadPages(auditId: string): Promise<PageRow[]>;
  savePerformance(auditId: string, samples: PerformanceSample[]): Promise<void>;
  loadPerformance(auditId: string): Promise<PerformanceSample[]>;
  replaceFindings(auditId: string, findings: Finding[], lineage: Map<string, "new" | "recurring" | null>): Promise<void>;
  saveRecommendations(auditId: string, recs: Recommendation[]): Promise<void>;
  loadFindings(auditId: string): Promise<Finding[]>;
  loadRecommendations(auditId: string): Promise<Recommendation[]>;
  loadWorkflows(auditId: string): Promise<Map<string, FindingWorkflow>>;
  getWorkflow(auditId: string, fingerprint: string): Promise<FindingWorkflow | null>;
  patchWorkflow(auditId: string, fingerprint: string, p: WorkflowPatch): Promise<FindingWorkflow | null>;
  carryWorkflow(fromAuditId: string, toAuditId: string): Promise<number>;
  listTasks(auditId: string): Promise<RemediationTask[]>;
  createTask(t: TaskInput): Promise<RemediationTask>;
  patchTask(id: string, auditId: string, p: TaskPatch): Promise<RemediationTask | null>;
  deleteTask(id: string, auditId: string): Promise<void>;
  saveReport(r: ReportInput): Promise<{ id: string; createdAt: string }>;
  listReports(auditId: string): Promise<ReportRow[]>;
  saveComparison(ownerId: string, currentId: string, previousId: string, data: unknown): Promise<void>;
  /** Competitors are scoped to (owner, site hostname) and keyed by canonical domain. */
  listCompetitors(ownerId: string, hostname: string): Promise<CompetitorCandidate[]>;
  upsertCompetitors(ownerId: string, hostname: string, list: CompetitorCandidate[]): Promise<void>;
  patchCompetitor(ownerId: string, hostname: string, domain: string, patch: CompetitorPatch): Promise<CompetitorCandidate | null>;
  deleteCompetitor(ownerId: string, hostname: string, domain: string): Promise<boolean>;
  createCompetitorRun(r: { ownerId: string; hostname: string; auditId: string | null; provider: string | null; queries: string[] }): Promise<CompetitorRunRow>;
  finishCompetitorRun(id: string, p: { status: CompetitorRunRow["status"]; summary: unknown; error?: string | null }): Promise<void>;
  listCompetitorRuns(ownerId: string, hostname: string, limit?: number): Promise<CompetitorRunRow[]>;
  /** Recommendation lifecycle. A recommendation with no row is implicitly NEW (version 0). */
  loadRecWorkflows(auditId: string): Promise<Map<string, RecWorkflow>>;
  getRecWorkflow(auditId: string, fingerprint: string): Promise<RecWorkflow | null>;
  /** Compare-and-set. Returns the new row, or null when the row was not in the expected state (a concurrent change). */
  transitionRec(w: RecTransitionWrite): Promise<RecWorkflow | null>;
  /** Writes a row for a later audit (carry-over). Does nothing when the row already exists. */
  insertRecWorkflow(w: RecWorkflow, event: { actor: RecActor; action: string; note: string | null }): Promise<boolean>;
  /** Records an event that does not change the status (assignment, notes). Creates the row if needed. */
  recordRecEvent(auditId: string, fingerprint: string, e: { actor: RecActor; action: string; note: string | null; evidence?: VerificationEvidence | null }, patch?: { assignee?: string | null }): Promise<RecWorkflow>;
  listRecEvents(auditId: string, fingerprint: string, limit?: number): Promise<RecEvent[]>;
  createRecApproval(a: { auditId: string; fingerprint: string; requestedBy: string }): Promise<RecApproval>;
  decideRecApproval(auditId: string, fingerprint: string, d: { decision: "approved" | "rejected" | "deferred"; decidedBy: string; note: string | null }): Promise<RecApproval | null>;
  listRecApprovals(auditId: string, fingerprint: string): Promise<RecApproval[]>;
}

/** One atomic change to a recommendation's workflow row, with the audit-trail entry written in the same step. */
export interface RecTransitionWrite {
  auditId: string;
  fingerprint: string;
  /** The status the caller validated against. The write is refused (null result) if the row has moved on. */
  expectFrom: RecStatus;
  expectVersion: number | null;
  patch: Partial<Omit<RecWorkflow, "auditId" | "fingerprint" | "version" | "createdAt" | "updatedAt">> & { status: RecStatus };
  actor: RecActor;
  action: string;
  note: string | null;
  evidence: VerificationEvidence | null;
}

export interface CompetitorPatch { status?: CompetitorStatus; classification?: CompetitorClass; name?: string | null; industry?: string | null; market?: string | null }
