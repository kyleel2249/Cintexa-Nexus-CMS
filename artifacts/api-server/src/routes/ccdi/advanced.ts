/**
 * CINTEXA CCDI — Phase 5 Advanced Security Engine routes
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../lib/auth-middleware";
import { logger } from "../../lib/logger";
import * as advanced from "../../services/ccdi-advanced-engines";
import { httpStatus } from "./http-util";

const router = Router();

function actor(req: Request): string {
  return String(req.auth?.sub ?? "unknown");
}

/**
 * POST /api/ccdi/advanced/assessments
 * Body: { organizationId, scopeId, name, engineType, targets, parameters?, connectorKey? }
 * engineType: cloud_audit | server_audit | container_scan | mobile_scan | database_audit | iot_scan | config_audit | dependency_scan
 */
router.post("/advanced/assessments", requireAuth, async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    if (!body.organizationId || !body.scopeId || !body.name || !body.engineType) {
      res.status(400).json({
        error:
          "organizationId, scopeId, name and engineType are required. engineType one of: cloud_audit, server_audit, container_scan, mobile_scan, database_audit, iot_scan, config_audit, dependency_scan",
      });
      return;
    }

    const result = await advanced.requestAdvancedAssessment({
      organizationId: body.organizationId,
      scopeId: body.scopeId,
      name: body.name,
      engineType: body.engineType,
      targets: body.targets ?? [],
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
      note: "Advanced assessment job created in draft. Submit and obtain approval before any execution.",
      connectorHints: advanced.ADVANCED_CONNECTOR_HINTS,
    });
  } catch (err) {
    logger.error({ err }, "ccdi.advanced.assessments failed");
    res.status(500).json({ error: "Failed to create advanced assessment" });
  }
});

/**
 * POST /api/ccdi/advanced/findings
 * Record a domain-specific finding (cloud/server/container/mobile/database/iot).
 */
router.post("/advanced/findings", requireAuth, async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const domains = ["cloud", "server", "container", "mobile", "database", "iot"];
    if (!body.organizationId || !body.domain || !body.title || !body.severity) {
      res.status(400).json({
        error: "organizationId, domain, title and severity are required",
      });
      return;
    }
    if (!domains.includes(body.domain)) {
      res.status(400).json({ error: `domain must be one of: ${domains.join(", ")}` });
      return;
    }

    const finding = await advanced.recordDomainFinding({
      organizationId: body.organizationId,
      domain: body.domain,
      assetId: body.assetId,
      title: body.title,
      severity: body.severity,
      description: body.description,
      remediation: body.remediation,
      cveId: body.cveId,
      category: body.category,
      affectedComponent: body.affectedComponent,
      evidenceSummary: body.evidenceSummary,
      sourceConnector: body.sourceConnector,
      jobId: body.jobId,
      meta: body.meta,
    });

    res.status(201).json({ finding });
  } catch (err) {
    logger.error({ err }, "ccdi.advanced.findings failed");
    res.status(500).json({ error: "Failed to record domain finding" });
  }
});

/** Catalogue of Phase 5 engines (informational). */
router.get("/advanced/engines", requireAuth, (_req: Request, res: Response) => {
  res.json({
    phase: 5,
    engines: [
      { key: "cloud_audit", name: "Cloud Security Assessment", domains: ["AWS", "Azure", "GCP", "multi-cloud"] },
      { key: "server_audit", name: "Server / Host Security", domains: ["Linux", "Windows", "hardening"] },
      { key: "container_scan", name: "Container & Kubernetes Security", domains: ["images", "K8s", "runtime"] },
      { key: "mobile_scan", name: "Mobile Application Security", domains: ["Android", "iOS"] },
      { key: "database_audit", name: "Database Security", domains: ["SQL", "NoSQL", "configuration"] },
      { key: "iot_scan", name: "IoT & Industrial (OT) Security", domains: ["IoT", "ICS", "SCADA"] },
      { key: "config_audit", name: "Configuration Audit", domains: ["baseline", "CIS"] },
      { key: "dependency_scan", name: "Dependency / SCA Scan", domains: ["libraries", "SBOMs"] },
    ],
    connectorHints: advanced.ADVANCED_CONNECTOR_HINTS,
    note: "All engines create draft jobs that require an approved scope and human approval. No live scanning occurs without those gates.",
  });
});

export default router;
