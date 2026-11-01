/**
 * CINTEXA CCDI — Phase 8 Isolated Worker Foundations
 *
 * Provides a safe job claim / heartbeat / complete protocol for future
 * isolated workers. No scanner binaries are executed here.
 *
 * Workers must:
 * 1. Respect kill-switch
 * 2. Only claim jobs that are queued and approved
 * 3. Heartbeat while running
 * 4. Write evidence metadata on completion
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import * as orch from "./ccdi-orchestration";

export async function claimNextJob(workerId: string, organizationId?: string) {
  if (await orch.isKillSwitchActive()) {
    return { error: "Kill switch active — no jobs may be claimed", status: 503 as const };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const params: any[] = [];
    let orgClause = "";
    if (organizationId) {
      params.push(organizationId);
      orgClause = `AND organization_id = $${params.length}`;
    }

    const { rows: jobs } = await client.query(
      `SELECT id, organization_id, name, job_type, parameters, targets, max_runtime_seconds
       FROM ccdi_jobs
       WHERE status = 'queued' AND cancel_requested = false ${orgClause}
       ORDER BY priority DESC, queued_at ASC NULLS LAST
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      params,
    );

    if (!jobs[0]) {
      await client.query("COMMIT");
      return { job: null };
    }

    const job = jobs[0];

    await client.query(
      `UPDATE ccdi_jobs
       SET status = 'running', started_at = now(), updated_at = now()
       WHERE id = $1`,
      [job.id],
    );

    const { rows: execs } = await client.query(
      `INSERT INTO ccdi_executions (job_id, organization_id, worker_id, status, started_at)
       VALUES ($1, $2, $3, 'running', now())
       RETURNING *`,
      [job.id, job.organization_id, workerId],
    );

    await client.query("COMMIT");

    logger.info({ jobId: job.id, workerId }, "ccdi.worker.claimed");

    return {
      job,
      execution: execs[0],
      note: "Job claimed. Worker must heartbeat and complete. No scanner is invoked by the control plane.",
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function heartbeatExecution(executionId: string, workerId: string, metrics?: Record<string, unknown>) {
  const { rows } = await pool.query(
    `UPDATE ccdi_executions
     SET metrics = COALESCE(metrics, '{}'::jsonb) || $1::jsonb,
         updated_at = now()
     WHERE id = $2 AND worker_id = $3 AND status = 'running'
     RETURNING id, status, updated_at`,
    [JSON.stringify(metrics ?? { heartbeat: new Date().toISOString() }), executionId, workerId],
  );
  if (!rows[0]) return { error: "Execution not found or not running", status: 404 as const };
  return { execution: rows[0] };
}

export async function completeExecution(opts: {
  executionId: string;
  workerId: string;
  success: boolean;
  exitCode?: number;
  stdoutSummary?: string;
  stderrSummary?: string;
  metrics?: Record<string, unknown>;
  evidence?: Array<{
    evidenceType: string;
    storageRef: string;
    filename?: string;
    sha256?: string;
    sizeBytes?: number;
  }>;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: execs } = await client.query(
      `SELECT * FROM ccdi_executions WHERE id = $1 AND worker_id = $2 FOR UPDATE`,
      [opts.executionId, opts.workerId],
    );
    if (!execs[0]) {
      await client.query("ROLLBACK");
      return { error: "Execution not found", status: 404 as const };
    }
    if (!["running", "starting"].includes(execs[0].status)) {
      await client.query("ROLLBACK");
      return { error: `Execution is ${execs[0].status}`, status: 400 as const };
    }

    const finalStatus = opts.success ? "succeeded" : "failed";

    await client.query(
      `UPDATE ccdi_executions
       SET status = $1, finished_at = now(), exit_code = $2,
           stdout_summary = $3, stderr_summary = $4,
           metrics = COALESCE(metrics, '{}'::jsonb) || $5::jsonb,
           updated_at = now()
       WHERE id = $6`,
      [
        finalStatus,
        opts.exitCode ?? (opts.success ? 0 : 1),
        opts.stdoutSummary ?? null,
        opts.stderrSummary ?? null,
        JSON.stringify(opts.metrics ?? {}),
        opts.executionId,
      ],
    );

    await client.query(
      `UPDATE ccdi_jobs
       SET status = $1, finished_at = now(), updated_at = now(),
           error_message = $2
       WHERE id = $3`,
      [finalStatus === "succeeded" ? "succeeded" : "failed", opts.stderrSummary ?? null, execs[0].job_id],
    );

    if (opts.evidence?.length) {
      for (const ev of opts.evidence) {
        await client.query(
          `INSERT INTO ccdi_evidence
             (organization_id, execution_id, job_id, evidence_type, filename, size_bytes, sha256, storage_ref, collected_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            execs[0].organization_id,
            opts.executionId,
            execs[0].job_id,
            ev.evidenceType,
            ev.filename ?? null,
            ev.sizeBytes ?? null,
            ev.sha256 ?? null,
            ev.storageRef,
            opts.workerId,
          ],
        );
      }
    }

    await client.query("COMMIT");
    return { status: finalStatus, executionId: opts.executionId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

logger.info("CCDI Phase 8 worker foundations loaded");
