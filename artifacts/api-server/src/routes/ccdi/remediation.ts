/**
 * CINTEXA CCDI — Phase 16 Remediation routes
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../lib/auth-middleware";
import { logger } from "../../lib/logger";
import * as rem from "../../services/ccdi-remediation";
import { requireCcdiPermission } from "../../services/ccdi-rbac";

const router = Router();

function actor(req: Request): string {
  return String(req.auth?.sub ?? "unknown");
}

router.get("/remediation/tasks", requireAuth, async (req: Request, res: Response) => {
  try {
    const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    if (!organizationId) {
      res.status(400).json({ error: "organizationId is required" });
      return;
    }
    const tasks = await rem.listRemediationTasks({
      organizationId,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      assigneeRef: typeof req.query.assigneeRef === "string" ? req.query.assigneeRef : undefined,
      findingId: typeof req.query.findingId === "string" ? req.query.findingId : undefined,
      limit: Number(req.query.limit) || 50,
    });
    res.json({ tasks });
  } catch (err) {
    logger.error({ err }, "ccdi.remediation.list failed");
    res.status(500).json({ error: "Failed to list remediation tasks" });
  }
});

router.get("/remediation/summary", requireAuth, async (req: Request, res: Response) => {
  try {
    const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    if (!organizationId) {
      res.status(400).json({ error: "organizationId is required" });
      return;
    }
    const summary = await rem.remediationSummary(organizationId);
    res.json({ summary });
  } catch (err) {
    logger.error({ err }, "ccdi.remediation.summary failed");
    res.status(500).json({ error: "Failed to load remediation summary" });
  }
});

router.post(
  "/remediation/tasks",
  requireAuth,
  requireCcdiPermission("ccdi.findings.manage"),
  async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      if (!body.organizationId || !body.title) {
        res.status(400).json({ error: "organizationId and title are required" });
        return;
      }
      const result = await rem.createRemediationTask({
        organizationId: String(body.organizationId),
        findingId: body.findingId ?? null,
        title: String(body.title),
        description: body.description,
        priority: body.priority,
        assigneeRef: body.assigneeRef,
        dueDate: body.dueDate,
        createdBy: actor(req),
      });
      if ("error" in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(201).json(result);
    } catch (err) {
      logger.error({ err }, "ccdi.remediation.create failed");
      res.status(500).json({ error: "Failed to create remediation task" });
    }
  },
);

router.patch(
  "/remediation/tasks/:id",
  requireAuth,
  requireCcdiPermission("ccdi.findings.manage"),
  async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      if (!body.organizationId) {
        res.status(400).json({ error: "organizationId is required" });
        return;
      }
      const result = await rem.updateRemediationTask({
        taskId: req.params.id,
        organizationId: String(body.organizationId),
        actor: actor(req),
        status: body.status,
        priority: body.priority,
        assigneeRef: body.assigneeRef,
        dueDate: body.dueDate,
        title: body.title,
        description: body.description,
      });
      if ("error" in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err) {
      logger.error({ err }, "ccdi.remediation.update failed");
      res.status(500).json({ error: "Failed to update remediation task" });
    }
  },
);

router.post(
  "/findings/:id/assign",
  requireAuth,
  requireCcdiPermission("ccdi.findings.manage"),
  async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      if (!body.organizationId || !body.ownerRef) {
        res.status(400).json({ error: "organizationId and ownerRef are required" });
        return;
      }
      const result = await rem.assignFinding({
        findingId: req.params.id,
        organizationId: String(body.organizationId),
        ownerRef: String(body.ownerRef),
        actor: actor(req),
        createTask: Boolean(body.createTask),
      });
      if ("error" in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err) {
      logger.error({ err }, "ccdi.findings.assign failed");
      res.status(500).json({ error: "Failed to assign finding" });
    }
  },
);

export default router;
