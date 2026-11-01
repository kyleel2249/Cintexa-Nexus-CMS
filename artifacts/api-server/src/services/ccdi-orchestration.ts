/**
 * CINTEXA CCDI — Phase 3 Secure Execution Orchestration Service
 *
 * Implements the controlled pipeline:
 *   REQUEST → SCOPE VALIDATION → POLICY CHECK → APPROVAL → QUEUE →
 *   (ISOLATED EXECUTION placeholder) → RESULT VALIDATION → EVIDENCE → REPORTING
 *
 * No arbitrary shell execution. No live scanner invocation in Phase 3.
 * Workers and real tool adapters arrive in later phases once the control plane is solid.
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

export type JobStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "rejected"
  | "expired";

export interface ScopeRecord {
  id: string;
  organization_id: string;
  name: string;
  asset_ids: string[];
  allowed_categories: string[];
  excluded_targets: string[];
  status: string;
  expires_at: Date | null;
}

export interface JobCreateInput {
  organizationId: string;
  scopeId?: string | null;
  connectorId?: string | null;
  name: string;
  jobType: string;
  parameters?: Record<string, unknown>;
  targets?: unknown[];
  rateLimitRps?: number | null;
  maxRuntimeSeconds?: number;
  requestedBy: string;
}

// ── Kill switch ────────────────────────────────────────────────────────────

export async function isKillSwitchActive(): Promise<boolean> {
  const { rows } = await pool.query(`SELECT active FROM ccdi_kill_switch WHERE id = 1`);
  return Boolean(rows[0]?.active);
}

export async function setKillSwitch(
  active: boolean,
  actor: string,
  reason?: string,
): Promise<{ active: boolean }> {
  if (active) {
    await pool.query(
      `UPDATE ccdi_kill_switch
       SET active = true, reason = $1, activated_by = $2, activated_at = now(),
           deactivated_by = NULL, deactivated_at = NULL, updated_at = now()
       WHERE id = 1`,
      [reason ?? "Emergency stop activated", actor],
    );
    // Cancel all queued / running jobs
    await pool.query(
      `UPDATE ccdi_jobs
       SET status = 'cancelled', cancel_requested = true, finished_at = now(), updated_at = now()
       WHERE status IN ('queued','running','approved')`,
    );
    await pool.query(
      `INSERT INTO ccdi_audit_logs (actor_ref, action, entity_type, entity_id, meta)
       VALUES ($1, 'kill_switch.activate', 'platform', '1', $2)`,
      [actor, JSON.stringify({ reason })],
    );
  } else {
    await pool.query(
      `UPDATE ccdi_kill_switch
       SET active = false, deactivated_by = $1, deactivated_at = now(), updated_at = now()
       WHERE id = 1`,
      [actor],
    );
    await pool.query(
      `INSERT INTO ccdi_audit_logs (actor_ref, action, entity_type, entity_id, meta)
       VALUES ($1, 'kill_switch.deactivate', 'platform', '1', '{}')`,
      [actor],
    );
  }
  return { active };
}

// ── Scope validation ───────────────────────────────────────────────────────

export async function getApprovedScope(scopeId: string, organizationId: string): Promise<ScopeRecord | null> {
  const { rows } = await pool.query(
    `SELECT id, organization_id, name, asset_ids, allowed_categories, excluded_targets, status, expires_at
     FROM ccdi_scopes
     WHERE id = $1 AND organization_id = $2`,
    [scopeId, organizationId],
  );
  if (!rows[0]) return null;
  const s = rows[0];
  if (s.status !== "approved") return null;
  if (s.expires_at && new Date(s.expires_at) < new Date()) return null;
  return s;
}

/**
 * Validates that every target in the job is allowed by the scope.
 * Returns { ok: true } or { ok: false, reason }.
 */
