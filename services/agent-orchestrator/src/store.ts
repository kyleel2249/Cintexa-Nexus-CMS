import { createHash } from 'node:crypto';
import type { AgentTask, Approval, AuditEvent } from './types.ts';

/** Persistence port. Implement against Drizzle/PostgreSQL (see migrations/0001). Every method is org-scoped by the caller. */
export interface Store {
  insertTask(t: AgentTask): Promise<void>;
  getTask(orgId: string, id: string): Promise<AgentTask | null>;
  updateTask(orgId: string, id: string, patch: Partial<AgentTask>): Promise<AgentTask>;
  listTasks(orgId: string, filter?: { rootTaskId?: string; status?: string }): Promise<AgentTask[]>;
  findByIdempotency(orgId: string, key: string): Promise<AgentTask | null>;
  insertApproval(a: Approval): Promise<void>;
  getApproval(orgId: string, id: string): Promise<Approval | null>;
  updateApproval(orgId: string, id: string, patch: Partial<Approval>): Promise<Approval>;
  listApprovals(orgId: string, status?: string): Promise<Approval[]>;
  appendAudit(e: Omit<AuditEvent, 'prevHash' | 'hash' | 'id'>): Promise<AuditEvent>;
  listAudit(orgId: string): Promise<AuditEvent[]>;
}

export function sha256(s: string): string { return createHash('sha256').update(s).digest('hex'); }

export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** In-memory store for tests and local development only. Not durable. */
export class MemoryStore implements Store {
  tasks = new Map<string, AgentTask>();
  approvals = new Map<string, Approval>();
  audit: AuditEvent[] = [];
  private seq = 0;

  async insertTask(t: AgentTask) { this.tasks.set(t.id, structuredClone(t)); }
  async getTask(orgId: string, id: string) {
    const t = this.tasks.get(id);
    return t && t.orgId === orgId ? structuredClone(t) : null;
  }
  async updateTask(orgId: string, id: string, patch: Partial<AgentTask>) {
    const t = this.tasks.get(id);
    if (!t || t.orgId !== orgId) throw new Error('task not found');
    Object.assign(t, structuredClone(patch));
    return structuredClone(t);
  }
  async listTasks(orgId: string, f: { rootTaskId?: string; status?: string } = {}) {
    return [...this.tasks.values()].filter((t) => t.orgId === orgId
      && (!f.rootTaskId || t.rootTaskId === f.rootTaskId) && (!f.status || t.status === f.status)).map((t) => structuredClone(t));
  }
  async findByIdempotency(orgId: string, key: string) {
    for (const t of this.tasks.values()) if (t.orgId === orgId && t.idempotencyKey === key) return structuredClone(t);
    return null;
  }
  async insertApproval(a: Approval) { this.approvals.set(a.id, structuredClone(a)); }
  async getApproval(orgId: string, id: string) {
    const a = this.approvals.get(id);
    return a && a.orgId === orgId ? structuredClone(a) : null;
  }
  async updateApproval(orgId: string, id: string, patch: Partial<Approval>) {
    const a = this.approvals.get(id);
    if (!a || a.orgId !== orgId) throw new Error('approval not found');
    Object.assign(a, structuredClone(patch));
    return structuredClone(a);
  }
  async listApprovals(orgId: string, status?: string) {
    return [...this.approvals.values()].filter((a) => a.orgId === orgId && (!status || a.status === status)).map((a) => structuredClone(a));
  }
  async appendAudit(e: Omit<AuditEvent, 'prevHash' | 'hash' | 'id'>) {
    const prev = [...this.audit].reverse().find((x) => x.orgId === e.orgId);
    const prevHash = prev?.hash ?? 'GENESIS';
    const hash = sha256(prevHash + stableStringify(e));
    const ev: AuditEvent = { ...e, id: `aud_${++this.seq}`, prevHash, hash };
    this.audit.push(ev);
    return structuredClone(ev);
  }
  async listAudit(orgId: string) { return this.audit.filter((e) => e.orgId === orgId).map((e) => structuredClone(e)); }
}

/** Verifies the per-org tamper-evident audit chain. */
export function verifyAuditChain(events: AuditEvent[]): boolean {
  let prev = 'GENESIS';
  for (const e of events) {
    const { id: _id, prevHash, hash, ...rest } = e;
    if (prevHash !== prev || sha256(prev + stableStringify(rest)) !== hash) return false;
    prev = hash;
  }
  return true;
}
