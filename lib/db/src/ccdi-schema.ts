/**
 * CINTEXA Advanced Cyber Defense & Security Intelligence (CCDI)
 * Phase 2 Foundation + Phase 3 Secure Execution schema.
 *
 * All tables are prefixed `ccdi_` for clear isolation from CMS core tables.
 * Statements are idempotent so they can run on every API boot via bootstrap.
 *
 * No raw secrets are stored. Credential references point to an external
 * secrets manager or the Sentinel encrypted vault pattern.
 *
 * Phase 3 adds: connectors, jobs, executions, approvals, evidence, kill-switch.
 */

const TS = "TIMESTAMPTZ";

export const CCDI_SCHEMA_STATEMENTS: string[] = [
  // ── Organizations / Tenants ───────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ccdi_organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  slug TEXT NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 80),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now()
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_ccdi_org_slug ON ccdi_organizations(slug)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_org_status ON ccdi_organizations(status)`,

  // ── Roles ──────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ccdi_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  slug TEXT NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 60),
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now()
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_ccdi_roles_org_slug ON ccdi_roles(organization_id, slug)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_roles_org ON ccdi_roles(organization_id)`,

  // ── Permissions ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ccdi_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (char_length(code) BETWEEN 1 AND 120),
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  description TEXT,
  created_at ${TS} NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_permissions_category ON ccdi_permissions(category)`,

  // ── Role ↔ Permission ──────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ccdi_role_permissions (
  role_id UUID NOT NULL REFERENCES ccdi_roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES ccdi_permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
)`,

  // ── User ↔ Role assignments ────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ccdi_user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  user_ref TEXT NOT NULL,
  role_id UUID NOT NULL REFERENCES ccdi_roles(id) ON DELETE CASCADE,
  assigned_by TEXT,
  assigned_at ${TS} NOT NULL DEFAULT now(),
  expires_at ${TS}
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_ccdi_user_roles ON ccdi_user_roles(organization_id, user_ref, role_id)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_user_roles_user ON ccdi_user_roles(user_ref)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_user_roles_org ON ccdi_user_roles(organization_id)`,

  // ── Audit logs ─────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ccdi_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  organization_id UUID REFERENCES ccdi_organizations(id) ON DELETE SET NULL,
  actor_ref TEXT,
  actor_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at ${TS} NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_audit_org_created ON ccdi_audit_logs(organization_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_audit_actor ON ccdi_audit_logs(actor_ref, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_audit_action ON ccdi_audit_logs(action)`,

  // ── Assets ─────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ccdi_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 300),
  asset_type TEXT NOT NULL CHECK (asset_type IN (
    'domain','subdomain','ip','website','api','server','cloud','database',
    'container','mobile_app','iot','ot','certificate','other'
  )),
  identifier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered','verified','approved','retired','rejected')),
  ownership_verified BOOLEAN NOT NULL DEFAULT false,
  risk_level TEXT DEFAULT 'unknown' CHECK (risk_level IN ('unknown','info','low','medium','high','critical')),
  tags TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  owner_ref TEXT,
  created_by TEXT,
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_assets_org ON ccdi_assets(organization_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_assets_type ON ccdi_assets(organization_id, asset_type)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_assets_status ON ccdi_assets(organization_id, status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_ccdi_assets_org_identifier ON ccdi_assets(organization_id, identifier) WHERE status <> 'retired'`,

  // ── Scopes / Authorisations ────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ccdi_scopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  asset_ids UUID[] NOT NULL DEFAULT '{}',
  allowed_categories TEXT[] NOT NULL DEFAULT '{}',
  excluded_targets TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','expired','revoked')),
  approved_by TEXT,
  approved_at ${TS},
  expires_at ${TS},
  created_by TEXT,
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_scopes_org ON ccdi_scopes(organization_id, status)`,

  // ── Secrets metadata only ──────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ccdi_secret_refs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'env' CHECK (provider IN ('env','vault','sentinel','cloud_sm','other')),
  external_ref TEXT NOT NULL,
  rotation_policy TEXT,
  last_rotated_at ${TS},
  created_by TEXT,
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now()
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_ccdi_secret_refs_org_name ON ccdi_secret_refs(organization_id, name)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_secret_refs_org ON ccdi_secret_refs(organization_id)`,

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 3 — Secure Execution & Orchestration
  // ═══════════════════════════════════════════════════════════════════════

  // ── Connectors (tool adapter registry) ─────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ccdi_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  connector_key TEXT NOT NULL CHECK (char_length(connector_key) BETWEEN 1 AND 80),
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'network','web','api','code','cloud','container','monitoring',
    'threat_intel','forensics','mobile','iot','other'
  )),
  version TEXT,
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','configured','healthy','unhealthy','disabled')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_ref_id UUID REFERENCES ccdi_secret_refs(id) ON DELETE SET NULL,
  health_checked_at ${TS},
  last_error TEXT,
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now()
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_ccdi_connectors_org_key ON ccdi_connectors(organization_id, connector_key)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_connectors_category ON ccdi_connectors(category, status)`,

  // ── Jobs (requested work units) ────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ccdi_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  scope_id UUID REFERENCES ccdi_scopes(id) ON DELETE SET NULL,
  connector_id UUID REFERENCES ccdi_connectors(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN (
    'asset_discovery','port_scan','web_scan','api_scan','vuln_scan',
    'config_audit','dependency_scan','custom'
  )),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','pending_approval','approved','queued','running',
    'succeeded','failed','cancelled','rejected','expired'
  )),
  priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 1 AND 100),
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  targets JSONB NOT NULL DEFAULT '[]'::jsonb,
  rate_limit_rps NUMERIC(8,2),
  max_runtime_seconds INTEGER DEFAULT 3600,
  requested_by TEXT,
  approved_by TEXT,
  approved_at ${TS},
  queued_at ${TS},
  started_at ${TS},
  finished_at ${TS},
  error_message TEXT,
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_jobs_org_status ON ccdi_jobs(organization_id, status)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_jobs_scope ON ccdi_jobs(scope_id)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_jobs_queued ON ccdi_jobs(status, queued_at) WHERE status IN ('queued','running')`,

  // ── Executions (runtime instances of a job) ────────────────────────────
  `CREATE TABLE IF NOT EXISTS ccdi_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES ccdi_jobs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  worker_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','starting','running','succeeded','failed','cancelled','timed_out'
  )),
  attempt INTEGER NOT NULL DEFAULT 1,
  started_at ${TS},
  finished_at ${TS},
  exit_code INTEGER,
  stdout_summary TEXT,
  stderr_summary TEXT,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_executions_job ON ccdi_executions(job_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_executions_status ON ccdi_executions(organization_id, status)`,

  // ── Approvals (explicit human gates) ───────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ccdi_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('scope','job')),
  entity_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','cancelled')),
  requested_by TEXT NOT NULL,
  requested_at ${TS} NOT NULL DEFAULT now(),
  decided_by TEXT,
  decided_at ${TS},
  decision_note TEXT,
  expires_at ${TS},
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at ${TS} NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_approvals_entity ON ccdi_approvals(entity_type, entity_id)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_approvals_org_status ON ccdi_approvals(organization_id, status)`,

  // ── Evidence (immutable-ish storage references) ────────────────────────
  `CREATE TABLE IF NOT EXISTS ccdi_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  execution_id UUID REFERENCES ccdi_executions(id) ON DELETE SET NULL,
  job_id UUID REFERENCES ccdi_jobs(id) ON DELETE SET NULL,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN (
    'scan_output','screenshot','log','pcap','report','hash','other'
  )),
  filename TEXT,
  content_type TEXT,
  size_bytes BIGINT,
  sha256 TEXT,
  storage_provider TEXT NOT NULL DEFAULT 'local' CHECK (storage_provider IN ('local','s3','gcs','azure','other')),
  storage_ref TEXT NOT NULL,
  redacted BOOLEAN NOT NULL DEFAULT false,
  collected_at ${TS} NOT NULL DEFAULT now(),
  collected_by TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at ${TS} NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_evidence_org ON ccdi_evidence(organization_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_evidence_execution ON ccdi_evidence(execution_id)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_evidence_job ON ccdi_evidence(job_id)`,

  // ── Platform kill-switch / emergency stop ──────────────────────────────
  `CREATE TABLE IF NOT EXISTS ccdi_kill_switch (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  activated_by TEXT,
  activated_at ${TS},
  deactivated_by TEXT,
  deactivated_at ${TS},
  updated_at ${TS} NOT NULL DEFAULT now()
)`,
  `INSERT INTO ccdi_kill_switch (id, active) VALUES (1, false) ON CONFLICT (id) DO NOTHING`,
];

