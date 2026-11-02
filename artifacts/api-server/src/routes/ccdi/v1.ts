/**
 * CINTEXA CCDI — Phase 2 foundation API (versioned). Mounted at /api/ccdi/v1.
 *
 * Authentication is OPEN by default (CCDI_ACCESS_MODE=open): see services/ccdi-foundation/access.ts.
 * Every route below still validates input, scopes queries by organisation, writes an audit record
 * for state changes, and never returns secret values.
 *
 * Phase 3+ capabilities (scanners, pentest execution, SIEM pipelines, AI agents) are NOT here.
 */
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { logger } from "../../lib/logger";
import {
  assertCanGrant,
  ccdiContext,
  isRestricted,
  permissionSet,
  requirePermission,
  type CcdiContext,
} from "../../services/ccdi-foundation/access";
import { appendAudit, verifyAuditChain, withAudit } from "../../services/ccdi-foundation/audit";
import { seedFoundation } from "../../services/ccdi-foundation/seed";
import {
  ENV_REF_RE,
  maskSecret,
  openSecret,
  sealSecret,
  vaultStatus,
} from "../../services/ccdi-foundation/vault";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  matchRecoveryCode,
  otpauthUri,
  verifyTotp,
} from "../../services/ccdi-foundation/totp";
import {
  HttpError,
  handler,
  limitBody,
  obj,
  oneOf,
  page,
  rateLimit,
  reqStr,
  slugify,
  str,
  uuidParam,
} from "../../services/ccdi-foundation/http";

const router = Router();

const CREDENTIAL_KINDS = ["ai_provider", "security_tool", "cloud", "siem", "email", "messaging", "payment", "github", "threat_intel", "other"] as const;
const INTEGRATION_CATEGORIES = ["github", "ai_provider", "email", "whatsapp", "payment", "security_tool", "cloud", "siem", "threat_intel", "other"] as const;
const AI_PROVIDERS = ["openai", "anthropic", "gemini", "openrouter", "custom"] as const;
const KEY_RE = /^[a-z0-9][a-z0-9_.-]{0,119}$/;

router.use(limitBody(256 * 1024));
router.use(rateLimit("ccdi-v1", 600));
router.use(ccdiContext);

let seedPromise: Promise<void> | null = null;
router.use((_req, _res, next) => {
  seedPromise ??= seedFoundation().catch((err) => {
    seedPromise = null;
    logger.warn({ err }, "ccdi.v1 foundation seed deferred");
  });
  void seedPromise.finally(() => next());
});

const ctxOf = (req: Request): CcdiContext => req.ccdi as CcdiContext;

function auditBase(req: Request, orgId: string | null) {
  const c = ctxOf(req);
  return { organizationId: orgId, actorRef: c.actorRef, actorEmail: c.actorEmail, correlationId: c.correlationId, ip: c.ip, userAgent: c.userAgent };
}

/** Requires a real identity in both modes where the feature is personal (MFA, own sessions). */
function requireIdentified(req: Request): void {
  const c = ctxOf(req);
  if (c.mode === "open" || !c.authenticated) {
    throw new HttpError(409, "This feature needs an identified user. Sign-in is disabled (open-access mode).", "IDENTITY_REQUIRED");
  }
}

// ── Health ──────────────────────────────────────────────────────────────
router.get("/health", handler(async (req, res) => {
  let database = "ok";
  try {
    await pool.query("SELECT 1");
  } catch {
    database = "unavailable";
  }
  const vault = vaultStatus();
  res.json({
    module: "ccdi",
    layer: "phase2-foundation",
    apiVersion: "v1",
    accessMode: ctxOf(req).mode,
    authentication: ctxOf(req).mode === "open" ? "disabled (open access)" : "required",
    database,
    credentialVault: { configured: vault.configured, activeKeyVersion: vault.activeKeyVersion, mode: vault.mode },
    correlationId: ctxOf(req).correlationId,
  });
}));

// ── API documentation ───────────────────────────────────────────────────
const ROUTE_DOCS: Array<{ method: string; path: string; permission: string; summary: string }> = [
  { method: "GET", path: "/health", permission: "-", summary: "Foundation health, access mode and vault status" },
  { method: "GET", path: "/me", permission: "identity", summary: "Current context, memberships and permissions" },
  { method: "GET", path: "/organizations", permission: "identity", summary: "Organisations visible to the caller" },
  { method: "POST", path: "/organizations", permission: "ccdi.organizations.manage (platform)", summary: "Create an organisation" },
  { method: "PATCH", path: "/organizations/{orgId}", permission: "ccdi.organizations.manage", summary: "Rename or change status" },
  { method: "GET", path: "/organizations/{orgId}/members", permission: "ccdi.users.manage", summary: "List members with roles" },
  { method: "POST", path: "/organizations/{orgId}/members", permission: "ccdi.users.manage", summary: "Add a member" },
  { method: "DELETE", path: "/organizations/{orgId}/members/{userRef}", permission: "ccdi.users.manage", summary: "Remove a member and their roles" },
  { method: "PUT", path: "/organizations/{orgId}/members/{userRef}/roles", permission: "ccdi.users.manage", summary: "Replace a member's roles (anti-escalation enforced)" },
  { method: "GET", path: "/roles", permission: "ccdi.users.manage", summary: "System and organisation roles with permissions" },
  { method: "GET", path: "/permissions", permission: "ccdi.users.manage", summary: "Permission catalogue (restricted flagged)" },
  { method: "POST", path: "/organizations/{orgId}/roles", permission: "ccdi.roles.manage", summary: "Create a custom role" },
  { method: "PUT", path: "/organizations/{orgId}/roles/{roleId}/permissions", permission: "ccdi.roles.manage", summary: "Replace a custom role's permissions" },
  { method: "GET", path: "/audit", permission: "ccdi.audit.view", summary: "Paginated audit trail" },
  { method: "GET", path: "/audit/verify", permission: "ccdi.platform.admin", summary: "Verify the audit hash chain" },
  { method: "GET|PUT", path: "/organizations/{orgId}/settings[/{key}]", permission: "ccdi.security.configure", summary: "Versioned organisation settings" },
  { method: "GET|PUT", path: "/organizations/{orgId}/policies[/{type}/{key}]", permission: "ccdi.security.configure", summary: "Security, access, retention, approval policies" },
  { method: "GET|PUT", path: "/platform/settings[/{key}]", permission: "ccdi.platform.admin", summary: "Platform-wide settings" },
  { method: "GET|POST", path: "/organizations/{orgId}/credentials", permission: "ccdi.credentials.manage", summary: "Masked credential metadata; create (value accepted once)" },
  { method: "POST", path: "/organizations/{orgId}/credentials/{id}/rotate|revoke", permission: "ccdi.credentials.manage", summary: "Rotate or revoke" },
  { method: "DELETE", path: "/organizations/{orgId}/credentials/{id}", permission: "ccdi.credentials.manage", summary: "Soft-delete and wipe ciphertext" },
  { method: "GET|POST|PATCH|DELETE", path: "/organizations/{orgId}/integrations[/{id}]", permission: "ccdi.integrations.manage", summary: "Integration registrations" },
  { method: "POST", path: "/organizations/{orgId}/integrations/{id}/test", permission: "ccdi.integrations.manage", summary: "Configuration check (no outbound call)" },
  { method: "GET|POST|PATCH|DELETE", path: "/organizations/{orgId}/ai-providers[/{id}]", permission: "ccdi.ai.configure", summary: "AI provider registrations and limits" },
  { method: "POST", path: "/organizations/{orgId}/ai-providers/{id}/test", permission: "ccdi.ai.configure", summary: "Live connection test for OpenAI, Anthropic, Gemini, OpenRouter" },
  { method: "GET", path: "/mfa/status", permission: "identity", summary: "MFA state for the current user" },
  { method: "POST", path: "/mfa/totp/enroll|confirm|verify|disable", permission: "identity", summary: "TOTP lifecycle (server-verified)" },
  { method: "POST", path: "/mfa/recovery-codes/regenerate", permission: "identity", summary: "Replace recovery codes" },
  { method: "GET", path: "/account/security", permission: "identity", summary: "Own recent authentication events" },
  { method: "GET", path: "/extension-points", permission: "-", summary: "Reserved future modules (none operational)" },
];

