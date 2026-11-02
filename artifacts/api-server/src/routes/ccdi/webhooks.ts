/**
 * CINTEXA CCDI — Phase 11 Webhook & SIEM routes
 */
import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { requireAuth } from "../../lib/auth-middleware";
import { logger } from "../../lib/logger";
import * as webhooks from "../../services/ccdi-webhooks";
import { requireCcdiPermission } from "../../services/ccdi-rbac";
import { pid, httpStatus } from "./http-util";

const router = Router();

function actor(req: Request): string {
  return String(req.auth?.sub ?? "unknown");
}

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  for (const stmt of webhooks.CCDI_PHASE11_SCHEMA) {
    await pool.query(stmt).catch(() => undefined);
  }
  schemaReady = true;
}

router.post(
  "/webhooks",
  requireAuth,
  requireCcdiPermission("ccdi.org.admin"),
  async (req: Request, res: Response) => {
    try {
      await ensureSchema();
      const { organizationId, name, url, eventTypes } = req.body ?? {};
      if (!organizationId || !name || !url) {
        res.status(400).json({ error: "organizationId, name and url are required" });
        return;
      }
      const result = await webhooks.registerWebhook({
        organizationId: String(organizationId),
        name: String(name),
        url: String(url),
        eventTypes: Array.isArray(eventTypes) ? eventTypes.map(String) : undefined,
        createdBy: actor(req),
      });
      if ("error" in result) {
        res.status(httpStatus(result.status)).json({ error: result.error });
        return;
      }
      res.status(201).json({
        endpoint: result.endpoint,
        secret: result.secret,
        note: "Store the secret securely. It is only returned once at creation.",
      });
    } catch (err) {
      logger.error({ err }, "ccdi.webhooks.create failed");
      res.status(500).json({ error: "Failed to register webhook" });
    }
  },
);

router.get("/webhooks", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureSchema();
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    if (!orgId) {
      res.status(400).json({ error: "organizationId is required" });
      return;
    }
    const { rows } = await pool.query(
      `SELECT id, organization_id, name, url, event_types, status, created_by, created_at, updated_at
       FROM ccdi_webhook_endpoints WHERE organization_id = $1 ORDER BY created_at DESC`,
      [orgId],
    );
    res.json({ endpoints: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.webhooks.list failed");
    res.status(500).json({ error: "Failed to list webhooks" });
  }
});

router.delete(
  "/webhooks/:id",
  requireAuth,
  requireCcdiPermission("ccdi.org.admin"),
  async (req: Request, res: Response) => {
    try {
      await ensureSchema();
      const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
      if (!orgId) {
        res.status(400).json({ error: "organizationId is required" });
        return;
      }
      const { rowCount } = await pool.query(
        `DELETE FROM ccdi_webhook_endpoints WHERE id = $1 AND organization_id = $2`,
        [pid(req.params.id), orgId],
      );
      if (!rowCount) {
        res.status(404).json({ error: "Webhook not found" });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      logger.error({ err }, "ccdi.webhooks.delete failed");
      res.status(500).json({ error: "Failed to delete webhook" });
    }
  },
);

router.get("/webhooks/deliveries", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureSchema();
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    if (!orgId) {
      res.status(400).json({ error: "organizationId is required" });
      return;
    }
    const { rows } = await pool.query(
      `SELECT id, endpoint_id, event_type, http_status, success, error_message, attempted_at
       FROM ccdi_webhook_deliveries WHERE organization_id = $1
       ORDER BY attempted_at DESC LIMIT 100`,
      [orgId],
    );
    res.json({ deliveries: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.webhooks.deliveries failed");
    res.status(500).json({ error: "Failed to list deliveries" });
  }
});

/** Test-fire a synthetic event (does not invent security findings). */
router.post(
  "/webhooks/test",
  requireAuth,
  requireCcdiPermission("ccdi.org.admin"),
  async (req: Request, res: Response) => {
    try {
      await ensureSchema();
      const organizationId = req.body?.organizationId;
      if (!organizationId) {
        res.status(400).json({ error: "organizationId is required" });
        return;
      }
      const result = await webhooks.emitCcdiEvent({
        organizationId: String(organizationId),
        eventType: "approval.requested",
        data: { test: true, message: "CCDI webhook test event", actor: actor(req) },
      });
      res.json(result);
    } catch (err) {
      logger.error({ err }, "ccdi.webhooks.test failed");
      res.status(500).json({ error: "Test delivery failed" });
    }
  },
);

// ── SIEM export (NDJSON) ───────────────────────────────────────────────────
router.get("/siem/export", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : undefined;
    const since = typeof req.query.since === "string" ? req.query.since : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 500;
    const ndjson = await webhooks.exportSiemEvents({ organizationId: orgId, since, limit });
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="ccdi-siem-events.ndjson"');
    res.send(ndjson);
  } catch (err) {
    logger.error({ err }, "ccdi.siem.export failed");
    res.status(500).json({ error: "SIEM export failed" });
  }
});

export default router;