/** System permission codes (Phase 2 + Phase 3). */
export const CCDI_PERMISSION_SEED: Array<{ code: string; name: string; category: string; description: string }> = [
  { code: "ccdi.command_centre.view", name: "View Command Centre", category: "command_centre", description: "View security posture dashboard" },
  { code: "ccdi.assets.view", name: "View Assets", category: "assets", description: "View asset inventory" },
  { code: "ccdi.assets.manage", name: "Manage Assets", category: "assets", description: "Create, update, retire assets" },
  { code: "ccdi.scopes.view", name: "View Scopes", category: "scopes", description: "View authorisation scopes" },
  { code: "ccdi.scopes.manage", name: "Manage Scopes", category: "scopes", description: "Create and request scope approval" },
  { code: "ccdi.scopes.approve", name: "Approve Scopes", category: "scopes", description: "Approve or revoke scopes" },
  { code: "ccdi.jobs.view", name: "View Jobs", category: "jobs", description: "View security jobs and executions" },
  { code: "ccdi.jobs.request", name: "Request Jobs", category: "jobs", description: "Create and submit jobs for approval" },
  { code: "ccdi.jobs.approve", name: "Approve Jobs", category: "jobs", description: "Approve or reject job requests" },
  { code: "ccdi.jobs.cancel", name: "Cancel Jobs", category: "jobs", description: "Cancel running or queued jobs" },
  { code: "ccdi.connectors.view", name: "View Connectors", category: "connectors", description: "View registered connectors" },
  { code: "ccdi.connectors.manage", name: "Manage Connectors", category: "connectors", description: "Register and configure connectors" },
  { code: "ccdi.evidence.view", name: "View Evidence", category: "evidence", description: "View collected evidence metadata" },
  { code: "ccdi.audit.view", name: "View Audit Logs", category: "audit", description: "Read security audit trail" },
  { code: "ccdi.kill_switch", name: "Emergency Stop", category: "platform", description: "Activate or deactivate the global kill switch" },
  { code: "ccdi.users.manage", name: "Manage CCDI Users", category: "access", description: "Assign CCDI roles" },
  { code: "ccdi.org.admin", name: "Organisation Admin", category: "access", description: "Full organisation administration" },
  { code: "ccdi.platform.admin", name: "Platform Admin", category: "access", description: "Cross-organisation platform administration" },
];

