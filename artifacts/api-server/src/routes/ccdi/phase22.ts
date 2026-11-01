/**
 * CINTEXA CCDI — Phase 22 retention routes
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../lib/auth-middleware";
import { logger } from "../../lib/logger";
import * as retention from "../../services/ccdi-retention";
import { requireCcdiPermission } from "../../services/ccdi-rbac";
import { ccdiRateLimit } from "../../middleware/ccdi-rate-limit";

const router = Router();

function actor(req: Request): string {
  return String(req.auth?.sub ?? "unknown");
}

const mutationLimit = ccdiRateLimit({ windowMs: 60_000, max: 30 });

router.get("/retention", requireAuth, async (req: Request, res: Response) => {
  try {
    const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    if (!organizationId) {
      res.status(400).json({ error: "organizationId is required" });
      return;
    }
    const policy = await retention.getRetentionPolicy(organizationId);
    res.json({ policy, defaults: retention.DEFAULT_RETENTION });
  } catch (err) {
    logger.error({ err }, "ccdi.retention.get failed");
    res.status(500).json({ error: "Failed to load retention policy" });
  }
});

router.put(
  "/retention",
  requireAuth,
  requireCcdiPermission("ccdi.org.admin"),
  mutationLimit,
  async (req: Request, res: Response) => {
    try {
      const { organizationId, policy } = req.body ?? {};
      if (!organizationId || !policy || typeof policy !== "object") {
        res.status(400).json({ error: "organizationId and policy object are required" });
        return;
      }
      const next = await retention.setRetentionPolicy(String(organizationId), policy);
      res.json({ policy: next });
    } catch (err) {
      logger.error({ err }, "ccdi.retention.set failed");
      res.status(500).json({ error: "Failed to update retention policy" });
    }
  },
);

router.post(
  "/retention/apply",
  requireAuth,
  requireCcdiPermission("ccdi.org.admin"),
  mutationLimit,
  async (req: Request, res: Response) => {
    try {
      const { organizationId, dryRun } = req.body ?? {};
      if (!organizationId) {
        res.status(400).json({ error: "organizationId is required" });
        return;
      }
      const result = await retention.applyRetention({
        organizationId: String(organizationId),
        dryRun: dryRun !== false,
        actor: actor(req),
      });
      res.json(result);
    } catch (err) {
      logger.error({ err }, "ccdi.retention.apply failed");
      res.status(500).json({ error: "Failed to apply retention" });
    }
  },
);

export default router;
