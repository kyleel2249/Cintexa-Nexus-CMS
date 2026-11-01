/**
 * CINTEXA CCDI — Phase 25 schedule routes
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../lib/auth-middleware";
import { logger } from "../../lib/logger";
import * as schedules from "../../services/ccdi-schedules";
import { requireCcdiPermission } from "../../services/ccdi-rbac";
import { ccdiRateLimit } from "../../middleware/ccdi-rate-limit";

const router = Router();

function actor(req: Request): string {
  return String(req.auth?.sub ?? "unknown");
}

const mutationLimit = ccdiRateLimit({ windowMs: 60_000, max: 40 });

router.get("/schedules", requireAuth, async (req: Request, res: Response) => {
  try {
    const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    if (!organizationId) {
      res.status(400).json({ error: "organizationId is required" });
      return;
    }
    const rows = await schedules.listSchedules(organizationId);
    res.json({ schedules: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.schedules.list failed");
    res.status(500).json({ error: "Failed to list schedules" });
  }
});

router.post(
  "/schedules",
  requireAuth,
  requireCcdiPermission("ccdi.job.approve"),
  mutationLimit,
  async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      if (!body.organizationId || !body.name) {
        res.status(400).json({ error: "organizationId and name are required" });
        return;
      }
      const result = await schedules.createSchedule({
        organizationId: String(body.organizationId),
        name: String(body.name),
        description: body.description,
        adapterKeys: body.adapterKeys,
        assetIds: body.assetIds,
        intervalMinutes: body.intervalMinutes,
        createdBy: actor(req),
      });
      if ("error" in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(201).json(result);
    } catch (err) {
      logger.error({ err }, "ccdi.schedules.create failed");
      res.status(500).json({ error: "Failed to create schedule" });
    }
  },
);

router.post(
  "/schedules/:id/enable",
  requireAuth,
  requireCcdiPermission("ccdi.job.approve"),
  mutationLimit,
  async (req: Request, res: Response) => {
    try {
      const organizationId = req.body?.organizationId;
      if (!organizationId) {
        res.status(400).json({ error: "organizationId is required" });
        return;
      }
      const enabled = req.body?.enabled !== false;
      const result = await schedules.setScheduleEnabled(
        String(organizationId),
        req.params.id,
        enabled,
        actor(req),
      );
      if ("error" in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err) {
      logger.error({ err }, "ccdi.schedules.enable failed");
      res.status(500).json({ error: "Failed to update schedule" });
    }
  },
);

router.post(
  "/schedules/process-due",
  requireAuth,
  requireCcdiPermission("ccdi.platform.admin"),
  mutationLimit,
  async (req: Request, res: Response) => {
    try {
      const result = await schedules.processDueSchedules({
        limit: req.body?.limit,
        actor: actor(req),
      });
      res.json(result);
    } catch (err) {
      logger.error({ err }, "ccdi.schedules.process failed");
      res.status(500).json({ error: "Failed to process schedules" });
    }
  },
);

export default router;
