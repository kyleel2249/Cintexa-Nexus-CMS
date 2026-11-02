/**
 * CINTEXA CCDI — Phase 5 advanced engine validation (pure, no I/O).
 *
 * Kept free of database imports so every rule here is unit-testable and so the
 * routes and the service share one definition of what is allowed.
 */

export const ADVANCED_ENGINE_TYPES = [
  "cloud_audit",
  "server_audit",
  "container_scan",
  "mobile_scan",
  "database_audit",
  "iot_scan",
  "config_audit",
  "dependency_scan",
] as const;
export type AdvancedEngineType = (typeof ADVANCED_ENGINE_TYPES)[number];

export const FINDING_DOMAINS = ["cloud", "server", "container", "mobile", "database", "iot"] as const;
export type FindingDomain = (typeof FINDING_DOMAINS)[number];

export const FINDING_SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/**
 * Maps a Phase 5 engine onto a job_type allowed by the Phase 3 CHECK constraint.
 *
 * Safety: no engine maps onto an *active network probing* job type. In particular
 * IoT/OT must never map to "port_scan" — that would turn an OT assessment into
 * active scanning of industrial equipment, which the Phase 5 safety rules forbid
 * by default. Every Phase 5 engine is configuration/inventory/analysis oriented.
 */
export const ENGINE_JOB_TYPE: Record<AdvancedEngineType, string> = {
  cloud_audit: "config_audit",
  server_audit: "config_audit",
  container_scan: "vuln_scan",
  mobile_scan: "vuln_scan",
  database_audit: "config_audit",
  iot_scan: "config_audit",
  config_audit: "config_audit",
  dependency_scan: "dependency_scan",
};

/**
 * Registered connector hints per domain. These are *hints only*: a hint does not
 * mean the tool is installed, configured, connected or validated.
 *
 * Deliberately excluded:
 *  - sqlmap  (SQL-injection exploitation tool; database assessment is
 *             configuration/privilege review, not exploitation)
 *  - nmap / shodan for IoT/OT (active scanning / third-party exposure lookups
 *             are not passive-by-default OT assessment)
 *  - frida / objection are dynamic-analysis tools: listed under `mobile_dynamic`
 *             and only usable on explicitly authorised test apps.
 */
export const ADVANCED_CONNECTOR_HINTS: Record<string, string[]> = {
  cloud: ["prowler", "scoutsuite", "checkov"],
  server: ["openscap", "lynis", "trivy"],
  container: ["trivy", "grype", "syft", "kube-bench", "checkov"],
  container_runtime_monitoring: ["falco"],
  mobile: ["mobsf", "jadx", "apktool"],
  mobile_dynamic: ["frida", "objection"],
  database: [],
  iot_firmware: ["binwalk", "emba", "yara"],
};

/** Connector keys that must never be attached to a Phase 5 assessment. */
export const FORBIDDEN_CONNECTORS: ReadonlySet<string> = new Set([
  "sqlmap",
  "metasploit",
  "hydra",
  "masscan",
  "nmap", // active scanning – not permitted for Phase 5 engines
  "shodan",
]);

