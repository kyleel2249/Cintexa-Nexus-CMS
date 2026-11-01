/**
 * CINTEXA CCDI — Phase 4 Core Security Engines
 *
 * Provides controlled, scope-gated helpers for:
 * - Asset discovery (passive / inventory based)
 * - Attack-surface recording
 * - Vulnerability / finding management
 * - Website, network and API assessment job scaffolding
 *
 * All active work still flows through the Phase 3 orchestration pipeline
 * (scope → approval → job). No unauthorised scanning or exploitation occurs here.
 */
import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import * as orch from "./ccdi-orchestration";

function fingerprint(parts: string[]): string {
  return createHash("sha256").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 40);
}

// ── Asset discovery (inventory-driven) ─────────────────────────────────────

export interface DiscoverAssetInput {
  organizationId: string;
  name: string;
  assetType: string;
  identifier: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  ownershipVerified?: boolean;
  createdBy: string;
}

export async function discoverOrUpsertAsset(input: DiscoverAssetInput) {
  const { rows } = await pool.query(
    `INSERT INTO ccdi_assets
       (organization_id, name, asset_type, identifier, tags, metadata, ownership_verified, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'discovered',$8)
     ON CONFLICT (organization_id, identifier) WHERE status <> 'retired'
     DO UPDATE SET
       name = EXCLUDED.name,
       asset_type = EXCLUDED.asset_type,
       tags = EXCLUDED.tags,
       metadata = ccdi_assets.metadata || EXCLUDED.metadata,
       updated_at = now()
     RETURNING *`,
    [
      input.organizationId,
      input.name.trim(),
      input.assetType,
      input.identifier.trim(),
      input.tags ?? [],
      input.metadata ?? {},
      input.ownershipVerified ?? false,
      input.createdBy,
    ],
  );
  return rows[0];
}

// ── Attack surface ─────────────────────────────────────────────────────────

export interface AttackSurfaceInput {
  organizationId: string;
  assetId?: string | null;
  surfaceType: string;
  value: string;
  protocol?: string;
  port?: number;
  technology?: string;
  confidence?: string;
  sourceJobId?: string | null;
  meta?: Record<string, unknown>;
}

