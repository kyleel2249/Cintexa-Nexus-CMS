/**
 * Recommendation lifecycle service: the one place that changes a recommendation's workflow state.
 *
 * Callers: the HTTP routes (people), the Action Agent (gated by `executionGate`), and the Verification Agent (retests and rescans).
 * Policy lives in @workspace/wi-core (`validateRecTransition`); this module only loads state, asks the policy, performs the compare-and-set
 * write, and records approvals. Nothing here trusts a caller's claim about who it is beyond the `RecActor` it is given, and HTTP routes only ever
 * construct `user` actors, so an HTTP caller cannot present itself as an agent or verifier.
 */
import {
  aggregateOutcomes, allowedTransitions, applyTransition, canExecute, carryStatus, emptyRecWorkflow, nextStatusForOutcome, validateRecTransition,
  type AllowedTransition, type CheckResult, type ExecutionGate, type RecActor, type RecApproval, type RecStatus, type RecWorkflow, type VerificationEvidence, type VerificationOutcome,
} from "@workspace/wi-core";
import { getPorts } from "./ports";

/** Identity used for automated verification. It can only produce VERIFIED/FAILED with cited audit evidence (enforced by the policy). */
export const VERIFIER: RecActor = { kind: "verifier", id: "verification-agent" };

export type TransitionFailure = { ok: false; status: 400 | 403 | 404 | 409; code: string; error: string; current?: RecWorkflow };
export type TransitionSuccess = { ok: true; workflow: RecWorkflow; approval: RecApproval | null };

const HTTP_FOR_CODE: Record<string, 400 | 403 | 409> = { no_edge: 409, forbidden: 403, agent_forbidden: 403, separate_approver: 403, note_required: 400, evidence_required: 400, invalid: 400, conflict: 409 };

export async function getWorkflowOrNew(auditId: string, fingerprint: string): Promise<RecWorkflow> {
  return (await getPorts().repo.getRecWorkflow(auditId, fingerprint)) ?? emptyRecWorkflow(auditId, fingerprint);
}

async function recommendationExists(auditId: string, fingerprint: string): Promise<boolean> {
  return (await getPorts().repo.loadRecommendations(auditId)).some((r) => r.fingerprint === fingerprint);
}

export async function transitionRecommendation(args: {
  auditId: string; fingerprint: string; to: RecStatus; actor: RecActor; note?: string | null; evidence?: VerificationEvidence | null; expectedVersion?: number | null; now?: Date;
}): Promise<TransitionSuccess | TransitionFailure> {
  const ports = getPorts();
  const repo = ports.repo;
  if (!(await recommendationExists(args.auditId, args.fingerprint))) return { ok: false, status: 404, code: "not_found", error: "Recommendation not found." };
  const current = await getWorkflowOrNew(args.auditId, args.fingerprint);
  if (args.expectedVersion !== undefined && args.expectedVersion !== null && args.expectedVersion !== current.version) {
    return { ok: false, status: 409, code: "conflict", error: "This recommendation was changed by someone else. Reload and try again.", current };
  }
  const settings = await ports.settings.load();
  const note = args.note?.trim() || null;
  const check = validateRecTransition(current, { to: args.to, note, evidence: args.evidence ?? null }, args.actor, { requireSeparateApprover: settings.requireSeparateApprover, now: args.now });
  if (!check.ok) return { ok: false, status: HTTP_FOR_CODE[check.code] ?? 400, code: check.code, error: check.error, current };
  const patch = applyTransition(current, { to: args.to, note, evidence: args.evidence ?? null }, args.actor, args.now);
  const written = await repo.transitionRec({
    auditId: args.auditId, fingerprint: args.fingerprint, expectFrom: current.status, expectVersion: current.version, patch,
    actor: args.actor, action: `status:${current.status}>${args.to}`, note, evidence: args.evidence ?? null,
  });
  if (!written) return { ok: false, status: 409, code: "conflict", error: "This recommendation was changed by someone else. Reload and try again.", current: await getWorkflowOrNew(args.auditId, args.fingerprint) };
  let approval: RecApproval | null = null;
  if (args.to === "AWAITING_APPROVAL") approval = await repo.createRecApproval({ auditId: args.auditId, fingerprint: args.fingerprint, requestedBy: args.actor.id });
  else if (current.status === "AWAITING_APPROVAL" && (args.to === "APPROVED" || args.to === "REJECTED" || args.to === "DEFERRED")) {
    approval = await repo.decideRecApproval(args.auditId, args.fingerprint, { decision: args.to === "APPROVED" ? "approved" : args.to === "REJECTED" ? "rejected" : "deferred", decidedBy: args.actor.id, note });
  }
  return { ok: true, workflow: written, approval };
}

