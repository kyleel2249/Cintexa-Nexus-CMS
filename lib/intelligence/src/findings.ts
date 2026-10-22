import type { AgentOutput, AgentTask, Finding } from './types';
import type { IntelDb } from './sql-store';
import { ensureIntelSchema } from './sql-store';
import { sha256 } from './store';

const OPEN = ['open', 'acknowledged', 'in_progress'];
export const WORKFLOW_STATUSES = ['open', 'acknowledged', 'in_progress', 'resolved', 'dismissed'] as const;
const fid = (orgId: string, fp: string) => `fnd_${sha256(`${orgId}\n${fp}`).slice(0, 20)}`;

export interface FindingRow {
  id: string; fingerprint: string; category: string; severity: string; evidenceStatus: string; workflowStatus: string; owner: string | null; dueDate: string | null;
  firstSeen: string; lastSeen: string; lastTaskId: string | null; finding: Finding; history: { at: string; event: string; detail?: unknown }[];
}
const toRow = (r: any): FindingRow => ({ id: r.id, fingerprint: r.fingerprint, category: r.category, severity: r.severity, evidenceStatus: r.evidence_status, workflowStatus: r.workflow_status, owner: r.owner, dueDate: r.due_date, firstSeen: r.first_seen, lastSeen: r.last_seen, lastTaskId: r.last_task_id, finding: r.data, history: r.history ?? [] });

/**
 * Records what a run observed. New ids are created, re-observed ids are refreshed (a resolved one is re-opened and says so),
 * and open findings that belong to an analyst that completed with data but did NOT re-observe them are marked resolved
 * "by reassessment" - an analyst that failed, degraded or had no data never resolves anything.
 */
export async function persistFindings(db: IntelDb, orgId: string, root: AgentOutput, tree: AgentTask[], nowIso: string): Promise<{ created: number; updated: number; reopened: number; resolved: number }> {
  await ensureIntelSchema(db);
  const out = { created: 0, updated: 0, reopened: 0, resolved: 0 };
  const observed = new Set<string>();
  for (const x of root.findings) {
    observed.add(x.id);
    const cur = (await db.query<any>(`SELECT * FROM intel_findings WHERE org_id=$1 AND fingerprint=$2`, [orgId, x.id])).rows[0];
    if (!cur) {
      await db.query(`INSERT INTO intel_findings (id, org_id, fingerprint, category, severity, evidence_status, workflow_status, first_seen, last_seen, last_task_id, data, history)
        VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$7,$8,$9::jsonb,$10::jsonb)`, [fid(orgId, x.id), orgId, x.id, x.category, x.severity, x.status, nowIso, root.taskId, JSON.stringify(x), JSON.stringify([{ at: nowIso, event: 'detected', detail: { severity: x.severity } }])]);
      out.created++; continue;
    }
    const hist = [...(cur.history ?? [])] as any[];
    let wf = cur.workflow_status as string;
    if (wf === 'resolved') { wf = 'open'; hist.push({ at: nowIso, event: 'reopened', detail: 'observed again after being resolved' }); out.reopened++; }
    else out.updated++;
    if (cur.severity !== x.severity) hist.push({ at: nowIso, event: 'severity_changed', detail: { from: cur.severity, to: x.severity } });
    await db.query(`UPDATE intel_findings SET category=$3, severity=$4, evidence_status=$5, workflow_status=$6, last_seen=$7, last_task_id=$8, data=$9::jsonb, history=$10::jsonb WHERE org_id=$1 AND id=$2`,
      [orgId, cur.id, x.category, x.severity, x.status, wf, nowIso, root.taskId, JSON.stringify(x), JSON.stringify(hist.slice(-50))]);
  }
  const reassessed = tree.filter((t) => t.status === 'succeeded' && t.result?.status === 'ok' && Number((t.result.data as any)?.coverage ?? 0) > 0 && !['sales_director', 'business_diagnostic_director', 'website_director', 'chief_executive', 'recommendation_planner'].includes(t.agentRole)).map((t) => t.agentRole);
  for (const role of reassessed) {
    const rows = (await db.query<any>(`SELECT id, fingerprint, history FROM intel_findings WHERE org_id=$1 AND workflow_status = ANY($2::text[]) AND fingerprint LIKE $3`, [orgId, OPEN, `${role}.%`])).rows;
    for (const r of rows) {
      if (observed.has(r.fingerprint)) continue;
      const hist = [...(r.history ?? []), { at: nowIso, event: 'resolved_by_reassessment', detail: { agent: role, taskId: root.taskId } }];
      await db.query(`UPDATE intel_findings SET workflow_status='resolved', history=$3::jsonb WHERE org_id=$1 AND id=$2`, [orgId, r.id, JSON.stringify(hist.slice(-50))]);
      out.resolved++;
    }
  }
  return out;
}

