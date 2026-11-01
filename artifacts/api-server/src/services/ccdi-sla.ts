/**
 * CINTEXA CCDI — Phase 17 SLA policies
 *
 * Default response/remediation windows by severity. Organisations can override
 * via ccdi_organizations.settings.sla (days).
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

/** Default remediation due-days from discovery / task creation */
export const DEFAULT_SLA_DAYS: Record<Severity, number | null> = {
  critical: 7,
  high: 14,
  medium: 30,
  low: 60,
  info: null, // no forced due date
};

export async function getOrgSlaDays(organizationId: string): Promise<Record<Severity, number | null>> {
  try {
    const { rows } = await pool.query(
      `SELECT settings FROM ccdi_organizations WHERE id = $1`,
      [organizationId],
    );
    const settings = rows[0]?.settings ?? {};
    const sla = (settings as any)?.sla ?? {};
    return {
      critical: numOr(sla.critical, DEFAULT_SLA_DAYS.critical),
      high: numOr(sla.high, DEFAULT_SLA_DAYS.high),
      medium: numOr(sla.medium, DEFAULT_SLA_DAYS.medium),
      low: numOr(sla.low, DEFAULT_SLA_DAYS.low),
      info: sla.info === null || sla.info === undefined ? DEFAULT_SLA_DAYS.info : Number(sla.info),
    };
  } catch {
    return { ...DEFAULT_SLA_DAYS };
  }
}

function numOr(v: unknown, fallback: number | null): number | null {
  if (v === null) return null;
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function dueDateFromDays(days: number | null | undefined): string | null {
  if (days == null || !Number.isFinite(days)) return null;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.floor(days)));
  return d.toISOString().slice(0, 10);
}

export async function computeDueDateForSeverity(
  organizationId: string,
  severity: string,
): Promise<string | null> {
  const sla = await getOrgSlaDays(organizationId);
  const key = (severity as Severity) in sla ? (severity as Severity) : "medium";
  return dueDateFromDays(sla[key]);
}

export async function slaBreaches(organizationId: string) {
  const { rows } = await pool.query(
    `SELECT
       count(*) FILTER (
         WHERE f.status IN ('open','confirmed','in_progress')
           AND f.severity = 'critical'
           AND f.first_seen_at < now() - interval '7 days'
       )::int AS critical_overdue,
       count(*) FILTER (
         WHERE f.status IN ('open','confirmed','in_progress')
           AND f.severity = 'high'
           AND f.first_seen_at < now() - interval '14 days'
       )::int AS high_overdue,
       count(*) FILTER (
         WHERE t.status IN ('open','in_progress')
           AND t.due_date IS NOT NULL
           AND t.due_date < CURRENT_DATE
       )::int AS tasks_overdue
     FROM ccdi_findings f
     FULL OUTER JOIN ccdi_remediation_tasks t
       ON t.organization_id = f.organization_id AND t.organization_id = $1
     WHERE COALESCE(f.organization_id, t.organization_id) = $1`,
    [organizationId],
  );

  // Simpler reliable queries
  const [findings, tasks] = await Promise.all([
    pool.query(
      `SELECT
         count(*) FILTER (WHERE severity = 'critical' AND first_seen_at < now() - interval '7 days')::int AS critical_overdue,
         count(*) FILTER (WHERE severity = 'high' AND first_seen_at < now() - interval '14 days')::int AS high_overdue
       FROM ccdi_findings
       WHERE organization_id = $1 AND status IN ('open','confirmed','in_progress')`,
      [organizationId],
    ),
    pool.query(
      `SELECT count(*)::int AS tasks_overdue
       FROM ccdi_remediation_tasks
       WHERE organization_id = $1 AND status IN ('open','in_progress')
         AND due_date IS NOT NULL AND due_date < CURRENT_DATE`,
      [organizationId],
    ),
  ]);

  return {
    criticalFindingsPastSla: findings.rows[0]?.critical_overdue ?? 0,
    highFindingsPastSla: findings.rows[0]?.high_overdue ?? 0,
    remediationTasksOverdue: tasks.rows[0]?.tasks_overdue ?? 0,
    policyDays: await getOrgSlaDays(organizationId),
    note: "Default SLA windows used unless organization.settings.sla overrides are set.",
  };
}

logger.info("CCDI Phase 17 SLA service loaded");
