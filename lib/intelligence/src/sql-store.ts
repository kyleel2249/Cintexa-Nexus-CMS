import type { AgentTask, Approval, AuditEvent } from './types';
import { sha256, stableStringify } from './store';
import type { Store } from './store';
import { INTEL_SCHEMA_STATEMENTS } from './schema';
import { randomUUID } from './portable';

/** Minimal driver surface satisfied by node-postgres (Pool) and PGlite. */
export interface IntelDb { query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }

const ready = new WeakMap<object, Promise<void>>();
/** Creates the intel_* tables once per database handle. */
export function ensureIntelSchema(db: IntelDb): Promise<void> {
  let p = ready.get(db);
  if (!p) {
    p = (async () => { for (const s of INTEL_SCHEMA_STATEMENTS) await db.query(s); })();
    p.catch(() => ready.delete(db));
    ready.set(db, p);
  }
  return p;
}

const json = (v: unknown) => JSON.stringify(v);
const isUnique = (e: unknown) => /23505|unique|duplicate/i.test(`${(e as { code?: string }).code ?? ''} ${(e as Error).message ?? ''}`);

/** Durable Store over PostgreSQL / PGlite. Every statement filters on org_id (tenant isolation is enforced here, not in the UI). */
export class SqlStore implements Store {
  constructor(private db: IntelDb) {}
  private async q<T = any>(sql: string, params: unknown[] = []) { await ensureIntelSchema(this.db); return (await this.db.query<T>(sql, params)).rows; }

  async insertTask(t: AgentTask) {
    await this.q(`INSERT INTO intel_tasks (id, org_id, root_task_id, parent_task_id, agent_role, status, priority, idempotency_key, input_hash, created_at, updated_at, data)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
    [t.id, t.orgId, t.rootTaskId, t.parentTaskId, t.agentRole, t.status, t.priority, t.idempotencyKey, t.inputHash, t.createdAt, t.updatedAt, json(t)]);
  }
  async getTask(orgId: string, id: string) {
    const r = await this.q<{ data: AgentTask }>(`SELECT data FROM intel_tasks WHERE org_id=$1 AND id=$2`, [orgId, id]);
    return r[0]?.data ?? null;
  }
  async updateTask(orgId: string, id: string, patch: Partial<AgentTask>) {
    // jsonb merge is atomic in the database, so a cancel flag and a result written by different callers cannot clobber each other.
    const r = await this.q<{ data: AgentTask }>(
      `UPDATE intel_tasks SET data = data || $3::jsonb,
         status = COALESCE($4, status), priority = COALESCE($5, priority), updated_at = COALESCE($6, updated_at)
       WHERE org_id=$1 AND id=$2 RETURNING data`,
      [orgId, id, json(patch), patch.status ?? null, patch.priority ?? null, patch.updatedAt ?? null]);
    if (!r[0]) throw new Error('task not found');
    return r[0].data;
  }
  async listTasks(orgId: string, f: { rootTaskId?: string; status?: string } = {}) {
    const r = await this.q<{ data: AgentTask }>(
      `SELECT data FROM intel_tasks WHERE org_id=$1 AND ($2::text IS NULL OR root_task_id=$2) AND ($3::text IS NULL OR status=$3)
       ORDER BY created_at, id LIMIT 2000`, [orgId, f.rootTaskId ?? null, f.status ?? null]);
    return r.map((x) => x.data);
  }
  async findByIdempotency(orgId: string, key: string) {
    const r = await this.q<{ data: AgentTask }>(`SELECT data FROM intel_tasks WHERE org_id=$1 AND idempotency_key=$2`, [orgId, key]);
    return r[0]?.data ?? null;
  }
  async insertApproval(a: Approval) {
    await this.q(`INSERT INTO intel_approvals (id, org_id, task_id, status, requested_at, data) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [a.id, a.orgId, a.taskId, a.status, a.requestedAt, json(a)]);
  }
  async getApproval(orgId: string, id: string) {
    const r = await this.q<{ data: Approval }>(`SELECT data FROM intel_approvals WHERE org_id=$1 AND id=$2`, [orgId, id]);
    return r[0]?.data ?? null;
  }
  async updateApproval(orgId: string, id: string, patch: Partial<Approval>) {
    const r = await this.q<{ data: Approval }>(
      `UPDATE intel_approvals SET data = data || $3::jsonb, status = COALESCE($4, status) WHERE org_id=$1 AND id=$2 RETURNING data`,
      [orgId, id, json(patch), patch.status ?? null]);
    if (!r[0]) throw new Error('approval not found');
    return r[0].data;
  }
  async listApprovals(orgId: string, status?: string) {
    const r = await this.q<{ data: Approval }>(
      `SELECT data FROM intel_approvals WHERE org_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY requested_at DESC, id LIMIT 500`, [orgId, status ?? null]);
    return r.map((x) => x.data);
  }
  async appendAudit(e: Omit<AuditEvent, 'prevHash' | 'hash' | 'id'>): Promise<AuditEvent> {
    const base = { ...e, metadata: JSON.parse(json(e.metadata ?? {})) as Record<string, unknown> }; // normalise exactly as the DB will return it
    for (let attempt = 0; attempt < 8; attempt++) {
      const last = await this.q<{ hash: string }>(`SELECT hash FROM intel_audit WHERE org_id=$1 ORDER BY seq DESC LIMIT 1`, [e.orgId]);
      const prevHash = last[0]?.hash ?? 'GENESIS';
      const hash = sha256(prevHash + stableStringify(base));
      const id = `aud_${randomUUID()}`;
      try {
        await this.q(`INSERT INTO intel_audit (id, org_id, at, actor, action, resource, resource_id, metadata, prev_hash, hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
          [id, base.orgId, base.at, base.actor, base.action, base.resource, base.resourceId, json(base.metadata), prevHash, hash]);
        return { ...base, id, prevHash, hash };
      } catch (err) { if (!isUnique(err)) throw err; /* lost a race for this predecessor: re-read and retry */ }
    }
    throw new Error('audit chain contention: could not append');
  }
  async listAudit(orgId: string) {
    const r = await this.q<any>(`SELECT id, org_id, at, actor, action, resource, resource_id, metadata, prev_hash, hash FROM intel_audit WHERE org_id=$1 ORDER BY seq`, [orgId]);
    return r.map((x): AuditEvent => ({ id: x.id, orgId: x.org_id, at: x.at, actor: x.actor, action: x.action, resource: x.resource, resourceId: x.resource_id, metadata: x.metadata, prevHash: x.prev_hash, hash: x.hash }));
  }
}