export async function listFindings(db: IntelDb, orgId: string, f: { workflowStatus?: string; severity?: string; limit?: number } = {}): Promise<FindingRow[]> {
  await ensureIntelSchema(db);
  const rows = (await db.query<any>(`SELECT * FROM intel_findings WHERE org_id=$1 AND ($2::text IS NULL OR workflow_status=$2) AND ($3::text IS NULL OR severity=$3)
    ORDER BY CASE severity WHEN 'CRITICAL' THEN 5 WHEN 'HIGH' THEN 4 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 2 ELSE 1 END DESC, last_seen DESC, id LIMIT $4`,
    [orgId, f.workflowStatus ?? null, f.severity ?? null, Math.min(500, f.limit ?? 200)])).rows;
  return rows.map(toRow);
}

export async function updateFinding(db: IntelDb, orgId: string, id: string, patch: { workflowStatus?: string; owner?: string | null; dueDate?: string | null; note?: string }, actor: string, nowIso: string): Promise<FindingRow | null> {
  await ensureIntelSchema(db);
  const cur = (await db.query<any>(`SELECT * FROM intel_findings WHERE org_id=$1 AND id=$2`, [orgId, id])).rows[0];
  if (!cur) return null;
  const hist = [...(cur.history ?? [])] as any[];
  if (patch.workflowStatus && patch.workflowStatus !== cur.workflow_status) hist.push({ at: nowIso, event: 'status_changed', detail: { from: cur.workflow_status, to: patch.workflowStatus, by: actor, note: patch.note ?? null } });
  if (patch.owner !== undefined && patch.owner !== cur.owner) hist.push({ at: nowIso, event: 'owner_changed', detail: { to: patch.owner, by: actor } });
  if (patch.dueDate !== undefined && patch.dueDate !== cur.due_date) hist.push({ at: nowIso, event: 'due_date_changed', detail: { to: patch.dueDate, by: actor } });
  const r = (await db.query<any>(`UPDATE intel_findings SET workflow_status=$3, owner=$4, due_date=$5, history=$6::jsonb WHERE org_id=$1 AND id=$2 RETURNING *`,
    [orgId, id, patch.workflowStatus ?? cur.workflow_status, patch.owner === undefined ? cur.owner : patch.owner, patch.dueDate === undefined ? cur.due_date : patch.dueDate, JSON.stringify(hist.slice(-50))])).rows[0];
  return toRow(r);
}

export async function recordSnapshot(db: IntelDb, orgId: string, key: string, value: number | null, meta: Record<string, unknown>, nowIso: string, taskId: string | null): Promise<void> {
  await ensureIntelSchema(db);
  await db.query(`INSERT INTO intel_metric_snapshots (org_id, metric_key, value, meta, taken_at, task_id) VALUES ($1,$2,$3,$4::jsonb,$5,$6)`, [orgId, key, value, JSON.stringify(meta), nowIso, taskId]);
}
export async function metricHistory(db: IntelDb, orgId: string, key: string, limit = 90) {
  await ensureIntelSchema(db);
  return (await db.query<any>(`SELECT value::float8 value, meta, taken_at FROM intel_metric_snapshots WHERE org_id=$1 AND metric_key=$2 ORDER BY taken_at DESC LIMIT $3`, [orgId, key, Math.min(500, limit)])).rows.reverse();
}
