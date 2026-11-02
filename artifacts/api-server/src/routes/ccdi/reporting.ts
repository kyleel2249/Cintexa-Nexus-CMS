/**
 * CINTEXA CCDI — Phase 7 Reporting & Compliance routes
 */
import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { requireAuth } from "../../lib/auth-middleware";
import { logger } from "../../lib/logger";
import * as reporting from "../../services/ccdi-reporting";
import { pid } from "./http-util";

const router = Router();

function actor(req: Request): string {
  return String(req.auth?.sub ?? "unknown");
}

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  for (const stmt of reporting.CCDI_PHASE7_SCHEMA) {
    await pool.query(stmt).catch(() => undefined);
  }
  await reporting.seedComplianceFrameworks().catch(() => undefined);
  schemaReady = true;
}

// ── Posture dashboard ──────────────────────────────────────────────────────
router.get("/reporting/posture", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureSchema();
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    if (!orgId) {
      res.status(400).json({ error: "organizationId is required" });
      return;
    }
    const posture = await reporting.buildPostureSummary(orgId);
    res.json({ posture });
  } catch (err) {
    logger.error({ err }, "ccdi.reporting.posture failed");
    res.status(500).json({ error: "Failed to build posture summary" });
  }
});

// ── Report generation ──────────────────────────────────────────────────────
router.post("/reporting/generate", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureSchema();
    const { organizationId, reportType, title } = req.body ?? {};
    const allowed = ["executive", "operational", "audit", "compliance", "evidence_package"];
    if (!organizationId || !allowed.includes(reportType)) {
      res.status(400).json({
        error: `organizationId and reportType (${allowed.join("|")}) are required`,
      });
      return;
    }
    const report = await reporting.generateReport({
      organizationId,
      reportType,
      title,
      generatedBy: actor(req),
    });
    res.status(201).json({ report });
  } catch (err) {
    logger.error({ err }, "ccdi.reporting.generate failed");
    res.status(500).json({ error: "Failed to generate report" });
  }
});

router.get("/reporting/reports", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureSchema();
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const params: any[] = [];
    let where = "";
    if (orgId) {
      params.push(orgId);
      where = `WHERE organization_id = $1`;
    }
    const { rows } = await pool.query(
      `SELECT id, organization_id, report_type, title, status, summary, generated_by, generated_at, created_at
       FROM ccdi_reports ${where} ORDER BY generated_at DESC LIMIT 100`,
      params,
    );
    res.json({ reports: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.reporting.list failed");
    res.status(500).json({ error: "Failed to list reports" });
  }
});

router.get("/reporting/reports/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureSchema();
    const { rows } = await pool.query(`SELECT * FROM ccdi_reports WHERE id = $1`, [pid(req.params.id)]);
    if (!rows[0]) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    res.json({ report: rows[0] });
  } catch (err) {
    logger.error({ err }, "ccdi.reporting.get failed");
    res.status(500).json({ error: "Failed to load report" });
  }
});

// ── Compliance frameworks & mappings ───────────────────────────────────────
router.get("/reporting/frameworks", requireAuth, async (_req: Request, res: Response) => {
  try {
    await ensureSchema();
    const { rows } = await pool.query(
      `SELECT id, code, name, version, description, created_at FROM ccdi_compliance_frameworks ORDER BY code`,
    );
    res.json({ frameworks: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.reporting.frameworks failed");
    res.status(500).json({ error: "Failed to list frameworks" });
  }
});

router.get("/reporting/controls", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureSchema();
    const frameworkId = typeof req.query.frameworkId === "string" ? req.query.frameworkId : null;
    const params: any[] = [];
    let where = "";
    if (frameworkId) {
      params.push(frameworkId);
      where = `WHERE framework_id = $1`;
    }
    const { rows } = await pool.query(
      `SELECT id, framework_id, control_id, title, description, category
       FROM ccdi_compliance_controls ${where} ORDER BY control_id LIMIT 500`,
      params,
    );
    res.json({ controls: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.reporting.controls failed");
    res.status(500).json({ error: "Failed to list controls" });
  }
});

router.get("/reporting/mappings", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureSchema();
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    if (!orgId) {
      res.status(400).json({ error: "organizationId is required" });
      return;
    }
    const { rows } = await pool.query(
      `SELECT m.*, c.control_id AS control_code, c.title AS control_title, f.code AS framework_code
       FROM ccdi_compliance_mappings m
       JOIN ccdi_compliance_controls c ON c.id = m.control_id
       JOIN ccdi_compliance_frameworks f ON f.id = c.framework_id
       WHERE m.organization_id = $1
       ORDER BY f.code, c.control_id`,
      [orgId],
    );
    res.json({ mappings: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.reporting.mappings.list failed");
    res.status(500).json({ error: "Failed to list mappings" });
  }
});

router.post("/reporting/mappings", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureSchema();
    const body = req.body ?? {};
    if (!body.organizationId || !body.controlId || !body.status) {
      res.status(400).json({ error: "organizationId, controlId and status are required" });
      return;
    }
    const mapping = await reporting.upsertComplianceMapping({
      organizationId: body.organizationId,
      controlId: body.controlId,
      status: body.status,
      evidenceNotes: body.evidenceNotes,
      findingIds: body.findingIds,
      assessedBy: actor(req),
    });
    res.status(201).json({ mapping });
  } catch (err) {
    logger.error({ err }, "ccdi.reporting.mappings.upsert failed");
    res.status(500).json({ error: "Failed to save mapping" });
  }
});

export default router;