router.get("/docs", handler(async (_req, res) => {
  res.json({
    title: "CINTEXA CCDI Foundation API",
    version: "v1",
    basePath: "/api/ccdi/v1",
    headers: {
      "x-ccdi-organization": "Organisation context (UUID) for tenant routes; /organizations/{orgId}/… paths set it automatically",
      "x-correlation-id": "Optional 8-64 char id echoed back and stored in the audit trail",
    },
    conventions: "Errors are { error, correlationId }. Lists accept limit (1-100) and offset. Secret values are never returned.",
    routes: ROUTE_DOCS,
  });
}));

router.get("/extension-points", handler(async (_req, res) => {
  const reserved = (name: string) => ({ module: name, state: "reserved", operational: false });
  res.json({
    note: "Structural placeholders only. Nothing below executes in Phase 2.",
    modules: [
      reserved("security-scans"), reserved("penetration-testing"), reserved("siem-pipelines"),
      reserved("incident-response"), reserved("ai-security-agents"), reserved("security-workers"),
    ],
  });
}));

// ── Current identity ────────────────────────────────────────────────────
router.get("/me", handler(async (req, res) => {
  const c = ctxOf(req);
  if (c.mode === "open") {
    res.json({ mode: "open", actor: c.actorRef, authenticated: false, note: "Open-access mode: no sign-in, permissions not enforced." });
    return;
  }
  if (!c.authenticated) throw new HttpError(401, "Authentication required");
  const memberships = await pool.query(
    `SELECT m.organization_id, o.name, o.slug, m.status FROM ccdi_org_members m
     JOIN ccdi_organizations o ON o.id = m.organization_id WHERE m.user_ref = $1 AND m.status <> 'removed'`,
    [c.actorRef],
  );
  const perms = c.orgId ? [...(await permissionSet(c.actorRef, c.orgId))].sort() : [];
  res.json({ mode: "enforced", actor: c.actorRef, email: c.actorEmail, authenticated: true, organizationId: c.orgId, memberships: memberships.rows, permissions: perms });
}));