/** Default system roles. */
export const CCDI_SYSTEM_ROLES: Array<{ slug: string; name: string; description: string; permissions: string[] }> = [
  {
    slug: "super_administrator",
    name: "Super Administrator",
    description: "Full platform control",
    permissions: [
      "ccdi.platform.admin", "ccdi.org.admin", "ccdi.users.manage", "ccdi.kill_switch",
      "ccdi.command_centre.view", "ccdi.assets.view", "ccdi.assets.manage",
      "ccdi.scopes.view", "ccdi.scopes.manage", "ccdi.scopes.approve",
      "ccdi.jobs.view", "ccdi.jobs.request", "ccdi.jobs.approve", "ccdi.jobs.cancel",
      "ccdi.connectors.view", "ccdi.connectors.manage", "ccdi.evidence.view", "ccdi.audit.view",
    ],
  },
  {
    slug: "security_director",
    name: "Security Director",
    description: "Strategic security ownership",
    permissions: [
      "ccdi.org.admin", "ccdi.users.manage", "ccdi.command_centre.view",
      "ccdi.assets.view", "ccdi.assets.manage", "ccdi.scopes.view", "ccdi.scopes.manage", "ccdi.scopes.approve",
      "ccdi.jobs.view", "ccdi.jobs.request", "ccdi.jobs.approve", "ccdi.jobs.cancel",
      "ccdi.connectors.view", "ccdi.evidence.view", "ccdi.audit.view",
    ],
  },
  {
    slug: "security_manager",
    name: "Security Manager",
    description: "Operational security management",
    permissions: [
      "ccdi.command_centre.view", "ccdi.assets.view", "ccdi.assets.manage",
      "ccdi.scopes.view", "ccdi.scopes.manage", "ccdi.jobs.view", "ccdi.jobs.request", "ccdi.jobs.cancel",
      "ccdi.connectors.view", "ccdi.evidence.view", "ccdi.audit.view",
    ],
  },
  {
    slug: "penetration_tester",
    name: "Penetration Tester",
    description: "Authorised testing execution",
    permissions: [
      "ccdi.command_centre.view", "ccdi.assets.view", "ccdi.scopes.view",
      "ccdi.jobs.view", "ccdi.jobs.request", "ccdi.evidence.view", "ccdi.audit.view",
    ],
  },
  {
    slug: "security_analyst",
    name: "Security Analyst",
    description: "Analysis and monitoring",
    permissions: [
      "ccdi.command_centre.view", "ccdi.assets.view", "ccdi.scopes.view",
      "ccdi.jobs.view", "ccdi.evidence.view", "ccdi.audit.view",
    ],
  },
  {
    slug: "compliance_auditor",
    name: "Compliance Auditor",
    description: "Read-only compliance and audit access",
    permissions: ["ccdi.command_centre.view", "ccdi.assets.view", "ccdi.evidence.view", "ccdi.audit.view"],
  },
  {
    slug: "viewer",
    name: "Viewer",
    description: "Read-only visibility",
    permissions: ["ccdi.command_centre.view", "ccdi.assets.view", "ccdi.jobs.view"],
  },
];