export async function assignRecommendation(args: { auditId: string; fingerprint: string; actor: RecActor; assignee: string | null }): Promise<{ ok: true; workflow: RecWorkflow } | TransitionFailure> {
  if (args.actor.kind !== "user" || !(args.actor.isOwner || args.actor.isAdmin)) return { ok: false, status: 403, code: "forbidden", error: "Only the audit owner or an administrator can assign a recommendation." };
  const who = args.assignee === null ? null : args.assignee.trim().slice(0, 120);
  if (who !== null && who.length === 0) return { ok: false, status: 400, code: "invalid", error: "Enter who it is assigned to, or clear the assignment." };
  if (!(await recommendationExists(args.auditId, args.fingerprint))) return { ok: false, status: 404, code: "not_found", error: "Recommendation not found." };
  const wf = await getPorts().repo.recordRecEvent(args.auditId, args.fingerprint, { actor: args.actor, action: "assigned", note: who ? `Assigned to ${who}` : "Assignment cleared" }, { assignee: who });
  return { ok: true, workflow: wf };
}

export interface RecView { workflow: RecWorkflow; allowed: AllowedTransition[]; execution: ExecutionGate }

/** Everything the UI needs for one recommendation: state, what this actor may do next, and whether an Action Agent may act. */
export function viewFor(wf: RecWorkflow, actor: RecActor, opts: { requireSeparateApprover: boolean; now?: Date }): RecView {
  const now = opts.now ?? new Date();
  return { workflow: wf, allowed: allowedTransitions(wf, actor, { requireSeparateApprover: opts.requireSeparateApprover, now }), execution: canExecute(wf, now) };
}

/** The Action Agent's gate. It must call this immediately before generating or applying any change, and stop on `allowed: false`. */
export async function executionGate(auditId: string, fingerprint: string, now: Date = new Date()): Promise<ExecutionGate> {
  if (!(await recommendationExists(auditId, fingerprint))) return { allowed: false, reason: "Recommendation not found." };
  return canExecute(await getWorkflowOrNew(auditId, fingerprint), now);
}

// ---------------------------------------------------------------------------
// Verification Agent: deterministic. It only ever acts on evidence from a finished retest or rescan.
// ---------------------------------------------------------------------------

/** A retest was started for these fingerprints: implemented recommendations move to VERIFYING. Anything else is left alone. */
export async function startVerification(auditId: string, fingerprints: string[], retestAuditId: string): Promise<number> {
  let n = 0;
  for (const fp of fingerprints) {
    const wf = await getPorts().repo.getRecWorkflow(auditId, fp);
    if (!wf || wf.status !== "IMPLEMENTED") continue;
    const r = await transitionRecommendation({ auditId, fingerprint: fp, to: "VERIFYING", actor: VERIFIER, note: `Retest ${retestAuditId} started.`, evidence: { method: "retest", auditId: retestAuditId, outcome: "inconclusive" } });
    if (r.ok) n++;
  }
  return n;
}

/**
 * Applies an independent check result. A recommendation reported as implemented passes through VERIFYING first, so history always shows
 * that verification was started. The status only changes when the evidence supports it; an inconclusive result never verifies anything.
 */