// ── Organisations ───────────────────────────────────────────────────────
router.get("/organizations", handler(async (req, res) => {
  const c = ctxOf(req);
  const { limit, offset } = page(req);
  if (c.mode === "enforced") {
    if (!c.authenticated) throw new HttpError(401, "Authentication required");
    const { rows } = await pool.query(
      `SELECT o.id, o.name, o.slug, o.status, o.created_at FROM ccdi_organizations o
       JOIN ccdi_org_members m ON m.organization_id = o.id AND m.user_ref = $1 AND m.status = 'active'
       ORDER BY o.name LIMIT $2 OFFSET $3`,
      [c.actorRef, limit, offset],
    );
    res.json({ organizations: rows, limit, offset });
    return;
  }
  const { rows } = await pool.query(
    `SELECT id, name, slug, status, created_at FROM ccdi_organizations ORDER BY name LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  res.json({ organizations: rows, limit, offset });
}));

router.post("/organizations", requirePermission("ccdi.organizations.manage", { platform: true }), handler(async (req, res) => {
  const c = ctxOf(req);
  const name = reqStr(req.body?.name, "name", { max: 200 });
  const slug = str(req.body?.slug, "slug", { optional: true, max: 80, re: /^[a-z0-9][a-z0-9-]*$/ }) ?? slugify(name);
  if (!slug) throw new HttpError(400, "A slug could not be derived from the name");
  const org = await withAudit(
    (o: { id: string; slug: string }) => ({ ...auditBase(req, o.id), action: "organization.created", entityType: "organization", entityId: o.id, meta: { slug: o.slug } }),
    async (client) => {
      const { rows } = await client.query(
        `INSERT INTO ccdi_organizations (name, slug) VALUES ($1,$2) RETURNING id, name, slug, status, created_at`,
        [name, slug],
      );
      if (c.mode === "enforced") {
        await client.query(`INSERT INTO ccdi_org_members (organization_id, user_ref, email, status) VALUES ($1,$2,$3,'active')`, [rows[0].id, c.actorRef, c.actorEmail]);
        await client.query(
          `INSERT INTO ccdi_user_roles (organization_id, user_ref, role_id, assigned_by)
           SELECT $1, $2, id, $2 FROM ccdi_roles WHERE organization_id IS NULL AND slug = 'organization_administrator'`,
          [rows[0].id, c.actorRef],
        );
      }
      return rows[0];
    },
  );
  res.status(201).json({ organization: org });
}));

router.patch("/organizations/:orgId", requirePermission("ccdi.organizations.manage", { tenant: true }), handler(async (req, res) => {
  const orgId = uuidParam(req.params.orgId, "orgId");
  const name = str(req.body?.name, "name", { optional: true, max: 200 });
  const status = req.body?.status === undefined ? undefined : oneOf(req.body.status, "status", ["active", "suspended", "archived"] as const);
  if (name === undefined && status === undefined) throw new HttpError(400, "Nothing to update");
  const org = await withAudit(
    { ...auditBase(req, orgId), action: "organization.updated", entityType: "organization", entityId: orgId, meta: { name, status } },
    async (client) => {
      const { rows } = await client.query(
        `UPDATE ccdi_organizations SET name = COALESCE($2, name), status = COALESCE($3, status), updated_at = now()
         WHERE id = $1 RETURNING id, name, slug, status, updated_at`,
        [orgId, name ?? null, status ?? null],
      );
      if (!rows.length) throw new HttpError(404, "Organisation not found");
      return rows[0];
    },
  );
  res.json({ organization: org });
}));

// ── Members and role assignment ─────────────────────────────────────────
router.get("/organizations/:orgId/members", requirePermission("ccdi.users.manage", { tenant: true }), handler(async (req, res) => {
  const orgId = uuidParam(req.params.orgId, "orgId");
  const { limit, offset } = page(req);
  const { rows } = await pool.query(
    `SELECT m.user_ref, m.display_name, m.email, m.status, m.joined_at,
            COALESCE(array_agg(r.slug ORDER BY r.slug) FILTER (WHERE r.slug IS NOT NULL), '{}') AS roles
     FROM ccdi_org_members m
     LEFT JOIN ccdi_user_roles ur ON ur.organization_id = m.organization_id AND ur.user_ref = m.user_ref
     LEFT JOIN ccdi_roles r ON r.id = ur.role_id
     WHERE m.organization_id = $1 AND m.status <> 'removed'
     GROUP BY m.id ORDER BY m.joined_at LIMIT $2 OFFSET $3`,
    [orgId, limit, offset],
  );
  res.json({ members: rows, limit, offset });
}));

router.post("/organizations/:orgId/members", requirePermission("ccdi.users.manage", { tenant: true }), handler(async (req, res) => {
  const orgId = uuidParam(req.params.orgId, "orgId");
  const userRef = reqStr(req.body?.userRef, "userRef", { max: 120, re: /^[A-Za-z0-9@._:-]+$/ });
  const email = str(req.body?.email, "email", { optional: true, max: 254, re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ });
  const displayName = str(req.body?.displayName, "displayName", { optional: true, max: 120 });
  const member = await withAudit(
    { ...auditBase(req, orgId), action: "member.added", entityType: "org_member", entityId: userRef, meta: { email: email ?? null } },
    async (client) => {
      const { rows } = await client.query(
        `INSERT INTO ccdi_org_members (organization_id, user_ref, email, display_name, status, invited_by)
         VALUES ($1,$2,$3,$4,'active',$5)
         ON CONFLICT (organization_id, user_ref) DO UPDATE
           SET status = 'active', removed_at = NULL, email = COALESCE(EXCLUDED.email, ccdi_org_members.email),
               display_name = COALESCE(EXCLUDED.display_name, ccdi_org_members.display_name), updated_at = now()
         RETURNING user_ref, display_name, email, status, joined_at`,
        [orgId, userRef, email ?? null, displayName ?? null, ctxOf(req).actorRef],
      );
      return rows[0];
    },
  );
  res.status(201).json({ member });
}));

router.delete("/organizations/:orgId/members/:userRef", requirePermission("ccdi.users.manage", { tenant: true }), handler(async (req, res) => {
  const orgId = uuidParam(req.params.orgId, "orgId");
  const userRef = reqStr(req.params.userRef, "userRef", { max: 120 });
  const c = ctxOf(req);
  if (c.mode === "enforced" && userRef === c.actorRef) throw new HttpError(409, "You cannot remove yourself from an organisation");
  await withAudit(
    { ...auditBase(req, orgId), action: "member.removed", entityType: "org_member", entityId: userRef },
    async (client) => {
      const r = await client.query(
        `UPDATE ccdi_org_members SET status = 'removed', removed_at = now(), updated_at = now()
         WHERE organization_id = $1 AND user_ref = $2 AND status <> 'removed'`,
        [orgId, userRef],
      );
      if (!r.rowCount) throw new HttpError(404, "Member not found");
      await client.query(`DELETE FROM ccdi_user_roles WHERE organization_id = $1 AND user_ref = $2`, [orgId, userRef]);
    },
  );
  res.json({ ok: true });
}));

router.put("/organizations/:orgId/members/:userRef/roles", requirePermission("ccdi.users.manage", { tenant: true }), handler(async (req, res) => {
  const orgId = uuidParam(req.params.orgId, "orgId");
  const userRef = reqStr(req.params.userRef, "userRef", { max: 120 });
  const slugs: unknown = req.body?.roleSlugs;
  if (!Array.isArray(slugs) || slugs.length > 20 || slugs.some((s) => typeof s !== "string" || !KEY_RE.test(s))) {
    throw new HttpError(400, "roleSlugs must be an array of up to 20 role slugs");
  }
  const wanted = [...new Set(slugs as string[])];
  const c = ctxOf(req);

  const member = await pool.query(`SELECT 1 FROM ccdi_org_members WHERE organization_id = $1 AND user_ref = $2 AND status = 'active'`, [orgId, userRef]);
  if (!member.rowCount) throw new HttpError(404, "Active member not found in this organisation");

  const roles = await pool.query(
    `SELECT r.id, r.slug, COALESCE(array_agg(p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS codes
     FROM ccdi_roles r
     LEFT JOIN ccdi_role_permissions rp ON rp.role_id = r.id
     LEFT JOIN ccdi_permissions p ON p.id = rp.permission_id
     WHERE r.slug = ANY($1::text[]) AND (r.organization_id IS NULL OR r.organization_id = $2)
     GROUP BY r.id`,
    [wanted, orgId],
  );
  if (roles.rows.length !== wanted.length) throw new HttpError(400, "One or more roles do not exist in this organisation");

  const needed = new Set<string>();
  for (const r of roles.rows) for (const code of r.codes as string[]) needed.add(code);
  await assertCanGrant(c, orgId, [...needed]);
  if (c.mode === "enforced" && userRef === c.actorRef) throw new HttpError(409, "You cannot change your own roles");

  const result = await withAudit(
    { ...auditBase(req, orgId), action: "member.roles_changed", entityType: "org_member", entityId: userRef, meta: { roles: wanted } },
    async (client) => {
      const before = await client.query(
        `SELECT r.slug FROM ccdi_user_roles ur JOIN ccdi_roles r ON r.id = ur.role_id WHERE ur.organization_id = $1 AND ur.user_ref = $2`,
        [orgId, userRef],
      );
      await client.query(`DELETE FROM ccdi_user_roles WHERE organization_id = $1 AND user_ref = $2`, [orgId, userRef]);
      for (const r of roles.rows) {
        await client.query(
          `INSERT INTO ccdi_user_roles (organization_id, user_ref, role_id, assigned_by) VALUES ($1,$2,$3,$4)`,
          [orgId, userRef, r.id, c.actorRef],
        );
      }
      return { previous: before.rows.map((x: { slug: string }) => x.slug), current: wanted };
    },
  );
  res.json(result);
}));

// ── Roles and permissions ───────────────────────────────────────────────
router.get("/roles", requirePermission("ccdi.users.manage"), handler(async (req, res) => {
  const orgId = ctxOf(req).orgId;
  const { rows } = await pool.query(
    `SELECT r.id, r.organization_id, r.name, r.slug, r.description, r.is_system,
            COALESCE(array_agg(p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
     FROM ccdi_roles r
     LEFT JOIN ccdi_role_permissions rp ON rp.role_id = r.id
     LEFT JOIN ccdi_permissions p ON p.id = rp.permission_id
     WHERE r.organization_id IS NULL OR r.organization_id = $1
     GROUP BY r.id ORDER BY r.is_system DESC, r.name`,
    [orgId],
  );
  res.json({ roles: rows });
}));

router.get("/permissions", requirePermission("ccdi.users.manage"), handler(async (_req, res) => {
  const { rows } = await pool.query(`SELECT code, name, category, description FROM ccdi_permissions ORDER BY category, code`);
  res.json({ permissions: rows.map((p: { code: string }) => ({ ...p, restricted: isRestricted(p.code) })) });
}));

async function validatePermissionCodes(input: unknown): Promise<string[]> {
  if (!Array.isArray(input) || input.length > 200 || input.some((c) => typeof c !== "string")) {
    throw new HttpError(400, "permissions must be an array of permission codes");
  }
  const codes = [...new Set(input as string[])];
  const { rows } = await pool.query(`SELECT code FROM ccdi_permissions WHERE code = ANY($1::text[])`, [codes]);
  if (rows.length !== codes.length) throw new HttpError(400, "One or more permission codes are unknown");
  return codes;
}

router.post("/organizations/:orgId/roles", requirePermission("ccdi.roles.manage", { tenant: true }), handler(async (req, res) => {
  const orgId = uuidParam(req.params.orgId, "orgId");
  const name = reqStr(req.body?.name, "name", { max: 80 });
  const slug = str(req.body?.slug, "slug", { optional: true, max: 60, re: /^[a-z0-9][a-z0-9_-]*$/ }) ?? slugify(name).replace(/-/g, "_");
  const description = str(req.body?.description, "description", { optional: true, max: 300 });
  const codes = await validatePermissionCodes(req.body?.permissions ?? []);
  await assertCanGrant(ctxOf(req), orgId, codes);
  const role = await withAudit(
    (r: { id: string }) => ({ ...auditBase(req, orgId), action: "role.created", entityType: "role", entityId: r.id, meta: { slug, permissions: codes } }),
    async (client) => {
      const { rows } = await client.query(
        `INSERT INTO ccdi_roles (organization_id, name, slug, description, is_system) VALUES ($1,$2,$3,$4,false) RETURNING id, name, slug, description`,
        [orgId, name, slug, description ?? null],
      );
      await client.query(
        `INSERT INTO ccdi_role_permissions (role_id, permission_id) SELECT $1, id FROM ccdi_permissions WHERE code = ANY($2::text[])`,
        [rows[0].id, codes],
      );
      return rows[0];
    },
  );
  res.status(201).json({ role: { ...role, permissions: codes } });
}));

router.put("/organizations/:orgId/roles/:roleId/permissions", requirePermission("ccdi.roles.manage", { tenant: true }), handler(async (req, res) => {
  const orgId = uuidParam(req.params.orgId, "orgId");
  const roleId = uuidParam(req.params.roleId, "roleId");
  const codes = await validatePermissionCodes(req.body?.permissions);
  await assertCanGrant(ctxOf(req), orgId, codes);
  await withAudit(
    { ...auditBase(req, orgId), action: "role.permissions_changed", entityType: "role", entityId: roleId, meta: { permissions: codes } },
    async (client) => {
      const role = await client.query(`SELECT is_system FROM ccdi_roles WHERE id = $1 AND organization_id = $2`, [roleId, orgId]);
      if (!role.rowCount) throw new HttpError(404, "Role not found in this organisation");
      if (role.rows[0].is_system) throw new HttpError(403, "System roles cannot be modified");
      await client.query(`DELETE FROM ccdi_role_permissions WHERE role_id = $1`, [roleId]);
      await client.query(
        `INSERT INTO ccdi_role_permissions (role_id, permission_id) SELECT $1, id FROM ccdi_permissions WHERE code = ANY($2::text[])`,
        [roleId, codes],
      );
    },
  );
  res.json({ ok: true, permissions: codes });
}));

// ── Audit ───────────────────────────────────────────────────────────────
router.get("/audit", requirePermission("ccdi.audit.view"), handler(async (req, res) => {
  const c = ctxOf(req);
  if (c.mode === "enforced" && !c.orgId) throw new HttpError(400, "An organisation context is required");
  const { limit, offset } = page(req);
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
  if (c.orgId) add("organization_id = ?::uuid", c.orgId);
  if (typeof req.query.action === "string" && /^[a-z0-9_.:-]{1,80}$/i.test(req.query.action)) add("action = ?", req.query.action);
  if (typeof req.query.actor === "string" && req.query.actor.length <= 120) add("actor_ref = ?", req.query.actor);
  if (typeof req.query.outcome === "string" && ["success", "failure", "denied"].includes(req.query.outcome)) add("outcome = ?", req.query.outcome);
  if (typeof req.query.from === "string" && !Number.isNaN(Date.parse(req.query.from))) add("created_at >= ?::timestamptz", req.query.from);
  if (typeof req.query.to === "string" && !Number.isNaN(Date.parse(req.query.to))) add("created_at <= ?::timestamptz", req.query.to);
  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT id::text AS id, event_id, organization_id, actor_ref, actor_email, action, entity_type, entity_id,
            outcome, correlation_id, ip_address, meta, created_at
     FROM ccdi_audit_logs ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  res.json({ events: rows, limit, offset });
}));

router.get("/audit/verify", requirePermission("ccdi.audit.view", { platform: true }), handler(async (_req, res) => {
  res.json(await verifyAuditChain());
}));

// ── Settings and policies ───────────────────────────────────────────────
async function listSettings(orgId: string | null) {
  const { rows } = await pool.query(
    `SELECT key, value, version, updated_by, updated_at FROM ccdi_settings
     WHERE organization_id IS NOT DISTINCT FROM $1::uuid ORDER BY key`,
    [orgId],
  );
  return rows;
}

async function putSetting(req: Request, orgId: string | null, key: string) {
  if (!KEY_RE.test(key)) throw new HttpError(400, "Invalid setting key");
  const value = obj(req.body?.value, "value");
  const expected = req.body?.expectedVersion;
  if (expected !== undefined && !Number.isInteger(expected)) throw new HttpError(400, "expectedVersion must be an integer");
  return withAudit(
    { ...auditBase(req, orgId), action: "setting.updated", entityType: "setting", entityId: key, meta: { key, value } },
    async (client) => {
      const cur = await client.query(
        `SELECT id, version FROM ccdi_settings WHERE organization_id IS NOT DISTINCT FROM $1::uuid AND key = $2 FOR UPDATE`,
        [orgId, key],
      );
      if (cur.rowCount) {
        if (expected !== undefined && cur.rows[0].version !== expected) throw new HttpError(409, "The setting was changed by someone else. Reload and retry.");
        const { rows } = await client.query(
          `UPDATE ccdi_settings SET value = $2::jsonb, version = version + 1, updated_by = $3, updated_at = now()
           WHERE id = $1 RETURNING key, value, version, updated_at`,
          [cur.rows[0].id, JSON.stringify(value), ctxOf(req).actorRef],
        );
        return rows[0];
      }
      const { rows } = await client.query(
        `INSERT INTO ccdi_settings (organization_id, key, value, updated_by) VALUES ($1,$2,$3::jsonb,$4)
         RETURNING key, value, version, updated_at`,
        [orgId, key, JSON.stringify(value), ctxOf(req).actorRef],
      );
      return rows[0];
    },
  );
}

router.get("/organizations/:orgId/settings", requirePermission("ccdi.security.configure", { tenant: true }), handler(async (req, res) => {
  res.json({ settings: await listSettings(uuidParam(req.params.orgId, "orgId")) });
}));
router.put("/organizations/:orgId/settings/:key", requirePermission("ccdi.security.configure", { tenant: true }), handler(async (req, res) => {
  res.json({ setting: await putSetting(req, uuidParam(req.params.orgId, "orgId"), String(req.params.key)) });
}));
router.get("/platform/settings", requirePermission("ccdi.platform.admin", { platform: true }), handler(async (_req, res) => {
  res.json({ settings: await listSettings(null) });
}));
router.put("/platform/settings/:key", requirePermission("ccdi.platform.admin", { platform: true }), handler(async (req, res) => {
  res.json({ setting: await putSetting(req, null, String(req.params.key)) });
}));

router.get("/organizations/:orgId/policies", requirePermission("ccdi.security.configure", { tenant: true }), handler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT policy_type, policy_key, title, definition, status, version, updated_by, updated_at
     FROM ccdi_security_policies WHERE organization_id = $1 ORDER BY policy_type, policy_key`,
    [uuidParam(req.params.orgId, "orgId")],
  );
  res.json({ policies: rows });
}));

router.put("/organizations/:orgId/policies/:type/:key", requirePermission("ccdi.security.configure", { tenant: true }), handler(async (req, res) => {
  const orgId = uuidParam(req.params.orgId, "orgId");
  const type = oneOf(req.params.type, "type", ["security", "access", "retention", "approval"] as const);
  const key = String(req.params.key);
  if (!KEY_RE.test(key)) throw new HttpError(400, "Invalid policy key");
  const title = reqStr(req.body?.title, "title", { max: 200 });
  const definition = obj(req.body?.definition, "definition");
  const status = req.body?.status === undefined ? "active" : oneOf(req.body.status, "status", ["draft", "active", "retired"] as const);
  const policy = await withAudit(
    { ...auditBase(req, orgId), action: "policy.updated", entityType: "policy", entityId: `${type}:${key}`, meta: { type, key, status, definition } },
    async (client) => {
      const { rows } = await client.query(
        `INSERT INTO ccdi_security_policies (organization_id, policy_type, policy_key, title, definition, status, updated_by)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
         ON CONFLICT (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), policy_type, policy_key)
         DO UPDATE SET title = EXCLUDED.title, definition = EXCLUDED.definition, status = EXCLUDED.status,
                       version = ccdi_security_policies.version + 1, updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING policy_type, policy_key, title, definition, status, version, updated_at`,
        [orgId, type, key, title, JSON.stringify(definition), status, ctxOf(req).actorRef],
      );
      return rows[0];
    },
  );
  res.json({ policy });
}));

// ── Credentials (values accepted once, never returned) ──────────────────
const CRED_COLUMNS = `id, name, kind, provider, storage, external_ref, masked_hint, status, expires_at, last_rotated_at, revoked_at, created_at`;
const credentialLimiter = rateLimit("ccdi-credentials", 30);

function secretValue(v: unknown): string {
  if (typeof v !== "string" || v.length < 8 || v.length > 8192) throw new HttpError(400, "value must be a string of 8-8192 characters");
  return v;
}

router.get("/organizations/:orgId/credentials", requirePermission("ccdi.credentials.manage", { tenant: true }), handler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${CRED_COLUMNS} FROM ccdi_credentials WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY name`,
    [uuidParam(req.params.orgId, "orgId")],
  );
  res.json({ credentials: rows, vault: { configured: vaultStatus().configured } });
}));

router.post("/organizations/:orgId/credentials", credentialLimiter, requirePermission("ccdi.credentials.manage", { tenant: true }), handler(async (req, res) => {
  const orgId = uuidParam(req.params.orgId, "orgId");
  const name = reqStr(req.body?.name, "name", { max: 120 });
  const kind = oneOf(req.body?.kind, "kind", CREDENTIAL_KINDS);
  const provider = reqStr(req.body?.provider, "provider", { max: 60, re: /^[a-z0-9_.-]+$/i });
  const storage = oneOf(req.body?.storage ?? "vault", "storage", ["vault", "env"] as const);
  const expiresAt = req.body?.expiresAt ? new Date(String(req.body.expiresAt)) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new HttpError(400, "expiresAt must be a valid date");

  const id = randomUUID();
  let sealed: ReturnType<typeof sealSecret> | null = null;
  let hint: string;
  let externalRef: string | null = null;
  if (storage === "vault") {
    if (!vaultStatus().configured) throw new HttpError(503, "The credential vault is not configured. Set CCDI_MASTER_KEYS (see docs/CCDI_PHASE2_FOUNDATION.md).", "VAULT_NOT_CONFIGURED");
    const value = secretValue(req.body?.value);
    sealed = sealSecret(value, id);
    hint = maskSecret(value);
  } else {
    externalRef = reqStr(req.body?.externalRef, "externalRef");
    if (!ENV_REF_RE.test(externalRef)) throw new HttpError(400, "externalRef must be an environment variable name starting with CCDI_");
    hint = `env:${externalRef}`;
  }

  const cred = await withAudit(
    { ...auditBase(req, orgId), action: "credential.created", entityType: "credential", entityId: id, meta: { name, kind, provider, storage } },
    async (client) => {
      const { rows } = await client.query(
        `INSERT INTO ccdi_credentials (id, organization_id, name, kind, provider, storage, external_ref, ciphertext, iv, auth_tag, key_version, masked_hint, expires_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING ${CRED_COLUMNS}`,
        [id, orgId, name, kind, provider, storage, externalRef, sealed?.ciphertext ?? null, sealed?.iv ?? null, sealed?.tag ?? null, sealed?.keyVersion ?? null, hint, expiresAt, ctxOf(req).actorRef],
      );
      return rows[0];
    },
  );
  res.status(201).json({ credential: cred });
}));

router.post("/organizations/:orgId/credentials/:id/rotate", credentialLimiter, requirePermission("ccdi.credentials.manage", { tenant: true }), handler(async (req, res) => {
  const orgId = uuidParam(req.params.orgId, "orgId");
  const id = uuidParam(req.params.id);
  if (!vaultStatus().configured) throw new HttpError(503, "The credential vault is not configured.", "VAULT_NOT_CONFIGURED");
  const value = secretValue(req.body?.value);
  const sealed = sealSecret(value, id);
  const cred = await withAudit(
    { ...auditBase(req, orgId), action: "credential.rotated", entityType: "credential", entityId: id, meta: { keyVersion: sealed.keyVersion } },
    async (client) => {
      const { rows } = await client.query(
        `UPDATE ccdi_credentials SET ciphertext=$3, iv=$4, auth_tag=$5, key_version=$6, masked_hint=$7, status='active',
                revoked_at=NULL, last_rotated_at=now(), updated_at=now()
         WHERE id=$1 AND organization_id=$2 AND storage='vault' AND deleted_at IS NULL RETURNING ${CRED_COLUMNS}`,
        [id, orgId, sealed.ciphertext, sealed.iv, sealed.tag, sealed.keyVersion, maskSecret(value)],
      );
      if (!rows.length) throw new HttpError(404, "Vault credential not found");
      return rows[0];
    },
  );
  res.json({ credential: cred });
}));

router.post("/organizations/:orgId/credentials/:id/revoke", credentialLimiter, requirePermission("ccdi.credentials.manage", { tenant: true }), handler(async (req, res) => {
  const orgId = uuidParam(req.params.orgId, "orgId");
  const id = uuidParam(req.params.id);
  const cred = await withAudit(
    { ...auditBase(req, orgId), action: "credential.revoked", entityType: "credential", entityId: id },
    async (client) => {
      const { rows } = await client.query(
        `UPDATE ccdi_credentials SET status='revoked', revoked_at=now(), ciphertext=NULL, iv=NULL, auth_tag=NULL, updated_at=now()
         WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL RETURNING ${CRED_COLUMNS}`,
        [id, orgId],
      );
      if (!rows.length) throw new HttpError(404, "Credential not found");
      return rows[0];
    },
  );
  res.json({ credential: cred });
}));

router.delete("/organizations/:orgId/credentials/:id", credentialLimiter, requirePermission("ccdi.credentials.manage", { tenant: true }), handler(async (req, res) => {
  const orgId = uuidParam(req.params.orgId, "orgId");
  const id = uuidParam(req.params.id);
  await withAudit(
    { ...auditBase(req, orgId), action: "credential.deleted", entityType: "credential", entityId: id },
    async (client) => {
      const r = await client.query(
        `UPDATE ccdi_credentials SET deleted_at=now(), status='revoked', revoked_at=COALESCE(revoked_at, now()),
                ciphertext=NULL, iv=NULL, auth_tag=NULL, updated_at=now()
         WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,
        [id, orgId],
      );
      if (!r.rowCount) throw new HttpError(404, "Credential not found");
    },
  );
  res.json({ ok: true });
}));

