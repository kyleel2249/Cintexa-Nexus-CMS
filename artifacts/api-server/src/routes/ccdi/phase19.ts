/**
 * CINTEXA CCDI — Phase 19 routes
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../lib/auth-middleware";
import { logger } from "../../lib/logger";
import * as wf from "../../services/ccdi-assets-workflow";
import { requireCcdiPermission } from "../../services/ccdi-rbac";
import { pid, httpStatus } from "./http-util";

const router = Router();

function actor(req: Request): string {
  return String(req.auth?.sub ?? "unknown");
}

router.get("/assets/pending-ownership", requireAuth, async (req: Request, res: Response) => {
  try {
    const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    if (!organizationId) {
      res.status(400).json({ error: "organizationId is required" });
      return;
    }
    const assets = await wf.listPendingOwnership(organizationId, Number(req.query.limit) || 50);
    res.json({ assets });
  } catch (err) {
    logger.error({ err }, "ccdi.assets.pending_ownership failed");
    res.status(500).json({ error: "Failed to list pending ownership assets" });
  }
});

router.post(
  "/assets/:id/ownership",
  requireAuth,
  requireCcdiPermission("ccdi.assets.manage"),
  async (req: Request, res: Response) => {
    try {
      const { organizationId, decision, note, ownerRef } = req.body ?? {};
      if (!organizationId || !["verified", "approved", "rejected"].includes(decision)) {
        res.status(400).json({
          error: "organizationId and decision (verified|approved|rejected) are required",
        });
        return;
      }
      const result = await wf.verifyAssetOwnership({
        assetId: pid(req.params.id),
        organizationId: String(organizationId),
        actor: actor(req),
        decision,
        note,
        ownerRef,
      });
      if ("error" in result) {
        res.status(httpStatus(result.status)).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err) {
      logger.error({ err }, "ccdi.assets.ownership failed");
      res.status(500).json({ error: "Failed to update asset ownership" });
    }
  },
);

router.post(
  "/findings/bulk",
  requireAuth,
  requireCcdiPermission("ccdi.findings.manage"),
  async (req: Request, res: Response) => {
    try {
      const { organizationId, findingIds, status, ownerRef } = req.body ?? {};
      if (!organizationId || !Array.isArray(findingIds)) {
        res.status(400).json({ error: "organizationId and findingIds[] are required" });
        return;
      }
      const result = await wf.bulkUpdateFindings({
        organizationId: String(organizationId),
        findingIds: findingIds.map(String),
        status,
        ownerRef,
        actor: actor(req),
      });
      if ("error" in result) {
        res.status(httpStatus(result.status)).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err) {
      logger.error({ err }, "ccdi.findings.bulk failed");
      res.status(500).json({ error: "Failed to bulk-update findings" });
    }
  },
);

export default router;
