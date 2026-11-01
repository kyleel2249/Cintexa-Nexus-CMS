/**
 * CINTEXA Advanced Cyber Defense & Security Intelligence (CCDI)
 * Phase 2 — Platform Foundation schema.
 *
 * All tables are prefixed `ccdi_` for clear isolation from CMS core tables.
 * Statements are idempotent (CREATE TABLE IF NOT EXISTS / guarded indexes)
 * so they can run on every API boot via bootstrap, matching the existing
 * sales / finance / sentinel / wi pattern.
 *
 * No raw secrets are stored. Credential references point to an external
 * secrets manager or the Sentinel encrypted vault pattern.
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

  // ── User ↔ Role assignments (supports Firebase sub or cms_users.id) ────
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

  // ── Audit logs (append-only style; no UPDATE/DELETE in application code) ─
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

  // ── Assets (basic inventory foundation) ────────────────────────────────
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

  // ── Scopes / Authorisations (foundation for Phase 3 execution) ─────────
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

  // ── Secrets metadata only (never store raw secrets) ────────────────────
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
];

/** System permission codes seeded on first run (idempotent via ON CONFLICT). */
export const CCDI_PERMISSION_SEED: Array<{ code: string; name: string; category: string; description: string }> = [
  { code: "ccdi.command_centre.view", name: "View Command Centre", category: "command_centre", description: "View security posture dashboard" },
  { code: "ccdi.assets.view", name: "View Assets", category: "assets", description: "View asset inventory" },
  { code: "ccdi.assets.manage", name: "Manage Assets", category: "assets", description: "Create, update, retire assets" },
  { code: "ccdi.scopes.view", name: "View Scopes", category: "scopes", description: "View authorisation scopes" },
  { code: "ccdi.scopes.manage", name: "Manage Scopes", category: "scopes", description: "Create and request scope approval" },
  { code: "ccdi.scopes.approve", name: "Approve Scopes", category: "scopes", description: "Approve or revoke scopes" },
  { code: "ccdi.audit.view", name: "View Audit Logs", category: "audit", description: "Read security audit trail" },
  { code: "ccdi.users.manage", name: "Manage CCDI Users", category: "access", description: "Assign CCDI roles" },
  { code: "ccdi.org.admin", name: "Organisation Admin", category: "access", description: "Full organisation administration" },
  { code: "ccdi.platform.admin", name: "Platform Admin", category: "access", description: "Cross-organisation platform administration" },
];

/** Default system roles (organisation_id NULL = global templates). */
export const CCDI_SYSTEM_ROLES: Array<{ slug: string; name: string; description: string; permissions: string[] }> = [
  {
    slug: "super_administrator",
    name: "Super Administrator",
    description: "Full platform control",
    permissions: ["ccdi.platform.admin", "ccdi.org.admin", "ccdi.users.manage", "ccdi.command_centre.view", "ccdi.assets.view", "ccdi.assets.manage", "ccdi.scopes.view", "ccdi.scopes.manage", "ccdi.scopes.approve", "ccdi.audit.view"],
  },
  {
    slug: "security_director",
    name: "Security Director",
    description: "Strategic security ownership",
    permissions: ["ccdi.org.admin", "ccdi.command_centre.view", "ccdi.assets.view", "ccdi.assets.manage", "ccdi.scopes.view", "ccdi.scopes.manage", "ccdi.scopes.approve", "ccdi.audit.view", "ccdi.users.manage"],
  },
  {
    slug: "security_manager",
    name: "Security Manager",
    description: "Operational security management",
    permissions: ["ccdi.command_centre.view", "ccdi.assets.view", "ccdi.assets.manage", "ccdi.scopes.view", "ccdi.scopes.manage", "ccdi.audit.view"],
  },
  {
    slug: "penetration_tester",
    name: "Penetration Tester",
    description: "Authorised testing execution (Phase 3+)",
    permissions: ["ccdi.command_centre.view", "ccdi.assets.view", "ccdi.scopes.view", "ccdi.audit.view"],
  },
  {
    slug: "security_analyst",
    name: "Security Analyst",
    description: "Analysis and monitoring",
    permissions: ["ccdi.command_centre.view", "ccdi.assets.view", "ccdi.scopes.view", "ccdi.audit.view"],
  },
  {
    slug: "compliance_auditor",
    name: "Compliance Auditor",
    description: "Read-only compliance and audit access",
    permissions: ["ccdi.command_centre.view", "ccdi.assets.view", "ccdi.audit.view"],
  },
  {
    slug: "viewer",
    name: "Viewer",
    description: "Read-only visibility",
    permissions: ["ccdi.command_centre.view", "ccdi.assets.view"],
  },
];