/** A credential reference must exist, be active and belong to the same organisation. */
async function assertCredentialInOrg(credentialId: string | null | undefined, orgId: string): Promise<string | null> {
  if (credentialId === undefined || credentialId === null || credentialId === "") return null;
  const id = uuidParam(credentialId, "credentialId");
  const { rows } = await pool.query(
    `SELECT 1 FROM ccdi_credentials WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status = 'active'`,
    [id, orgId],
  );
  if (!rows.length) throw new HttpError(400, "credentialId does not reference an active credential in this organisation");
  return id;
}

// ── Integrations ────────────────────────────────────────────────────────
const INTEGRATION_COLUMNS = `id, category, integration_key, name, config, credential_id, status, health_checked_at, health_detail, created_at, updated_at`;

router.get("/organizations/:orgId/integrations", requirePermission("ccdi.integrations.view", { tenant: true }), handler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${INTEGRATION_COLUMNS} FROM ccdi_integrations WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY category, name`,
    [uuidParam(req.params.orgId, "orgId")],
  );
  res.json({ integrations: rows });
}));

router.post("/organizations/:orgId/integrations", requirePermission("ccdi.integrations.manage", { tenant: true }), handler(async (req, res) => {
  const orgId = uuidParam(req.params.orgId, "orgId");
  const category = oneOf(req.body?.category, "category", INTEGRATION_CATEGORIES);
  const name = reqStr(req.body?.name, "name", { max: 120 });
  const key = str(req.body?.integrationKey, "integrationKey", { optional: true, max: 80, re: KEY_RE }) ?? slugify(name);
  const config = obj(req.body?.config, "config");
  const credentialId = await assertCredentialInOrg(req.body?.credentialId, orgId);
  const row = await withAudit(
    (r: { id: string }) => ({ ...auditBase(req, orgId), action: "integration.registered", entityType: "integration", entityId: r.id, meta: { category, key } }),
    async (client) => {
      const { rows } = await client.query(
        `INSERT INTO ccdi_integrations (organization_id, category, integration_key, name, config, credential_id, status, created_by)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING ${INTEGRATION_COLUMNS}`,
        [orgId, category, key, name, JSON.stringify(config), credentialId, credentialId ? "configured" : "registered", ctxOf(req).actorRef],
      );
      return rows[0];
    },
  );
  res.status(201).json({ integration: row });
}));

router.patch("/organizations/:orgId/integrations/:id", requirePermission("ccdi.integrations.manage", { tenant: true }), handler(async (req, res) => {
  const orgId = uuidParam(req.params.orgId, "orgId");
  const id = uuidParam(req.params.id);
  const name = str(req.body?.name, "name", { optional: true, max: 120 });
  const config = req.body?.config === undefined ? undefined : obj(req.body.config, "config");
  const disabled = req.body?.disabled === undefined ? undefined : Boolean(req.body.disabled);
  const credentialId = req.body?.credentialId === undefined ? undefined : await assertCredentialInOrg(req.body.credentialId, orgId);
  const row = await withAudit(
    { ...auditBase(req, orgId), action: "integration.updated", entityType: "integration", entityId: id, meta: { name, disabled, credentialChanged: credentialId !== undefined } },
    async (client) => {
      const { rows } = await client.query(
        `UPDATE ccdi_integrations SET
           name = COALESCE($3, name),
           config = COALESCE($4::jsonb, config),
           credential_id = CASE WHEN $5::boolean THEN $6::uuid ELSE credential_id END,
           status = CASE WHEN $7::boolean IS TRUE THEN 'disabled'
                         WHEN $7::boolean IS FALSE AND status = 'disabled' THEN 'registered' ELSE status END,
           updated_at = now()
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING ${INTEGRATION_COLUMNS}`,
        [id, orgId, name ?? null, config === undefined ? null : JSON.stringify(config), credentialId !== undefined, credentialId ?? null, disabled ?? null],
      );
      if (!rows.length) throw new HttpError(404, "Integration not found");
      return rows[0];
    },
  );
  res.json({ integration: row });
}));

router.delete("/organizations/:orgId/integrations/:id", requirePermission("ccdi.integrations.manage", { tenant: true }), handler(async (req, res) => {
  const orgId = uuidParam(req.params.orgId, "orgId");
  const id = uuidParam(req.params.id);
  await withAudit(
    { ...auditBase(req, orgId), action: "integration.deleted", entityType: "integration", entityId: id },
    async (client) => {
      const r = await client.query(`UPDATE ccdi_integrations SET deleted_at = now(), status = 'disabled' WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [id, orgId]);
      if (!r.rowCount) throw new HttpError(404, "Integration not found");
    },
  );
  res.json({ ok: true });
}));

