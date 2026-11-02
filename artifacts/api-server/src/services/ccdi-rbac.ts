/**
 * CINTEXA CCDI — Phase 9–10 RBAC helpers
 *
 * Seeds system permissions/roles and provides permission checks.
 * Fine-grained enforcement via requireCcdiPermission.
 *
 * CCDI_STRICT_RBAC=1 disables bootstrap allow (users with zero roles are denied).
 */
import type { RequestHandler } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { CCDI_PERMISSION_SEED, CCDI_SYSTEM_ROLES } from "@workspace/db";

let seeded = false;

function strictRbacEnabled(): boolean {
  const v = String(process.env.CCDI_STRICT_RBAC || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export async function seedCcdiRbac(): Promise<void> {
  if (seeded) return;
  try {
    for (const p of CCDI_PERMISSION_SEED) {
      await pool.query(
        `INSERT INTO ccdi_permissions (code, name, category, description)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, description = EXCLUDED.description`,
        [p.code, p.name, p.category, p.description],
      );
    }

    for (const role of CCDI_SYSTEM_ROLES) {
      const { rows } = await pool.query(
        `INSERT INTO ccdi_roles (organization_id, name, slug, description, is_system)
         VALUES (NULL, $1, $2, $3, true)
         ON CONFLICT (slug) WHERE organization_id IS NULL DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
         RETURNING id`,
        [role.name, role.slug, role.description],
      );
      const roleId = rows[0]?.id;
      if (!roleId) continue;

      for (const code of role.permissions) {
        await pool.query(
          `INSERT INTO ccdi_role_permissions (role_id, permission_id)
           SELECT $1, id FROM ccdi_permissions WHERE code = $2
           ON CONFLICT DO NOTHING`,
          [roleId, code],
        );
      }
    }

    seeded = true;
    logger.info("CCDI RBAC permissions and system roles seeded");
  } catch (err) {
    logger.warn({ err }, "CCDI RBAC seed skipped or partial (tables may not exist yet)");
  }
}

export async function userHasCcdiPermission(
  userRef: string,
  organizationId: string | null | undefined,
  permissionCode: string,
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1
     FROM ccdi_user_roles ur
     JOIN ccdi_role_permissions rp ON rp.role_id = ur.role_id
     JOIN ccdi_permissions p ON p.id = rp.permission_id
     WHERE ur.user_ref = $1
       AND (ur.expires_at IS NULL OR ur.expires_at > now())
       AND (
         p.code = $2
         OR p.code = 'ccdi.platform.admin'
         OR p.code = 'ccdi.org.admin'
       )
       AND ($3::uuid IS NULL OR ur.organization_id = $3 OR p.code = 'ccdi.platform.admin')
     LIMIT 1`,
    [userRef, permissionCode, organizationId ?? null],
  );
  return rows.length > 0;
}

/**
 * Express middleware factory.
 * Default: if the user has no CCDI role assignments, allow (bootstrap).
 * When CCDI_STRICT_RBAC=1, users with zero roles are denied.
 */
export function requireCcdiPermission(permissionCode: string): RequestHandler {
  return async (req, res, next) => {
    try {
      const userRef = String(req.auth?.sub ?? "");
      if (!userRef) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const orgId =
        (typeof req.body?.organizationId === "string" && req.body.organizationId) ||
        (typeof req.query?.organizationId === "string" && req.query.organizationId) ||
        null;

      const { rows: roleCount } = await pool.query(
        `SELECT count(*)::int AS n FROM ccdi_user_roles WHERE user_ref = $1`,
        [userRef],
      );
      const n = roleCount[0]?.n ?? 0;

      if (n === 0) {
        if (strictRbacEnabled()) {
          res.status(403).json({
            error: "CCDI_STRICT_RBAC is enabled and this user has no CCDI roles assigned",
          });
          return;
        }
        next();
        return;
      }

      const ok = await userHasCcdiPermission(userRef, orgId, permissionCode);
      if (!ok) {
        res.status(403).json({ error: `Missing permission: ${permissionCode}` });
        return;
      }
      next();
    } catch (err) {
      logger.error({ err }, "ccdi.rbac.check failed");
      res.status(500).json({ error: "Permission check failed" });
    }
  };
}

export async function assignCcdiRole(opts: {
  organizationId: string;
  userRef: string;
  roleSlug: string;
  assignedBy: string;
}) {
  const { rows: roles } = await pool.query(
    `SELECT id FROM ccdi_roles
     WHERE slug = $1 AND (organization_id = $2 OR organization_id IS NULL)
     ORDER BY organization_id NULLS LAST
     LIMIT 1`,
    [opts.roleSlug, opts.organizationId],
  );
  if (!roles[0]) return { error: "Role not found", status: 404 as const };

  const { rows } = await pool.query(
    `INSERT INTO ccdi_user_roles (organization_id, user_ref, role_id, assigned_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (organization_id, user_ref, role_id) DO NOTHING
     RETURNING *`,
    [opts.organizationId, opts.userRef, roles[0].id, opts.assignedBy],
  );

  await pool.query(
    `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, action, entity_type, entity_id, meta)
     VALUES ($1,$2,'rbac.assign_role','user_role',$3,$4)`,
    [
      opts.organizationId,
      opts.assignedBy,
      rows[0]?.id ?? null,
      JSON.stringify({ userRef: opts.userRef, roleSlug: opts.roleSlug }),
    ],
  );

  return { assignment: rows[0] ?? { alreadyAssigned: true } };
}
