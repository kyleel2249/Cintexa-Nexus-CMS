import type { FindingStatus, FindingWorkflow, RetestStatus } from "./types";

/** Allowed manual transitions. "verified" is deliberately reachable only through verification evidence. */
export const TRANSITIONS: Record<FindingStatus, FindingStatus[]> = {
  open: ["triaged", "planned", "in_progress", "accepted_risk", "dismissed"],
  triaged: ["open", "planned", "in_progress", "accepted_risk", "dismissed"],
  planned: ["triaged", "in_progress", "accepted_risk", "dismissed"],
  in_progress: ["planned", "fixed", "accepted_risk", "dismissed"],
  fixed: ["in_progress", "retest_required", "verified"],
  retest_required: ["in_progress", "fixed", "verified"],
  verified: ["open", "retest_required"],
  accepted_risk: ["open", "triaged"],
  dismissed: ["open", "triaged"],
};

export interface TransitionRequest {
  from: FindingStatus;
  to: FindingStatus;
  rationale?: string | null;
  retestStatus?: RetestStatus;
  /** Documented manual verification: who did it and how. */
  manualVerification?: { by: string; notes: string } | null;
}

export interface TransitionResult {
  ok: boolean;
  error?: string;
  verificationMethod?: "retest" | "manual" | null;
}

export function validateTransition(req: TransitionRequest): TransitionResult {
  if (req.from === req.to) return { ok: true };
  if (!TRANSITIONS[req.from]?.includes(req.to)) return { ok: false, error: `A finding cannot move from "${req.from}" to "${req.to}".` };
  if ((req.to === "accepted_risk" || req.to === "dismissed") && !(req.rationale && req.rationale.trim().length >= 10)) {
    return { ok: false, error: `A rationale of at least 10 characters is required to mark a finding as ${req.to === "accepted_risk" ? "an accepted risk" : "dismissed"}.` };
  }
  if (req.to === "verified") {
    if (req.retestStatus === "passed") return { ok: true, verificationMethod: "retest" };
    const m = req.manualVerification;
    if (m && m.by && m.notes && m.notes.trim().length >= 10) return { ok: true, verificationMethod: "manual" };
    return { ok: false, error: "A finding cannot be verified by a status change alone. Run a retest that passes, or record who verified it manually and how." };
  }
  return { ok: true };
}

/** Applies the effect a retest has on a finding's workflow. */
export function applyRetestOutcome(wf: Pick<FindingWorkflow, "status">, outcome: RetestStatus): { status: FindingStatus; retestStatus: RetestStatus } {
  if (outcome === "passed") return { status: "verified", retestStatus: "passed" };
  if (outcome === "failed") return { status: "in_progress", retestStatus: "failed" };
  return { status: wf.status === "verified" ? "retest_required" : wf.status, retestStatus: outcome };
}

export function isOpenStatus(s: FindingStatus): boolean {
  return s === "open" || s === "triaged" || s === "planned" || s === "in_progress" || s === "fixed" || s === "retest_required";
}