export async function recordAttackSurface(input: AttackSurfaceInput) {
  const { rows } = await pool.query(
    `INSERT INTO ccdi_attack_surface
       (organization_id, asset_id, surface_type, value, protocol, port, technology, confidence, source_job_id, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      input.organizationId,
      input.assetId ?? null,
      input.surfaceType,
      input.value,
      input.protocol ?? null,
      input.port ?? null,
      input.technology ?? null,
      input.confidence ?? "medium",
      input.sourceJobId ?? null,
      input.meta ?? {},
    ],
  );
  return rows[0];
}

// ── Findings / Vulnerability management ────────────────────────────────────

export interface FindingInput {
  organizationId: string;
  assetId?: string | null;
  jobId?: string | null;
  executionId?: string | null;
  title: string;
  description?: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  cveId?: string;
  cweId?: string;
  cvssScore?: number;
  cvssVector?: string;
  category?: string;
  affectedUrl?: string;
  affectedComponent?: string;
  evidenceSummary?: string;
  remediation?: string;
  references?: unknown[];
  sourceConnector?: string;
  ownerRef?: string;
  meta?: Record<string, unknown>;
}

export async function upsertFinding(input: FindingInput) {
  const fp = fingerprint([
    input.organizationId,
    input.assetId ?? "",
    input.title,
    input.affectedUrl ?? "",
    input.affectedComponent ?? "",
    input.cveId ?? "",
  ]);

  const { rows } = await pool.query(
    `INSERT INTO ccdi_findings
       (organization_id, asset_id, job_id, execution_id, title, description, severity,
        cve_id, cwe_id, cvss_score, cvss_vector, category, affected_url, affected_component,
        evidence_summary, remediation, references, source_connector, fingerprint, owner_ref, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (organization_id, fingerprint) WHERE fingerprint IS NOT NULL AND status NOT IN ('resolved','false_positive','duplicate')
     DO UPDATE SET
       last_seen_at = now(),
       severity = EXCLUDED.severity,
       evidence_summary = COALESCE(EXCLUDED.evidence_summary, ccdi_findings.evidence_summary),
       updated_at = now()
     RETURNING *`,
    [
      input.organizationId,
      input.assetId ?? null,
      input.jobId ?? null,
      input.executionId ?? null,
      input.title,
      input.description ?? null,
      input.severity,
      input.cveId ?? null,
      input.cweId ?? null,
      input.cvssScore ?? null,
      input.cvssVector ?? null,
      input.category ?? null,
      input.affectedUrl ?? null,
      input.affectedComponent ?? null,
      input.evidenceSummary ?? null,
      input.remediation ?? null,
      JSON.stringify(input.references ?? []),
      input.sourceConnector ?? null,
      fp,
      input.ownerRef ?? null,
      input.meta ?? {},
    ],
  );
  return rows[0];
}

export async function updateFindingStatus(
  findingId: string,
  organizationId: string,
  status: string,
  actor: string,
) {
  const allowed = ["open", "confirmed", "in_progress", "resolved", "accepted_risk", "false_positive", "duplicate"];
  if (!allowed.includes(status)) {
    return { error: "Invalid status", status: 400 as const };
  }
  const { rows } = await pool.query(
    `UPDATE ccdi_findings
     SET status = $1,
         resolved_at = CASE WHEN $1 IN ('resolved','false_positive','accepted_risk') THEN now() ELSE resolved_at END,
         updated_at = now()
     WHERE id = $2 AND organization_id = $3
     RETURNING *`,
    [status, findingId, organizationId],
  );
  if (!rows[0]) return { error: "Finding not found", status: 404 as const };

  await pool.query(
    `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, action, entity_type, entity_id, meta)
     VALUES ($1,$2,'finding.status_change','finding',$3,$4)`,
    [organizationId, actor, findingId, JSON.stringify({ status })],
  );
  return { finding: rows[0] };
}

// ── Controlled assessment job scaffolding ──────────────────────────────────

/**
 * Creates a draft assessment job that must still go through scope validation
 * and human approval before any execution can occur.
 */
export async function requestAssessmentJob(opts: {
  organizationId: string;
  scopeId: string;
  name: string;
  jobType: "web_scan" | "port_scan" | "api_scan" | "vuln_scan" | "asset_discovery";
  targets: unknown[];
  parameters?: Record<string, unknown>;
  requestedBy: string;
  connectorKey?: string;
}) {
  // Resolve connector if provided
  let connectorId: string | null = null;
  if (opts.connectorKey) {
    const { rows } = await pool.query(
      `SELECT id FROM ccdi_connectors
       WHERE connector_key = $1 AND (organization_id = $2 OR organization_id IS NULL)
       LIMIT 1`,
      [opts.connectorKey, opts.organizationId],
    );
    connectorId = rows[0]?.id ?? null;
  }

  return orch.createJob({
    organizationId: opts.organizationId,
    scopeId: opts.scopeId,
    connectorId,
    name: opts.name,
    jobType: opts.jobType,
    targets: opts.targets,
    parameters: {
      ...(opts.parameters ?? {}),
      engine: "ccdi-phase4",
      note: "Job created by Phase 4 engine. Requires approval before any active testing.",
    },
    requestedBy: opts.requestedBy,
  });
}

// ── Summary helpers for Command Centre ─────────────────────────────────────

export async function findingsSummary(organizationId?: string | null) {
  const params: any[] = [];
  let filter = "";
  if (organizationId) {
    params.push(organizationId);
    filter = `WHERE organization_id = $1`;
  }
  const { rows } = await pool.query(
    `SELECT
       count(*)::int AS total,
       count(*) FILTER (WHERE status = 'open')::int AS open,
       count(*) FILTER (WHERE severity = 'critical')::int AS critical,
       count(*) FILTER (WHERE severity = 'high')::int AS high,
       count(*) FILTER (WHERE severity = 'medium')::int AS medium,
       count(*) FILTER (WHERE severity = 'low')::int AS low
     FROM ccdi_findings ${filter}`,
    params,
  );
  return rows[0] ?? { total: 0, open: 0, critical: 0, high: 0, medium: 0, low: 0 };
}

logger.info("CCDI Phase 4 engines loaded");