export function validateTargetsAgainstScope(
  targets: unknown[],
  scope: ScopeRecord,
): { ok: true } | { ok: false; reason: string } {
  if (!Array.isArray(targets) || targets.length === 0) {
    return { ok: false, reason: "At least one target is required" };
  }

  const excluded = new Set((scope.excluded_targets || []).map((t) => String(t).toLowerCase()));
  const allowedAssets = new Set((scope.asset_ids || []).map(String));

  for (const t of targets) {
    const target = typeof t === "string" ? t : (t as any)?.identifier ?? (t as any)?.host ?? JSON.stringify(t);
    const normalized = String(target).toLowerCase();

    if (excluded.has(normalized)) {
      return { ok: false, reason: `Target '${target}' is explicitly excluded from scope` };
    }

    // If scope has explicit asset allow-list, target must match an asset id or identifier
    // (loose match for Phase 3; tighter binding arrives with asset resolution)
    if (allowedAssets.size > 0) {
      const asId = (t as any)?.assetId ?? (t as any)?.id;
      if (asId && !allowedAssets.has(String(asId))) {
        return { ok: false, reason: `Target asset is not in the approved scope allow-list` };
      }
    }
  }

  return { ok: true };
}

// ── Job lifecycle ──────────────────────────────────────────────────────────

export async function createJob(input: JobCreateInput): Promise<{ job: any } | { error: string; status: number }> {
  if (await isKillSwitchActive()) {
    return { error: "Global emergency stop is active. No new jobs may be created.", status: 503 };
  }

  const allowedTypes = [
    "asset_discovery", "port_scan", "web_scan", "api_scan", "vuln_scan",
    "config_audit", "dependency_scan", "custom",
  ];
  if (!allowedTypes.includes(input.jobType)) {
    return { error: "Invalid jobType", status: 400 };
  }

  let scope: ScopeRecord | null = null;
  if (input.scopeId) {
    scope = await getApprovedScope(input.scopeId, input.organizationId);
    if (!scope) {
      return { error: "Scope not found, not approved, or expired", status: 400 };
    }
    const targets = input.targets ?? [];
    const validation = validateTargetsAgainstScope(targets, scope);
    if (!validation.ok) {
      return { error: validation.reason, status: 400 };
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO ccdi_jobs
       (organization_id, scope_id, connector_id, name, job_type, status,
        parameters, targets, rate_limit_rps, max_runtime_seconds, requested_by)
     VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      input.organizationId,
      input.scopeId ?? null,
      input.connectorId ?? null,
      input.name.trim(),
      input.jobType,
      JSON.stringify(input.parameters ?? {}),
      JSON.stringify(input.targets ?? []),
      input.rateLimitRps ?? null,
      input.maxRuntimeSeconds ?? 3600,
      input.requestedBy,
    ],
  );

  await pool.query(
    `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, action, entity_type, entity_id, meta)
     VALUES ($1,$2,'job.create','job',$3,$4)`,
    [input.organizationId, input.requestedBy, rows[0].id, JSON.stringify({ name: input.name, jobType: input.jobType })],
  );

  return { job: rows[0] };
}

export async function submitJobForApproval(
  jobId: string,
  organizationId: string,
  actor: string,
): Promise<{ job: any } | { error: string; status: number }> {
  if (await isKillSwitchActive()) {
    return { error: "Global emergency stop is active", status: 503 };
  }

  const { rows } = await pool.query(
    `SELECT * FROM ccdi_jobs WHERE id = $1 AND organization_id = $2`,
    [jobId, organizationId],
  );
  if (!rows[0]) return { error: "Job not found", status: 404 };
  if (rows[0].status !== "draft") {
    return { error: `Job is in status '${rows[0].status}' and cannot be submitted`, status: 400 };
  }

  // Require an approved scope for any non-draft progression
  if (!rows[0].scope_id) {
    return { error: "An approved scope is required before submission", status: 400 };
  }
  const scope = await getApprovedScope(rows[0].scope_id, organizationId);
  if (!scope) {
    return { error: "Linked scope is not approved or has expired", status: 400 };
  }

  const { rows: updated } = await pool.query(
    `UPDATE ccdi_jobs SET status = 'pending_approval', updated_at = now()
     WHERE id = $1 RETURNING *`,
    [jobId],
  );

  await pool.query(
    `INSERT INTO ccdi_approvals (organization_id, entity_type, entity_id, status, requested_by, expires_at)
     VALUES ($1, 'job', $2, 'pending', $3, now() + interval '7 days')`,
    [organizationId, jobId, actor],
  );

  await pool.query(
    `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, action, entity_type, entity_id, meta)
     VALUES ($1,$2,'job.submit_for_approval','job',$3,'{}')`,
    [organizationId, actor, jobId],
  );

  return { job: updated[0] };
}

