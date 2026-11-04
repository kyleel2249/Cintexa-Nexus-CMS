import { createHash } from "node:crypto";
import { isIsoDate, type IsoDate } from "./decimal";
import { PolicyError, PolicyNotConfiguredError } from "./errors";
import type { PolicyAuditEvent, PolicyVersion, ProposeInput, RegistrySnapshot } from "./types";
import { DOMAIN_CATEGORY, validateParams } from "./validators";

const GENESIS_HASH = "0".repeat(64);

export interface RegistryOptions {
  clock?: () => string;
  /** Last date of the most recent locked period, or null when nothing is locked. Supplied by the period service. */
  lockedThrough?: () => IsoDate | null;
  /** Segregation of duties: when true the approver must differ from the proposer. Off by default (single operator). */
  requireDistinctApprover?: boolean;
  snapshot?: RegistrySnapshot;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function hashEvent(e: Omit<PolicyAuditEvent, "hash">): string {
  const body = JSON.stringify({ seq: e.seq, at: e.at, actor: e.actor, action: e.action, key: e.key, version: e.version, detail: e.detail, prevHash: e.prevHash });
  return createHash("sha256").update(body).digest("hex");
}

/** Recomputes the hash chain. Any edited, removed or reordered audit event makes this return false. */
export function verifyAuditChain(audit: PolicyAuditEvent[]): boolean {
  let prev = GENESIS_HASH;
  for (let i = 0; i < audit.length; i++) {
    const e = audit[i];
    if (!e || e.seq !== i + 1 || e.prevHash !== prev) return false;
    const { hash, ...rest } = e;
    if (hashEvent(rest) !== hash) return false;
    prev = hash;
  }
  return true;
}

/**
 * The single authority for accounting policies. Policies are versioned and effective-dated; a version is never edited or
 * deleted, only superseded by a later approved version. Every state change lands in a tamper-evident audit chain.
 */
export class PolicyRegistry {
  private versions: PolicyVersion[];
  private audit: PolicyAuditEvent[];
  private readonly clock: () => string;
  private readonly lockedThrough: () => IsoDate | null;
  private readonly distinctApprover: boolean;

  constructor(opts: RegistryOptions = {}) {
    this.clock = opts.clock ?? (() => new Date().toISOString());
    this.lockedThrough = opts.lockedThrough ?? (() => null);
    this.distinctApprover = opts.requireDistinctApprover ?? false;
    this.versions = opts.snapshot ? clone(opts.snapshot.versions) : [];
    this.audit = opts.snapshot ? clone(opts.snapshot.audit) : [];
    if (!verifyAuditChain(this.audit)) throw new PolicyError("INVALID_POLICY", "Policy audit chain failed verification; refusing to load tampered policy data");
  }

  snapshot(): RegistrySnapshot {
    return clone({ versions: this.versions, audit: this.audit });
  }

  auditTrail(): PolicyAuditEvent[] {
    return clone(this.audit);
  }

  private versionsOf(key: string): PolicyVersion[] {
    return this.versions.filter((v) => v.key === key).sort((a, b) => a.version - b.version);
  }

  private find(key: string, version: number): PolicyVersion {
    const v = this.versions.find((x) => x.key === key && x.version === version);
    if (!v) throw new PolicyError("NOT_FOUND", `Policy ${key} v${version} does not exist`);
    return v;
  }

  private record(actor: string, action: PolicyAuditEvent["action"], key: string, version: number, detail: Record<string, unknown>): void {
    const last = this.audit[this.audit.length - 1];
    const base = { seq: this.audit.length + 1, at: this.clock(), actor, action, key, version, detail: clone(detail), prevHash: last ? last.hash : GENESIS_HASH };
    this.audit.push({ ...base, hash: hashEvent(base) });
  }

  hasPolicy(key: string): boolean {
    return this.versions.some((v) => v.key === key);
  }

  propose(input: ProposeInput): PolicyVersion {
    const problems: string[] = [];
    if (!input.key.trim()) problems.push("key is required");
    if (!input.actor.trim()) problems.push("actor is required");
    if (!isIsoDate(input.effectiveFrom)) problems.push("effectiveFrom must be a valid YYYY-MM-DD date");
    const existing = this.versionsOf(input.key);
    const first = existing[0];
    if (first && first.domain !== input.domain) problems.push(`key ${input.key} is already bound to domain ${first.domain}`);
    if (input.changeType === "initial" && existing.length > 0) problems.push('changeType "initial" is only valid for the first version of a policy');
    if (input.changeType !== "initial" && existing.length === 0) problems.push('the first version of a policy must use changeType "initial"');
    if (input.changeType !== "initial" && !input.rationale.trim()) problems.push("a rationale is required for any change to a policy");
    problems.push(...validateParams(input.domain, input.params));
    if (problems.length > 0) throw new PolicyError("INVALID_POLICY", problems.join("; "));

    const version: PolicyVersion = {
      key: input.key,
      domain: input.domain,
      category: DOMAIN_CATEGORY[input.domain],
      version: existing.length + 1,
      status: "draft",
      effectiveFrom: input.effectiveFrom,
      params: clone(input.params),
      changeType: input.changeType,
      rationale: input.rationale.trim(),
      retrospective: input.retrospective === true,
      requiresRestatement: false,
      proposedBy: input.actor,
      proposedAt: this.clock(),
    };
    if (input.standardRef) version.standardRef = input.standardRef;
    this.versions.push(version);
    this.record(input.actor, "proposed", version.key, version.version, { effectiveFrom: version.effectiveFrom, changeType: version.changeType, rationale: version.rationale, params: version.params });
    return clone(version);
  }

