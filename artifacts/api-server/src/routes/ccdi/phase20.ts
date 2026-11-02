/**
 * CINTEXA CCDI — Phase 20 alert routes
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../lib/auth-middleware";
import { logger } from "../../lib/logger";
import * as alerts from "../../services/ccdi-alerts";
import { requireCcdiPermission } from "../../services/ccdi-rbac";
import { pid, httpStatus } from "./http-util";

const router = Router();

function actor(req: Request): string {
  return String(req.auth?.sub ?? "unknown");
}

router.get("/alerts", requireAuth, async (req: Request, res: Response) => {
  try {
    const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    if (!organizationId) {
      res.status(400).json({ error: "organizationId is required" });
      return;
    }
    const list = await alerts.listAlerts({
      organizationId,
      unacknowledgedOnly: req.query.unacknowledged === "true",
      limit: Number(req.query.limit) || 50,
    });
    res.json({ alerts: list });
  } catch (err) {
    logger.error({ err }, "ccdi.alerts.list failed");
    res.status(500).json({ error: "Failed to list alerts" });
  }
});

router.post(
  "/alerts",
  requireAuth,
  requireCcdiPermission("ccdi.org.admin"),
  async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      if (!body.organizationId || !body.title || !body.eventType) {
        res.status(400).json({ error: "organizationId, eventType and title are required" });
        return;
      }
      const alert = await alerts.raiseAlert({
        organizationId: String(body.organizationId),
        eventType: String(body.eventType),
        severity: body.severity,
        title: String(body.title),
        body: body.body,
        entityType: body.entityType,
        entityId: body.entityId,
        meta: body.meta,
      });
      res.status(201).json({ alert });
    } catch (err) {
      logger.error({ err }, "ccdi.alerts.raise failed");
      res.status(500).json({ error: "Failed to raise alert" });
    }
  },
);

router.post("/alerts/:id/acknowledge", requireAuth, async (req: Request, res: Response) => {
  try {
    const organizationId = req.body?.organizationId;
    if (!organizationId) {
      res.status(400).json({ error: "organizationId is required" });
      return;
    }
    const result = await alerts.acknowledgeAlert({
      alertId: pid(req.params.id),
      organizationId: String(organizationId),
      actor: actor(req),
    });
    if ("error" in result) {
      res.status(httpStatus(result.status)).json({ error: result.error });
      return;
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, "ccdi.alerts.ack failed");
    res.status(500).json({ error: "Failed to acknowledge alert" });
  }
});

router.get("/alerts/subscriptions", requireAuth, async (req: Request, res: Response) => {
  try {
    const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    if (!organizationId) {
      res.status(400).json({ error: "organizationId is required" });
      return;
    }
    const userRef = typeof req.query.userRef === "string" ? req.query.userRef : undefined;
    const subs = await alerts.listSubscriptions(organizationId, userRef);
    res.json({ subscriptions: subs });
  } catch (err) {
    logger.error({ err }, "ccdi.alerts.subscriptions.list failed");
    res.status(500).json({ error: "Failed to list subscriptions" });
  }
});

router.put("/alerts/subscriptions", requireAuth, async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    if (!body.organizationId) {
      res.status(400).json({ error: "organizationId is required" });
      return;
    }
    const sub = await alerts.upsertSubscription({
      organizationId: String(body.organizationId),
      userRef: body.userRef || actor(req),
      eventTypes: body.eventTypes,
      minSeverity: body.minSeverity,
      channel: body.channel,
      enabled: body.enabled,
    });
    res.json({ subscription: sub });
  } catch (err) {
    logger.error({ err }, "ccdi.alerts.subscriptions.upsert failed");
    res.status(500).json({ error: "Failed to update subscription" });
  }
});

router.get("/alerts/digest", requireAuth, async (req: Request, res: Response) => {
  try {
    const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    if (!organizationId) {
      res.status(400).json({ error: "organizationId is required" });
      return;
    }
    const sinceHours = Math.min(Number(req.query.sinceHours) || 24, 168);
    const digest = await alerts.buildAlertDigest(organizationId, sinceHours);
    res.json({ digest });
  } catch (err) {
    logger.error({ err }, "ccdi.alerts.digest failed");
    res.status(500).json({ error: "Failed to build digest" });
  }
});

export default router;