export async function decideJobApproval(
  jobId: string,
  organizationId: string,
  actor: string,
  decision: "approved" | "rejected",
  note?: string,
): Promise<{ job: any } | { error: string; status: number }> {
  const { rows } = await pool.query(
    `SELECT * FROM ccdi_jobs WHERE id = $1 AND organization_id = $2`,
    [jobId, organizationId],
  );
  if (!rows[0]) return { error: "Job not found", status: 404 };
  if (rows[0].status !== "pending_approval") {
    return { error: `Job is not pending approval (current: ${rows[0].status})`, status: 400 };
  }

  const newStatus = decision === "approved" ? "approved" : "rejected";

  const { rows: updated } = await pool.query(
    `UPDATE ccdi_jobs
     SET status = $1, approved_by = $2, approved_at = CASE WHEN $1 = 'approved' THEN now() ELSE NULL END,
         updated_at = now()
     WHERE id = $3
     RETURNING *`,
    [newStatus, actor, jobId],
  );

  await pool.query(
    `UPDATE ccdi_approvals
     SET status = $1, decided_by = $2, decided_at = now(), decision_note = $3
     WHERE entity_type = 'job' AND entity_id = $4 AND status = 'pending'`,
    [decision, actor, note ?? null, jobId],
  );

  await pool.query(
    `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, action, entity_type, entity_id, meta)
     VALUES ($1,$2,$3,'job',$4,$5)`,
    [organizationId, actor, `job.${decision}`, jobId, JSON.stringify({ note })],
  );

  // Auto-queue on approval if kill-switch is off
  if (decision === "approved" && !(await isKillSwitchActive())) {
    await pool.query(
      `UPDATE ccdi_jobs SET status = 'queued', queued_at = now(), updated_at = now() WHERE id = $1`,
      [jobId],
    );
    updated[0].status = "queued";
  }

  return { job: updated[0] };
}