  approve(key: string, versionNo: number, actor: string): PolicyVersion {
    const v = this.find(key, versionNo);
    if (v.status !== "draft") throw new PolicyError("NOT_DRAFT", `Policy ${key} v${versionNo} is ${v.status}, not draft`);
    if (!actor.trim()) throw new PolicyError("INVALID_POLICY", "actor is required");
    if (this.distinctApprover && actor === v.proposedBy) throw new PolicyError("SAME_APPROVER", "Segregation of duties: the proposer cannot approve their own policy change");

    let requiresRestatement = false;
    const locked = this.lockedThrough();
    if (locked && v.effectiveFrom <= locked) {
      if (v.changeType === "initial") throw new PolicyError("PERIOD_LOCKED", `An initial policy cannot take effect inside the locked period (locked through ${locked})`);
      if (v.changeType === "estimate_change") throw new PolicyError("ESTIMATE_NOT_RETROSPECTIVE", "A change in accounting estimate applies prospectively only (IAS 8) and cannot reach a locked period");
      if (!v.retrospective) throw new PolicyError("PERIOD_LOCKED", `Effective date ${v.effectiveFrom} falls in a period locked through ${locked}. Choose a later date, or propose it as retrospective to trigger a formal restatement`);
      requiresRestatement = true;
    }

    const approved = this.versionsOf(key).filter((x) => x.status === "approved" && x.version !== v.version);
    if (approved.some((x) => x.effectiveFrom === v.effectiveFrom)) throw new PolicyError("EFFECTIVE_DATE_CLASH", `Another approved version of ${key} already takes effect on ${v.effectiveFrom}`);
    const latest = approved.reduce<string>((max, x) => (x.effectiveFrom > max ? x.effectiveFrom : max), "");
    if (!v.retrospective && latest && v.effectiveFrom < latest) throw new PolicyError("BACKDATED", `Effective date ${v.effectiveFrom} is earlier than an approved version taking effect ${latest}; this would silently change history`);

    v.status = "approved";
    v.approvedBy = actor;
    v.approvedAt = this.clock();
    v.requiresRestatement = requiresRestatement;
    this.record(actor, "approved", key, versionNo, { effectiveFrom: v.effectiveFrom, requiresRestatement });
    return clone(v);
  }

  reject(key: string, versionNo: number, actor: string, reason: string): PolicyVersion {
    const v = this.find(key, versionNo);
    if (v.status !== "draft") throw new PolicyError("NOT_DRAFT", `Policy ${key} v${versionNo} is ${v.status}, not draft`);
    if (!reason.trim()) throw new PolicyError("INVALID_POLICY", "A rejection reason is required");
    v.status = "rejected";
    v.rejectedBy = actor;
    v.rejectedAt = this.clock();
    v.rejectionReason = reason.trim();
    this.record(actor, "rejected", key, versionNo, { reason: v.rejectionReason });
    return clone(v);
  }

  /** The approved version in force on `date`. Throws PolicyNotConfiguredError rather than guessing. */
  resolve(key: string, date: IsoDate): PolicyVersion {
    if (!isIsoDate(date)) throw new PolicyError("INVALID_DATE", `"${String(date)}" is not a valid YYYY-MM-DD date`);
    let best: PolicyVersion | undefined;
    for (const v of this.versions) {
      if (v.key === key && v.status === "approved" && v.effectiveFrom <= date && (!best || v.effectiveFrom > best.effectiveFrom)) best = v;
    }
    if (!best) throw new PolicyNotConfiguredError(key, date);
    return clone(best);
  }

  tryResolve(key: string, date: IsoDate): PolicyVersion | null {
    try {
      return this.resolve(key, date);
    } catch (err) {
      if (err instanceof PolicyNotConfiguredError) return null;
      throw err;
    }
  }

  history(key: string): PolicyVersion[] {
    return clone(this.versionsOf(key));
  }

  pendingDrafts(): PolicyVersion[] {
    return clone(this.versions.filter((v) => v.status === "draft"));
  }

  /** Which of the given policy keys have no approved version in force on `date`. */
  missing(keys: readonly string[], date: IsoDate): string[] {
    return keys.filter((k) => this.tryResolve(k, date) === null);
  }
}
