/**
 * CINTEXA CCDI — Phase 6 Intelligence & AI Agent routes
 */
import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { requireAuth } from "../../lib/auth-middleware";
import { logger } from "../../lib/logger";
import * as intel from "../../services/ccdi-intelligence";
import { pid, httpStatus } from "./http-util";

const router = Router();

function actor(req: Request): string {
  return String(req.auth?.sub ?? "unknown");
}

// Ensure Phase 6 tables exist (idempotent)
let schemaEnsured = false;
async function ensurePhase6Schema() {
  if (schemaEnsured) return;
  for (const stmt of intel.CCDI_PHASE6_SCHEMA) {
    await pool.query(stmt).catch(() => undefined);
  }
  schemaEnsured = true;
}

// ── Prioritisation ─────────────────────────────────────────────────────────
router.get("/intelligence/priorities", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensurePhase6Schema();
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    if (!orgId) {
      res.status(400).json({ error: "organizationId is required" });
      return;
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const items = await intel.prioritiseFindings(orgId, limit);
    res.json({ priorities: items });
  } catch (err) {
    logger.error({ err }, "ccdi.intelligence.priorities failed");
    res.status(500).json({ error: "Failed to prioritise findings" });
  }
});

// ── Correlation ────────────────────────────────────────────────────────────
router.post("/intelligence/correlate", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensurePhase6Schema();
    const orgId = req.body?.organizationId;
    if (!orgId) {
      res.status(400).json({ error: "organizationId is required" });
      return;
    }
    const correlations = await intel.runCorrelation(String(orgId));
    res.json({
      correlations,
      note: "Rule-based correlation of high/critical findings sharing the same asset.",
    });
  } catch (err) {
    logger.error({ err }, "ccdi.intelligence.correlate failed");
    res.status(500).json({ error: "Correlation failed" });
  }
});

router.get("/intelligence/correlations", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensurePhase6Schema();
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const params: any[] = [];
    let where = "";
    if (orgId) {
      params.push(orgId);
      where = `WHERE organization_id = $1`;
    }
    const { rows } = await pool.query(
      `SELECT * FROM ccdi_correlations ${where} ORDER BY score DESC, created_at DESC LIMIT 100`,
      params,
    );
    res.json({ correlations: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.intelligence.correlations.list failed");
    res.status(500).json({ error: "Failed to list correlations" });
  }
});

// ── Triage ─────────────────────────────────────────────────────────────────
router.post("/intelligence/triage/:findingId", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensurePhase6Schema();
    const orgId = req.body?.organizationId;
    if (!orgId) {
      res.status(400).json({ error: "organizationId is required" });
      return;
    }
    const result = await intel.triageFinding(pid(req.params.findingId), String(orgId), actor(req));
    if ("error" in result) {
      res.status(httpStatus(result.status)).json({ error: result.error });
      return;
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, "ccdi.intelligence.triage failed");
    res.status(500).json({ error: "Triage failed" });
  }
});

// ── AI Advisory Agent ──────────────────────────────────────────────────────
router.post("/intelligence/advisory", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensurePhase6Schema();
    const { organizationId, question, contextFindingIds } = req.body ?? {};
    if (!organizationId || !question) {
      res.status(400).json({ error: "organizationId and question are required" });
      return;
    }
    const result = await intel.runAdvisoryAgent({
      organizationId: String(organizationId),
      question: String(question),
      contextFindingIds: Array.isArray(contextFindingIds) ? contextFindingIds : undefined,
      actor: actor(req),
    });
    if ("error" in result) {
      res.status(httpStatus(result.status)).json({ error: result.error });
      return;
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, "ccdi.intelligence.advisory failed");
    res.status(500).json({ error: "Advisory agent failed" });
  }
});

// ── Threat intelligence ────────────────────────────────────────────────────
router.get("/intelligence/threat-intel", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensurePhase6Schema();
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const params: any[] = [];
    let where = "";
    if (orgId) {
      params.push(orgId);
      where = `WHERE organization_id = $1 OR organization_id IS NULL`;
    }
    const { rows } = await pool.query(
      `SELECT * FROM ccdi_threat_intel ${where} ORDER BY last_seen_at DESC LIMIT 200`,
      params,
    );
    res.json({ indicators: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.intelligence.threat-intel.list failed");
    res.status(500).json({ error: "Failed to list threat intel" });
  }
});

router.post("/intelligence/threat-intel", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensurePhase6Schema();
    const body = req.body ?? {};
    if (!body.source || !body.indicatorType || !body.indicatorValue) {
      res.status(400).json({ error: "source, indicatorType and indicatorValue are required" });
      return;
    }
    const record = await intel.addThreatIntel({
      organizationId: body.organizationId,
      source: body.source,
      indicatorType: body.indicatorType,
      indicatorValue: body.indicatorValue,
      title: body.title,
      description: body.description,
      severity: body.severity,
      confidence: body.confidence,
      tags: body.tags,
      meta: body.meta,
    });
    res.status(201).json({ indicator: record });
  } catch (err) {
    logger.error({ err }, "ccdi.intelligence.threat-intel.create failed");
    res.status(500).json({ error: "Failed to add threat intel" });
  }
});

// ── Workflows ──────────────────────────────────────────────────────────────
router.get("/intelligence/workflows", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensurePhase6Schema();
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const params: any[] = [];
    let where = "";
    if (orgId) {
      params.push(orgId);
      where = `WHERE organization_id = $1`;
    }
    const { rows } = await pool.query(
      `SELECT * FROM ccdi_workflows ${where} ORDER BY updated_at DESC LIMIT 100`,
      params,
    );
    res.json({ workflows: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.intelligence.workflows.list failed");
    res.status(500).json({ error: "Failed to list workflows" });
  }
});

router.post("/intelligence/workflows", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensurePhase6Schema();
    const body = req.body ?? {};
    if (!body.organizationId || !body.name || !body.triggerType) {
      res.status(400).json({ error: "organizationId, name and triggerType are required" });
      return;
    }
    const wf = await intel.createWorkflow({
      organizationId: body.organizationId,
      name: body.name,
      description: body.description,
      triggerType: body.triggerType,
      triggerConfig: body.triggerConfig,
      steps: body.steps,
      createdBy: actor(req),
    });
    res.status(201).json({
      workflow: wf,
      note: "Workflows are definition-only in Phase 6. Execution is advisory / semi-automated and never performs unauthorised actions.",
    });
  } catch (err) {
    logger.error({ err }, "ccdi.intelligence.workflows.create failed");
    res.status(500).json({ error: "Failed to create workflow" });
  }
});

// ── Agent run history ──────────────────────────────────────────────────────
router.get("/intelligence/agent-runs", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensurePhase6Schema();
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const params: any[] = [];
    let where = "";
    if (orgId) {
      params.push(orgId);
      where = `WHERE organization_id = $1`;
    }
    const { rows } = await pool.query(
      `SELECT id, organization_id, agent_type, input_summary, output_summary, model, status, created_by, created_at
       FROM ccdi_agent_runs ${where} ORDER BY created_at DESC LIMIT 100`,
      params,
    );
    res.json({ runs: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.intelligence.agent-runs failed");
    res.status(500).json({ error: "Failed to list agent runs" });
  }
});

export default router;
