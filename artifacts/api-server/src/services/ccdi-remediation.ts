/**
 * CINTEXA CCDI — Phase 16 Remediation Workflow & Finding Assignment
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import * as webhooks from "./ccdi-webhooks";

const TASK_STATUSES = ["open", "in_progress", "completed", "cancelled", "deferred"] as const;
const PRIORITIES = ["low", "medium", "high", "critical"] as const;

export async function createRemediationTask(opts: {
  organizationId: string;
  findingId?: string | null;
  title: string;
  description?: string;
  priority?: string;
  assigneeRef?: string;
  dueDate?: string;
  createdBy: string;
}) {
  if (!opts.title?.trim()) return { error: "title is required", status: 400 as const };
  const priority = PRIORITIES.includes(opts.priority as any) ? opts.priority : "medium";

  if (opts.findingId) {
    const { rows } = await pool.query(
      `SELECT id FROM ccdi_findings WHERE id = $1 AND organization_id = $2`,
      [opts.findingId, opts.organizationId],
    );
    if (!rows[0]) return { error: "Finding not found in organisation", status: 404 as const };
  }

  const { rows } = await pool.query(
    `INSERT INTO ccdi_remediation_tasks
       (organization_id, finding_id, title, description, priority, assignee_ref, due_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      opts.organizationId,
      opts.findingId ?? null,
      opts.title.trim(),
      opts.description ?? null,
      priority,
      opts.assigneeRef ?? null,
      opts.dueDate ?? null,
      opts.createdBy,
    ],
  );

  if (opts.findingId) {
    await pool.query(
      `UPDATE ccdi_findings SET status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
         owner_ref = COALESCE(owner_ref, $3),
         updated_at = now()
       WHERE id = $1 AND organization_id = $2`,
      [opts.findingId, opts.organizationId, opts.assigneeRef ?? null],
    );
  }

  await pool.query(
    `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, action, entity_type, entity_id, meta)
     VALUES ($1,$2,'remediation.create','remediation_task',$3,$4)`,
    [
      opts.organizationId,
      opts.createdBy,
      rows[0].id,
      JSON.stringify({ findingId: opts.findingId, priority }),
    ],
  );

  await webhooks
    .emitCcdiEvent({
      organizationId: opts.organizationId,
      eventType: "finding.updated",
      data: { remediationTaskId: rows[0].id, findingId: opts.findingId, action: "remediation.create" },
    })
    .catch(() => undefined);

  return { task: rows[0] };
}

export async function listRemediationTasks(opts: {
  organizationId: string;
  status?: string;
  assigneeRef?: string;
  findingId?: string;
  limit?: number;
}) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const params: any[] = [opts.organizationId];
  let where = `WHERE organization_id = $1`;
  if (opts.status) {
    params.push(opts.status);
    where += ` AND status = $${params.length}`;
  }
  if (opts.assigneeRef) {
    params.push(opts.assigneeRef);
    where += ` AND assignee_ref = $${params.length}`;
  }
  if (opts.findingId) {
    params.push(opts.findingId);
    where += ` AND finding_id = $${params.length}`;
  }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT * FROM ccdi_remediation_tasks ${where}
     ORDER BY
       CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       due_date NULLS LAST,
       created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

export async function updateRemediationTask(opts: {
  taskId: string;
  organizationId: string;
  actor: string;
  status?: string;
  priority?: string;
  assigneeRef?: string | null;
  dueDate?: string | null;
  title?: string;
  description?: string | null;
}) {
  const { rows: existing } = await pool.query(
    `SELECT * FROM ccdi_remediation_tasks WHERE id = $1 AND organization_id = $2`,
    [opts.taskId, opts.organizationId],
  );
  if (!existing[0]) return { error: "Task not found", status: 404 as const };

  if (opts.status && !TASK_STATUSES.includes(opts.status as any)) {
    return { error: "Invalid status", status: 400 as const };
  }
  if (opts.priority && !PRIORITIES.includes(opts.priority as any)) {
    return { error: "Invalid priority", status: 400 as const };
  }

  const { rows } = await pool.query(
    `UPDATE ccdi_remediation_tasks SET
       status = COALESCE($3, status),
       priority = COALESCE($4, priority),
       assignee_ref = CASE WHEN $5::boolean THEN $6 ELSE assignee_ref END,
       due_date = CASE WHEN $7::boolean THEN $8::date ELSE due_date END,
       title = COALESCE($9, title),
       description = CASE WHEN $10::boolean THEN $11 ELSE description END,
       completed_at = CASE
         WHEN $3 = 'completed' THEN COALESCE(completed_at, now())
         WHEN $3 IS NOT NULL AND $3 <> 'completed' THEN NULL
         ELSE completed_at
       END,
       updated_at = now()
     WHERE id = $1 AND organization_id = $2
     RETURNING *`,
    [
      opts.taskId,
      opts.organizationId,
      opts.status ?? null,
      opts.priority ?? null,
      opts.assigneeRef !== undefined,
      opts.assigneeRef ?? null,
      opts.dueDate !== undefined,
      opts.dueDate ?? null,
      opts.title ?? null,
      opts.description !== undefined,
      opts.description ?? null,
    ],
  );

  if (opts.status === "completed" && existing[0].finding_id) {
    await pool.query(
      `UPDATE ccdi_findings SET status = 'resolved', resolved_at = COALESCE(resolved_at, now()), updated_at = now()
       WHERE id = $1 AND organization_id = $2 AND status IN ('open','confirmed','in_progress')`,
      [existing[0].finding_id, opts.organizationId],
    );
  }

  await pool.query(
    `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, action, entity_type, entity_id, meta)
     VALUES ($1,$2,'remediation.update','remediation_task',$3,$4)`,
    [
      opts.organizationId,
      opts.actor,
      opts.taskId,
      JSON.stringify({ status: opts.status, priority: opts.priority, assigneeRef: opts.assigneeRef }),
    ],
  );

  return { task: rows[0] };
}

export async function assignFinding(opts: {
  findingId: string;
  organizationId: string;
  ownerRef: string;
  actor: string;
  createTask?: boolean;
}) {
  const { rows } = await pool.query(
    `UPDATE ccdi_findings SET owner_ref = $3, updated_at = now()
     WHERE id = $1 AND organization_id = $2
     RETURNING *`,
    [opts.findingId, opts.organizationId, opts.ownerRef],
  );
  if (!rows[0]) return { error: "Finding not found", status: 404 as const };

  await pool.query(
    `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, action, entity_type, entity_id, meta)
     VALUES ($1,$2,'finding.assign','finding',$3,$4)`,
    [opts.organizationId, opts.actor, opts.findingId, JSON.stringify({ ownerRef: opts.ownerRef })],
  );

  let task = null as unknown;
  if (opts.createTask) {
    const created = await createRemediationTask({
      organizationId: opts.organizationId,
      findingId: opts.findingId,
      title: `Remediate: ${rows[0].title}`,
      description: rows[0].remediation || rows[0].description,
      priority: ["critical", "high"].includes(rows[0].severity) ? rows[0].severity : "medium",
      assigneeRef: opts.ownerRef,
      createdBy: opts.actor,
    });
    if ("task" in created) task = created.task;
  }

  return { finding: rows[0], task };
}

export async function remediationSummary(organizationId: string) {
  const { rows } = await pool.query(
    `SELECT
       count(*)::int AS total,
       count(*) FILTER (WHERE status = 'open')::int AS open,
       count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
       count(*) FILTER (WHERE status = 'completed')::int AS completed,
       count(*) FILTER (WHERE status = 'deferred')::int AS deferred,
       count(*) FILTER (WHERE due_date < CURRENT_DATE AND status IN ('open','in_progress'))::int AS overdue
     FROM ccdi_remediation_tasks WHERE organization_id = $1`,
    [organizationId],
  );
  return rows[0] ?? { total: 0, open: 0, in_progress: 0, completed: 0, deferred: 0, overdue: 0 };
}

logger.info("CCDI Phase 16 remediation service loaded");
