/**
 * CCDI foundation — idempotent seeding of permissions, system roles and membership backfill.
 */
import { pool } from "@workspace/db";
import {
  CCDI_FOUNDATION_PERMISSION_SEED,
  CCDI_FOUNDATION_ROLE_EXTENSIONS,
  CCDI_FOUNDATION_SYSTEM_ROLES,
} from "@workspace/db";
import { logger } from "../../lib/logger";

let done = false;

export async function seedFoundation(): Promise<void> {
  if (done) return;
  for (const p of CCDI_FOUNDATION_PERMISSION_SEED) {
    await pool.query(
      `INSERT INTO ccdi_permissions (code, name, category, description) VALUES ($1,$2,$3,$4)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, description = EXCLUDED.description`,
      [p.code, p.name, p.category, p.description],
    );
  }
  for (const role of CCDI_FOUNDATION_SYSTEM_ROLES) {
    const { rows } = await pool.query(
      `INSERT INTO ccdi_roles (organization_id, name, slug, description, is_system)
       VALUES (NULL, $1, $2, $3, true)
       ON CONFLICT (slug) WHERE organization_id IS NULL
       DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
       RETURNING id`,
      [role.name, role.slug, role.description],
    );
    await grant(rows[0]?.id, role.permissions);
  }
  for (const [slug, codes] of Object.entries(CCDI_FOUNDATION_ROLE_EXTENSIONS)) {
    const { rows } = await pool.query(`SELECT id FROM ccdi_roles WHERE organization_id IS NULL AND slug = $1`, [slug]);
    await grant(rows[0]?.id, codes);
  }
  // Roles assigned before memberships existed would otherwise be denied once enforcement is on.
  await pool.query(
    `INSERT INTO ccdi_org_members (organization_id, user_ref, status)
     SELECT DISTINCT organization_id, user_ref, 'active' FROM ccdi_user_roles
     ON CONFLICT (organization_id, user_ref) DO NOTHING`,
  );
  done = true;
  logger.info("CCDI foundation permissions, roles and memberships seeded");
}

async function grant(roleId: string | undefined, codes: string[]): Promise<void> {
  if (!roleId) return;
  for (const code of codes) {
    await pool.query(
      `INSERT INTO ccdi_role_permissions (role_id, permission_id)
       SELECT $1, id FROM ccdi_permissions WHERE code = $2 ON CONFLICT DO NOTHING`,
      [roleId, code],
    );
  }
}