/** Connectors that perform dynamic instrumentation and need an authorised test app. */
export const DYNAMIC_ANALYSIS_CONNECTORS: ReadonlySet<string> = new Set(["frida", "objection"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

export interface OtActiveAuthorisation {
  systemOwnerPermissionRef: string;
  maintenanceWindow: { start: string; end: string };
  approvedTestProcedureRef: string;
  qualifiedOtReviewer: string;
}

/**
 * OT/IoT safety guard.
 *
 * Passive is the default. Anything else (mode === "active") is rejected unless a
 * complete, documented authorisation package is supplied. Even then the resulting
 * job still goes through scope approval + human approval; this only controls
 * whether an active request may be *drafted*.
 */
export function validateIotMode(
  parameters: Record<string, unknown> | undefined,
): Validation<{ mode: "passive" | "active"; authorisation?: OtActiveAuthorisation }> {
  const modeRaw = parameters?.mode ?? "passive";
  if (modeRaw !== "passive" && modeRaw !== "active") {
    return { ok: false, error: "parameters.mode must be 'passive' or 'active'" };
  }
  if (modeRaw === "passive") return { ok: true, value: { mode: "passive" } };

  const a = parameters?.otAuthorisation as Record<string, any> | undefined;
  const missing: string[] = [];
  const str = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  if (!a || typeof a !== "object") {
    return {
      ok: false,
      error:
        "Active IoT/OT assessment requires parameters.otAuthorisation (system-owner permission, maintenance window, approved test procedure, qualified OT reviewer)",
    };
  }
  if (!str(a.systemOwnerPermissionRef)) missing.push("systemOwnerPermissionRef");
  if (!str(a.approvedTestProcedureRef)) missing.push("approvedTestProcedureRef");
  if (!str(a.qualifiedOtReviewer)) missing.push("qualifiedOtReviewer");
  const mw = a.maintenanceWindow;
  const start = mw && Date.parse(String(mw.start));
  const end = mw && Date.parse(String(mw.end));
  if (!mw || Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    missing.push("maintenanceWindow{start<end}");
  }
  if (missing.length) {
    return { ok: false, error: `Active IoT/OT assessment authorisation incomplete: ${missing.join(", ")}` };
  }
  return {
    ok: true,
    value: {
      mode: "active",
      authorisation: {
        systemOwnerPermissionRef: a.systemOwnerPermissionRef.trim(),
        maintenanceWindow: { start: String(mw.start), end: String(mw.end) },
        approvedTestProcedureRef: a.approvedTestProcedureRef.trim(),
        qualifiedOtReviewer: a.qualifiedOtReviewer.trim(),
      },
    },
  };
}

export interface AssessmentRequest {
  organizationId: string;
  scopeId: string;
  name: string;
  engineType: AdvancedEngineType;
  targets: unknown[];
  parameters: Record<string, unknown>;
  connectorKey?: string;
}

const MAX_TARGETS = 500;
const MAX_NAME = 200;

export function validateAssessmentRequest(body: any): Validation<AssessmentRequest> {
  if (!body || typeof body !== "object") return { ok: false, error: "Request body is required" };

  if (!isUuid(body.organizationId)) return { ok: false, error: "organizationId must be a valid UUID" };
  // A scope is mandatory for Phase 5: assessments must never be drafted without an
  // authorised scope to validate targets against.
  if (!isUuid(body.scopeId)) return { ok: false, error: "scopeId must be a valid UUID (an approved scope is required)" };

  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > MAX_NAME) {
    return { ok: false, error: `name is required (1-${MAX_NAME} characters)` };
  }
  if (!ADVANCED_ENGINE_TYPES.includes(body.engineType)) {
    return { ok: false, error: `engineType must be one of: ${ADVANCED_ENGINE_TYPES.join(", ")}` };
  }
  if (!Array.isArray(body.targets) || body.targets.length === 0) {
    return { ok: false, error: "targets must be a non-empty array" };
  }
  if (body.targets.length > MAX_TARGETS) {
    return { ok: false, error: `targets may contain at most ${MAX_TARGETS} entries` };
  }
  if (body.parameters !== undefined && (typeof body.parameters !== "object" || body.parameters === null || Array.isArray(body.parameters))) {
    return { ok: false, error: "parameters must be an object" };
  }
  const parameters: Record<string, unknown> = { ...(body.parameters ?? {}) };

  // Callers must not be able to spoof server-controlled markers.
  for (const reserved of ["engine", "phase", "approved", "approvedBy", "scopeValidated"]) {
    delete parameters[reserved];
  }

  let connectorKey: string | undefined;
  if (body.connectorKey !== undefined && body.connectorKey !== null && body.connectorKey !== "") {
    if (typeof body.connectorKey !== "string" || !/^[a-z0-9][a-z0-9._-]{0,62}$/i.test(body.connectorKey)) {
      return { ok: false, error: "connectorKey is invalid" };
    }
    connectorKey = body.connectorKey.toLowerCase();
    if (FORBIDDEN_CONNECTORS.has(connectorKey)) {
      return {
        ok: false,
        error: `Connector '${connectorKey}' is not permitted for Phase 5 advanced assessments (active scanning/exploitation tooling)`,
      };
    }
    if (DYNAMIC_ANALYSIS_CONNECTORS.has(connectorKey)) {
      if (body.engineType !== "mobile_scan") {
        return { ok: false, error: `Connector '${connectorKey}' is only valid for mobile_scan` };
      }
      if (parameters.authorisedTestApplication !== true) {
        return {
          ok: false,
          error: `Dynamic analysis connector '${connectorKey}' requires parameters.authorisedTestApplication=true (explicitly authorised test app only)`,
        };
      }
    }
  }

  if (body.engineType === "iot_scan") {
    const iot = validateIotMode(parameters);
    if (!iot.ok) return iot;
    parameters.mode = iot.value.mode;
    if (iot.value.mode === "active") {
      // Active OT work always needs additional human approval + OT professional review.
      parameters.requiresAdditionalApproval = true;
      parameters.requiresQualifiedOtReview = true;
    }
  }

  return {
    ok: true,
    value: {
      organizationId: body.organizationId,
      scopeId: body.scopeId,
      name: body.name.trim(),
      engineType: body.engineType,
      targets: body.targets,
      parameters,
      connectorKey,
    },
  };
}

export interface DomainFindingInput {
  organizationId: string;
  domain: FindingDomain;
  assetId?: string;
  jobId?: string;
  title: string;
  severity: FindingSeverity;
  description?: string;
  remediation?: string;
  cveId?: string;
  category?: string;
  affectedComponent?: string;
  evidenceSummary?: string;
  sourceConnector?: string;
  meta?: Record<string, unknown>;
}

const CVE_RE = /^CVE-\d{4}-\d{4,}$/i;

export function validateDomainFinding(body: any): Validation<DomainFindingInput> {
  if (!body || typeof body !== "object") return { ok: false, error: "Request body is required" };
  if (!isUuid(body.organizationId)) return { ok: false, error: "organizationId must be a valid UUID" };
  if (!FINDING_DOMAINS.includes(body.domain)) {
    return { ok: false, error: `domain must be one of: ${FINDING_DOMAINS.join(", ")}` };
  }
  if (!FINDING_SEVERITIES.includes(body.severity)) {
    return { ok: false, error: `severity must be one of: ${FINDING_SEVERITIES.join(", ")}` };
  }
  if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 300) {
    return { ok: false, error: "title is required (1-300 characters)" };
  }
  for (const k of ["assetId", "jobId"] as const) {
    if (body[k] !== undefined && body[k] !== null && !isUuid(body[k])) {
      return { ok: false, error: `${k} must be a valid UUID` };
    }
  }
  if (body.cveId !== undefined && body.cveId !== null && body.cveId !== "" && !CVE_RE.test(String(body.cveId))) {
    return { ok: false, error: "cveId must look like CVE-YYYY-NNNN" };
  }
  for (const k of ["description", "remediation", "category", "affectedComponent", "evidenceSummary", "sourceConnector"] as const) {
    if (body[k] !== undefined && body[k] !== null && typeof body[k] !== "string") {
      return { ok: false, error: `${k} must be a string` };
    }
    if (typeof body[k] === "string" && body[k].length > 20000) {
      return { ok: false, error: `${k} is too long` };
    }
  }
  if (body.meta !== undefined && (typeof body.meta !== "object" || body.meta === null || Array.isArray(body.meta))) {
    return { ok: false, error: "meta must be an object" };
  }
  return {
    ok: true,
    value: {
      organizationId: body.organizationId,
      domain: body.domain,
      assetId: body.assetId ?? undefined,
      jobId: body.jobId ?? undefined,
      title: body.title.trim(),
      severity: body.severity,
      description: body.description ?? undefined,
      remediation: body.remediation ?? undefined,
      cveId: body.cveId ? String(body.cveId).toUpperCase() : undefined,
      category: body.category ?? undefined,
      affectedComponent: body.affectedComponent ?? undefined,
      evidenceSummary: body.evidenceSummary ?? undefined,
      sourceConnector: body.sourceConnector ?? undefined,
      meta: body.meta ?? undefined,
    },
  };
}