router.post("/organizations/:orgId/integrations/:id/test", requirePermission("ccdi.integrations.manage", { tenant: true }), handler(async (req, res) => {
  const orgId = uuidParam(req.params.orgId, "orgId");
  const id = uuidParam(req.params.id);
  const { rows } = await pool.query(
    `SELECT i.id, i.credential_id, c.status AS credential_status
     FROM ccdi_integrations i LEFT JOIN ccdi_credentials c ON c.id = i.credential_id AND c.deleted_at IS NULL
     WHERE i.id = $1 AND i.organization_id = $2 AND i.deleted_at IS NULL`,
    [id, orgId],
  );
  if (!rows.length) throw new HttpError(404, "Integration not found");
  const r = rows[0];
  const ok = r.credential_id && r.credential_status === "active";
  // A configuration check only. It never reports "verified": no outbound connection is attempted in Phase 2.
  const detail = ok ? "Configuration complete. No outbound connection was attempted, so the external service is not verified." : "No active credential is attached.";
  await withAudit(
    { ...auditBase(req, orgId), action: "integration.config_checked", entityType: "integration", entityId: id, meta: { complete: Boolean(ok) } },
    async (client) => {
      await client.query(
        `UPDATE ccdi_integrations SET status = $3, health_checked_at = now(), health_detail = $4 WHERE id = $1 AND organization_id = $2 AND status <> 'disabled'`,
        [id, orgId, ok ? "configured" : "registered", detail],
      );
    },
  );
  res.json({ ok: Boolean(ok), verified: false, detail });
}));

