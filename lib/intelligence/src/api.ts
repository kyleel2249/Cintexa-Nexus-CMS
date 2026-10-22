import { MANDATORY_APPROVAL_TYPES } from './autonomy';
import { OrchestratorError } from './types';
import type { Actor, AgentOutput, AgentTask, AutonomyLevel } from './types';
import { ensureIntelSchema } from './sql-store';
import { verifyAuditChain } from './store';
import { listFindings, metricHistory, persistFindings, recordSnapshot, updateFinding, WORKFLOW_STATUSES } from './findings';
import { DEFAULT_SETTINGS } from './runtime';
import type { Intelligence, IntelSettings } from './runtime';

export interface IntelRequest { method: string; path: string; query?: Record<string, string | string[] | undefined>; body?: any; headers?: Record<string, string | string[] | undefined>; actor: Actor | null }
export interface IntelResponse { status: number; body?: unknown; raw?: { contentType: string; filename?: string; data: string } }

const ok = (body: unknown, status = 200): IntelResponse => ({ status, body });
const err = (status: number, code: string, message: string, extra?: object): IntelResponse => ({ status, body: { error: message, code, ...extra } });
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const READERS = ['staff', 'manager', 'admin'];
const ROOTS = new Set(['chief_executive', 'business_diagnostic_director', 'sales_director', 'website_director']);

/** Maps the platform role to intelligence roles. Admins can approve; editors can view/run but not decide consequential approvals. */
export function actorFromPlatform(sub: string, platformRole: string, orgId = 'default'): Actor {
  const roles = platformRole === 'admin' ? ['admin', 'manager', 'staff'] : platformRole === 'editor' || platformRole === 'staff' ? ['staff'] : [];
  return { userId: sub, orgId, roles };
}

