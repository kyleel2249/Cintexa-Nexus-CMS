import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { SALES_SCHEMA_STATEMENTS } from '../../db/src/sales-schema';
import { createIntelligence, handleIntelligence, decideDisposition, staticPolicy, portableSha256, verifyAuditChain } from '../src/index';
import type { Actor, Intelligence } from '../src/index';

const NOW = new Date('2026-10-22T12:00:00Z');
const admin: Actor = { userId: 'u-admin', orgId: 'default', roles: ['admin', 'manager', 'staff'] };
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

async function boot(): Promise<{ i: Intelligence; pg: PGlite }> {
  const pg = new PGlite();
  for (const s of SALES_SCHEMA_STATEMENTS) await pg.query(s);
  const q = (s: string, p?: unknown[]) => pg.query(s, p);
  await q(`INSERT INTO sales_pipelines (id, name, is_default) VALUES (1,'Main',true)`);
  await q(`INSERT INTO sales_pipeline_stages (id, pipeline_id, name, position, probability, kind, stalled_after_days) VALUES
    (1,1,'Qualify',1,20,'open',14),(2,1,'Proposal',2,50,'open',14),(3,1,'Won',3,100,'won',14),(4,1,'Lost',4,0,'lost',14)`);
  await q(`INSERT INTO sales_accounts (id, number, name, status, expected_reorder_on) VALUES (1,'A1','Acme','active','2026-09-01'),(2,'A2','Beta','active',NULL)`);
  for (let n = 1; n <= 12; n++) await q(`INSERT INTO sales_leads (number, first_name, status, score, created_at) VALUES ($1,$2,'new',$3,$4)`, [`L${n}`, `Lead${n}`, n * 5, ago(20)]);
  await q(`UPDATE sales_leads SET next_follow_up_at=$1 WHERE number='L12'`, [ago(2)]);
  for (let n = 1; n <= 3; n++) await q(`INSERT INTO sales_opportunities (number, name, account_id, pipeline_id, stage_id, amount, currency, probability, expected_close_date, close_date_changes, created_at)
    VALUES ($1,$2,1,1,1,10000,'USD',20,'2026-09-30',$3,$4)`, [`O${n}`, `Deal ${n}`, n === 1 ? 3 : 0, ago(40)]);
  for (let n = 1; n <= 6; n++) await q(`INSERT INTO sales_opportunities (number, name, account_id, pipeline_id, stage_id, status, amount, probability, closed_at, created_at, lost_reason)
    VALUES ($1,$2,2,1,$3,$4,5000,0,$5,$6,$7)`, [`C${n}`, `Closed ${n}`, n <= 2 ? 3 : 4, n <= 2 ? 'won' : 'lost', ago(30), ago(60), n <= 2 ? null : 'price']);
  const order = (num: string, total: number, booked: string, pay: string, paid: number, due: string | null) => q(
    `INSERT INTO sales_orders (number, account_id, status, total, paid_total, payment_status, booked_at, invoice_due_on) VALUES ($1,1,'confirmed',$2,$3,$4,$5,$6)`, [num, total, paid, pay, booked, due]);
  await order('S1', 4000, ago(10), 'unpaid', 0, '2026-10-01');
  await order('S2', 3000, ago(30), 'paid', 3000, null);
  await order('S3', 3000, ago(50), 'paid', 3000, null);
  await order('S4', 20000, ago(120), 'paid', 20000, null);
  const i = createIntelligence({ db: { query: (s, p) => q(s, p) as never }, now: () => NOW });
  return { i, pg };
}
const call = (i: Intelligence, method: string, rawPath: string, body?: unknown, actor: Actor | null = admin, headers: Record<string, string> = {}) => {
  const [path, qs = ''] = rawPath.split('?');
  return handleIntelligence(i, { method, path, query: Object.fromEntries(new URLSearchParams(qs)), body, actor, headers });
};

test('portable sha256 matches node crypto', () => {
  for (const s of ['', 'abc', 'x'.repeat(1000), 'héllo ✓']) assert.equal(portableSha256(s), createHash('sha256').update(s).digest('hex'));
});

test('autonomy: level 4 never auto-executes mandatory-approval actions', () => {
  const action = { type: 'send_external_communication', summary: 's', payload: {}, risk: 'low' as const, reversible: true };
  assert.equal(decideDisposition(action, 4, staticPolicy(4)).disposition, 'needs_approval');
  assert.equal(decideDisposition({ ...action, type: 'create_followup_activity' }, 4, staticPolicy(4)).disposition, 'auto_execute');
  assert.equal(decideDisposition({ ...action, type: 'create_followup_activity' }, 1, staticPolicy(4)).disposition, 'recommend');
});

test('authentication and role gates', async () => {
  const { i } = await boot();
  assert.equal((await call(i, 'GET', '/overview', undefined, null)).status, 401);
  assert.equal((await call(i, 'GET', '/overview', undefined, { userId: 'x', orgId: 'default', roles: [] })).status, 403);
  assert.equal((await call(i, 'PUT', '/settings', {}, { userId: 'e', orgId: 'default', roles: ['staff'] })).status, 403);
});

