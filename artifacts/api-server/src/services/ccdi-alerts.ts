/**
 * CINTEXA CCDI — Phase 20 In-app alerts & subscriptions
 *
 * Lightweight notification feed for operators. Does not send email/SMS itself;
 * external systems can poll digests or consume webhooks (Phase 11/15).
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

export const CCDI_PHASE20_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS ccdi_alert_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  user_ref TEXT NOT NULL,
  event_types TEXT[] NOT NULL DEFAULT '{*}',
  min_severity TEXT DEFAULT 'high' CHECK (min_severity IN ('info','low','medium','high','critical')),
  channel TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app','webhook','digest')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_ref, channel)
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_alert_subs_org ON ccdi_alert_subscriptions(organization_id, enabled)`,

  `CREATE TABLE IF NOT EXISTS ccdi_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','low','medium','high','critical')),
  title TEXT NOT NULL,
  body TEXT,
  entity_type TEXT,
  entity_id TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  acknowledged_by TEXT,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_alerts_org_created ON ccdi_alerts(organization_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_alerts_unacked ON ccdi_alerts(organization_id, acknowledged, created_at DESC)`,
];

export async function ensureAlertSchema() {
  for (const stmt of CCDI_PHASE20_SCHEMA) {
    await pool.query(stmt).catch((err) => {
      logger.warn({ err }, "ccdi.alerts.schema");
    });
  }
}

const SEVERITY_RANK: Record<string, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export async function raiseAlert(opts: {
  organizationId: string;
  eventType: string;
  severity?: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  meta?: Record<string, unknown>;
}) {
  await ensureAlertSchema();
  const severity = opts.severity && SEVERITY_RANK[opts.severity] !== undefined ? opts.severity : "info";

  const { rows } = await pool.query(
    `INSERT INTO ccdi_alerts
       (organization_id, event_type, severity, title, body, entity_type, entity_id, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      opts.organizationId,
      opts.eventType,
      severity,
      opts.title,
      opts.body ?? null,
      opts.entityType ?? null,
      opts.entityId ?? null,
      JSON.stringify(opts.meta ?? {}),
    ],
  );
  return rows[0];
}

export async function listAlerts(opts: {
  organizationId: string;
  unacknowledgedOnly?: boolean;
  limit?: number;
}) {
  await ensureAlertSchema();
  const limit = Math.min(opts.limit ?? 50, 200);
  const params: any[] = [opts.organizationId];
  let where = `WHERE organization_id = $1`;
  if (opts.unacknowledgedOnly) {
    where += ` AND acknowledged = false`;
  }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT * FROM ccdi_alerts ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows;
}

export async function acknowledgeAlert(opts: {
  alertId: string;
  organizationId: string;
  actor: string;
}) {
  await ensureAlertSchema();
  const { rows } = await pool.query(
    `UPDATE ccdi_alerts SET
       acknowledged = true,
       acknowledged_by = $3,
       acknowledged_at = now()
     WHERE id = $1 AND organization_id = $2
     RETURNING *`,
    [opts.alertId, opts.organizationId, opts.actor],
  );
  if (!rows[0]) return { error: "Alert not found", status: 404 as const };
  return { alert: rows[0] };
}

export async function upsertSubscription(opts: {
  organizationId: string;
  userRef: string;
  eventTypes?: string[];
  minSeverity?: string;
  channel?: string;
  enabled?: boolean;
}) {
  await ensureAlertSchema();
  const channel = opts.channel || "in_app";
  const { rows } = await pool.query(
    `INSERT INTO ccdi_alert_subscriptions
       (organization_id, user_ref, event_types, min_severity, channel, enabled)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (organization_id, user_ref, channel) DO UPDATE SET
       event_types = EXCLUDED.event_types,
       min_severity = EXCLUDED.min_severity,
       enabled = EXCLUDED.enabled,
       updated_at = now()
     RETURNING *`,
    [
      opts.organizationId,
      opts.userRef,
      opts.eventTypes?.length ? opts.eventTypes : ["*"],
      opts.minSeverity || "high",
      channel,
      opts.enabled !== false,
    ],
  );
  return rows[0];
}

export async function listSubscriptions(organizationId: string, userRef?: string) {
  await ensureAlertSchema();
  const params: any[] = [organizationId];
  let where = `WHERE organization_id = $1`;
  if (userRef) {
    params.push(userRef);
    where += ` AND user_ref = $2`;
  }
  const { rows } = await pool.query(
    `SELECT * FROM ccdi_alert_subscriptions ${where} ORDER BY updated_at DESC`,
    params,
  );
  return rows;
}

/** Compact digest for external email/chat workers */
export async function buildAlertDigest(organizationId: string, sinceHours = 24) {
  await ensureAlertSchema();
  const { rows } = await pool.query(
    `SELECT severity, count(*)::int AS count
     FROM ccdi_alerts
     WHERE organization_id = $1
       AND created_at > now() - make_interval(hours => $2)
     GROUP BY severity`,
    [organizationId, sinceHours],
  );
  const { rows: recent } = await pool.query(
    `SELECT id, event_type, severity, title, created_at, acknowledged
     FROM ccdi_alerts
     WHERE organization_id = $1
       AND created_at > now() - make_interval(hours => $2)
     ORDER BY created_at DESC LIMIT 20`,
    [organizationId, sinceHours],
  );
  const { rows: unacked } = await pool.query(
    `SELECT count(*)::int AS n FROM ccdi_alerts
     WHERE organization_id = $1 AND acknowledged = false`,
    [organizationId],
  );

  return {
    organizationId,
    windowHours: sinceHours,
    generatedAt: new Date().toISOString(),
    unacknowledgedTotal: unacked[0]?.n ?? 0,
    bySeverity: Object.fromEntries(rows.map((r) => [r.severity, r.count])),
    recent,
  };
}

logger.info("CCDI Phase 20 alerts service loaded");
