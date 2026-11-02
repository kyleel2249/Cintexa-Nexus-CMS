/**
 * CINTEXA CCDI — Phase 2 foundation schema (additive).
 *
 * Extends the existing `ccdi_*` tables without altering their meaning. Every
 * statement is idempotent and runs through `ensureSchema()` after
 * CCDI_SCHEMA_STATEMENTS (see bootstrap.ts).
 *
 * Rules:
 *  - No plaintext credentials are stored. Secret values live only as AES-256-GCM
 *    ciphertext in `ccdi_credentials`; every other table holds a reference.
 *  - Tenant-owned rows carry organization_id and are indexed on it.
 *  - Audit rows are append-only (trigger) and hash-chained.
 *  - Future-phase tables below are structural extension points only. No Phase 3+
 *    behaviour reads or writes them yet.
 */

const TS = "TIMESTAMPTZ";

export const CCDI_FOUNDATION_SCHEMA_STATEMENTS: string[] = [
  // ── Organisation membership & status ────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ccdi_org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  user_ref TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended','removed')),
  invited_by TEXT,
  joined_at ${TS} NOT NULL DEFAULT now(),
  removed_at ${TS},
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now()
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_ccdi_org_members ON ccdi_org_members(organization_id, user_ref)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_org_members_user ON ccdi_org_members(user_ref, status)`,

  // ── Platform / organisation settings (key-value, versioned) ─────────
  `CREATE TABLE IF NOT EXISTS ccdi_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL CHECK (char_length(key) BETWEEN 1 AND 120),
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now()
)`,
  // NULL organization_id = platform-wide setting. COALESCE makes NULLs unique-comparable.
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_ccdi_settings_scope_key
   ON ccdi_settings (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), key)`,

  // ── Security / access policies and approval definitions ─────────────
  `CREATE TABLE IF NOT EXISTS ccdi_security_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  policy_type TEXT NOT NULL CHECK (policy_type IN ('security','access','retention','approval')),
  policy_key TEXT NOT NULL CHECK (char_length(policy_key) BETWEEN 1 AND 120),
  title TEXT NOT NULL,
  definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','retired')),
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now()
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_ccdi_policies_scope_key
   ON ccdi_security_policies (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), policy_type, policy_key)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_policies_org ON ccdi_security_policies(organization_id, status)`,

  // ── MFA configuration (secret is vault ciphertext, never plaintext) ──
  `CREATE TABLE IF NOT EXISTS ccdi_mfa_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_ref TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('totp','webauthn','recovery_codes')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','disabled')),
  secret_ciphertext TEXT,
  secret_iv TEXT,
  secret_tag TEXT,
  key_version INTEGER,
  recovery_code_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_used_step BIGINT,
  verified_at ${TS},
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now()
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_ccdi_mfa_user_method ON ccdi_mfa_configs(user_ref, method)`,

  // ── Authentication events (login history / MFA / recovery) ──────────
  `CREATE TABLE IF NOT EXISTS ccdi_auth_events (
  id BIGSERIAL PRIMARY KEY,
  user_ref TEXT,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success','failure','denied')),
  ip_address TEXT,
  user_agent TEXT,
  correlation_id TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at ${TS} NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_auth_events_user ON ccdi_auth_events(user_ref, created_at DESC)`,

  // ── Credential vault (AES-256-GCM ciphertext only) ──────────────────
  `CREATE TABLE IF NOT EXISTS ccdi_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  kind TEXT NOT NULL CHECK (kind IN (
    'ai_provider','security_tool','cloud','siem','email','messaging','payment','github','threat_intel','other'
  )),
  provider TEXT NOT NULL,
  storage TEXT NOT NULL DEFAULT 'vault' CHECK (storage IN ('vault','env','external')),
  external_ref TEXT,
  ciphertext TEXT,
  iv TEXT,
  auth_tag TEXT,
  key_version INTEGER,
  masked_hint TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  expires_at ${TS},
  last_rotated_at ${TS},
  revoked_at ${TS},
  created_by TEXT,
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now(),
  deleted_at ${TS}
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_ccdi_credentials_org_name ON ccdi_credentials(organization_id, name) WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_credentials_org ON ccdi_credentials(organization_id, status)`,

  // ── Integration registrations ───────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ccdi_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'github','ai_provider','email','whatsapp','payment','security_tool','cloud','siem','threat_intel','other'
  )),
  integration_key TEXT NOT NULL CHECK (char_length(integration_key) BETWEEN 1 AND 80),
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  credential_id UUID REFERENCES ccdi_credentials(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','configured','verified','failing','disabled')),
  health_checked_at ${TS},
  health_detail TEXT,
  created_by TEXT,
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now(),
  deleted_at ${TS}
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_ccdi_integrations_org_key ON ccdi_integrations(organization_id, integration_key) WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_integrations_org ON ccdi_integrations(organization_id, category)`,

  // ── AI provider configuration (no agents, no execution) ─────────────
  `CREATE TABLE IF NOT EXISTS ccdi_ai_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('openai','anthropic','gemini','openrouter','custom')),
  name TEXT NOT NULL,
  base_url TEXT,
  default_model TEXT,
  models JSONB NOT NULL DEFAULT '[]'::jsonb,
  credential_id UUID REFERENCES ccdi_credentials(id) ON DELETE SET NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','configured','verified','failing','disabled')),
  monthly_token_limit BIGINT CHECK (monthly_token_limit IS NULL OR monthly_token_limit >= 0),
  monthly_cost_limit_usd NUMERIC(12,2) CHECK (monthly_cost_limit_usd IS NULL OR monthly_cost_limit_usd >= 0),
  tokens_used_month BIGINT NOT NULL DEFAULT 0,
  cost_used_month_usd NUMERIC(12,4) NOT NULL DEFAULT 0,
  usage_period TEXT,
  health_checked_at ${TS},
  health_detail TEXT,
  created_by TEXT,
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now(),
  deleted_at ${TS}
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_ccdi_ai_providers_org_name ON ccdi_ai_providers(organization_id, name) WHERE deleted_at IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_ccdi_ai_providers_default ON ccdi_ai_providers(organization_id) WHERE is_default AND deleted_at IS NULL`,

  // ── Future-phase extension points (structure only, no behaviour) ────
  `CREATE TABLE IF NOT EXISTS ccdi_incident_meta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  severity TEXT,
  status TEXT NOT NULL DEFAULT 'reserved',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at ${TS} NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_incident_meta_org ON ccdi_incident_meta(organization_id)`,
  `CREATE TABLE IF NOT EXISTS ccdi_ai_agent_meta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  agent_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at ${TS} NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_ai_agent_meta_org ON ccdi_ai_agent_meta(organization_id)`,

  // ── Fix: system roles (organization_id IS NULL) were never de-duplicated ──
  // ux_ccdi_roles_org_slug treats NULLs as distinct, so ON CONFLICT never fired and
  // every API restart inserted another copy of each system role. Repoint
  // assignments to the oldest copy, delete the copies, then enforce uniqueness.
  `WITH keepers AS (
     SELECT slug, (array_agg(id ORDER BY created_at, id))[1] AS keep_id
     FROM ccdi_roles WHERE organization_id IS NULL GROUP BY slug HAVING count(*) > 1
   ), dupes AS (
     SELECT r.id AS dupe_id, k.keep_id FROM ccdi_roles r
     JOIN keepers k ON k.slug = r.slug
     WHERE r.organization_id IS NULL AND r.id <> k.keep_id
   )
   UPDATE ccdi_user_roles ur SET role_id = d.keep_id
   FROM dupes d
   WHERE ur.role_id = d.dupe_id
     AND NOT EXISTS (
       SELECT 1 FROM ccdi_user_roles x
       WHERE x.organization_id = ur.organization_id AND x.user_ref = ur.user_ref AND x.role_id = d.keep_id
     )`,
  `WITH keepers AS (
     SELECT slug, (array_agg(id ORDER BY created_at, id))[1] AS keep_id
     FROM ccdi_roles WHERE organization_id IS NULL GROUP BY slug HAVING count(*) > 1
   )
   DELETE FROM ccdi_roles r USING keepers k
   WHERE r.organization_id IS NULL AND r.slug = k.slug AND r.id <> k.keep_id`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_ccdi_roles_system_slug ON ccdi_roles(slug) WHERE organization_id IS NULL`,

  // ── Audit hardening: tamper-evident hash chain + append-only ────────
  `ALTER TABLE ccdi_audit_logs ADD COLUMN IF NOT EXISTS event_id UUID DEFAULT gen_random_uuid()`,
  `ALTER TABLE ccdi_audit_logs ADD COLUMN IF NOT EXISTS outcome TEXT`,
  `ALTER TABLE ccdi_audit_logs ADD COLUMN IF NOT EXISTS correlation_id TEXT`,
  `ALTER TABLE ccdi_audit_logs ADD COLUMN IF NOT EXISTS prev_hash TEXT`,
  `ALTER TABLE ccdi_audit_logs ADD COLUMN IF NOT EXISTS entry_hash TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_ccdi_audit_event_id ON ccdi_audit_logs(event_id)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_audit_correlation ON ccdi_audit_logs(correlation_id)`,

  // Blocks DELETE and any UPDATE, with one exception: ON DELETE SET NULL of
  // organization_id (an organisation being removed) must not be blocked, and the
  // hash deliberately excludes organization_id so the chain stays verifiable.
  `CREATE OR REPLACE FUNCTION ccdi_audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ccdi_audit_logs is append-only';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS NULL
       AND OLD.organization_id IS NOT NULL
       AND (to_jsonb(NEW) - 'organization_id') = (to_jsonb(OLD) - 'organization_id') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'ccdi_audit_logs is append-only';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_ccdi_audit_logs_immutable ON ccdi_audit_logs`,
  `CREATE TRIGGER trg_ccdi_audit_logs_immutable
   BEFORE UPDATE OR DELETE ON ccdi_audit_logs
   FOR EACH ROW EXECUTE FUNCTION ccdi_audit_logs_immutable()`,
];