test('executive run: real findings, honest degradation, reassessment, approvals, audit chain', async () => {
  const { i, pg } = await boot();
  const run = await call(i, 'POST', '/runs', {}, admin, { 'idempotency-key': 'k1' });
  assert.equal(run.status, 201, JSON.stringify(run.body));
  const { task } = run.body as any;
  assert.equal(task.status, 'succeeded');
  const ids: string[] = task.result.findings.map((f: any) => f.id);
  for (const id of ['lead_intelligence.stale_leads', 'opportunity_pipeline.stalled', 'opportunity_pipeline.past_close_date', 'financial_diagnostic.overdue_receivables:USD']) assert.ok(ids.includes(id), `missing ${id}; got ${ids.join(', ')}`);
  const stale = task.result.findings.find((f: any) => f.id === 'lead_intelligence.stale_leads');
  assert.equal(stale.severity, 'HIGH'); assert.equal(stale.status, 'confirmed'); assert.ok(stale.evidence.length > 0);
  // website audit tool is not registered here: reported as unavailable, run marked degraded, nothing invented
  assert.equal(task.result.status, 'degraded');
  assert.ok(task.result.uncertainties.some((u: string) => u.includes('Website audit history is not available')));
  assert.ok(task.result.uncertainties.some((u: string) => u.includes('AI narrative is not configured')));
  assert.equal(task.result.data.narrative, null);
  assert.equal(task.result.data.healthScore.domains.length, 4);
  const tree = (await call(i, 'GET', `/tasks/${task.id}`)).body as any;
  const degradedRoles = tree.tree.filter((t: any) => t.degraded).map((t: any) => t.agentRole).sort();
  assert.deepEqual(degradedRoles, ['chief_executive', 'website_audit', 'website_director'], `unexpected degraded agents: ${degradedRoles}`);
  // weighted pipeline is exactly sum(value x probability) = 3 x 10000 x 0.2
  const pipe = tree.tree.find((t: any) => t.agentRole === 'opportunity_pipeline');
  const pipeTask = (await call(i, 'GET', `/tasks/${pipe.id}`)).body as any;
  assert.equal(pipeTask.task.result.data.weightedPipelineByCurrency.USD.weighted, 6000);
  // idempotency: same key + same request returns the same task
  const again = await call(i, 'POST', '/runs', {}, admin, { 'idempotency-key': 'k1' });
  assert.equal((again.body as any).task.id, task.id);

  // overview shows computed KPIs with definitions and sources
  const ov = (await call(i, 'GET', '/overview')).body as any;
  const wp = ov.kpis.find((k: any) => k.key === 'weighted_pipeline');
  assert.equal(wp.values[0].value, 6000); assert.ok(wp.definition && wp.formula && wp.source);
  assert.equal(ov.kpis.find((k: any) => k.key === 'target_attainment').available, false);
  assert.ok(ov.findings.open > 0);

  // approvals: default autonomy level 2 prepares, never executes
  const prepared = ((await call(i, 'GET', '/approvals?status=prepared')).body as any).approvals;
  assert.ok(prepared.length > 0);
  assert.equal((await pg.query(`SELECT COUNT(*)::int n FROM sales_activities`)).rows[0].n, 0);
  const apr = prepared[0];
  assert.equal((await call(i, 'POST', `/approvals/${apr.id}/decide`, { decision: 'approve' })).status, 409); // must be promoted first
  assert.equal((await call(i, 'POST', `/approvals/${apr.id}/promote`)).status, 200);
  assert.equal((await call(i, 'POST', `/approvals/${apr.id}/decide`, { decision: 'approve' }, { userId: 'v', orgId: 'default', roles: ['viewer'] })).status, 403);
  const decided = await call(i, 'POST', `/approvals/${apr.id}/decide`, { decision: 'approve', note: 'ok' });
  assert.equal((decided.body as any).approval.status, 'executed');
  assert.equal((await pg.query(`SELECT COUNT(*)::int n FROM sales_activities WHERE type='follow_up'`)).rows[0].n, 1);
  assert.equal((await call(i, 'POST', `/approvals/${apr.id}/decide`, { decision: 'approve' })).status, 409); // no double execution
  assert.equal((await pg.query(`SELECT COUNT(*)::int n FROM sales_activities`)).rows[0].n, 1);

  // reassessment: fix the data, re-run, the stale-lead finding is resolved by reassessment (not deleted)
  await pg.query(`UPDATE sales_leads SET last_contact_at=$1, next_follow_up_at=NULL`, [ago(1)]);
  const run2 = await call(i, 'POST', '/runs', {}); assert.equal(run2.status, 201);
  const fnd = ((await call(i, 'GET', '/findings?status=resolved')).body as any).findings;
  const resolved = fnd.find((f: any) => f.fingerprint === 'lead_intelligence.stale_leads');
  assert.ok(resolved); assert.ok(resolved.history.some((h: any) => h.event === 'resolved_by_reassessment'));
  const open = ((await call(i, 'GET', '/findings?status=open')).body as any).findings;
  assert.ok(open.some((f: any) => f.fingerprint === 'opportunity_pipeline.stalled'));
  // a finding can be owned and tracked
  const upd = await call(i, 'PATCH', `/findings/${open[0].id}`, { workflowStatus: 'in_progress', owner: 'Ama', dueDate: '2026-11-05' });
  assert.equal((upd.body as any).finding.workflowStatus, 'in_progress');
  assert.equal((await call(i, 'PATCH', `/findings/${open[0].id}`, { workflowStatus: 'bogus' })).status, 400);
  // health trend is recorded
  assert.equal(((await call(i, 'GET', '/metrics/health.overall')).body as any).points.length, 2);

  // audit chain verifies, and tampering is detected
  const audit = (await call(i, 'GET', '/audit?limit=500')).body as any;
  assert.equal(audit.valid, true); assert.ok(audit.total > 20);
  await pg.query(`UPDATE intel_audit SET actor='intruder' WHERE seq = (SELECT min(seq) FROM intel_audit)`);
  assert.equal(verifyAuditChain(await i.store.listAudit('default')), false);
  const gov = await i.orchestrator.submit(admin, { agentRole: 'security_governance', input: {} });
  const g = await i.orchestrator.runToCompletion('default', gov.id);
  assert.ok(g.result!.findings.some((f) => f.id === 'security_governance.audit_chain_broken' && f.severity === 'CRITICAL'));
});

