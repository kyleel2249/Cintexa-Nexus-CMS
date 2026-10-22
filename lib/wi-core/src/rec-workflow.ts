/**
 * Recommendation lifecycle: approval, execution gating and verification rules.
 *
 * Pure and dependency-free. Every status change, from the HTTP routes, the Action Agent or the Verification Agent, is validated here, so the rules
 * cannot be bypassed by any one caller.
 *
 * Invariants:
 *  1. People decide. An agent may propose (triage, submit for approval) and report work it was authorised to do, but it can never approve, reject,
 *     defer or verify.
 *  2. Nothing consequential runs without approval. `canExecute` is the only gate an Action Agent may use: approved, not stale, not paused.
 *  3. VERIFIED needs independent evidence: a passing retest or rescan recorded by the verifier, or a documented manual verification by an owner/admin.
 *     Generating a successful-looking response is never evidence.
 *  4. Every transition carries who did it, why, and (where relevant) the evidence, so the history can be audited.
 */

export const REC_STATUSES = ["NEW", "READY", "AWAITING_APPROVAL", "APPROVED", "IN_PROGRESS", "IMPLEMENTED", "VERIFYING", "VERIFIED", "FAILED", "REJECTED", "DEFERRED"] as const;
export type RecStatus = (typeof REC_STATUSES)[number];

export const REC_STATUS_LABELS: Record<RecStatus, string> = {
  NEW: "New",
  READY: "Ready for review",
  AWAITING_APPROVAL: "Awaiting approval",
  APPROVED: "Approved",
  IN_PROGRESS: "In progress",
  IMPLEMENTED: "Implemented",
  VERIFYING: "Verifying",
  VERIFIED: "Verified",
  FAILED: "Failed",
  REJECTED: "Rejected",
  DEFERRED: "Deferred",
};

export const REC_STATUS_DESCRIPTIONS: Record<RecStatus, string> = {
  NEW: "Generated from an audit finding. Not reviewed yet.",
  READY: "Reviewed and ready to be submitted for approval.",
  AWAITING_APPROVAL: "Submitted. An owner or administrator must approve before any change is made.",
  APPROVED: "Approved for implementation. Changes may now be made or generated.",
  IN_PROGRESS: "Being implemented.",
  IMPLEMENTED: "The change is reported as done. It is not fixed until it is verified.",
  VERIFYING: "A retest or rescan is checking whether the problem is gone.",
  VERIFIED: "Independent evidence shows the problem is gone.",
  FAILED: "The fix did not work, or the work failed. A new approval is needed to try again.",
  REJECTED: "Decided against, with a recorded reason.",
  DEFERRED: "Postponed, with a recorded reason.",
};

export const TERMINAL_OR_PARKED: readonly RecStatus[] = ["VERIFIED", "REJECTED", "DEFERRED"];

export type ActorKind = "user" | "agent" | "verifier" | "system";
export interface RecActor {
  kind: ActorKind;
  id: string;
  /** Owns the audit. Only meaningful for users. */
  isOwner?: boolean;
  isAdmin?: boolean;
}

export type EvidenceMethod = "retest" | "rescan" | "manual";
export interface VerificationEvidence {
  method: EvidenceMethod;
  /** The retest or rescan audit that produced the result. Required for retest and rescan. */
  auditId?: string;
  testId?: string;
  outcome: "passed" | "failed" | "inconclusive";
  note?: string;
}

export interface RecWorkflow {
  auditId: string;
  fingerprint: string;
  status: RecStatus;
  assignee: string | null;
  /** Incremented on every change. Callers pass the version they saw so concurrent edits are detected. 0 = no row yet (implicitly NEW). */
  version: number;
  requestedBy: string | null;
  requestedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  implementedBy: string | null;
  implementedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  verification: VerificationEvidence | null;
  createdAt: string;
  updatedAt: string;
}