// ── AI provider configuration (no agents) ───────────────────────────────
const AI_COLUMNS = `id, provider, name, base_url, default_model, models, credential_id, is_default, status,
  monthly_token_limit, monthly_cost_limit_usd, tokens_used_month, cost_used_month_usd, health_checked_at, health_detail, created_at, updated_at`;

function customBaseUrl(v: unknown): string | null {
  const s = str(v, "baseUrl", { optional: true, max: 300 });
  if (!s) return null;
  let u: URL;
  try { u = new URL(s); } catch { throw new HttpError(400, "baseUrl must be a valid URL"); }
  if (u.protocol !== "https:" || !u.hostname.includes(".") || /^(localhost|\d{1,3}(\.\d{1,3}){3})$/i.test(u.hostname) || u.username || u.password) {
    throw new HttpError(400, "baseUrl must be an https URL on a public hostname");
  }
  return u.toString().replace(/\/$/, "");
}

function modelList(v: unknown): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 50 || v.some((m) => typeof m !== "string" || m.length < 1 || m.length > 120)) {
    throw new HttpError(400, "models must be an array of up to 50 model names");
  }
  return [...new Set(v as string[])];
}

function limit(v: unknown, label: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) throw new HttpError(400, `${label} must be a non-negative number`);
  return n;
}

router.get("/organizations/:orgId/ai-providers", requirePermission("ccdi.ai.configure", { tenant: true }), handler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${AI_COLUMNS} FROM ccdi_ai_providers WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY is_default DESC, name`,
    [uuidParam(req.params.orgId, "orgId")],
  );
  res.json({ providers: rows });
}));

router.post("/organizations/:orgId/ai-providers", requirePermission("ccdi.ai.configure", { tenant: true }), handler(async (req, res) => {
  const orgId = uuidParam(req.params.orgId, "orgId");
  const provider = oneOf(req.body?.provider, "provider", AI_PROVIDERS);
  const name = reqStr(req.body?.name, "name", { max: 120 });
  const baseUrl = provider === "custom" ? customBaseUrl(req.body?.baseUrl) : null;
  if (provider === "custom" && !baseUrl) throw new HttpError(400, "baseUrl is required for custom providers");
  const models = modelList(req.body?.models);
  const defaultModel = str(req.body?.defaultModel, "defaultModel", { optional: true, max: 120 }) ?? null;
  const credentialId = await assertCredentialInOrg(req.body?.credentialId, orgId);
  const tokenLimit = limit(req.body?.monthlyTokenLimit, "monthlyTokenLimit");
  const costLimit = limit(req.body?.monthlyCostLimitUsd, "monthlyCostLimitUsd");
  const makeDefault = Boolean(req.body?.isDefault);
  const row = await withAudit(
    (r: { id: string }) => ({ ...auditBase(req, orgId), action: "ai_provider.registered", entityType: "ai_provider", entityId: r.id, meta: { provider, name, isDefault: makeDefault } }),
    async (client) => {
      if (makeDefault) await client.query(`UPDATE ccdi_ai_providers SET is_default = false WHERE organization_id = $1 AND is_default`, [orgId]);
      const { rows } = await client.query(
        `INSERT INTO ccdi_ai_providers (organization_id, provider, name, base_url, default_model, models, credential_id, is_default, status,
            monthly_token_limit, monthly_cost_limit_usd, created_by)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12) RETURNING ${AI_COLUMNS}`,
        [orgId, provider, name, baseUrl, defaultModel, JSON.stringify(models), credentialId, makeDefault, credentialId ? "configured" : "registered", tokenLimit, costLimit, ctxOf(req).actorRef],
      );
      return rows[0];
    },
  );
  res.status(201).json({ provider: row });
}));

router.patch("/organizations/:orgId/ai-providers/:id", requirePermission("ccdi.ai.configure", { tenant: true }), handler(async (req, res) => {
  const orgId = uuidParam(req.params.orgId, "orgId");
  const id = uuidParam(req.params.id);
  const name = str(req.body?.name, "name", { optional: true, max: 120 });
  const defaultModel = str(req.body?.defaultModel, "defaultModel", { optional: true, max: 120 });
  const models = req.body?.models === undefined ? undefined : modelList(req.body.models);
  const credentialId = req.body?.credentialId === undefined ? undefined : await assertCredentialInOrg(req.body.credentialId, orgId);
  const tokenLimit = req.body?.monthlyTokenLimit === undefined ? undefined : limit(req.body.monthlyTokenLimit, "monthlyTokenLimit");
  const costLimit = req.body?.monthlyCostLimitUsd === undefined ? undefined : limit(req.body.monthlyCostLimitUsd, "monthlyCostLimitUsd");
  const makeDefault = req.body?.isDefault === undefined ? undefined : Boolean(req.body.isDefault);
  const disabled = req.body?.disabled === undefined ? undefined : Boolean(req.body.disabled);
  const row = await withAudit(
    { ...auditBase(req, orgId), action: "ai_provider.updated", entityType: "ai_provider", entityId: id, meta: { name, defaultModel, models, tokenLimit, costLimit, makeDefault, disabled } },
    async (client) => {
      if (makeDefault) await client.query(`UPDATE ccdi_ai_providers SET is_default = false WHERE organization_id = $1 AND is_default AND id <> $2`, [orgId, id]);
      const { rows } = await client.query(
        `UPDATE ccdi_ai_providers SET
           name = COALESCE($3, name),
           default_model = COALESCE($4, default_model),
           models = COALESCE($5::jsonb, models),
           credential_id = CASE WHEN $6::boolean THEN $7::uuid ELSE credential_id END,
           monthly_token_limit = CASE WHEN $8::boolean THEN $9::bigint ELSE monthly_token_limit END,
           monthly_cost_limit_usd = CASE WHEN $10::boolean THEN $11::numeric ELSE monthly_cost_limit_usd END,
           is_default = COALESCE($12, is_default),
           status = CASE WHEN $13::boolean IS TRUE THEN 'disabled'
                         WHEN $13::boolean IS FALSE AND status = 'disabled' THEN 'registered' ELSE status END,
           updated_at = now()
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING ${AI_COLUMNS}`,
        [id, orgId, name ?? null, defaultModel ?? null, models === undefined ? null : JSON.stringify(models),
         credentialId !== undefined, credentialId ?? null, tokenLimit !== undefined, tokenLimit ?? null,
         costLimit !== undefined, costLimit ?? null, makeDefault ?? null, disabled ?? null],
      );
      if (!rows.length) throw new HttpError(404, "AI provider not found");
      return rows[0];
    },
  );
  res.json({ provider: row });
}));

router.delete("/organizations/:orgId/ai-providers/:id", requirePermission("ccdi.ai.configure", { tenant: true }), handler(async (req, res) => {
  const orgId = uuidParam(req.params.orgId, "orgId");
  const id = uuidParam(req.params.id);
  await withAudit(
    { ...auditBase(req, orgId), action: "ai_provider.deleted", entityType: "ai_provider", entityId: id },
    async (client) => {
      const r = await client.query(`UPDATE ccdi_ai_providers SET deleted_at = now(), is_default = false, status = 'disabled' WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [id, orgId]);
      if (!r.rowCount) throw new HttpError(404, "AI provider not found");
    },
  );
  res.json({ ok: true });
}));