test('tenant isolation and settings validation', async () => {
  const { i } = await boot();
  const run = await call(i, 'POST', '/runs', { agentRole: 'data_quality' });
  const id = (run.body as any).task.id;
  const other: Actor = { userId: 'u2', orgId: 'org-b', roles: ['admin', 'manager', 'staff'] };
  assert.equal((await call(i, 'GET', `/tasks/${id}`, undefined, other)).status, 404);
  assert.equal(((await call(i, 'GET', '/tasks', undefined, other)).body as any).tasks.length, 0);
  assert.equal(((await call(i, 'GET', '/audit', undefined, other)).body as any).total, 0);
  assert.equal((await call(i, 'PUT', '/settings', { autonomy: { defaultLevel: 2, overrides: { send_external_communication: 4 } } })).status, 400);
  assert.equal((await call(i, 'PUT', '/settings', { autonomy: { defaultLevel: 9 } })).status, 400);
  assert.equal((await call(i, 'PUT', '/settings', { autonomy: { defaultLevel: 3, overrides: { create_followup_activity: 4 }, maxAutoPerWindow: 2 }, weights: { sales: 1, financial: 0, operations: 0, data: 0 } })).status, 200);
  assert.equal(((await call(i, 'GET', '/settings')).body as any).settings.autonomy.defaultLevel, 3);
});

test('mandatory actions need a human and never report fake success; unauthorised agent tools are refused', async () => {
  const { i } = await boot();
  i.agents.register({ role: 'test_comms', title: 't', description: 't', domain: 'test', tools: ['sales.leads'], inputSchema: { type: 'object', props: {}, optional: [], loose: true }, completionCriteria: [], autonomyCeiling: 3, maxCostUsd: 1,
    async handler() { return { confidence: 1, recommendedActions: [{ type: 'send_external_communication', summary: 'email', payload: {}, risk: 'high', reversible: false }] }; } });
  await i.loadPolicy('default'); await i.saveSettings('default', { autonomy: { defaultLevel: 4, overrides: {}, maxAutoPerWindow: 10 }, weights: { sales: 1, financial: 1, operations: 1, data: 1 } }, 'u');
  const t = await i.orchestrator.submit(admin, { agentRole: 'test_comms', input: {} });
  const done = await i.orchestrator.runToCompletion('default', t.id);
  const aprId = (done.result!.data as any).approvalIds[0];
  const pending = await i.store.getApproval('default', aprId);
  assert.equal(pending!.status, 'pending'); assert.equal(pending!.requestedBy, 'agent:test_comms');
  const d = await i.orchestrator.decideApproval(admin, aprId, 'approve');
  assert.equal(d.status, 'failed'); assert.equal(d.executionResult!.detail, 'no_executor_configured');
  // an agent cannot call tools outside its allowlist or supply a tenant id
  i.agents.register({ role: 'test_rogue', title: 'r', description: 'r', domain: 'test', tools: ['sales.leads'], inputSchema: { type: 'object', props: {}, optional: [], loose: true }, completionCriteria: [], autonomyCeiling: 1, maxCostUsd: 1, maxAttempts: 1,
    async handler(ctx) { await ctx.callTool('sales.revenue', {}); return { confidence: 1 }; } });
  const r = await i.orchestrator.runToCompletion('default', (await i.orchestrator.submit(admin, { agentRole: 'test_rogue', input: {} })).id);
  assert.equal(r.status, 'failed'); assert.match(r.error!, /tool_not_permitted/);
});