export function emptyRecWorkflow(auditId: string, fingerprint: string, now = new Date().toISOString()): RecWorkflow {
  return {
    auditId, fingerprint, status: "NEW", assignee: null, version: 0, requestedBy: null, requestedAt: null, decidedBy: null, decidedAt: null, decisionNote: null,
    implementedBy: null, implementedAt: null, verifiedBy: null, verifiedAt: null, verification: null, createdAt: now, updatedAt: now,
  };
}

/** Allowed edges. Who may take an edge is decided by `validateRecTransition`. */
export const REC_TRANSITIONS: Record<RecStatus, readonly RecStatus[]> = {
  NEW: ["READY", "DEFERRED", "REJECTED"],
  READY: ["AWAITING_APPROVAL", "DEFERRED", "REJECTED"],
  AWAITING_APPROVAL: ["APPROVED", "REJECTED", "DEFERRED", "READY"],
  APPROVED: ["IN_PROGRESS", "DEFERRED", "READY"],
  IN_PROGRESS: ["IMPLEMENTED", "FAILED", "DEFERRED"],
  IMPLEMENTED: ["VERIFYING", "IN_PROGRESS"],
  VERIFYING: ["VERIFIED", "FAILED", "IMPLEMENTED"],
  VERIFIED: ["READY"],
  FAILED: ["READY"],
  REJECTED: ["READY"],
  DEFERRED: ["READY"],
};

export const APPROVAL_TTL_DAYS = 30;
const MIN_NOTE = 5;

export interface TransitionContext {
  /** When true, whoever submitted a recommendation cannot approve it (administrators excepted). */
  requireSeparateApprover?: boolean;
  now?: Date;
}
export interface RecTransitionRequest {
  to: RecStatus;
  note?: string | null;
  evidence?: VerificationEvidence | null;
}
export type TransitionCode = "no_edge" | "forbidden" | "note_required" | "evidence_required" | "separate_approver" | "agent_forbidden" | "invalid";
export type TransitionCheck = { ok: true } | { ok: false; code: TransitionCode; error: string };

const fail = (code: TransitionCode, error: string): TransitionCheck => ({ ok: false, code, error });
const isApprover = (a: RecActor): boolean => a.kind === "user" && Boolean(a.isOwner || a.isAdmin);
const noteLen = (n: string | null | undefined): number => (n ?? "").trim().length;

/** Statuses only a person with approval rights may enter or leave. */
const DECISION_EDGES = new Set<string>(["AWAITING_APPROVAL>APPROVED", "AWAITING_APPROVAL>REJECTED", "AWAITING_APPROVAL>DEFERRED", "APPROVED>READY", "REJECTED>READY"]);
const AGENT_ALLOWED_EDGES = new Set<string>(["NEW>READY", "READY>AWAITING_APPROVAL", "IN_PROGRESS>IMPLEMENTED", "IN_PROGRESS>FAILED"]);

