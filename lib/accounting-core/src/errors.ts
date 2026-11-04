export type PolicyErrorCode =
  | "INVALID_POLICY"
  | "INVALID_DATE"
  | "NOT_FOUND"
  | "NOT_DRAFT"
  | "SAME_APPROVER"
  | "PERIOD_LOCKED"
  | "ESTIMATE_NOT_RETROSPECTIVE"
  | "BACKDATED"
  | "EFFECTIVE_DATE_CLASH"
  | "NOT_CONFIGURED"
  | "INVALID_EVENT";

export class PolicyError extends Error {
  readonly code: PolicyErrorCode;
  constructor(code: PolicyErrorCode, message: string) {
    super(message);
    this.name = "PolicyError";
    this.code = code;
  }
}

/** Thrown when a decision needs a policy nobody has configured. The engine never guesses a policy. */
export class PolicyNotConfiguredError extends PolicyError {
  readonly policyKey: string;
  readonly asAt: string;
  constructor(policyKey: string, asAt: string) {
    super("NOT_CONFIGURED", `No approved accounting policy "${policyKey}" is effective on ${asAt}. Configure and approve it before posting.`);
    this.name = "PolicyNotConfiguredError";
    this.policyKey = policyKey;
    this.asAt = asAt;
  }
}