/** Capabilities that are never implied by wildcard admin permissions. */
export const CCDI_RESTRICTED_PERMISSIONS = [
  "ccdi.secrets.reveal",
  "ccdi.tools.execute",
  "ccdi.pentest.approve",
  "ccdi.deploy.production",
  "ccdi.destructive.run",
  "ccdi.workers.admin",
  "ccdi.cross_tenant.access",
] as const;

export const CCDI_FOUNDATION_PERMISSION_SEED: Array<{ code: string; name: string; category: string; description: string }> = [
  { code: "ccdi.organizations.manage", name: "Manage Organisations", category: "organisation", description: "Create and edit organisations and members" },
  { code: "ccdi.roles.manage", name: "Manage Roles", category: "access", description: "Create custom roles and edit role permissions" },
  { code: "ccdi.security.configure", name: "Configure Security", category: "security", description: "Edit security settings and policies" },
  { code: "ccdi.integrations.view", name: "View Integrations", category: "integrations", description: "View integration registrations" },
  { code: "ccdi.integrations.manage", name: "Manage Integrations", category: "integrations", description: "Register and configure integrations" },
  { code: "ccdi.credentials.manage", name: "Manage Credentials", category: "credentials", description: "Store, rotate and revoke credentials (values are never shown)" },
  { code: "ccdi.ai.configure", name: "Configure AI Providers", category: "ai", description: "Register AI providers and cost limits" },
  { code: "ccdi.incidents.view", name: "View Incidents", category: "incidents", description: "Reserved for a later phase" },
  { code: "ccdi.incidents.manage", name: "Manage Incidents", category: "incidents", description: "Reserved for a later phase" },
  { code: "ccdi.compliance.view", name: "View Compliance", category: "compliance", description: "Reserved for a later phase" },
  { code: "ccdi.reports.view", name: "View Reports", category: "reporting", description: "View reports" },
  // Restricted: granted to no system role. Assign explicitly, per user, when justified.
  { code: "ccdi.secrets.reveal", name: "Reveal Secret Values", category: "restricted", description: "RESTRICTED. No API reveals secrets in Phase 2; reserved for explicit grant" },
  { code: "ccdi.tools.execute", name: "Execute Security Tools", category: "restricted", description: "RESTRICTED. Reserved for a later phase" },
  { code: "ccdi.pentest.approve", name: "Approve Penetration Tests", category: "restricted", description: "RESTRICTED. Reserved for a later phase" },
  { code: "ccdi.deploy.production", name: "Production Deployment", category: "restricted", description: "RESTRICTED. Reserved" },
  { code: "ccdi.destructive.run", name: "Destructive Operations", category: "restricted", description: "RESTRICTED. Reserved" },
  { code: "ccdi.workers.admin", name: "Administer Security Workers", category: "restricted", description: "RESTRICTED. Reserved for a later phase" },
  { code: "ccdi.cross_tenant.access", name: "Cross-Tenant Access", category: "restricted", description: "RESTRICTED. Reserved for explicit platform grants" },
];

