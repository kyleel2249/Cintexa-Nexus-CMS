/**
 * CINTEXA CCDI — Phase 21 evidence integrity routes
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../lib/auth-middleware";
import { logger } from "../../lib/logger";
import * as integrity from "../../services/ccdi-evidence-integrity";
import { requireCcdiPermission } from "../../services/ccdi-rbac";

const router = Router();

function actor(req: Request): string {
  return String(req.auth?.sub ?? "unknown");
}

router.get("/evidence/:id/custody", requireAuth, async (req: Request, res: Response) => {
  try {
    const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    if (!organizationId) {
      res.status(400).json({ error: "organizationId is required" });
      return;
    }
    const chain = await integrity.listCustodyChain(organizationId, req.params.id);
    res.json({ custody: chain });
  } catch (err) {
    logger.error({ err }, "ccdi.evidence.custody.list failed");
    res.status(500).json({ error: "Failed to list custody chain" });
  }
});

router.post(
  "/evidence/:id/custody",
  requireAuth,
  requireCcdiPermission("ccdi.findings.manage"),
  async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      if (!body.organizationId || !body.action) {
        res.status(400).json({ error: "organizationId and action are required" });
        return;
      }
      const result = await integrity.recordCustodyEvent({
        organizationId: String(body.organizationId),
        evidenceId: req.params.id,
        action: String(body.action),
        actorRef: actor(req),
        note: body.note,
        meta: body.meta,
      });
      if ("error" in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(201).json(result);
    } catch (err) {
      logger.error({ err }, "ccdi.evidence.custody.record failed");
      res.status(500).json({ error: "Failed to record custody event" });
    }
  },
);

router.post(
  "/evidence/:id/verify",
  requireAuth,
  requireCcdiPermission("ccdi.findings.manage"),
  async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      if (!body.organizationId) {
        res.status(400).json({ error: "organizationId is required" });
        return;
      }
      const result = await integrity.verifyEvidenceIntegrity({
        organizationId: String(body.organizationId),
        evidenceId: req.params.id,
        actorRef: actor(req),
        computedSha256: body.computedSha256,
      });
      if ("error" in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err) {
      logger.error({ err }, "ccdi.evidence.verify failed");
      res.status(500).json({ error: "Failed to verify evidence" });
    }
  },
);

export default router;