export function validateRecTransition(current: RecWorkflow, req: RecTransitionRequest, actor: RecActor, ctx: TransitionContext = {}): TransitionCheck {
  const from = current.status;
  const to = req.to;
  if (!REC_STATUSES.includes(to)) return fail("invalid", "Unknown status.");
  if (from === to) return fail("no_edge", `The recommendation is already ${REC_STATUS_LABELS[from].toLowerCase()}.`);
  if (!REC_TRANSITIONS[from].includes(to)) return fail("no_edge", `A recommendation cannot move from ${REC_STATUS_LABELS[from]} to ${REC_STATUS_LABELS[to]}.`);
  const edge = `${from}>${to}`;

  // Invariant 1: agents never decide or verify.
  if (actor.kind === "agent") {
    if (to === "APPROVED" || to === "REJECTED" || to === "DEFERRED" || to === "VERIFIED" || DECISION_EDGES.has(edge)) return fail("agent_forbidden", "An AI agent cannot approve, reject, defer or verify a recommendation. A person must decide.");
    if (!AGENT_ALLOWED_EDGES.has(edge)) return fail("agent_forbidden", `An AI agent cannot move a recommendation from ${REC_STATUS_LABELS[from]} to ${REC_STATUS_LABELS[to]}.`);
  }

  // Decisions
  if (DECISION_EDGES.has(edge) && !isApprover(actor)) return fail("forbidden", "Only the audit owner or an administrator can make this decision.");
  if (edge === "AWAITING_APPROVAL>APPROVED" && ctx.requireSeparateApprover && current.requestedBy && current.requestedBy === actor.id && !actor.isAdmin) {
    return fail("separate_approver", "Approval by someone other than the person who submitted it is required.");
  }

  // Verification (invariant 3)
  if (to === "VERIFIED") {
    const ev = req.evidence;
    if (!ev || ev.outcome !== "passed") return fail("evidence_required", "Verification needs evidence of a passing result.");
    if (actor.kind === "verifier" || actor.kind === "system") {
      if ((ev.method !== "retest" && ev.method !== "rescan") || !ev.auditId) return fail("evidence_required", "Automated verification must cite the retest or rescan audit that passed.");
    } else if (actor.kind === "user") {
      if (!isApprover(actor)) return fail("forbidden", "Only the audit owner or an administrator can verify a recommendation.");
      if (ev.method === "manual") {
        if (noteLen(req.note) < 10) return fail("note_required", "Manual verification needs a note (at least 10 characters) describing what was checked and how.");
      } else if (!ev.auditId) return fail("evidence_required", "Cite the retest or rescan audit that passed.");
    }
  }
  if (from === "VERIFIED" && actor.kind === "user") return fail("forbidden", "Only the verifier or system can reopen a verified recommendation, when the problem returns.");
  if (from === "VERIFYING" && to === "FAILED" && actor.kind === "user" && !isApprover(actor)) return fail("forbidden", "Only the audit owner or an administrator can mark a verification as failed.");

  // Who may start execution
  if (to === "IN_PROGRESS" && from === "APPROVED") {
    if (actor.kind === "user" && !isApprover(actor) && !(current.assignee && current.assignee === actor.id)) return fail("forbidden", "Only the owner, an administrator or the assignee can start an approved recommendation.");
    if (!approvalFresh(current, ctx.now).fresh) return fail("forbidden", "The approval has expired. Request approval again.");
  }
  if (to === "IMPLEMENTED" && actor.kind === "user" && !isApprover(actor) && !(current.assignee && current.assignee === actor.id)) return fail("forbidden", "Only the owner, an administrator or the assignee can mark this implemented.");
  if ((from === "VERIFYING" || to === "VERIFYING") && actor.kind === "agent") return fail("agent_forbidden", "An AI agent cannot start or change verification.");
  if (to === "VERIFYING" && actor.kind === "user" && !isApprover(actor)) return fail("forbidden", "Only the audit owner or an administrator can start verification.");
  if ((to === "NEW" || to === "READY" || to === "AWAITING_APPROVAL") && actor.kind === "user" && !isApprover(actor) && !(current.assignee && current.assignee === actor.id)) {
    return fail("forbidden", "Only the owner, an administrator or the assignee can move this recommendation.");
  }

  // Rationale is mandatory where a decision or a claim is recorded
  if ((to === "REJECTED" || to === "DEFERRED") && noteLen(req.note) < MIN_NOTE) return fail("note_required", "A reason (at least 5 characters) is required.");
  if (to === "IMPLEMENTED" && from === "IN_PROGRESS" && noteLen(req.note) < MIN_NOTE) return fail("note_required", "Describe what was changed (at least 5 characters).");
  if (to === "FAILED" && actor.kind !== "verifier" && actor.kind !== "system" && noteLen(req.note) < MIN_NOTE) return fail("note_required", "Describe what went wrong (at least 5 characters).");
  if (edge === "APPROVED>READY" && noteLen(req.note) < MIN_NOTE) return fail("note_required", "A reason for revoking the approval is required.");
  return { ok: true };
}

