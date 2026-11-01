/**
 * CINTEXA CCDI — Phase 22 Data Retention Policies
 *
 * Organisation-scoped retention windows stored in settings.retention.
 * applyRetention() can dry-run or delete expired operational rows.
 * Does not delete evidence blobs or findings by default (safety).
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

export type RetentionPolicy = {
  auditLogsDays: number;
  alertsDays: number;
  webhookDeliveriesDays: number;
  webhookOutboxDays: number;
  executionsDays: number;
};

export const DEFAULT_RETENTION: RetentionPolicy = {
  auditLogsDays: 365,
  alertsDays: 90,
  webhookDeliveriesDays: 30,
  webhookOutboxDays: 30,
  executionsDays: 180,
};

function clampDays(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(3650, Math.max(7, Math.floor(n)));
}

export async function getRetentionPolicy(organizationId: string): Promise<RetentionPolicy> {
  const { rows } = await pool.query(
    `SELECT settings FROM ccdi_organizations WHERE id = $1`,
    [organizationId],
  );
  const r = (rows[0]?.settings as any)?.retention ?? {};
  return {
    auditLogsDays: clampDays(r.auditLogsDays, DEFAULT_RETENTION.auditLogsDays),
    alertsDays: clampDays(r.alertsDays, DEFAULT_RETENTION.alertsDays),
    webhookDeliveriesDays: clampDays(r.webhookDeliveriesDays, DEFAULT_RETENTION.webhookDeliveriesDays),
    webhookOutboxDays: clampDays(r.webhookOutboxDays, DEFAULT_RETENTION.webhookOutboxDays),
    executionsDays: clampDays(r.executionsDays, DEFAULT_RETENTION.executionsDays),
  };
}

export async function setRetentionPolicy(
  organizationId: string,
  policy: Partial<RetentionPolicy>,
): Promise<RetentionPolicy> {
  const current = await getRetentionPolicy(organizationId);
  const next: RetentionPolicy = {
    auditLogsDays: clampDays(policy.auditLogsDays ?? current.auditLogsDays, current.auditLogsDays),
    alertsDays: clampDays(policy.alertsDays ?? current.alertsDays, current.alertsDays),
    webhookDeliveriesDays: clampDays(
      policy.webhookDeliveriesDays ?? current.webhookDeliveriesDays,
      current.webhookDeliveriesDays,
    ),
    webhookOutboxDays: clampDays(
      policy.webhookOutboxDays ?? current.webhookOutboxDays,
      current.webhookOutboxDays,
    ),
    executionsDays: clampDays(policy.executionsDays ?? current.executionsDays, current.executionsDays),
  };

  await pool.query(
    `UPDATE ccdi_organizations
     SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{retention}', $2::jsonb, true),
         updated_at = now()
     WHERE id = $1`,
    [organizationId, JSON.stringify(next)],
  );
  return next;
}

export async function applyRetention(opts: {
  organizationId: string;
  dryRun?: boolean;
  actor: string;
}) {
  const policy = await getRetentionPolicy(opts.organizationId);
  const dryRun = opts.dryRun !== false; // default dry-run for safety

  const counts: Record<string, number> = {};

  async function countOrDelete(table: string, timeCol: string, days: number, extraWhere = "") {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM ${table}
       WHERE organization_id = $1
         AND ${timeCol} < now() - make_interval(days => $2)
         ${extraWhere}`,
      [opts.organizationId, days],
    );
    const n = rows[0]?.n ?? 0;
    counts[table] = n;
    if (!dryRun && n > 0) {
      await pool.query(
        `DELETE FROM ${table}
         WHERE organization_id = $1
           AND ${timeCol} < now() - make_interval(days => $2)
           ${extraWhere}`,
        [opts.organizationId, days],
      );
    }
  }

  await countOrDelete("ccdi_audit_logs", "created_at", policy.auditLogsDays);
  // alerts table may not exist until phase 20 used
  try {
    await countOrDelete("ccdi_alerts", "created_at", policy.alertsDays, "AND acknowledged = true");
  } catch {
    counts["ccdi_alerts"] = 0;
  }
  try {
    await countOrDelete("ccdi_webhook_deliveries", "attempted_at", policy.webhookDeliveriesDays);
  } catch {
    counts["ccdi_webhook_deliveries"] = 0;
  }
  try {
    await countOrDelete(
      "ccdi_webhook_outbox",
      "created_at",
      policy.webhookOutboxDays,
      "AND status IN ('delivered','dead')",
    );
  } catch {
    counts["ccdi_webhook_outbox"] = 0;
  }
  await countOrDelete(
    "ccdi_executions",
    "created_at",
    policy.executionsDays,
    "AND status IN ('succeeded','failed','cancelled','timed_out')",
  );

  await pool.query(
    `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, action, entity_type, entity_id, meta)
     VALUES ($1,$2,'retention.apply','organization',$1,$3)`,
    [
      opts.organizationId,
      opts.actor,
      JSON.stringify({ dryRun, policy, counts }),
    ],
  );

  logger.info({ organizationId: opts.organizationId, dryRun, counts }, "ccdi.retention.apply");

  return {
    dryRun,
    policy,
    counts,
    note: dryRun
      ? "Dry-run only — no rows deleted. Pass dryRun:false to execute."
      : "Retention applied. Evidence and findings are never deleted by this job.",
  };
}

logger.info("CCDI Phase 22 retention service loaded");
