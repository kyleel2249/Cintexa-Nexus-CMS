import { randomUUID } from './portable';
import { OrchestratorError } from './types';
import type { Actor, AgentOutput, AgentRole, AgentTask, Approval, AutonomyLevel, EvidenceRef, Finding, ProposedAction, Usage } from './types';
import { S, validate } from './validate';
import type { Schema } from './validate';
import { MANDATORY_APPROVAL_TYPES, decideDisposition } from './autonomy';
import type { AutonomyPolicy } from './autonomy';
import { ToolRegistry } from './tools';
import { sha256, stableStringify } from './store';
import type { Store } from './store';
import type { LlmResult, ModelRouter } from './llm';

// ---------- Agent contracts ----------
export interface AgentDraft {
  findings?: Finding[]; evidence?: EvidenceRef[]; confidence: number;
  recommendedActions?: ProposedAction[]; uncertainties?: string[]; summary?: string; data?: Record<string, unknown>;
}
export interface AgentContext {
  task: AgentTask; orgId: string; signal: AbortSignal; now(): Date;
  callTool(name: string, args?: unknown): Promise<unknown>;
  /** Like callTool but an unconfigured/failing tool degrades the run instead of failing it. */
  tryTool(name: string, args?: unknown): Promise<{ ok: true; value: unknown } | { ok: false; reason: string }>;
  llmJson<T>(taskClass: string, system: string, user: string, schema: Schema): Promise<LlmResult<T>>;
  delegate(role: AgentRole, input: Record<string, unknown>, opts?: { dependsOn?: string[]; priority?: number }): Promise<string>;
  awaitTasks(ids: string[]): Promise<AgentTask[]>;
  getResult(taskId: string): Promise<AgentOutput | null>;
  /** True when an AI provider is configured. Agents skip optional narrative instead of reporting a degraded run. */
  aiConfigured: boolean;
  markDegraded(reason: string): void;
  setProgress(pct: number): void;
}
export interface AgentDefinition {
  role: AgentRole; title: string; description: string; domain: string;
  tools: readonly string[]; inputSchema: Schema; completionCriteria: readonly string[];
  autonomyCeiling: AutonomyLevel; maxCostUsd: number; defaultTimeoutMs?: number; maxAttempts?: number;
  handler: (ctx: AgentContext, input: any) => Promise<AgentDraft>;
}
export class AgentRegistry {
  private defs = new Map<string, AgentDefinition>();
  register(d: AgentDefinition) { if (this.defs.has(d.role)) throw new Error(`duplicate agent ${d.role}`); this.defs.set(d.role, d); }
  get(role: string) { return this.defs.get(role); }
  list() { return [...this.defs.values()]; }
}

export type ActionExecutor = (action: ProposedAction, ctx: { orgId: string; approvedBy: string; idempotencyKey: string }) => Promise<{ ok: boolean; detail?: string }>;