export async function handleIntelligence(i: Intelligence, req: IntelRequest): Promise<IntelResponse> {
  const actor = req.actor;
  if (!actor) return err(401, 'unauthenticated', 'Sign in required');
  if (!actor.roles.some((r) => READERS.includes(r))) return err(403, 'forbidden', 'No access to Intelligence');
  const orgId = actor.orgId, m = req.method.toUpperCase(), path = req.path.replace(/\/+$/, '') || '/';
  const isAdmin = actor.roles.includes('admin');
  try {
    await ensureIntelSchema(i.db);
    if (m === 'GET' && path === '/health') return ok({ ok: true, aiConfigured: i.llm.configured, tools: i.tools.names(), agents: i.agents.list().length });
    if (m === 'GET' && path === '/agents') return ok({ agents: i.agents.list().map((a) => ({ role: a.role, title: a.title, description: a.description, domain: a.domain, tools: a.tools, completionCriteria: a.completionCriteria, autonomyCeiling: a.autonomyCeiling, maxCostUsd: a.maxCostUsd })), mandatoryApprovalTypes: [...MANDATORY_APPROVAL_TYPES] });
    if (m === 'GET' && path === '/overview') return ok(await overview(i, orgId));

    if (m === 'POST' && path === '/runs') {
      const b = req.body ?? {}, role = typeof b.agentRole === 'string' ? b.agentRole : 'chief_executive';
      if (!i.agents.get(role)) return err(400, 'unknown_agent', `Unknown agent ${role}`);
      const busy = [...(await i.store.listTasks(orgId, { status: 'running' })), ...(await i.store.listTasks(orgId, { status: 'queued' }))].find((t) => t.parentTaskId === null && t.agentRole === role && i.now().getTime() - Date.parse(t.createdAt) < 10 * 60_000);
      if (busy) return err(409, 'run_in_progress', `${role} is already running`, { taskId: busy.id });
      await i.loadPolicy(orgId);
      const settings = await i.getSettings(orgId);
      const key = one(req.headers?.['idempotency-key']);
      const input = role === 'business_diagnostic_director' || role === 'chief_executive' ? (role === 'business_diagnostic_director' ? { weights: settings.weights } : {}) : (b.input ?? {});
      const task = await i.orchestrator.submit(actor, { agentRole: role, input, idempotencyKey: key, timeoutMs: undefined });
      if (task.status !== 'queued') return ok({ task, persisted: null, replayed: true }); // idempotent replay: return the stored result, record nothing twice
      const done = await i.orchestrator.runToCompletion(orgId, task.id);
      let persisted = null;
      if (done.status === 'succeeded' && done.result && ROOTS.has(done.agentRole)) persisted = await persistRun(i, orgId, done);
      return ok({ task: done, persisted }, 201);
    }
    if (m === 'GET' && path === '/tasks') {
      const tasks = (await i.store.listTasks(orgId, { rootTaskId: one(req.query?.root), status: one(req.query?.status) })).filter((t) => (one(req.query?.roots) === '1' ? t.parentTaskId === null : true));
      return ok({ tasks: tasks.reverse().slice(0, 200).map(slim) });
    }
    let mt = path.match(/^\/tasks\/([\w-]+)$/);
    if (m === 'GET' && mt) {
      const t = await i.store.getTask(orgId, mt[1]); if (!t) return err(404, 'not_found', 'Task not found');
      return ok({ task: t, tree: (await i.store.listTasks(orgId, { rootTaskId: t.rootTaskId })).map(slim) });
    }
    mt = path.match(/^\/tasks\/([\w-]+)\/cancel$/);
    if (m === 'POST' && mt) return ok({ task: await i.orchestrator.cancel(actor, mt[1]) });

    if (m === 'GET' && path === '/findings') return ok({ findings: await listFindings(i.db, orgId, { workflowStatus: one(req.query?.status), severity: one(req.query?.severity) }) });
    mt = path.match(/^\/findings\/([\w]+)$/);
    if (m === 'PATCH' && mt) {
      const b = req.body ?? {};
      if (b.workflowStatus !== undefined && !(WORKFLOW_STATUSES as readonly string[]).includes(b.workflowStatus)) return err(400, 'invalid_status', 'Unknown workflow status');
      if (b.dueDate !== undefined && b.dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.dueDate))) return err(400, 'invalid_due_date', 'dueDate must be YYYY-MM-DD');
      if (b.owner !== undefined && b.owner !== null && (typeof b.owner !== 'string' || b.owner.length > 120)) return err(400, 'invalid_owner', 'owner must be text up to 120 characters');
      const row = await updateFinding(i.db, orgId, mt[1], { workflowStatus: b.workflowStatus, owner: b.owner, dueDate: b.dueDate, note: typeof b.note === 'string' ? b.note.slice(0, 500) : undefined }, actor.userId, i.now().toISOString());
      if (!row) return err(404, 'not_found', 'Finding not found');
      await i.store.appendAudit({ orgId, at: i.now().toISOString(), actor: actor.userId, action: 'finding.updated', resource: 'finding', resourceId: row.id, metadata: { workflowStatus: row.workflowStatus, owner: row.owner, dueDate: row.dueDate } });
      return ok({ finding: row });
    }

    if (m === 'GET' && path === '/approvals') return ok({ approvals: await i.store.listApprovals(orgId, one(req.query?.status)) });
    mt = path.match(/^\/approvals\/([\w-]+)\/(decide|promote)$/);
    if (m === 'POST' && mt) {
      await i.loadPolicy(orgId);
      if (mt[2] === 'promote') return ok({ approval: await i.orchestrator.promoteApproval(actor, mt[1]) });
      const d = req.body?.decision; if (d !== 'approve' && d !== 'reject') return err(400, 'invalid_decision', 'decision must be approve or reject');
      return ok({ approval: await i.orchestrator.decideApproval(actor, mt[1], d, typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : undefined) });
    }
    if (m === 'GET' && path === '/audit') {
      const ev = await i.store.listAudit(orgId);
      return ok({ valid: verifyAuditChain(ev), total: ev.length, events: ev.slice(-Math.min(500, Number(one(req.query?.limit)) || 100)).reverse() });
    }
    mt = path.match(/^\/metrics\/([\w.:-]+)$/);
    if (m === 'GET' && mt) return ok({ key: mt[1], points: await metricHistory(i.db, orgId, mt[1]) });

    if (m === 'GET' && path === '/settings') return ok({ settings: await i.getSettings(orgId), mandatoryApprovalTypes: [...MANDATORY_APPROVAL_TYPES] });
    if (m === 'PUT' && path === '/settings') {
      if (!isAdmin) return err(403, 'forbidden', 'Only administrators can change autonomy and weighting');
      const parsed = parseSettings(req.body); if (typeof parsed === 'string') return err(400, 'invalid_settings', parsed);
      await i.saveSettings(orgId, parsed, actor.userId);
      await i.store.appendAudit({ orgId, at: i.now().toISOString(), actor: actor.userId, action: 'settings.updated', resource: 'intel_settings', resourceId: orgId, metadata: { autonomy: parsed.autonomy as unknown as Record<string, unknown>, weights: parsed.weights } });
      return ok({ settings: parsed });
    }
    return err(404, 'not_found', 'Unknown Intelligence route');
  } catch (e) {
    if (e instanceof OrchestratorError) {
      const status = e.code === 'forbidden' || e.code === 'forbidden_self_approval' ? 403 : e.code === 'not_found' || e.code === 'approval_not_found' ? 404 : e.code === 'invalid_state' || e.code === 'idempotency_conflict' ? 409 : 400;
      return err(status, e.code, e.message);
    }
    return err(500, 'internal_error', 'Internal error');
  }
}