export interface AllowedTransition { to: RecStatus; label: string; noteRequired: boolean; needsEvidence: boolean; confirm: boolean }
const ACTION_LABELS: Record<string, string> = {
  "NEW>READY": "Mark ready for review", "NEW>DEFERRED": "Defer", "NEW>REJECTED": "Reject",
  "READY>AWAITING_APPROVAL": "Request approval", "READY>DEFERRED": "Defer", "READY>REJECTED": "Reject",
  "AWAITING_APPROVAL>APPROVED": "Approve", "AWAITING_APPROVAL>REJECTED": "Reject", "AWAITING_APPROVAL>DEFERRED": "Defer", "AWAITING_APPROVAL>READY": "Withdraw request",
  "APPROVED>IN_PROGRESS": "Start work", "APPROVED>DEFERRED": "Defer", "APPROVED>READY": "Revoke approval",
  "IN_PROGRESS>IMPLEMENTED": "Mark implemented", "IN_PROGRESS>FAILED": "Mark failed", "IN_PROGRESS>DEFERRED": "Defer",
  "IMPLEMENTED>VERIFYING": "Verify with a retest", "IMPLEMENTED>IN_PROGRESS": "Rework",
  "VERIFYING>VERIFIED": "Mark verified", "VERIFYING>FAILED": "Mark failed", "VERIFYING>IMPLEMENTED": "Back to implemented",
  "FAILED>READY": "Reopen", "REJECTED>READY": "Reopen", "DEFERRED>READY": "Reopen",
};