export async function cancelJob(
  jobId: string,
  organizationId: string,
  actor: string,
): Promise<{ job: any } | { error: string; status: number }> {
  const { rows } = await pool.query(
    `SELECT * FROM ccdi_jobs WHERE id = $1 AND organization_id = $2`,
    [jobId, organizationId],
  );
  if (!rows[0]) return { error: "Job not found", status: 404 };

  const cancellable = ["draft", "pending_approval", "approved", "queued", "running"];
  if (!cancellable.includes(rows[0].status)) {
    return { error: `Job cannot be cancelled from status '${rows[0].status}'`, status: 400 };
  }

  const { rows: updated } = await pool.query(
    `UPDATE ccdi_jobs
     SET status = 'cancelled', cancel_requested = true, finished_at = now(), updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [jobId],
  );

  // Mark any running executions
  await pool.query(
    `UPDATE ccdi_executions
     SET status = 'cancelled', finished_at = now(), updated_at = now()
     WHERE job_id = $1 AND status IN ('pending','starting','running')`,
    [jobId],
  );

  await pool.query(
    `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, action, entity_type, entity_id, meta)
     VALUES ($1,$2,'job.cancel','job',$3,'{}')`,
    [organizationId, actor, jobId],
  );

  return { job: updated[0] };
}

// ── Connector registry (skeleton) ──────────────────────────────────────────

export const BUILTIN_CONNECTORS = [
  { key: "nmap", name: "Nmap", category: "network" },
  { key: "owasp_zap", name: "OWASP ZAP", category: "web" },
  { key: "nuclei", name: "Nuclei", category: "web" },
  { key: "nikto", name: "Nikto", category: "web" },
  { key: "testssl", name: "testssl.sh", category: "web" },
  { key: "trivy", name: "Trivy", category: "container" },
  { key: "prowler", name: "Prowler", category: "cloud" },
  { key: "semgrep", name: "Semgrep", category: "code" },
  { key: "gitleaks", name: "Gitleaks", category: "code" },
  { key: "wazuh", name: "Wazuh", category: "monitoring" },
] as const;

export async function ensureBuiltinConnectors(organizationId: string | null = null): Promise<void> {
  for (const c of BUILTIN_CONNECTORS) {
    await pool.query(
      `INSERT INTO ccdi_connectors (organization_id, connector_key, name, category, status)
       VALUES ($1, $2, $3, $4, 'registered')
       ON CONFLICT (organization_id, connector_key) DO NOTHING`,
      [organizationId, c.key, c.name, c.category],
    );
  }
}

// ── Scope approval helpers ─────────────────────────────────────────────────

export async function submitScopeForApproval(
  scopeId: string,
  organizationId: string,
  actor: string,
): Promise<{ scope: any } | { error: string; status: number }> {
  const { rows } = await pool.query(
    `SELECT * FROM ccdi_scopes WHERE id = $1 AND organization_id = $2`,
    [scopeId, organizationId],
  );
  if (!rows[0]) return { error: "Scope not found", status: 404 };
  if (rows[0].status !== "draft") {
    return { error: `Scope is in status '${rows[0].status}'`, status: 400 };
  }

  const { rows: updated } = await pool.query(
    `UPDATE ccdi_scopes SET status = 'pending_approval', updated_at = now() WHERE id = $1 RETURNING *`,
    [scopeId],
  );

  await pool.query(
    `INSERT INTO ccdi_approvals (organization_id, entity_type, entity_id, status, requested_by, expires_at)
     VALUES ($1, 'scope', $2, 'pending', $3, now() + interval '14 days')`,
    [organizationId, scopeId, actor],
  );

  await pool.query(
    `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, action, entity_type, entity_id, meta)
     VALUES ($1,$2,'scope.submit_for_approval','scope',$3,'{}')`,
    [organizationId, actor, scopeId],
  );

  return { scope: updated[0] };
}

export async function decideScopeApproval(
  scopeId: string,
  organizationId: string,
  actor: string,
  decision: "approved" | "rejected",
  note?: string,
  expiresAt?: string | null,
): Promise<{ scope: any } | { error: string; status: number }> {
  const { rows } = await pool.query(
    `SELECT * FROM ccdi_scopes WHERE id = $1 AND organization_id = $2`,
    [scopeId, organizationId],
  );
  if (!rows[0]) return { error: "Scope not found", status: 404 };
  if (rows[0].status !== "pending_approval") {
    return { error: `Scope is not pending approval`, status: 400 };
  }

  const newStatus = decision === "approved" ? "approved" : "revoked";

  const { rows: updated } = await pool.query(
    `UPDATE ccdi_scopes
     SET status = $1,
         approved_by = CASE WHEN $1 = 'approved' THEN $2 ELSE NULL END,
         approved_at = CASE WHEN $1 = 'approved' THEN now() ELSE NULL END,
         expires_at = CASE WHEN $1 = 'approved' THEN $3::timestamptz ELSE NULL END,
         updated_at = now()
     WHERE id = $4
     RETURNING *`,
    [newStatus, actor, expiresAt ?? null, scopeId],
  );

  await pool.query(
    `UPDATE ccdi_approvals
     SET status = $1, decided_by = $2, decided_at = now(), decision_note = $3
     WHERE entity_type = 'scope' AND entity_id = $4 AND status = 'pending'`,
    [decision, actor, note ?? null, scopeId],
  );

  await pool.query(
    `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, action, entity_type, entity_id, meta)
     VALUES ($1,$2,$3,'scope',$4,$5)`,
    [organizationId, actor, `scope.${decision}`, scopeId, JSON.stringify({ note, expiresAt })],
  );

  return { scope: updated[0] };
}

logger.info("CCDI orchestration service loaded (Phase 3 control plane)");
