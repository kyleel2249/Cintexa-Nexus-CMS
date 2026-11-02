/**
 * CINTEXA CCDI — Phase 5 Advanced Security Engines
 *
 * Controlled scaffolding for:
 * - Cloud security assessments
 * - Server / host security
 * - Container / Kubernetes security
 * - Mobile application security
 * - Database security
 * - IoT / Industrial (OT) security
 *
 * Every assessment creates a draft job that must pass:
 *   approved scope → human approval → queue
 * before any worker execution. This module never executes a security tool.
 *
 * Status: job drafting + finding recording only. Tool adapters, inventories and
 * reporting for these engines are NOT implemented (see docs/CCDI_PHASE5.md).
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import * as orch from "./ccdi-orchestration";
import * as engines from "./ccdi-engines";
import {
  ADVANCED_CONNECTOR_HINTS,
  ENGINE_JOB_TYPE,
  validateAssessmentRequest,
  validateDomainFinding,
  isUuid,
  type AdvancedEngineType,
  type AssessmentRequest,
  type DomainFindingInput,
} from "./ccdi-advanced-validation";

export type AdvancedJobType = AdvancedEngineType;
export { ADVANCED_CONNECTOR_HINTS, validateAssessmentRequest, validateDomainFinding };

type Err = { error: string; status: 400 | 404 | 409 | 500 };

/** Extract asset ids referenced by targets ({assetId} / {id}). */
function referencedAssetIds(targets: unknown[]): string[] {
  const ids = new Set<string>();
  for (const t of targets) {
    if (t && typeof t === "object") {
      const v = (t as any).assetId ?? (t as any).id;
      if (v !== undefined && v !== null) ids.add(String(v));
    }
  }
  return [...ids];
}

/**
 * Confirms every referenced asset belongs to the organisation and is not retired
 * or rejected. Discovery alone never authorises assessment — the approved scope
 * (checked by orch.createJob) still decides that.
 */
async function verifyAssetOwnership(organizationId: string, assetIds: string[]): Promise<Err | null> {
  if (assetIds.length === 0) return null;
  if (!assetIds.every(isUuid)) return { error: "Target assetId values must be valid UUIDs", status: 400 };
  const { rows } = await pool.query(
    `SELECT id FROM ccdi_assets
     WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND status NOT IN ('retired','rejected')`,
    [organizationId, assetIds],
  );
  if (rows.length !== assetIds.length) {
    // Same message whether the asset is missing, retired or belongs to another
    // organisation, so the response cannot be used to probe other tenants.
    return { error: "One or more target assets were not found in this organisation", status: 404 };
  }
  return null;
}

export async function requestAdvancedAssessment(
  input: AssessmentRequest & { requestedBy: string },
): Promise<{ job: any } | Err> {
  // Re-validate defensively: this function is also callable from other services.
  const v = validateAssessmentRequest(input);
  if (!v.ok) return { error: v.error, status: 400 };
  const req = v.value;

  const ownership = await verifyAssetOwnership(req.organizationId, referencedAssetIds(req.targets));
  if (ownership) return ownership;

  let connectorId: string | null = null;
  if (req.connectorKey) {
    const { rows } = await pool.query(
      `SELECT id, status FROM ccdi_connectors
       WHERE connector_key = $1 AND (organization_id = $2 OR organization_id IS NULL)
       ORDER BY organization_id NULLS LAST
       LIMIT 1`,
      [req.connectorKey, req.organizationId],
    );
    if (!rows[0]) {
      return { error: `Connector '${req.connectorKey}' is not registered`, status: 404 };
    }
    if (rows[0].status === "disabled") {
      return { error: `Connector '${req.connectorKey}' is disabled`, status: 409 };
    }
    connectorId = rows[0].id;
  }

  const result = await orch.createJob({
    organizationId: req.organizationId,
    scopeId: req.scopeId,
    connectorId,
    name: req.name,
    jobType: ENGINE_JOB_TYPE[req.engineType] as any,
    targets: req.targets,
    parameters: {
      ...req.parameters,
      engine: req.engineType,
      phase: 5,
      note: "Advanced assessment drafted by Phase 5 engine. Requires scope validation and human approval before execution.",
    },
    requestedBy: input.requestedBy,
  });

  if ("job" in result) {
    // Dedicated audit record: createJob only logs generic 'job.create'.
    await pool
      .query(
        `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, action, entity_type, entity_id, meta)
         VALUES ($1,$2,'advanced.assessment.request','job',$3,$4)`,
        [
          req.organizationId,
          input.requestedBy,
          result.job.id,
          JSON.stringify({
            engine: req.engineType,
            connectorKey: req.connectorKey ?? null,
            mode: req.parameters.mode ?? null,
            targetCount: req.targets.length,
          }),
        ],
      )
      .catch((err) => logger.warn({ err }, "advanced.assessment audit insert failed"));
  }

  return result as any;
}

/**
 * Record a cloud / server / container / mobile / database / IoT finding.
 * Verifies that referenced asset and job belong to the same organisation.
 */
export async function recordDomainFinding(input: DomainFindingInput): Promise<{ finding: any } | Err> {
  const v = validateDomainFinding(input);
  if (!v.ok) return { error: v.error, status: 400 };
  const f = v.value;

  const ownership = await verifyAssetOwnership(f.organizationId, f.assetId ? [f.assetId] : []);
  if (ownership) return ownership;

  if (f.jobId) {
    const { rows } = await pool.query(`SELECT 1 FROM ccdi_jobs WHERE id = $1 AND organization_id = $2`, [
      f.jobId,
      f.organizationId,
    ]);
    if (!rows[0]) return { error: "Job not found in this organisation", status: 404 };
  }

  const finding = await engines.upsertFinding({
    organizationId: f.organizationId,
    assetId: f.assetId,
    jobId: f.jobId,
    title: f.title,
    description: f.description,
    severity: f.severity,
    cveId: f.cveId,
    category: f.category ?? f.domain,
    affectedComponent: f.affectedComponent,
    evidenceSummary: f.evidenceSummary,
    remediation: f.remediation,
    sourceConnector: f.sourceConnector,
    // `domain` is set last so caller-supplied meta cannot override it.
    meta: { ...(f.meta ?? {}), domain: f.domain },
  });
  return { finding };
}

logger.info("CCDI Phase 5 advanced engines loaded");