// ---------- Output schema (agents must satisfy this) ----------
const evidenceSchema = S.obj({ source: S.str({ min: 1 }), ref: S.str({ min: 1 }), observedAt: S.str(), note: S.str() }, ['observedAt', 'note']);
const findingSchema = S.obj({
  id: S.str({ min: 1 }), category: S.str({ min: 1 }), severity: S.str({ enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL'] }),
  title: S.str({ min: 1 }), detail: S.str(), evidence: S.arr(evidenceSchema), confidence: S.num({ min: 0, max: 1 }),
  status: S.str({ enum: ['confirmed', 'needs_verification', 'hypothesis'] }), meta: S.any,
}, ['meta']);
const actionSchema = S.obj({
  type: S.str({ min: 1 }), summary: S.str({ min: 1 }), payload: S.any, risk: S.str({ enum: ['low', 'medium', 'high'] }),
  reversible: S.bool, requiredRoles: S.arr(S.str()),
}, ['requiredRoles']);
export const outputSchema = S.obj({
  taskId: S.str(), agentRole: S.str(), status: S.str({ enum: ['ok', 'degraded', 'error'] }), timestamp: S.str(),
  evidence: S.arr(evidenceSchema), findings: S.arr(findingSchema), confidence: S.num({ min: 0, max: 1 }),
  recommendedActions: S.arr(actionSchema), uncertainties: S.arr(S.str()), errors: S.arr(S.str()), summary: S.str(), data: S.any,
}, ['errors', 'summary', 'data']);

export function validateOutput(o: AgentOutput): string[] {
  const errs = validate(outputSchema, o);
  for (const f of o.findings ?? []) if (f.status === 'confirmed' && f.evidence.length === 0) errs.push(`finding ${f.id}: confirmed findings require evidence`);
  return errs;
}

export interface OrchestratorOptions {
  store: Store; agents: AgentRegistry; tools: ToolRegistry; llm: ModelRouter;
  policy: (orgId: string) => AutonomyPolicy; executors?: Record<string, ActionExecutor>;
  concurrency?: number; maxDepth?: number; maxTasksPerRoot?: number; backoffMs?: number;
  now?: () => Date; sleep?: (ms: number) => Promise<void>;
}
export interface SubmitRequest {
  agentRole: AgentRole; input: Record<string, unknown>; priority?: number; dependsOn?: string[];
  idempotencyKey?: string; parentTaskId?: string; timeoutMs?: number; maxAttempts?: number;
}

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);
const ZERO: Usage = { promptTokens: 0, completionTokens: 0, costUsd: 0 };

export class Orchestrator {
  private o: Required<Omit<OrchestratorOptions, 'executors'>> & { executors: Record<string, ActionExecutor> };
  private claimed = new Set<string>();
  private controllers = new Map<string, AbortController>();
  private autoCounts = new Map<string, number>();

  constructor(opts: OrchestratorOptions) {
    this.o = {
      concurrency: 4, maxDepth: 4, maxTasksPerRoot: 40, backoffMs: 500,
      now: () => new Date(), sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)), executors: {}, ...opts,
    } as never;
  }
  private iso() { return this.o.now().toISOString(); }
  private async audit(orgId: string, actor: string, action: string, resource: string, resourceId: string, metadata: Record<string, unknown> = {}) {
    await this.o.store.appendAudit({ orgId, at: this.iso(), actor, action, resource, resourceId, metadata });
  }

  // ---------- Submission ----------
  async submit(actor: Actor, req: SubmitRequest): Promise<AgentTask> {
    const { store, agents } = this.o;
    const def = agents.get(req.agentRole);
    if (!def) throw new OrchestratorError('unknown_agent', `no agent ${req.agentRole}`);
    const errs = validate(def.inputSchema, req.input);
    if (errs.length) throw new OrchestratorError('invalid_input', errs.join('; '));
    const priority = req.priority ?? 50;
    if (!Number.isInteger(priority) || priority < 0 || priority > 100) throw new OrchestratorError('invalid_priority', 'priority must be an integer 0..100');
    const inputHash = sha256(stableStringify({ role: req.agentRole, input: req.input }));
    if (req.idempotencyKey) {
      const existing = await store.findByIdempotency(actor.orgId, req.idempotencyKey);
      if (existing) {
        if (existing.inputHash !== inputHash) throw new OrchestratorError('idempotency_conflict', 'key reused with different request');
        return existing;
      }
    }
    for (const d of req.dependsOn ?? []) if (!(await store.getTask(actor.orgId, d))) throw new OrchestratorError('dependency_not_found', `dependency ${d} not found in this organisation`);
    let lineage: string[] = [req.agentRole], depth = 0, parentTaskId: string | null = null, rootTaskId = '';
    const id = `tsk_${randomUUID()}`;
    if (req.parentTaskId) {
      const parent = await store.getTask(actor.orgId, req.parentTaskId);
      if (!parent) throw new OrchestratorError('parent_not_found', 'parent task not found');
      if (parent.lineage.includes(req.agentRole)) throw new OrchestratorError('circular_delegation', `${req.agentRole} already appears in delegation chain`);
      depth = parent.depth + 1;
      if (depth > this.o.maxDepth) throw new OrchestratorError('max_depth_exceeded', `delegation deeper than ${this.o.maxDepth}`);
      lineage = [...parent.lineage, req.agentRole]; parentTaskId = parent.id; rootTaskId = parent.rootTaskId;
      if ((await store.listTasks(actor.orgId, { rootTaskId })).length >= this.o.maxTasksPerRoot) throw new OrchestratorError('task_limit_exceeded', 'too many tasks under one root');
    } else rootTaskId = id;
    const now = this.iso();
    const task: AgentTask = {
      id, orgId: actor.orgId, rootTaskId, parentTaskId, lineage, depth, agentRole: req.agentRole, input: req.input, priority,
      status: 'queued', dependsOn: req.dependsOn ?? [], idempotencyKey: req.idempotencyKey ?? null, inputHash, attempts: 0,
      maxAttempts: req.maxAttempts ?? def.maxAttempts ?? 2, timeoutMs: req.timeoutMs ?? def.defaultTimeoutMs ?? 30_000,
      createdBy: actor.userId, createdAt: now, updatedAt: now, availableAt: now, cancelRequested: false,
      result: null, error: null, degraded: false, usage: { ...ZERO }, progress: 0,
    };
    await store.insertTask(task);
    await this.audit(actor.orgId, actor.userId, 'task.submitted', 'agent_task', id, { agentRole: req.agentRole, parentTaskId, priority });
    return task;
  }

  async cancel(actor: Actor, id: string): Promise<AgentTask> {
    const t = await this.o.store.getTask(actor.orgId, id);
    if (!t) throw new OrchestratorError('not_found', 'task not found');
    if (TERMINAL.has(t.status)) return t;
    await this.audit(actor.orgId, actor.userId, 'task.cancel_requested', 'agent_task', id);
    if (t.status === 'running') {
      await this.o.store.updateTask(actor.orgId, id, { cancelRequested: true });
      this.controllers.get(id)?.abort(new OrchestratorError('cancelled', 'cancelled by user'));
      return (await this.o.store.getTask(actor.orgId, id)) as AgentTask;
    }
    return this.o.store.updateTask(actor.orgId, id, { status: 'cancelled', cancelRequested: true, error: 'cancelled_by_user', updatedAt: this.iso() });
  }

  // ---------- Scheduling ----------
  private async classify(orgId: string, t: AgentTask, byId: Map<string, AgentTask>): Promise<'ready' | 'wait' | 'dead'> {
    if (t.status !== 'queued') return 'wait';
    let waiting = false;
    for (const d of t.dependsOn) {
      const dep = byId.get(d) ?? (await this.o.store.getTask(orgId, d));
      if (!dep) return 'dead';
      if (dep.status === 'succeeded') continue;
      if (TERMINAL.has(dep.status)) {
        await this.o.store.updateTask(orgId, t.id, { status: 'cancelled', error: `dependency_failed:${d}`, updatedAt: this.iso() });
        await this.audit(orgId, 'system', 'task.cancelled_dependency', 'agent_task', t.id, { dependency: d });
        return 'dead';
      }
      waiting = true;
    }
    return waiting ? 'wait' : 'ready';
  }

  /** Drains all runnable tasks for an organisation, honouring priority, dependencies, backoff and the concurrency limit. */
  async runUntilIdle(orgId: string): Promise<void> {
    const running = new Set<Promise<void>>();
    for (;;) {
      const tasks = await this.o.store.listTasks(orgId);
      const byId = new Map(tasks.map((t) => [t.id, t]));
      const nowMs = this.o.now().getTime();
      const queued = tasks.filter((t) => t.status === 'queued' && !this.claimed.has(t.id));
      const ready: AgentTask[] = []; let backoffWait: number | null = null; let blocked = 0;
      for (const t of queued) {
        const c = await this.classify(orgId, t, byId);
        if (c === 'ready') {
          const at = Date.parse(t.availableAt);
          if (at <= nowMs) ready.push(t); else backoffWait = Math.min(backoffWait ?? Infinity, at - nowMs);
        } else if (c === 'wait') blocked++;
      }
      ready.sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      for (const t of ready.slice(0, Math.max(0, this.o.concurrency - running.size))) {
        const p: Promise<void> = this.execute(orgId, t.id).finally(() => { running.delete(p); });
        running.add(p);
      }
      if (running.size > 0) { await Promise.race(running); continue; }
      if (backoffWait !== null) { await this.o.sleep(backoffWait); continue; }
      const stillRunning = tasks.some((t) => t.status === 'running') || this.claimed.size > 0;
      if (blocked > 0 && stillRunning) { await this.o.sleep(5); continue; }
      return;
    }
  }

  async runToCompletion(orgId: string, id: string): Promise<AgentTask> {
    for (;;) {
      const t = await this.o.store.getTask(orgId, id);
      if (!t) throw new OrchestratorError('not_found', 'task not found');
      if (TERMINAL.has(t.status)) return t;
      if (t.status === 'queued' && !this.claimed.has(id)) {
        for (const d of t.dependsOn) await this.runToCompletion(orgId, d);
        const byId = new Map<string, AgentTask>();
        const c = await this.classify(orgId, t, byId);
        if (c === 'dead') continue;
        const wait = Date.parse(t.availableAt) - this.o.now().getTime();
        if (wait > 0) await this.o.sleep(wait);
        await this.execute(orgId, id);
      } else await this.o.sleep(2);
    }
  }

  // ---------- Execution ----------
  private async execute(orgId: string, id: string): Promise<void> {
    if (this.claimed.has(id)) return;
    this.claimed.add(id);
    const { store } = this.o;
    const ac = new AbortController();
    this.controllers.set(id, ac);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let usage: Usage = { ...ZERO };
    try {
      const t = await store.getTask(orgId, id);
      if (!t || t.status !== 'queued') return;
      const def = this.o.agents.get(t.agentRole);
      if (!def) { await store.updateTask(orgId, id, { status: 'failed', error: 'unknown_agent', updatedAt: this.iso() }); return; }
      const attempts = t.attempts + 1;
      await store.updateTask(orgId, id, { status: 'running', attempts, updatedAt: this.iso(), error: null });
      await this.audit(orgId, `agent:${t.agentRole}`, 'task.started', 'agent_task', id, { attempt: attempts });
      timer = setTimeout(() => ac.abort(new OrchestratorError('timeout', `exceeded ${t.timeoutMs}ms`, true)), t.timeoutMs);
      const abortP = new Promise<never>((_, rej) => ac.signal.addEventListener('abort', () => rej(ac.signal.reason)));
      abortP.catch(() => undefined);
      const degradedReasons: string[] = [];
      const ctx = this.makeContext(t, def, ac.signal, () => usage, (u) => { usage = u; }, degradedReasons);
      try {
        const draft = await Promise.race([def.handler(ctx, t.input), abortP]);
        const fresh = await store.getTask(orgId, id);
        if (ac.signal.aborted || fresh?.cancelRequested) throw (ac.signal.reason ?? new OrchestratorError('cancelled', 'cancelled'));
        const output = await this.finalise(t, def, draft, degradedReasons);
        await store.updateTask(orgId, id, { status: 'succeeded', result: output, usage, degraded: output.status === 'degraded', progress: 100, updatedAt: this.iso(), error: null });
        await this.audit(orgId, `agent:${t.agentRole}`, 'task.succeeded', 'agent_task', id, { degraded: output.status === 'degraded', findings: output.findings.length, costUsd: usage.costUsd });
      } catch (e) {
        const err = e as OrchestratorError & Error;
        const code = err.code ?? 'handler_error';
        if (code === 'cancelled') {
          await store.updateTask(orgId, id, { status: 'cancelled', usage, error: 'cancelled', updatedAt: this.iso() });
          await this.audit(orgId, 'system', 'task.cancelled', 'agent_task', id);
        } else {
          const retryable = err.retryable === true || code === 'handler_error';
          const msg = `${code}: ${String(err.message).slice(0, 300)}`;
          if (retryable && attempts < t.maxAttempts) {
            const delay = this.o.backoffMs * 2 ** (attempts - 1);
            await store.updateTask(orgId, id, { status: 'queued', usage, error: msg, availableAt: new Date(this.o.now().getTime() + delay).toISOString(), updatedAt: this.iso() });
            await this.audit(orgId, 'system', 'task.retry_scheduled', 'agent_task', id, { attempt: attempts, delayMs: delay, error: msg });
          } else {
            const status = code === 'timeout' ? 'timed_out' : 'failed';
            await store.updateTask(orgId, id, { status, usage, error: msg, updatedAt: this.iso() });
            await this.audit(orgId, 'system', `task.${status}`, 'agent_task', id, { error: msg });
          }
        }
      }
    } finally {
      if (timer) clearTimeout(timer);
      this.controllers.delete(id);
      this.claimed.delete(id);
    }
  }

  private makeContext(t: AgentTask, def: AgentDefinition, signal: AbortSignal, getUsage: () => Usage, setUsage: (u: Usage) => void, degraded: string[]): AgentContext {
    const alive = () => { if (signal.aborted) throw (signal.reason ?? new OrchestratorError('cancelled', 'aborted')); };
    const markDegraded = (r: string) => { if (!degraded.includes(r)) degraded.push(r); };
    const system: Actor = { userId: `agent:${t.agentRole}`, orgId: t.orgId, roles: ['system'] };
    const callTool = async (name: string, args: unknown = {}) => {
      alive();
      return this.o.tools.invokeForAgent(def.tools, name, args, { orgId: t.orgId, taskId: t.id, signal });
    };
    return {
      task: t, orgId: t.orgId, signal, now: this.o.now, callTool, markDegraded, aiConfigured: this.o.llm.configured,
      async tryTool(name, args) {
        try { return { ok: true as const, value: await callTool(name, args) }; }
        catch (e) {
          const err = e as OrchestratorError;
          if (err.code === 'tool_unavailable') { markDegraded(`integration_not_configured:${name}`); return { ok: false as const, reason: 'integration_not_configured' }; }
          if (err.code === 'tool_not_permitted' || err.code === 'invalid_tool_args' || err.code === 'cancelled' || err.code === 'timeout') throw e;
          markDegraded(`tool_failed:${name}`); return { ok: false as const, reason: 'tool_failed' };
        }
      },
      llmJson: async <T>(taskClass: string, sys: string, user: string, schema: Schema) => {
        alive();
        if (getUsage().costUsd >= def.maxCostUsd) throw new OrchestratorError('budget_exceeded', `task cost budget ${def.maxCostUsd} USD reached`);
        const r = await this.o.llm.completeJson<T>(taskClass, sys, user, schema);
        const u = getUsage();
        setUsage({ promptTokens: u.promptTokens + r.usage.promptTokens, completionTokens: u.completionTokens + r.usage.completionTokens, costUsd: u.costUsd + r.usage.costUsd });
        if (!r.ok) markDegraded(`ai_unavailable:${r.reason}`);
        return r;
      },
      delegate: async (role, input, opts = {}) => {
        alive();
        const child = await this.submit(system, { agentRole: role, input, parentTaskId: t.id, dependsOn: opts.dependsOn, priority: opts.priority ?? t.priority });
        return child.id;
      },
      awaitTasks: async (ids) => {
        const out: AgentTask[] = [];
        for (const id of ids) { alive(); out.push(await this.runToCompletion(t.orgId, id)); }
        return out;
      },
      getResult: async (taskId) => { alive(); const r = await this.o.store.getTask(t.orgId, taskId); return r?.result ?? null; },
      setProgress: (pct) => { void this.o.store.updateTask(t.orgId, t.id, { progress: Math.max(0, Math.min(100, Math.round(pct))) }).catch(() => undefined); },
    };
  }

  private async finalise(t: AgentTask, def: AgentDefinition, draft: AgentDraft, degraded: string[]): Promise<AgentOutput> {
    const policy = this.o.policy(t.orgId);
    const kept: ProposedAction[] = []; const approvalIds: string[] = []; const suppressed: string[] = [];
    for (const action of draft.recommendedActions ?? []) {
      const { level, disposition } = decideDisposition(action, def.autonomyCeiling, policy);
      if (disposition === 'suppress') { suppressed.push(action.type); continue; }
      kept.push(action);
      if (disposition === 'recommend') continue;
      const a = await this.createApproval(t, action, disposition === 'prepare' ? 'prepared' : 'pending');
      approvalIds.push(a.id);
      if (disposition === 'auto_execute') {
        const key = `${t.orgId}:${action.type}`;
        const n = (this.autoCounts.get(key) ?? 0) + 1;
        if (n > (policy.maxAutoPerWindow ?? 10)) continue; // over the guarded-autonomy cap: stays pending for a human
        this.autoCounts.set(key, n);
        await this.executeApproval(a, `policy:guarded_autonomy:level${level}`);
      }
    }
    const output: AgentOutput = {
      taskId: t.id, agentRole: t.agentRole, status: degraded.length ? 'degraded' : 'ok', timestamp: this.iso(),
      evidence: draft.evidence ?? [], findings: draft.findings ?? [], confidence: draft.confidence,
      recommendedActions: kept, uncertainties: [...(draft.uncertainties ?? []), ...degraded.map((r) => `degraded:${r}`)],
      summary: draft.summary, data: { ...(draft.data ?? {}), approvalIds, suppressedActionTypes: suppressed },
    };
    const errs = validateOutput(output);
    if (errs.length) throw new OrchestratorError('invalid_output', errs.slice(0, 5).join('; '));
    return output;
  }

  // ---------- Approvals ----------
  private async createApproval(t: AgentTask, action: ProposedAction, status: 'prepared' | 'pending'): Promise<Approval> {
    const a: Approval = {
      id: `apr_${randomUUID()}`, orgId: t.orgId, taskId: t.id, agentRole: t.agentRole, action, payloadHash: sha256(stableStringify(action)),
      status, requestedBy: `agent:${t.agentRole}`, requestedAt: this.iso(), decidedBy: null, decidedAt: null, decisionNote: null, executedAt: null, executionResult: null,
    };
    await this.o.store.insertApproval(a);
    await this.audit(t.orgId, `agent:${t.agentRole}`, `approval.${status}`, 'approval', a.id, { actionType: action.type, risk: action.risk });
    return a;
  }

  async promoteApproval(actor: Actor, id: string): Promise<Approval> {
    const a = await this.o.store.getApproval(actor.orgId, id);
    if (!a) throw new OrchestratorError('approval_not_found', 'approval not found');
    if (a.status !== 'prepared') throw new OrchestratorError('invalid_state', `approval is ${a.status}`);
    if (!actor.roles.some((r) => ['staff', 'manager', 'admin'].includes(r))) throw new OrchestratorError('forbidden', 'insufficient role');
    await this.audit(actor.orgId, actor.userId, 'approval.promoted', 'approval', id);
    return this.o.store.updateApproval(actor.orgId, id, { status: 'pending' });
  }

  async decideApproval(actor: Actor, id: string, decision: 'approve' | 'reject', note?: string): Promise<Approval> {
    const a = await this.o.store.getApproval(actor.orgId, id);
    if (!a) throw new OrchestratorError('approval_not_found', 'approval not found');
    if (a.status !== 'pending') throw new OrchestratorError('invalid_state', `approval is ${a.status}`);
    const required = a.action.requiredRoles ?? ['manager', 'admin'];
    if (!actor.roles.some((r) => required.includes(r))) throw new OrchestratorError('forbidden', 'insufficient role to decide this approval');
    if (MANDATORY_APPROVAL_TYPES.has(a.action.type) && a.requestedBy === actor.userId) throw new OrchestratorError('forbidden_self_approval', 'requester cannot approve their own consequential action');
    if (sha256(stableStringify(a.action)) !== a.payloadHash) throw new OrchestratorError('payload_tampered', 'approved payload does not match stored hash');
    const decidedAt = this.iso();
    if (decision === 'reject') {
      await this.audit(actor.orgId, actor.userId, 'approval.rejected', 'approval', id, { note: note ?? null });
      return this.o.store.updateApproval(actor.orgId, id, { status: 'rejected', decidedBy: actor.userId, decidedAt, decisionNote: note ?? null });
    }
    const approved = await this.o.store.updateApproval(actor.orgId, id, { status: 'approved', decidedBy: actor.userId, decidedAt, decisionNote: note ?? null });
    await this.audit(actor.orgId, actor.userId, 'approval.approved', 'approval', id, { actionType: a.action.type, payloadHash: a.payloadHash, note: note ?? null });
    return this.executeApproval(approved, actor.userId);
  }

  private async executeApproval(a: Approval, approvedBy: string): Promise<Approval> {
    const { store } = this.o;
    if (a.status === 'executed') return a;
    const exec = this.o.executors[a.action.type];
    let result: { ok: boolean; detail?: string };
    if (!exec) result = { ok: false, detail: 'no_executor_configured' }; // never report success without an executor
    else {
      try { result = await exec(a.action, { orgId: a.orgId, approvedBy, idempotencyKey: a.id }); }
      catch (e) { result = { ok: false, detail: `executor_error: ${(e as Error).message.slice(0, 200)}` }; }
    }
    const updated = await store.updateApproval(a.orgId, a.id, {
      status: result.ok ? 'executed' : 'failed', executedAt: this.iso(), executionResult: result,
      decidedBy: a.decidedBy ?? approvedBy, decidedAt: a.decidedAt ?? this.iso(),
    });
    await this.audit(a.orgId, approvedBy, result.ok ? 'action.executed' : 'action.failed', 'approval', a.id, { actionType: a.action.type, detail: result.detail ?? null });
    return updated;
  }
}
