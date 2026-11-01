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
 * Every assessment still creates a draft job that must pass:
 *   approved scope → human approval → queue
 * before any future worker execution.
 *
 * No live unauthorised scanning or exploitation is performed here.
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import * as orch from "./ccdi-orchestration";
import * as engines from "./ccdi-engines";

export type AdvancedJobType =
  | "cloud_audit"
  | "server_audit"
  | "container_scan"
  | "mobile_scan"
  | "database_audit"
  | "iot_scan"
  | "config_audit"
  | "dependency_scan";

const ADVANCED_TYPES: AdvancedJobType[] = [
  "cloud_audit",
  "server_audit",
  "container_scan",
  "mobile_scan",
  "database_audit",
  "iot_scan",
  "config_audit",
  "dependency_scan",
];

// Extend the allowed job_type check at the application layer (DB constraint
// was defined in Phase 3; we map advanced types onto the existing 'custom'
// or 'config_audit' / 'dependency_scan' values where needed, and store the
// precise engine in parameters.engine).

export async function requestAdvancedAssessment(opts: {
  organizationId: string;
  scopeId: string;
  name: string;
  engineType: AdvancedJobType;
  targets: unknown[];
  parameters?: Record<string, unknown>;
  requestedBy: string;
  connectorKey?: string;
}) {
  if (!ADVANCED_TYPES.includes(opts.engineType)) {
    return { error: "Invalid advanced engine type", status: 400 as const };
  }

  if (!Array.isArray(opts.targets) || opts.targets.length === 0) {
    return { error: "targets array is required", status: 400 as const };
  }

  // Map to a Phase-3 job_type that exists in the CHECK constraint
  const jobTypeMap: Record<AdvancedJobType, string> = {
    cloud_audit: "config_audit",
    server_audit: "config_audit",
    container_scan: "vuln_scan",
    mobile_scan: "vuln_scan",
    database_audit: "config_audit",
    iot_scan: "port_scan",
    config_audit: "config_audit",
    dependency_scan: "dependency_scan",
  };

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

  const result = await orch.createJob({
    organizationId: opts.organizationId,
    scopeId: opts.scopeId,
    connectorId,
    name: opts.name,
    jobType: jobTypeMap[opts.engineType] as any,
    targets: opts.targets,
    parameters: {
      ...(opts.parameters ?? {}),
      engine: opts.engineType,
      phase: 5,
      note: "Advanced assessment created by Phase 5 engine. Requires scope validation and human approval before execution.",
    },
    requestedBy: opts.requestedBy,
  });

  return result;
}

/** Suggested connector keys per advanced domain (registered only). */
export const ADVANCED_CONNECTOR_HINTS: Record<string, string[]> = {
  cloud: ["prowler", "scoutsuite", "cloudquery"],
  server: ["lynis", "osquery", "inspec"],
  container: ["trivy", "grype", "kube-bench", "kubehunter"],
  mobile: ["mobsf", "qark"],
  database: ["sqlmap", "db-audit"],
  iot: ["nmap", "shodan", "iot-scanner"],
};

/**
 * Record a cloud / server / container finding with domain-specific defaults.
 */
export async function recordDomainFinding(opts: {
  organizationId: string;
  domain: "cloud" | "server" | "container" | "mobile" | "database" | "iot";
  assetId?: string;
  title: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  description?: string;
  remediation?: string;
  cveId?: string;
  category?: string;
  affectedComponent?: string;
  evidenceSummary?: string;
  sourceConnector?: string;
  jobId?: string;
  meta?: Record<string, unknown>;
}) {
  return engines.upsertFinding({
    organizationId: opts.organizationId,
    assetId: opts.assetId,
    jobId: opts.jobId,
    title: opts.title,
    description: opts.description,
    severity: opts.severity,
    cveId: opts.cveId,
    category: opts.category ?? opts.domain,
    affectedComponent: opts.affectedComponent,
    evidenceSummary: opts.evidenceSummary,
    remediation: opts.remediation,
    sourceConnector: opts.sourceConnector,
    meta: { domain: opts.domain, ...(opts.meta ?? {}) },
  });
}

logger.info("CCDI Phase 5 advanced engines loaded");
