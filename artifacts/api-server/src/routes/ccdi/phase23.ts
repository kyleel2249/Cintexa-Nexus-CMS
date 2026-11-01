/**
 * CINTEXA CCDI — Phase 23 readiness routes
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../lib/auth-middleware";
import { logger } from "../../lib/logger";
import * as readiness from "../../services/ccdi-readiness";
import { requireCcdiPermission } from "../../services/ccdi-rbac";

const router = Router();

router.get(
  "/readiness",
  requireAuth,
  requireCcdiPermission("ccdi.platform.admin"),
  async (_req: Request, res: Response) => {
    try {
      const report = await readiness.assessProductionReadiness();
      res.json(report);
    } catch (err) {
      logger.error({ err }, "ccdi.readiness.assess failed");
      res.status(500).json({ error: "Failed to assess readiness" });
    }
  },
);

/** Lighter public-ish status for ops dashboards (still auth-gated) */
router.get("/readiness/summary", requireAuth, async (_req: Request, res: Response) => {
  try {
    const report = await readiness.assessProductionReadiness();
    res.json({
      module: report.module,
      phase: report.phase,
      assessedAt: report.assessedAt,
      readyForProduction: report.readyForProduction,
      summary: report.summary,
      guidance: report.guidance,
    });
  } catch (err) {
    logger.error({ err }, "ccdi.readiness.summary failed");
    res.status(500).json({ error: "Failed to load readiness summary" });
  }
});

export default router;
