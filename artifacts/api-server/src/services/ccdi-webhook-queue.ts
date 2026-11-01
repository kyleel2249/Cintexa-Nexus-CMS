/**
 * CINTEXA CCDI — Phase 15 durable webhook outbox
 *
 * Failed or deferred deliveries are stored with next_attempt_at and attempt_count.
 * processWebhookOutbox() drains due rows (call from cron or admin endpoint).
 */
import { createHmac } from "crypto";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

export const CCDI_PHASE15_WEBHOOK_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS ccdi_webhook_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID NOT NULL REFERENCES ccdi_webhook_endpoints(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 8,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','dead')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_webhook_outbox_due
    ON ccdi_webhook_outbox(status, next_attempt_at)
    WHERE status = 'pending'`,
];

export async function ensureWebhookOutboxSchema() {
  for (const stmt of CCDI_PHASE15_WEBHOOK_SCHEMA) {
    await pool.query(stmt).catch((err) => {
      logger.warn({ err }, "ccdi.webhook_outbox.schema");
    });
  }
}

function backoffSeconds(attempt: number): number {
  // 30s, 60s, 120s, ... capped at 1h
  return Math.min(3600, 30 * Math.pow(2, Math.max(0, attempt)));
}

export async function enqueueWebhookDelivery(opts: {
  endpointId: string;
  organizationId: string;
  eventType: string;
  payload: string;
}) {
  await ensureWebhookOutboxSchema();
  const { rows } = await pool.query(
    `INSERT INTO ccdi_webhook_outbox
       (endpoint_id, organization_id, event_type, payload, next_attempt_at)
     VALUES ($1,$2,$3,$4,now())
     RETURNING id`,
    [opts.endpointId, opts.organizationId, opts.eventType, opts.payload],
  );
  return rows[0];
}

export async function processWebhookOutbox(limit = 20) {
  await ensureWebhookOutboxSchema();

  const { rows } = await pool.query(
    `SELECT o.*, e.url, e.secret, e.status AS ep_status
     FROM ccdi_webhook_outbox o
     JOIN ccdi_webhook_endpoints e ON e.id = o.endpoint_id
     WHERE o.status = 'pending' AND o.next_attempt_at <= now() AND e.status = 'active'
     ORDER BY o.next_attempt_at ASC
     LIMIT $1
     FOR UPDATE OF o SKIP LOCKED`,
    [Math.min(limit, 100)],
  );

  let delivered = 0;
  let failed = 0;
  let dead = 0;

  for (const row of rows) {
    const attempt = Number(row.attempt_count || 0) + 1;
    try {
      const signature = createHmac("sha256", row.secret).update(row.payload).digest("hex");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      const res = await fetch(row.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CCDI-Event": row.event_type,
          "X-CCDI-Signature": `sha256=${signature}`,
          "X-CCDI-Attempt": String(attempt),
          "User-Agent": "CINTEXA-CCDI-Webhook/1.1",
        },
        body: row.payload,
        signal: controller.signal,
      });
      clearTimeout(timer);

      await pool.query(
        `INSERT INTO ccdi_webhook_deliveries
           (endpoint_id, organization_id, event_type, payload, http_status, success)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [row.endpoint_id, row.organization_id, row.event_type, row.payload, res.status, res.ok],
      );

      if (res.ok) {
        await pool.query(
          `UPDATE ccdi_webhook_outbox SET status = 'delivered', attempt_count = $2, updated_at = now()
           WHERE id = $1`,
          [row.id, attempt],
        );
        delivered += 1;
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err: any) {
      const msg = String(err?.message || err);
      const max = Number(row.max_attempts || 8);
      if (attempt >= max) {
        await pool.query(
          `UPDATE ccdi_webhook_outbox
           SET status = 'dead', attempt_count = $2, last_error = $3, updated_at = now()
           WHERE id = $1`,
          [row.id, attempt, msg],
        );
        dead += 1;
      } else {
        const delay = backoffSeconds(attempt);
        await pool.query(
          `UPDATE ccdi_webhook_outbox
           SET attempt_count = $2, last_error = $3,
               next_attempt_at = now() + make_interval(secs => $4),
               updated_at = now()
           WHERE id = $1`,
          [row.id, attempt, msg, delay],
        );
        failed += 1;
      }
      logger.warn({ err, outboxId: row.id }, "ccdi.webhook_outbox.attempt_failed");
    }
  }

  return { processed: rows.length, delivered, failed, dead };
}

logger.info("CCDI Phase 15 webhook outbox loaded");