/** What this actor may do right now. Drives the UI so that a button is shown only when the server would accept it. */
export function allowedTransitions(current: RecWorkflow, actor: RecActor, ctx: TransitionContext = {}): AllowedTransition[] {
  const out: AllowedTransition[] = [];
  for (const to of REC_TRANSITIONS[current.status]) {
    // Probe with the strongest honest request for this actor; notes and evidence are collected afterwards.
    const probe: RecTransitionRequest = { to, note: "probe-note-long-enough", evidence: to === "VERIFIED" ? { method: "manual", outcome: "passed", note: "probe" } : null };
    if (!validateRecTransition(current, probe, actor, ctx).ok) continue;
    if (to === "VERIFIED" && actor.kind !== "user") continue;
    const key = `${current.status}>${to}`;
    out.push({
      to, label: ACTION_LABELS[key] ?? REC_STATUS_LABELS[to],
      noteRequired: !validateRecTransition(current, { to, note: "", evidence: probe.evidence }, actor, ctx).ok,
      needsEvidence: to === "VERIFIED",
      confirm: to === "APPROVED" || to === "REJECTED" || to === "VERIFIED" || key === "APPROVED>READY",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Execution gate for the Action Agent
// ---------------------------------------------------------------------------

export function approvalFresh(wf: RecWorkflow, now: Date = new Date(), ttlDays = APPROVAL_TTL_DAYS): { fresh: boolean; expiresAt: string | null } {
  if (!wf.decidedAt) return { fresh: false, expiresAt: null };
  const expires = new Date(Date.parse(wf.decidedAt) + ttlDays * 86_400_000);
  return { fresh: now.getTime() <= expires.getTime(), expiresAt: expires.toISOString() };
}

export type ExecutionGate = { allowed: true; approvedBy: string; approvedAt: string; expiresAt: string } | { allowed: false; reason: string };

/**
 * The only question an Action Agent may ask before generating or applying a change. Anything other than an approved, unexpired recommendation
 * is refused, including recommendations that are merely awaiting approval or whose approval has lapsed.
 */
export function canExecute(wf: RecWorkflow, now: Date = new Date()): ExecutionGate {
  if (wf.status !== "APPROVED" && wf.status !== "IN_PROGRESS") return { allowed: false, reason: `This recommendation is ${REC_STATUS_LABELS[wf.status].toLowerCase()}. Changes can only be made once it is approved.` };
  if (!wf.decidedBy || !wf.decidedAt) return { allowed: false, reason: "No recorded approval was found for this recommendation." };
  const f = approvalFresh(wf, now);
  if (!f.fresh || !f.expiresAt) return { allowed: false, reason: `The approval from ${wf.decidedAt.slice(0, 10)} has expired. Request approval again.` };
  return { allowed: true, approvedBy: wf.decidedBy, approvedAt: wf.decidedAt, expiresAt: f.expiresAt };
}

// ---------------------------------------------------------------------------
// Verification outcomes and carry-over between audits
// ---------------------------------------------------------------------------

export type VerificationOutcome = "passed" | "failed" | "inconclusive";

/** Maps an independent check result onto a status change. Returns null when the status should not change. */
export function nextStatusForOutcome(status: RecStatus, outcome: VerificationOutcome): RecStatus | null {
  if (status !== "VERIFYING" && status !== "IMPLEMENTED") return null;
  if (outcome === "passed") return "VERIFIED";
  if (outcome === "failed") return "FAILED";
  return status === "IMPLEMENTED" ? "VERIFYING" : null;
}

export interface CarryResult { status: RecStatus; keepApproval: boolean; reason: string | null }

/**
 * What happens to a recommendation when a later audit still shows the same defect.
 * Work in flight stays in flight; a claimed fix that did not work fails; a verified fix that came back is a regression.
 */
export function carryStatus(prev: RecStatus): CarryResult {
  switch (prev) {
    case "IMPLEMENTED":
    case "VERIFYING":
      return { status: "FAILED", keepApproval: false, reason: "The problem is still present in a later audit after it was reported as implemented." };
    case "VERIFIED":
      return { status: "READY", keepApproval: false, reason: "Regression: this was verified as fixed but the problem is present again." };
    case "FAILED":
      return { status: "FAILED", keepApproval: false, reason: null };
    default:
      return { status: prev, keepApproval: prev === "APPROVED" || prev === "IN_PROGRESS", reason: null };
  }
}

export interface RecEvent {
  id: number;
  at: string;
  auditId: string;
  fingerprint: string;
  actorKind: ActorKind;
  actorId: string;
  action: string;
  from: RecStatus | null;
  to: RecStatus | null;
  note: string | null;
  evidence: VerificationEvidence | null;
}

export interface RecApproval {
  id: string;
  auditId: string;
  fingerprint: string;
  requestedBy: string;
  requestedAt: string;
  decision: "approved" | "rejected" | "deferred" | null;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
}

/** Row fields a transition writes, derived from the request so the store never decides policy. */
export function applyTransition(current: RecWorkflow, req: RecTransitionRequest, actor: RecActor, now: Date = new Date()): Partial<RecWorkflow> & { status: RecStatus } {
  const at = now.toISOString();
  const patch: Partial<RecWorkflow> & { status: RecStatus } = { status: req.to };
  const from = current.status;
  const who = `${actor.kind}:${actor.id}`;
  if (req.to === "AWAITING_APPROVAL") Object.assign(patch, { requestedBy: actor.id, requestedAt: at, decidedBy: null, decidedAt: null, decisionNote: null });
  if (from === "AWAITING_APPROVAL" && (req.to === "APPROVED" || req.to === "REJECTED" || req.to === "DEFERRED")) Object.assign(patch, { decidedBy: actor.id, decidedAt: at, decisionNote: req.note?.trim() || null });
  if ((from === "NEW" || from === "READY") && (req.to === "REJECTED" || req.to === "DEFERRED")) Object.assign(patch, { decidedBy: actor.id, decidedAt: at, decisionNote: req.note?.trim() || null });
  if (req.to === "READY") Object.assign(patch, { decidedBy: null, decidedAt: null, decisionNote: req.note?.trim() || null, requestedBy: null, requestedAt: null, verification: null, verifiedBy: null, verifiedAt: null, implementedBy: null, implementedAt: null });
  if (req.to === "IN_PROGRESS" && from === "APPROVED" && !current.assignee && actor.kind === "user") patch.assignee = actor.id;
  if (req.to === "IMPLEMENTED" && from === "IN_PROGRESS") Object.assign(patch, { implementedBy: who, implementedAt: at });
  if (req.to === "VERIFIED") Object.assign(patch, { verifiedBy: who, verifiedAt: at, verification: req.evidence ?? null });
  if (req.to === "FAILED" && req.evidence) patch.verification = req.evidence;
  return patch;
}
