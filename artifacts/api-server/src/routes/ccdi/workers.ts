/**
 * CINTEXA CCDI — Phase 8 Worker protocol routes
 * Intended for isolated worker processes, not browsers.
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../lib/auth-middleware";
import { logger } from "../../lib/logger";
import * as workers from "../../services/ccdi-workers";

const router = Router();

router.post("/workers/claim", requireAuth, async (req: Request, res: Response) => {
  try {
    const workerId = String(req.body?.workerId || req.auth?.sub || "anonymous-worker");
    const organizationId = req.body?.organizationId ? String(req.body.organizationId) : undefined;
    const result = await workers.claimNextJob(workerId, organizationId);
    if ("error" in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, "ccdi.workers.claim failed");
    res.status(500).json({ error: "Failed to claim job" });
  }
});

router.post("/workers/heartbeat", requireAuth, async (req: Request, res: Response) => {
  try {
    const { executionId, workerId, metrics } = req.body ?? {};
    if (!executionId || !workerId) {
      res.status(400).json({ error: "executionId and workerId are required" });
      return;
    }
    const result = await workers.heartbeatExecution(String(executionId), String(workerId), metrics);
    if ("error" in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, "ccdi.workers.heartbeat failed");
    res.status(500).json({ error: "Heartbeat failed" });
  }
});

router.post("/workers/complete", requireAuth, async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    if (!body.executionId || !body.workerId || typeof body.success !== "boolean") {
      res.status(400).json({ error: "executionId, workerId and success (boolean) are required" });
      return;
    }
    const result = await workers.completeExecution({
      executionId: String(body.executionId),
      workerId: String(body.workerId),
      success: body.success,
      exitCode: body.exitCode,
      stdoutSummary: body.stdoutSummary,
      stderrSummary: body.stderrSummary,
      metrics: body.metrics,
      evidence: body.evidence,
    });
    if ("error" in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, "ccdi.workers.complete failed");
    res.status(500).json({ error: "Failed to complete execution" });
  }
});

export default router;