const slim = (t: AgentTask) => ({ id: t.id, rootTaskId: t.rootTaskId, parentTaskId: t.parentTaskId, agentRole: t.agentRole, status: t.status, degraded: t.degraded, attempts: t.attempts, progress: t.progress, createdAt: t.createdAt, updatedAt: t.updatedAt, error: t.error, usage: t.usage, summary: t.result?.summary ?? null, findings: t.result?.findings.length ?? 0, confidence: t.result?.confidence ?? null });

function parseSettings(b: any): IntelSettings | string {
  if (!b || typeof b !== 'object') return 'Body must be an object';
  const a = b.autonomy ?? DEFAULT_SETTINGS.autonomy, w = b.weights ?? DEFAULT_SETTINGS.weights;
  const lvl = (v: unknown): v is AutonomyLevel => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 4;
  if (!lvl(a.defaultLevel)) return 'autonomy.defaultLevel must be an integer 0-4';
  const overrides: Record<string, AutonomyLevel> = {};
  for (const [k, v] of Object.entries(a.overrides ?? {})) {
    if (!/^[a-z_]{3,60}$/.test(k)) return `invalid action type ${k}`;
    if (!lvl(v)) return `autonomy level for ${k} must be 0-4`;
    if (MANDATORY_APPROVAL_TYPES.has(k) && v > 3) return `${k} always requires a human decision; its level cannot exceed 3`;
    overrides[k] = v;
  }
  const max = a.maxAutoPerWindow ?? 10; if (!Number.isInteger(max) || max < 0 || max > 100) return 'maxAutoPerWindow must be an integer 0-100';
  const keys = ['sales', 'financial', 'operations', 'data'] as const; const weights: any = {};
  for (const k of keys) { const v = w[k]; if (typeof v !== 'number' || !(v >= 0 && v <= 1)) return `weights.${k} must be a number 0-1`; weights[k] = v; }
  if (keys.every((k) => weights[k] === 0)) return 'at least one weight must be above 0';
  return { autonomy: { defaultLevel: a.defaultLevel, overrides, maxAutoPerWindow: max }, weights };
}

async function persistRun(i: Intelligence, orgId: string, root: AgentTask) {
  const nowIso = i.now().toISOString(), out = root.result as AgentOutput;
  const tree = await i.store.listTasks(orgId, { rootTaskId: root.rootTaskId });
  const stats = await persistFindings(i.db, orgId, out, tree, nowIso);
  const hs = (out.data as any)?.healthScore ?? tree.map((t) => (t.result?.data as any)?.healthScore).find(Boolean);
  if (hs) {
    await recordSnapshot(i.db, orgId, 'health.overall', hs.score, { coverage: hs.dataCoverage, reason: hs.reason ?? null }, nowIso, root.id);
    for (const d of hs.domains ?? []) await recordSnapshot(i.db, orgId, `health.domain.${d.domain}`, d.value, { effectiveWeight: d.effectiveWeight }, nowIso, root.id);
  }
  for (const t of tree) {
    const d = t.result?.data as any;
    if (t.agentRole === 'opportunity_pipeline' && d?.weightedPipelineByCurrency) for (const [cur, v] of Object.entries<any>(d.weightedPipelineByCurrency)) await recordSnapshot(i.db, orgId, `pipeline.weighted.${cur}`, v.weighted, { total: v.total, count: v.count }, nowIso, root.id);
    if (t.agentRole === 'financial_diagnostic' && d?.series) for (const s of d.series) await recordSnapshot(i.db, orgId, `revenue.booked90d.${s.currency}`, s.booked, { collected: s.collected, outstanding: s.outstanding, overdue: s.overdue }, nowIso, root.id);
    if (t.agentRole === 'data_quality' && d?.reliabilityScore != null) await recordSnapshot(i.db, orgId, 'data.reliability', d.reliabilityScore, {}, nowIso, root.id);
  }
  await recordSnapshot(i.db, orgId, 'findings.count', out.findings.length, { bySeverity: out.findings.reduce((a: Record<string, number>, f) => ((a[f.severity] = (a[f.severity] ?? 0) + 1), a), {}) }, nowIso, root.id);
  return stats;
}

