/**
 * CINTEXA CCDI — Phase 17 SLA + metrics routes
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../lib/auth-middleware";
import { logger } from "../../lib/logger";
import * as sla from "../../services/ccdi-sla";
import * as metrics from "../../services/ccdi-metrics";
import { requireCcdiPermission } from "../../services/ccdi-rbac";

const router = Router();

router.get("/sla", requireAuth, async (req: Request, res: Response) => {
  try {
    const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    if (!organizationId) {
      res.status(400).json({ error: "organizationId is required" });
      return;
    }
    const [policyDays, breaches] = await Promise.all([
      sla.getOrgSlaDays(organizationId),
      sla.slaBreaches(organizationId),
    ]);
    res.json({ policyDays, breaches });
  } catch (err) {
    logger.error({ err }, "ccdi.sla.get failed");
    res.status(500).json({ error: "Failed to load SLA status" });
  }
});

router.get("/metrics", requireAuth, async (req: Request, res: Response) => {
  try {
    const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const snapshot = await metrics.collectCcdiMetrics(organizationId);
    res.json(snapshot);
  } catch (err) {
    logger.error({ err }, "ccdi.metrics failed");
    res.status(500).json({ error: "Failed to collect metrics" });
  }
});

/** Optional: update org SLA days via settings.sla */
router.put(
  "/sla/policy",
  requireAuth,
  requireCcdiPermission("ccdi.org.admin"),
  async (req: Request, res: Response) => {
    try {
      const { organizationId, sla: slaBody } = req.body ?? {};
      if (!organizationId || !slaBody || typeof slaBody !== "object") {
        res.status(400).json({ error: "organizationId and sla object are required" });
        return;
      }
      const { pool } = await import("@workspace/db");
      const { rows } = await pool.query(
        `UPDATE ccdi_organizations
         SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{sla}', $2::jsonb, true),
             updated_at = now()
         WHERE id = $1
         RETURNING id, settings`,
        [organizationId, JSON.stringify(slaBody)],
      );
      if (!rows[0]) {
        res.status(404).json({ error: "Organisation not found" });
        return;
      }
      res.json({ organizationId: rows[0].id, sla: (rows[0].settings as any)?.sla });
    } catch (err) {
      logger.error({ err }, "ccdi.sla.policy.update failed");
      res.status(500).json({ error: "Failed to update SLA policy" });
    }
  },
);

export default router;
