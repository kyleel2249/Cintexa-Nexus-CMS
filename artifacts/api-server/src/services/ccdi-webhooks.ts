/**
 * CINTEXA CCDI — Phase 11 Webhooks & SIEM-oriented events
 *
 * Organisations can register webhook endpoints for control-plane events
 * (job lifecycle, findings, kill-switch, approvals). Delivery is best-effort
 * with logged outcomes. No customer-asset scanning is triggered here.
 */
import { createHmac, randomBytes } from "crypto";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

export const CCDI_PHASE11_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS ccdi_webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  event_types TEXT[] NOT NULL DEFAULT '{*}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_webhooks_org ON ccdi_webhook_endpoints(organization_id, status)`,

  `CREATE TABLE IF NOT EXISTS ccdi_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID NOT NULL REFERENCES ccdi_webhook_endpoints(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  http_status INT,
  success BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_webhook_deliveries_ep ON ccdi_webhook_deliveries(endpoint_id, attempted_at DESC)`,
];

export type CcdiEventType =
  | "job.created"
  | "job.approved"
  | "job.rejected"
  | "job.started"
  | "job.completed"
  | "job.failed"
  | "finding.created"
  | "finding.updated"
  | "approval.requested"
  | "approval.decided"
  | "kill_switch.changed"
  | "report.generated"
  | "*"
  ;

export async function registerWebhook(opts: {
  organizationId: string;
  name: string;
  url: string;
  eventTypes?: string[];
  createdBy: string;
}) {
  // Basic SSRF guardrails — block obvious local/metadata targets
  let parsed: URL;
  try {
    parsed = new URL(opts.url);
  } catch {
    return { error: "Invalid URL", status: 400 as const };
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    return { error: "Only http(s) URLs are allowed", status: 400 as const };
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.startsWith("169.254.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    return { error: "Private/local webhook targets are not allowed", status: 400 as const };
  }

  const secret = randomBytes(24).toString("hex");
  const { rows } = await pool.query(
    `INSERT INTO ccdi_webhook_endpoints
       (organization_id, name, url, secret, event_types, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, organization_id, name, url, event_types, status, created_at`,
    [
      opts.organizationId,
      opts.name,
      opts.url,
      secret,
      opts.eventTypes?.length ? opts.eventTypes : ["*"],
      opts.createdBy,
    ],
  );

  // Return secret once at creation time only
  return { endpoint: rows[0], secret };
}

export async function emitCcdiEvent(opts: {
  organizationId: string;
  eventType: CcdiEventType | string;
  data: Record<string, unknown>;
}) {
  const { rows: endpoints } = await pool.query(
    `SELECT * FROM ccdi_webhook_endpoints
     WHERE organization_id = $1 AND status = 'active'
       AND ($2 = ANY(event_types) OR '*' = ANY(event_types))`,
    [opts.organizationId, opts.eventType],
  );

  if (!endpoints.length) return { delivered: 0 };

  const body = JSON.stringify({
    event: opts.eventType,
    organizationId: opts.organizationId,
    timestamp: new Date().toISOString(),
    data: opts.data,
  });

  let delivered = 0;
  for (const ep of endpoints) {
    const signature = createHmac("sha256", ep.secret).update(body).digest("hex");
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      const res = await fetch(ep.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CCDI-Event": opts.eventType,
          "X-CCDI-Signature": `sha256=${signature}`,
          "User-Agent": "CINTEXA-CCDI-Webhook/1.0",
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      await pool.query(
        `INSERT INTO ccdi_webhook_deliveries
           (endpoint_id, organization_id, event_type, payload, http_status, success)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [ep.id, opts.organizationId, opts.eventType, body, res.status, res.ok],
      );
      if (res.ok) delivered += 1;
    } catch (err: any) {
      await pool.query(
        `INSERT INTO ccdi_webhook_deliveries
           (endpoint_id, organization_id, event_type, payload, success, error_message)
         VALUES ($1,$2,$3,$4,false,$5)`,
        [ep.id, opts.organizationId, opts.eventType, body, String(err?.message || err)],
      );
      logger.warn({ err, endpointId: ep.id }, "ccdi.webhook.delivery_failed");
    }
  }
  return { delivered };
}

/** SIEM-friendly newline-delimited JSON of recent audit events */
export async function exportSiemEvents(opts: {
  organizationId?: string;
  since?: string;
  limit?: number;
}) {
  const limit = Math.min(opts.limit ?? 500, 2000);
  const params: any[] = [];
  const clauses: string[] = [];
  if (opts.organizationId) {
    params.push(opts.organizationId);
    clauses.push(`organization_id = $${params.length}`);
  }
  if (opts.since) {
    params.push(opts.since);
    clauses.push(`created_at >= $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(limit);

  const { rows } = await pool.query(
    `SELECT id, organization_id, actor_ref, actor_email, action, entity_type, entity_id, meta, created_at
     FROM ccdi_audit_logs ${where}
     ORDER BY created_at ASC
     LIMIT $${params.length}`,
    params,
  );

  return rows.map((r) =>
    JSON.stringify({
      source: "cintexa-ccdi",
      event_id: r.id,
      timestamp: r.created_at,
      organization_id: r.organization_id,
      actor: r.actor_ref,
      actor_email: r.actor_email,
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      meta: r.meta,
    }),
  ).join("\n") + (rows.length ? "\n" : "");
}

logger.info("CCDI Phase 11 webhooks service loaded");