const VIEW_BASE = ["ccdi.command_centre.view", "ccdi.assets.view", "ccdi.findings.view"];
const ORG_ADMIN_PERMS = [
  "ccdi.org.admin", "ccdi.users.manage", "ccdi.roles.manage", "ccdi.organizations.manage",
  "ccdi.security.configure", "ccdi.integrations.view", "ccdi.integrations.manage",
  "ccdi.credentials.manage", "ccdi.ai.configure", "ccdi.audit.view", "ccdi.reports.view",
  ...VIEW_BASE,
];

/** Roles added by the foundation. Existing roles in ccdi-schema.ts are untouched. */
export const CCDI_FOUNDATION_SYSTEM_ROLES: Array<{ slug: string; name: string; description: string; permissions: string[] }> = [
  {
    slug: "platform_administrator",
    name: "Platform Administrator",
    description: "Platform operations; no secret access, no tool execution",
    permissions: ["ccdi.platform.admin", ...ORG_ADMIN_PERMS, "ccdi.kill_switch", "ccdi.connectors.view", "ccdi.connectors.manage"],
  },
  {
    slug: "organization_administrator",
    name: "Organisation Administrator",
    description: "Administers one organisation; no secret access, no tool execution",
    permissions: ORG_ADMIN_PERMS,
  },
  {
    slug: "incident_responder",
    name: "Incident Responder",
    description: "Incident handling (module reserved for a later phase)",
    permissions: [...VIEW_BASE, "ccdi.incidents.view", "ccdi.incidents.manage", "ccdi.evidence.view", "ccdi.audit.view"],
  },
  {
    slug: "developer",
    name: "Developer",
    description: "Remediation visibility for engineering teams",
    permissions: [...VIEW_BASE, "ccdi.findings.manage", "ccdi.integrations.view"],
  },
];

/** Extra permissions appended to existing system roles (additive only). */
export const CCDI_FOUNDATION_ROLE_EXTENSIONS: Record<string, string[]> = {
  super_administrator: [
    "ccdi.organizations.manage", "ccdi.roles.manage", "ccdi.security.configure",
    "ccdi.integrations.view", "ccdi.integrations.manage", "ccdi.credentials.manage",
    "ccdi.ai.configure", "ccdi.incidents.view", "ccdi.incidents.manage",
    "ccdi.compliance.view", "ccdi.reports.view",
  ],
  security_director: ["ccdi.security.configure", "ccdi.integrations.view", "ccdi.incidents.view", "ccdi.compliance.view", "ccdi.reports.view"],
  security_manager: ["ccdi.integrations.view", "ccdi.incidents.view", "ccdi.reports.view"],
  security_analyst: ["ccdi.incidents.view", "ccdi.reports.view"],
  compliance_auditor: ["ccdi.compliance.view", "ccdi.reports.view", "ccdi.incidents.view"],
};