const PROVIDER_PROBES: Record<string, (key: string) => { url: string; headers: Record<string, string> }> = {
  openai: (k) => ({ url: "https://api.openai.com/v1/models", headers: { Authorization: `Bearer ${k}` } }),
  anthropic: (k) => ({ url: "https://api.anthropic.com/v1/models", headers: { "x-api-key": k, "anthropic-version": "2023-06-01" } }),
  gemini: (k) => ({ url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", headers: { "x-goog-api-key": k } }),
  openrouter: (k) => ({ url: "https://openrouter.ai/api/v1/models", headers: { Authorization: `Bearer ${k}` } }),
};

router.post("/organizations/:orgId/ai-providers/:id/test", rateLimit("ccdi-ai-test", 20), requirePermission("ccdi.ai.configure", { tenant: true }), handler(async (req, res) => {
  const orgId = uuidParam(req.params.orgId, "orgId");
  const id = uuidParam(req.params.id);
  const { rows } = await pool.query(
    `SELECT p.provider, p.credential_id, c.storage, c.external_ref, c.ciphertext, c.iv, c.auth_tag, c.key_version, c.status AS cred_status
     FROM ccdi_ai_providers p LEFT JOIN ccdi_credentials c ON c.id = p.credential_id AND c.deleted_at IS NULL
     WHERE p.id = $1 AND p.organization_id = $2 AND p.deleted_at IS NULL`,
    [id, orgId],
  );
  if (!rows.length) throw new HttpError(404, "AI provider not found");
  const p = rows[0];

  let status: "verified" | "failing" | "configured" = "failing";
  let detail: string;
  let httpStatus: number | null = null;

  const probe = PROVIDER_PROBES[p.provider];
  if (!probe) {
    status = "configured";
    detail = "Connection tests are not available for custom providers in this phase (an outbound-request safety guard is required first).";
  } else if (!p.credential_id || p.cred_status !== "active") {
    detail = "No active credential is attached.";
  } else {
    let key: string | undefined;
    try {
      key = p.storage === "env" ? process.env[p.external_ref as string] : openSecret({ ciphertext: p.ciphertext, iv: p.iv, tag: p.auth_tag, keyVersion: p.key_version }, p.credential_id);
    } catch {
      key = undefined;
    }
    if (!key) {
      detail = "The credential value is not available on the server (missing environment variable or vault key).";
    } else {
      try {
        const target = probe(key);
        const r = await fetch(target.url, { headers: target.headers, signal: AbortSignal.timeout(8000), redirect: "error" });
        httpStatus = r.status;
        if (r.ok) { status = "verified"; detail = "The provider accepted the credential."; }
        else if (r.status === 401 || r.status === 403) detail = "The provider rejected the credential.";
        else detail = `The provider responded with HTTP ${r.status}.`;
      } catch {
        detail = "Could not reach the provider (network error or timeout).";
      }
    }
  }

  await withAudit(
    { ...auditBase(req, orgId), action: "ai_provider.tested", entityType: "ai_provider", entityId: id, meta: { provider: p.provider, result: status, httpStatus } },
    async (client) => {
      await client.query(
        `UPDATE ccdi_ai_providers SET status = CASE WHEN status = 'disabled' THEN status ELSE $3 END, health_checked_at = now(), health_detail = $4 WHERE id = $1 AND organization_id = $2`,
        [id, orgId, status, detail],
      );
    },
  );
  res.json({ status, verified: status === "verified", detail });
}));

// ── MFA (server-verified; not wired to sign-in while sign-in is disabled) ──
const mfaLimiter = rateLimit("ccdi-mfa", 10);

async function recordAuthEvent(req: Request, userRef: string, type: string, outcome: "success" | "failure" | "denied", meta: Record<string, unknown> = {}) {
  const c = ctxOf(req);
  await pool.query(
    `INSERT INTO ccdi_auth_events (user_ref, event_type, outcome, ip_address, user_agent, correlation_id, meta) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [userRef, type, outcome, c.ip, (c.userAgent ?? "").slice(0, 300) || null, c.correlationId, JSON.stringify(meta)],
  ).catch((err) => logger.warn({ err }, "auth event not recorded"));
}

async function loadTotp(userRef: string) {
  const { rows } = await pool.query(`SELECT * FROM ccdi_mfa_configs WHERE user_ref = $1 AND method = 'totp'`, [userRef]);
  return rows[0] as
    | { id: string; status: string; secret_ciphertext: string; secret_iv: string; secret_tag: string; key_version: number; recovery_code_hashes: string[]; last_used_step: string | null }
    | undefined;
}

function totpSecretOf(cfg: NonNullable<Awaited<ReturnType<typeof loadTotp>>>, userRef: string): string {
  return openSecret({ ciphertext: cfg.secret_ciphertext, iv: cfg.secret_iv, tag: cfg.secret_tag, keyVersion: cfg.key_version }, `mfa:${userRef}:totp`);
}

router.get("/mfa/status", handler(async (req, res) => {
  requireIdentified(req);
  const cfg = await loadTotp(ctxOf(req).actorRef);
  res.json({ totp: cfg ? cfg.status : "not_enrolled", recoveryCodesRemaining: cfg ? (cfg.recovery_code_hashes ?? []).length : 0, webauthn: "not_implemented" });
}));

router.post("/mfa/totp/enroll", mfaLimiter, handler(async (req, res) => {
  requireIdentified(req);
  const c = ctxOf(req);
  if (!vaultStatus().configured) throw new HttpError(503, "The credential vault is not configured, so MFA secrets cannot be stored.", "VAULT_NOT_CONFIGURED");
  const existing = await loadTotp(c.actorRef);
  if (existing?.status === "active") throw new HttpError(409, "TOTP is already enabled. Disable it first to re-enrol.");
  const secret = generateTotpSecret();
  const sealed = sealSecret(secret, `mfa:${c.actorRef}:totp`);
  await pool.query(
    `INSERT INTO ccdi_mfa_configs (user_ref, method, status, secret_ciphertext, secret_iv, secret_tag, key_version, recovery_code_hashes, last_used_step)
     VALUES ($1,'totp','pending',$2,$3,$4,$5,'[]'::jsonb,NULL)
     ON CONFLICT (user_ref, method) DO UPDATE SET status='pending', secret_ciphertext=EXCLUDED.secret_ciphertext, secret_iv=EXCLUDED.secret_iv,
       secret_tag=EXCLUDED.secret_tag, key_version=EXCLUDED.key_version, recovery_code_hashes='[]'::jsonb, last_used_step=NULL, updated_at=now()`,
    [c.actorRef, sealed.ciphertext, sealed.iv, sealed.tag, sealed.keyVersion],
  );
  await appendAudit({ ...auditBase(req, null), action: "mfa.enrol_started", entityType: "mfa", entityId: c.actorRef, outcome: "success" });
  // The secret is shown exactly once, here, so the user can add it to an authenticator app.
  res.json({ secret, otpauthUri: otpauthUri(secret, c.actorEmail ?? c.actorRef), note: "Shown once. Confirm with a code to activate." });
}));

router.post("/mfa/totp/confirm", mfaLimiter, handler(async (req, res) => {
  requireIdentified(req);
  const c = ctxOf(req);
  const code = reqStr(req.body?.code, "code", { max: 8, re: /^\d{6}$/ });
  const cfg = await loadTotp(c.actorRef);
  if (!cfg || cfg.status !== "pending") throw new HttpError(409, "No pending TOTP enrolment");
  const step = verifyTotp(totpSecretOf(cfg, c.actorRef), code, null);
  if (step === null) {
    await recordAuthEvent(req, c.actorRef, "mfa.confirm", "failure");
    throw new HttpError(400, "The code is not valid");
  }
  const recovery = generateRecoveryCodes();
  await withAudit(
    { ...auditBase(req, null), action: "mfa.enabled", entityType: "mfa", entityId: c.actorRef, meta: { method: "totp" } },
    async (client) => {
      await client.query(
        `UPDATE ccdi_mfa_configs SET status='active', verified_at=now(), last_used_step=$2, recovery_code_hashes=$3::jsonb, updated_at=now() WHERE id=$1`,
        [cfg.id, step, JSON.stringify(recovery.map(hashRecoveryCode))],
      );
    },
  );
  await recordAuthEvent(req, c.actorRef, "mfa.confirm", "success");
  res.json({ enabled: true, recoveryCodes: recovery, note: "Store these recovery codes now. They are not shown again." });
}));

router.post("/mfa/totp/verify", mfaLimiter, handler(async (req, res) => {
  requireIdentified(req);
  const c = ctxOf(req);
  const cfg = await loadTotp(c.actorRef);
  if (!cfg || cfg.status !== "active") throw new HttpError(409, "TOTP is not enabled");

  if (typeof req.body?.recoveryCode === "string") {
    const hashes = cfg.recovery_code_hashes ?? [];
    const idx = hashes.findIndex((h) => matchRecoveryCode(req.body.recoveryCode, h));
    if (idx < 0) {
      await recordAuthEvent(req, c.actorRef, "mfa.recovery", "failure");
      throw new HttpError(400, "The recovery code is not valid");
    }
    const remaining = hashes.filter((_, i) => i !== idx);
    const upd = await pool.query(`UPDATE ccdi_mfa_configs SET recovery_code_hashes=$2::jsonb, updated_at=now() WHERE id=$1 AND recovery_code_hashes=$3::jsonb`, [cfg.id, JSON.stringify(remaining), JSON.stringify(hashes)]);
    if (!upd.rowCount) throw new HttpError(409, "Please retry");
    await recordAuthEvent(req, c.actorRef, "mfa.recovery", "success");
    await appendAudit({ ...auditBase(req, null), action: "mfa.recovery_used", entityType: "mfa", entityId: c.actorRef, outcome: "success", meta: { remaining: remaining.length } });
    res.json({ verified: true, method: "recovery_code", recoveryCodesRemaining: remaining.length });
    return;
  }

  const code = reqStr(req.body?.code, "code", { max: 8, re: /^\d{6}$/ });
  const last = cfg.last_used_step === null ? null : Number(cfg.last_used_step);
  const step = verifyTotp(totpSecretOf(cfg, c.actorRef), code, last);
  if (step === null) {
    await recordAuthEvent(req, c.actorRef, "mfa.verify", "failure");
    throw new HttpError(400, "The code is not valid");
  }
  const upd = await pool.query(`UPDATE ccdi_mfa_configs SET last_used_step=$2, updated_at=now() WHERE id=$1 AND (last_used_step IS NULL OR last_used_step < $2)`, [cfg.id, step]);
  if (!upd.rowCount) throw new HttpError(400, "The code was already used");
  await recordAuthEvent(req, c.actorRef, "mfa.verify", "success");
  res.json({ verified: true, method: "totp" });
}));

router.post("/mfa/totp/disable", mfaLimiter, handler(async (req, res) => {
  requireIdentified(req);
  const c = ctxOf(req);
  const code = reqStr(req.body?.code, "code", { max: 8, re: /^\d{6}$/ });
  const cfg = await loadTotp(c.actorRef);
  if (!cfg || cfg.status !== "active") throw new HttpError(409, "TOTP is not enabled");
  const last = cfg.last_used_step === null ? null : Number(cfg.last_used_step);
  if (verifyTotp(totpSecretOf(cfg, c.actorRef), code, last) === null) {
    await recordAuthEvent(req, c.actorRef, "mfa.disable", "failure");
    throw new HttpError(400, "The code is not valid");
  }
  await withAudit(
    { ...auditBase(req, null), action: "mfa.disabled", entityType: "mfa", entityId: c.actorRef, meta: { method: "totp" } },
    async (client) => {
      await client.query(`UPDATE ccdi_mfa_configs SET status='disabled', secret_ciphertext=NULL, secret_iv=NULL, secret_tag=NULL, recovery_code_hashes='[]'::jsonb, updated_at=now() WHERE id=$1`, [cfg.id]);
    },
  );
  await recordAuthEvent(req, c.actorRef, "mfa.disable", "success");
  res.json({ enabled: false });
}));

router.post("/mfa/recovery-codes/regenerate", mfaLimiter, handler(async (req, res) => {
  requireIdentified(req);
  const c = ctxOf(req);
  const code = reqStr(req.body?.code, "code", { max: 8, re: /^\d{6}$/ });
  const cfg = await loadTotp(c.actorRef);
  if (!cfg || cfg.status !== "active") throw new HttpError(409, "TOTP is not enabled");
  const last = cfg.last_used_step === null ? null : Number(cfg.last_used_step);
  const step = verifyTotp(totpSecretOf(cfg, c.actorRef), code, last);
  if (step === null) throw new HttpError(400, "The code is not valid");
  const recovery = generateRecoveryCodes();
  await withAudit(
    { ...auditBase(req, null), action: "mfa.recovery_codes_regenerated", entityType: "mfa", entityId: c.actorRef },
    async (client) => {
      await client.query(`UPDATE ccdi_mfa_configs SET recovery_code_hashes=$2::jsonb, last_used_step=$3, updated_at=now() WHERE id=$1`, [cfg.id, JSON.stringify(recovery.map(hashRecoveryCode)), step]);
    },
  );
  res.json({ recoveryCodes: recovery, note: "Store these recovery codes now. They are not shown again." });
}));

router.get("/account/security", handler(async (req, res) => {
  requireIdentified(req);
  const { rows } = await pool.query(
    `SELECT event_type, outcome, ip_address, created_at FROM ccdi_auth_events WHERE user_ref = $1 ORDER BY id DESC LIMIT 20`,
    [ctxOf(req).actorRef],
  );
  res.json({ events: rows });
}));

// Anything unmatched under /v1 returns a JSON 404 instead of falling through to other CCDI routers.
router.use((req: Request, res: Response) => {
  res.status(404).json({ error: "Not found", correlationId: req.ccdi?.correlationId });
});

export default router;
