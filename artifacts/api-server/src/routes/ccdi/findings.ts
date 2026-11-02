/**
 * CINTEXA CCDI — Phase 4 Findings & Attack Surface routes
 * Mounted under /api/ccdi
 */
import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { requireAuth } from "../../lib/auth-middleware";
import { logger } from "../../lib/logger";
import * as engines from "../../services/ccdi-engines";
import { pid, httpStatus } from "./http-util";

const router = Router();

function actor(req: Request): string {
  return String(req.auth?.sub ?? "unknown");
}

// ── Findings ───────────────────────────────────────────────────────────────
router.get("/findings", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const severity = typeof req.query.severity === "string" ? req.query.severity : null;
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const params: any[] = [];
    const clauses: string[] = [];
    if (orgId) {
      params.push(orgId);
      clauses.push(`organization_id = $${params.length}`);
    }
    if (severity) {
      params.push(severity);
      clauses.push(`severity = $${params.length}`);
    }
    if (status) {
      params.push(status);
      clauses.push(`status = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT id, organization_id, asset_id, job_id, title, severity, status, cve_id, cwe_id,
              cvss_score, category, affected_url, affected_component, evidence_summary,
              remediation, first_seen_at, last_seen_at, owner_ref, source_connector, created_at, updated_at
       FROM ccdi_findings ${where}
       ORDER BY
         CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
         last_seen_at DESC
       LIMIT $${params.length}`,
      params,
    );
    res.json({ findings: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.findings.list failed");
    res.status(500).json({ error: "Failed to list findings" });
  }
});

router.post("/findings", requireAuth, async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    if (!body.organizationId || !body.title || !body.severity) {
      res.status(400).json({ error: "organizationId, title and severity are required" });
      return;
    }
    const finding = await engines.upsertFinding({
      organizationId: body.organizationId,
      assetId: body.assetId,
      jobId: body.jobId,
      executionId: body.executionId,
      title: body.title,
      description: body.description,
      severity: body.severity,
      cveId: body.cveId,
      cweId: body.cweId,
      cvssScore: body.cvssScore,
      cvssVector: body.cvssVector,
      category: body.category,
      affectedUrl: body.affectedUrl,
      affectedComponent: body.affectedComponent,
      evidenceSummary: body.evidenceSummary,
      remediation: body.remediation,
      references: body.references,
      sourceConnector: body.sourceConnector,
      ownerRef: body.ownerRef,
      meta: body.meta,
    });
    res.status(201).json({ finding });
  } catch (err) {
    logger.error({ err }, "ccdi.findings.create failed");
    res.status(500).json({ error: "Failed to create finding" });
  }
});

router.patch("/findings/:id/status", requireAuth, async (req: Request, res: Response) => {
  const { organizationId, status } = req.body ?? {};
  if (!organizationId || !status) {
    res.status(400).json({ error: "organizationId and status are required" });
    return;
  }
  const result = await engines.updateFindingStatus(pid(req.params.id), String(organizationId), status, actor(req));
  if ("error" in result) {
    res.status(httpStatus(result.status)).json({ error: result.error });
    return;
  }
  res.json(result);
});

// ── Attack surface ─────────────────────────────────────────────────────────
router.get("/attack-surface", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const params: any[] = [];
    let where = "";
    if (orgId) {
      params.push(orgId);
      where = `WHERE organization_id = $1`;
    }
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT id, organization_id, asset_id, surface_type, value, protocol, port, technology,
              confidence, first_seen_at, last_seen_at, source_job_id, created_at
       FROM ccdi_attack_surface ${where}
       ORDER BY last_seen_at DESC LIMIT $${params.length}`,
      params,
    );
    res.json({ attackSurface: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.attack-surface.list failed");
    res.status(500).json({ error: "Failed to list attack surface" });
  }
});

router.post("/attack-surface", requireAuth, async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    if (!body.organizationId || !body.surfaceType || !body.value) {
      res.status(400).json({ error: "organizationId, surfaceType and value are required" });
      return;
    }
    const record = await engines.recordAttackSurface({
      organizationId: body.organizationId,
      assetId: body.assetId,
      surfaceType: body.surfaceType,
      value: body.value,
      protocol: body.protocol,
      port: body.port,
      technology: body.technology,
      confidence: body.confidence,
      sourceJobId: body.sourceJobId,
      meta: body.meta,
    });
    res.status(201).json({ record });
  } catch (err) {
    logger.error({ err }, "ccdi.attack-surface.create failed");
    res.status(500).json({ error: "Failed to record attack surface" });
  }
});

// ── Controlled assessment request ──────────────────────────────────────────
router.post("/assessments/request", requireAuth, async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const allowed = ["web_scan", "port_scan", "api_scan", "vuln_scan", "asset_discovery"];
    if (!body.organizationId || !body.scopeId || !body.name || !allowed.includes(body.jobType)) {
      res.status(400).json({
        error: "organizationId, scopeId, name and jobType (web_scan|port_scan|api_scan|vuln_scan|asset_discovery) are required",
      });
      return;
    }
    if (!Array.isArray(body.targets) || body.targets.length === 0) {
      res.status(400).json({ error: "targets array is required" });
      return;
    }
    const result = await engines.requestAssessmentJob({
      organizationId: body.organizationId,
      scopeId: body.scopeId,
      name: body.name,
      jobType: body.jobType,
      targets: body.targets,
      parameters: body.parameters,
      requestedBy: actor(req),
      connectorKey: body.connectorKey,
    });
    if ("error" in result) {
      res.status(httpStatus(result.status)).json({ error: result.error });
      return;
    }
    res.status(201).json({
      ...result,
      note: "Assessment job created in draft. It must be submitted and approved before any execution.",
    });
  } catch (err) {
    logger.error({ err }, "ccdi.assessments.request failed");
    res.status(500).json({ error: "Failed to request assessment" });
  }
});

export default router;
