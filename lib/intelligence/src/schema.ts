/**
 * Intelligence schema (all tables prefixed `intel_`). Idempotent: safe to run on every boot / every app start,
 * on PostgreSQL (API server) and PGlite (on-device). Timestamps are ISO-8601 TEXT so both engines round-trip them
 * byte-for-byte (the audit hash chain depends on that). Full records live in `data` JSONB; the columns beside it are
 * the indexed/constrained facts. Tenant isolation: every row carries org_id and every query filters on it.
 */
export const INTEL_SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS intel_tasks (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    root_task_id TEXT NOT NULL,
    parent_task_id TEXT,
    agent_role TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled','timed_out')),
    priority INTEGER NOT NULL DEFAULT 50,
    idempotency_key TEXT,
    input_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    data JSONB NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS intel_tasks_idem ON intel_tasks(org_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS intel_tasks_org_status ON intel_tasks(org_id, status, priority DESC)`,
  `CREATE INDEX IF NOT EXISTS intel_tasks_root ON intel_tasks(org_id, root_task_id)`,
  `CREATE TABLE IF NOT EXISTS intel_approvals (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('prepared','pending','approved','rejected','executed','failed','expired')),
    requested_at TEXT NOT NULL,
    data JSONB NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS intel_approvals_org_status ON intel_approvals(org_id, status)`,
  `CREATE TABLE IF NOT EXISTS intel_audit (
    seq BIGSERIAL PRIMARY KEY,
    id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  )`,
  // A forked chain (two writers with the same predecessor) violates this and the loser retries.
  `CREATE UNIQUE INDEX IF NOT EXISTS intel_audit_chain ON intel_audit(org_id, prev_hash)`,
  `CREATE TABLE IF NOT EXISTS intel_findings (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW','INFORMATIONAL')),
    evidence_status TEXT NOT NULL CHECK (evidence_status IN ('confirmed','needs_verification','hypothesis')),
    workflow_status TEXT NOT NULL DEFAULT 'open' CHECK (workflow_status IN ('open','acknowledged','in_progress','resolved','dismissed')),
    owner TEXT,
    due_date TEXT,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    last_task_id TEXT,
    data JSONB NOT NULL,
    history JSONB NOT NULL DEFAULT '[]'::jsonb
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS intel_findings_fp ON intel_findings(org_id, fingerprint)`,
  `CREATE INDEX IF NOT EXISTS intel_findings_org ON intel_findings(org_id, workflow_status, severity)`,
  `CREATE TABLE IF NOT EXISTS intel_metric_snapshots (
    id BIGSERIAL PRIMARY KEY,
    org_id TEXT NOT NULL,
    metric_key TEXT NOT NULL,
    value DOUBLE PRECISION,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    taken_at TEXT NOT NULL,
    task_id TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS intel_metric_snapshots_key ON intel_metric_snapshots(org_id, metric_key, taken_at)`,
  `CREATE TABLE IF NOT EXISTS intel_settings (
    org_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    updated_by TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (org_id, key)
  )`,
];