async function overview(i: Intelligence, orgId: string) {
  const run = async (name: string, args: unknown = {}): Promise<any | null> => { try { return await i.tools.get(name)!.handler(args, { orgId, taskId: 'overview', signal: new AbortController().signal }); } catch { return null; } };
  const [rev, pipe, out, leads, act, tgt, quotes] = [await run('sales.revenue', { days: 90 }), await run('sales.pipeline'), await run('sales.outcomes', { days: 180 }), await run('sales.leads'), await run('sales.activities'), await run('sales.targets'), await run('sales.quotes')];
  const byCur = <T>(rows: T[] | undefined, pick: (r: T) => number) => (rows ?? []).map((r: any) => ({ currency: r.currency as string, value: pick(r) }));
  const kpi = (key: string, label: string, p: { values?: { currency: string; value: number }[]; value?: number | null; unit: 'money' | 'count' | 'percent' | 'days'; definition: string; formula: string; source: string; asOf?: string; period?: string; available: boolean; note?: string; href?: string }) => ({ key, label, ...p });
  const asOf = (x: any) => x?.asOf as string | undefined;
  const open = pipe?.opportunities ?? [];
  const curSet = [...new Set<string>(open.map((o: any) => o.currency))];
  const winRates = (out?.byCurrency ?? []).filter((c: any) => c.won + c.lost >= 5).map((c: any) => ({ currency: c.currency, value: Math.round((c.won / (c.won + c.lost)) * 1000) / 10 }));
  const kpis = [
    kpi('revenue_booked_90d', 'Booked revenue (90d)', { values: byCur(rev?.current, (r: any) => r.booked), unit: 'money', definition: 'Value of orders booked in the last 90 days (excl. draft and cancelled).', formula: 'sum(sales_orders.total) where booked_at in window', source: 'sales_orders', asOf: asOf(rev), period: 'last 90 days', available: !!rev, href: '/sales/orders' }),
    kpi('revenue_growth', 'Growth vs previous 90d', { values: (rev?.current ?? []).flatMap((c: any) => { const p = rev.previous.find((x: any) => x.currency === c.currency); return p && p.booked > 0 ? [{ currency: c.currency, value: Math.round(((c.booked - p.booked) / p.booked) * 1000) / 10 }] : []; }), unit: 'percent', definition: 'Change in booked revenue against the equal period before.', formula: '(current - previous) / previous', source: 'sales_orders', asOf: asOf(rev), available: !!rev && (rev.previous ?? []).length > 0, note: rev && !(rev.previous ?? []).length ? 'No bookings in the previous period to compare against.' : undefined }),
    kpi('collected_90d', 'Collected (90d)', { values: byCur(rev?.current, (r: any) => r.collected), unit: 'money', definition: 'Cash recorded against orders booked in the window.', formula: 'sum(paid_total)', source: 'sales_orders', asOf: asOf(rev), available: !!rev }),
    kpi('receivables_overdue', 'Overdue receivables', { values: byCur(rev?.outstanding, (r: any) => r.overdue_amount), unit: 'money', definition: 'Unpaid/partial order balances past their invoice due date.', formula: 'sum(total - paid - returned) where invoice_due_on < today', source: 'sales_orders', asOf: asOf(rev), available: !!rev, href: '/sales/orders' }),
    kpi('open_pipeline', 'Open pipeline', { values: curSet.map((c) => ({ currency: c, value: open.filter((o: any) => o.currency === c).reduce((s: number, o: any) => s + o.amount, 0) })), unit: 'money', definition: 'Total value of open opportunities.', formula: 'sum(amount) where status = open', source: 'sales_opportunities', asOf: asOf(pipe), available: !!pipe, href: '/sales/pipeline' }),
    kpi('weighted_pipeline', 'Weighted pipeline', { values: curSet.map((c) => ({ currency: c, value: Math.round(open.filter((o: any) => o.currency === c).reduce((s: number, o: any) => s + o.amount * (o.probability / 100), 0)) })), unit: 'money', definition: 'Open pipeline weighted by each deal\'s recorded probability. Not guaranteed revenue.', formula: 'sum(amount x probability)', source: 'sales_opportunities', asOf: asOf(pipe), available: !!pipe, href: '/sales/forecasting' }),
    kpi('win_rate_180d', 'Win rate (180d)', { values: winRates, unit: 'percent', definition: 'Won / (won + lost) for deals closed in 180 days; shown only with 5+ closed deals.', formula: 'won / (won + lost)', source: 'sales_opportunities', asOf: asOf(out), available: !!out && winRates.length > 0, note: out && !winRates.length ? 'Fewer than 5 closed deals: not reported.' : undefined }),
    kpi('leads_open', 'Open leads', { value: leads?.counts?.open_leads ?? null, unit: 'count', definition: 'Leads not converted or disqualified.', formula: 'count(status not in converted, disqualified)', source: 'sales_leads', asOf: asOf(leads), available: !!leads, href: '/sales/leads' }),
    kpi('leads_stale', 'Stale leads (7d+)', { value: leads?.counts?.stale ?? null, unit: 'count', definition: 'Open leads with no contact for 7+ days.', formula: 'last_contact_at (else created_at) < now - 7d', source: 'sales_leads', asOf: asOf(leads), available: !!leads, href: '/sales/leads' }),
    kpi('activities_overdue', 'Overdue activities', { value: act?.totals?.overdue ?? null, unit: 'count', definition: 'Open activities past their due time.', formula: "count(status = open and due_at < now)", source: 'sales_activities', asOf: asOf(act), available: !!act, href: '/sales/activities' }),
    kpi('quotes_expired_open', 'Expired open quotes', { value: quotes?.expiredOpen?.length ?? null, unit: 'count', definition: 'Quotations past validity but still sent/viewed/approved (first 25 shown).', formula: 'validity_date < today and status in sent, viewed, approved', source: 'sales_quotations', asOf: asOf(quotes), available: !!quotes, href: '/sales/quotations' }),
    kpi('target_attainment', 'Target attainment', { value: tgt?.period && tgt.actualByCurrency.length <= 1 ? Math.round(((tgt.actualByCurrency[0]?.booked ?? 0) / tgt.period.target) * 1000) / 10 : null, unit: 'percent', definition: 'Booked revenue against the approved company revenue target for the current period.', formula: 'booked / target', source: 'sales_targets + sales_orders', asOf: asOf(tgt), period: tgt?.period?.name, available: !!tgt?.period && tgt.actualByCurrency.length <= 1, note: !tgt ? undefined : !tgt.period ? 'No approved company revenue target covers today.' : tgt.actualByCurrency.length > 1 ? 'Multiple currencies in period; attainment needs a single currency.' : undefined, href: '/sales/targets' }),
  ];
  const open_f = await listFindings(i.db, orgId, { limit: 500 });
  const live = open_f.filter((f) => ['open', 'acknowledged', 'in_progress'].includes(f.workflowStatus));
  const health = (await metricHistory(i.db, orgId, 'health.overall', 30));
  const lastHealth = health[health.length - 1] ?? null;
  const approvals = await i.store.listApprovals(orgId);
  const tasks = await i.store.listTasks(orgId, {});
  const roots = tasks.filter((t) => t.parentTaskId === null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    generatedAt: i.now().toISOString(), aiConfigured: i.llm.configured, kpis,
    findings: { openBySeverity: live.reduce((a: Record<string, number>, f) => ((a[f.severity] = (a[f.severity] ?? 0) + 1), a), {}), open: live.length, criticalUnresolved: live.filter((f) => f.severity === 'CRITICAL').length },
    health: lastHealth ? { score: lastHealth.value, takenAt: lastHealth.taken_at, coverage: lastHealth.meta?.coverage ?? null, reason: lastHealth.meta?.reason ?? null, trend: health.map((h: any) => ({ at: h.taken_at, value: h.value })) } : null,
    approvals: { awaiting: approvals.filter((a) => a.status === 'pending').length, prepared: approvals.filter((a) => a.status === 'prepared').length, executed: approvals.filter((a) => a.status === 'executed').length, failed: approvals.filter((a) => a.status === 'failed').length },
    lastRun: roots[0] ? slim(roots[0]) : null,
  };
}
