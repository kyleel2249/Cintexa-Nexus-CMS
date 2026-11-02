/**
 * CINTEXA CCDI — Phase 5 Advanced Security Engine routes
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../lib/auth-middleware";
import { requireCcdiPermission } from "../../services/ccdi-rbac";
import { logger } from "../../lib/logger";
import * as advanced from "../../services/ccdi-advanced-engines";
import { ADVANCED_ENGINE_TYPES } from "../../services/ccdi-advanced-validation";
import { httpStatus } from "./http-util";

const router = Router();

function actor(req: Request): string {
  return String(req.auth?.sub ?? "unknown");
}

/**
 * POST /api/ccdi/advanced/assessments
 * Body: { organizationId, scopeId, name, engineType, targets, parameters?, connectorKey? }
 * Requires permission ccdi.jobs.request in the organisation.
 * An approved, unexpired scope is mandatory; the job is created as a draft only.
 */
router.post(
  "/advanced/assessments",
  requireAuth,
  requireCcdiPermission("ccdi.jobs.request"),
  async (req: Request, res: Response) => {
    try {
      const parsed = advanced.validateAssessmentRequest(req.body);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const result = await advanced.requestAdvancedAssessment({
        ...parsed.value,
        requestedBy: actor(req),
      });

      if ("error" in result) {
        res.status(httpStatus(result.status)).json({ error: result.error });
        return;
      }

      res.status(201).json({
        ...result,
        note: "Advanced assessment job created in draft. Submit and obtain approval before any execution. No tool has been executed.",
        connectorHints: advanced.ADVANCED_CONNECTOR_HINTS,
      });
    } catch (err) {
      logger.error({ err }, "ccdi.advanced.assessments failed");
      res.status(500).json({ error: "Failed to create advanced assessment" });
    }
  },
);

/**
 * POST /api/ccdi/advanced/findings
 * Record a domain-specific finding (cloud/server/container/mobile/database/iot).
 * Requires permission ccdi.findings.manage in the organisation.
 */
router.post(
  "/advanced/findings",
  requireAuth,
  requireCcdiPermission("ccdi.findings.manage"),
  async (req: Request, res: Response) => {
    try {
      const parsed = advanced.validateDomainFinding(req.body);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const result = await advanced.recordDomainFinding(parsed.value);
      if ("error" in result) {
        res.status(httpStatus(result.status)).json({ error: result.error });
        return;
      }

      res.status(201).json({ finding: result.finding });
    } catch (err) {
      logger.error({ err }, "ccdi.advanced.findings failed");
      res.status(500).json({ error: "Failed to record domain finding" });
    }
  },
);

/** Catalogue of Phase 5 engines (informational). */
router.get(
  "/advanced/engines",
  requireAuth,
  requireCcdiPermission("ccdi.jobs.view"),
  (_req: Request, res: Response) => {
    const catalogue: Record<(typeof ADVANCED_ENGINE_TYPES)[number], { name: string; domains: string[] }> = {
      cloud_audit: { name: "Cloud Security Assessment", domains: ["AWS", "Azure", "GCP", "multi-cloud"] },
      server_audit: { name: "Server / Host Security", domains: ["Linux", "Windows", "hardening"] },
      container_scan: { name: "Container & Kubernetes Security", domains: ["images", "K8s", "runtime"] },
      mobile_scan: { name: "Mobile Application Security", domains: ["Android", "iOS"] },
      database_audit: { name: "Database Security", domains: ["SQL", "NoSQL", "configuration"] },
      iot_scan: { name: "IoT & Industrial (OT) Security", domains: ["IoT", "ICS", "SCADA"] },
      config_audit: { name: "Configuration Audit", domains: ["baseline", "CIS"] },
      dependency_scan: { name: "Dependency / SCA Scan", domains: ["libraries", "SBOMs"] },
    };
    res.json({
      phase: 5,
      engines: ADVANCED_ENGINE_TYPES.map((key) => ({ key, ...catalogue[key] })),
      connectorHints: advanced.ADVANCED_CONNECTOR_HINTS,
      note:
        "Connector hints are registry suggestions only; they do not indicate a tool is installed, configured or validated. " +
        "All engines create draft jobs requiring an approved scope and human approval. IoT/OT is passive by default.",
    });
  },
);

export default router;
