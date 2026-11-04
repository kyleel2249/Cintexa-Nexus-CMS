import {
  PolicyRegistry,
  ALL_CORE_POLICY_KEYS,
  MUST_BE_CONFIGURED,
  PolicyError,
  isIsoDate,
  seedDefaultPolicies,
  verifyAuditChain,
  type IsoDate,
  type PolicyVersion,
  type ProposeInput,
  type RegistrySnapshot,
} from "@workspace/accounting-core";
import type { SalesDb, SalesQueryable } from "@workspace/db";

/** Every writer of the ledger or of policy takes this transaction-scoped lock, so posting and policy changes never interleave. */
export const LEDGER_LOCK_SQL = "SELECT pg_advisory_xact_lock(727001)";

function dateOf(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

/** Latest period end among periods that are not open. Policy changes reaching into it are retrospective. */
export async function lockedThroughDate(q: SalesQueryable): Promise<IsoDate | null> {
  const r = await q.query<{ d: unknown }>("SELECT MAX(period_end) AS d FROM acct_periods WHERE status IN ('closed','locked')");
  const d = r.rows[0]?.d;
  return d === null || d === undefined ? null : dateOf(d);
}

export async function loadPolicyRegistry(q: SalesQueryable, opts: { requireDistinctApprover?: boolean } = {}): Promise<{ registry: PolicyRegistry; version: number }> {
  const locked = await lockedThroughDate(q);
  const r = await q.query<{ snapshot: string; version: number }>("SELECT snapshot, version FROM acct_policy_state WHERE id = 1");
  const row = r.rows[0];
  const snapshot = row ? (JSON.parse(row.snapshot) as RegistrySnapshot) : undefined;
  const registry = new PolicyRegistry({ snapshot, lockedThrough: () => locked, requireDistinctApprover: opts.requireDistinctApprover ?? false });
  return { registry, version: row ? Number(row.version) : 0 };
}

export async function savePolicyRegistry(q: SalesQueryable, registry: PolicyRegistry, expectedVersion: number): Promise<void> {
  const text = JSON.stringify(registry.snapshot());
  if (expectedVersion === 0) {
    const ins = await q.query("INSERT INTO acct_policy_state (id, snapshot, version) VALUES (1, $1, 1) ON CONFLICT (id) DO NOTHING", [text]);
    if (ins.rowCount === 0) throw new PolicyError("INVALID_POLICY", "Policy state changed concurrently; retry");
    return;
  }
  const upd = await q.query("UPDATE acct_policy_state SET snapshot = $1, version = version + 1, updated_at = now() WHERE id = 1 AND version = $2", [text, expectedVersion]);
  if (upd.rowCount === 0) throw new PolicyError("INVALID_POLICY", "Policy state changed concurrently; retry");
}

export class PolicyService {
  private readonly db: SalesDb;
  constructor(db: SalesDb) {
    this.db = db;
  }

  private mutate<T>(fn: (r: PolicyRegistry) => T): Promise<T> {
    return this.db.tx(async (q) => {
      await q.query(LEDGER_LOCK_SQL);
      const { registry, version } = await loadPolicyRegistry(q);
      const out = fn(registry);
      await savePolicyRegistry(q, registry, version);
      return out;
    });
  }

  async view(): Promise<{ versions: PolicyVersion[]; auditChainValid: boolean; auditEvents: number }> {
    const { registry } = await loadPolicyRegistry(this.db);
    const snap = registry.snapshot();
    return { versions: snap.versions, auditChainValid: verifyAuditChain(snap.audit), auditEvents: snap.audit.length };
  }

  async history(key: string): Promise<PolicyVersion[]> {
    const { registry } = await loadPolicyRegistry(this.db);
    return registry.history(key);
  }

  async resolve(key: string, date: IsoDate): Promise<PolicyVersion> {
    const { registry } = await loadPolicyRegistry(this.db);
    return registry.resolve(key, date);
  }

  async readiness(date: IsoDate): Promise<{ date: IsoDate; ready: boolean; missing: string[]; mustBeConfigured: string[] }> {
    if (!isIsoDate(date)) throw new PolicyError("INVALID_DATE", "date must be a valid YYYY-MM-DD date");
    const { registry } = await loadPolicyRegistry(this.db);
    const missing = registry.missing(ALL_CORE_POLICY_KEYS, date);
    return { date, ready: missing.length === 0, missing, mustBeConfigured: MUST_BE_CONFIGURED.filter((k) => missing.includes(k)) };
  }

  propose(input: ProposeInput): Promise<PolicyVersion> {
    return this.mutate((r) => r.propose(input));
  }

  approve(key: string, version: number, actor: string): Promise<PolicyVersion> {
    return this.mutate((r) => r.approve(key, version, actor));
  }

  reject(key: string, version: number, actor: string, reason: string): Promise<PolicyVersion> {
    return this.mutate((r) => r.reject(key, version, actor, reason));
  }

  seedDefaults(opts: { effectiveFrom: IsoDate; actor: string; functionalCurrency?: string }): Promise<string[]> {
    return this.mutate((r) => seedDefaultPolicies(r, opts));
  }
}