export async function applyVerificationOutcome(auditId: string, fingerprint: string, outcome: VerificationOutcome, evidence: { method: "retest" | "rescan"; auditId: string; testId?: string }): Promise<RecStatus | null> {
  const repo = getPorts().repo;
  let wf = await repo.getRecWorkflow(auditId, fingerprint);
  if (!wf) return null;
  const next = nextStatusForOutcome(wf.status, outcome);
  const ev: VerificationEvidence = { ...evidence, outcome };
  if (wf.status === "IMPLEMENTED" && next !== "VERIFYING" && next !== null) {
    const step = await transitionRecommendation({ auditId, fingerprint, to: "VERIFYING", actor: VERIFIER, note: `${evidence.method === "retest" ? "Retest" : "Rescan"} ${evidence.auditId} produced a result.`, evidence: { ...ev, outcome: "inconclusive" } });
    if (!step.ok) return null;
    wf = step.workflow;
  }
  if (next === null) {
    await repo.recordRecEvent(auditId, fingerprint, { actor: VERIFIER, action: "verification_inconclusive", note: `${evidence.method === "retest" ? "Retest" : "Rescan"} ${evidence.auditId} could not confirm either way; status unchanged.`, evidence: ev });
    return wf.status;
  }
  if (next === "VERIFYING") {
    const r = await transitionRecommendation({ auditId, fingerprint, to: "VERIFYING", actor: VERIFIER, note: "Verification inconclusive; still checking.", evidence: ev });
    return r.ok ? "VERIFYING" : null;
  }
  const r = await transitionRecommendation({
    auditId, fingerprint, to: next, actor: VERIFIER, evidence: ev,
    note: next === "VERIFIED" ? `${evidence.method === "retest" ? "Retest" : "Rescan"} ${evidence.auditId}: the test passed.` : `${evidence.method === "retest" ? "Retest" : "Rescan"} ${evidence.auditId}: the problem is still present.`,
  });
  return r.ok ? next : null;
}

export interface ReconcileResult { carried: number; verified: number; failed: number; regressed: number }

/**
 * After a new audit of the same site: carries lifecycle state onto recommendations that recur, fails fixes that did not hold,
 * flags regressions, and verifies implemented recommendations whose test now passes. A fingerprint that merely disappeared is NOT
 * treated as fixed unless its test was actually run and passed in the new audit.
 */
export async function reconcileAfterAudit(newAuditId: string, prevAuditId: string, newResults?: CheckResult[]): Promise<ReconcileResult> {
  const repo = getPorts().repo;
  const out: ReconcileResult = { carried: 0, verified: 0, failed: 0, regressed: 0 };
  const prevAudit = await repo.getAudit(prevAuditId);
  const sourceId = prevAudit?.kind === "retest" && prevAudit.parentAuditId ? prevAudit.parentAuditId : prevAuditId;
  const prevRows = await repo.loadRecWorkflows(sourceId);
  if (!prevRows.size) return out;
  const [newFindings, prevFindings] = await Promise.all([repo.loadFindings(newAuditId), repo.loadFindings(sourceId)]);
  const present = new Set(newFindings.filter((f) => f.kind === "defect").map((f) => f.fingerprint));
  const testOf = new Map(prevFindings.map((f) => [f.fingerprint, f.testId]));
  const outcomes = aggregateOutcomes(newResults ?? (await repo.loadChecks(newAuditId)));
  for (const [fp, wf] of prevRows) {
    const testId = testOf.get(fp);
    if (present.has(fp)) {
      const c = carryStatus(wf.status);
      if (wf.status === "IMPLEMENTED" || wf.status === "VERIFYING") { if (await applyVerificationOutcome(sourceId, fp, "failed", { method: "rescan", auditId: newAuditId, testId })) out.failed++; }
      const now = new Date().toISOString();
      const reset = c.status !== wf.status;
      const carried: RecWorkflow = {
        ...wf, auditId: newAuditId, status: c.status, version: 1, createdAt: now, updatedAt: now,
        ...(reset ? { requestedBy: null, requestedAt: null, decidedBy: null, decidedAt: null, decisionNote: null } : {}),
        ...(wf.status === "VERIFIED" || wf.status === "IMPLEMENTED" || wf.status === "VERIFYING" ? { implementedBy: null, implementedAt: null, verifiedBy: null, verifiedAt: null, verification: null } : {}),
      };
      if (await repo.insertRecWorkflow(carried, { actor: VERIFIER, action: wf.status === "VERIFIED" ? "regression" : "carried", note: c.reason ?? `Carried from audit ${sourceId}.` })) {
        out.carried++;
        if (wf.status === "VERIFIED") out.regressed++;
      }
    } else if (wf.status === "IMPLEMENTED" || wf.status === "VERIFYING") {
      const o = testId ? outcomes.get(testId) : undefined;
      if (o && (o.status === "passed" || o.status === "not_applicable") && testId) {
        if (await applyVerificationOutcome(sourceId, fp, "passed", { method: "rescan", auditId: newAuditId, testId })) out.verified++;
      }
    }
  }
  return out;
}
