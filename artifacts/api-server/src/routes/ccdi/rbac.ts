/**
 * CINTEXA CCDI — Phase 9 RBAC routes
 */
import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { requireAuth } from "../../lib/auth-middleware";
import { logger } from "../../lib/logger";
import * as rbac from "../../services/ccdi-rbac";
import { httpStatus } from "./http-util";

const router = Router();

function actor(req: Request): string {
  return String(req.auth?.sub ?? "unknown");
}

router.post("/rbac/seed", requireAuth, async (_req: Request, res: Response) => {
  try {
    await rbac.seedCcdiRbac();
    res.json({ ok: true, message: "CCDI permissions and system roles seeded" });
  } catch (err) {
    logger.error({ err }, "ccdi.rbac.seed failed");
    res.status(500).json({ error: "Seed failed" });
  }
});

router.get("/rbac/roles", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const params: any[] = [];
    let where = "WHERE is_system = true OR organization_id IS NULL";
    if (orgId) {
      params.push(orgId);
      where = `WHERE organization_id IS NULL OR organization_id = $1`;
    }
    const { rows } = await pool.query(
      `SELECT id, organization_id, name, slug, description, is_system, created_at
       FROM ccdi_roles ${where} ORDER BY is_system DESC, name`,
      params,
    );
    res.json({ roles: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.rbac.roles failed");
    res.status(500).json({ error: "Failed to list roles" });
  }
});

router.get("/rbac/permissions", requireAuth, async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, name, category, description FROM ccdi_permissions ORDER BY category, code`,
    );
    res.json({ permissions: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.rbac.permissions failed");
    res.status(500).json({ error: "Failed to list permissions" });
  }
});

router.post("/rbac/assign", requireAuth, async (req: Request, res: Response) => {
  try {
    const { organizationId, userRef, roleSlug } = req.body ?? {};
    if (!organizationId || !userRef || !roleSlug) {
      res.status(400).json({ error: "organizationId, userRef and roleSlug are required" });
      return;
    }
    const result = await rbac.assignCcdiRole({
      organizationId: String(organizationId),
      userRef: String(userRef),
      roleSlug: String(roleSlug),
      assignedBy: actor(req),
    });
    if ("error" in result) {
      res.status(httpStatus(result.status)).json({ error: result.error });
      return;
    }
    res.status(201).json(result);
  } catch (err) {
    logger.error({ err }, "ccdi.rbac.assign failed");
    res.status(500).json({ error: "Failed to assign role" });
  }
});

router.get("/rbac/assignments", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const params: any[] = [];
    let where = "";
    if (orgId) {
      params.push(orgId);
      where = `WHERE ur.organization_id = $1`;
    }
    const { rows } = await pool.query(
      `SELECT ur.id, ur.organization_id, ur.user_ref, ur.assigned_by, ur.assigned_at, ur.expires_at,
              r.slug AS role_slug, r.name AS role_name
       FROM ccdi_user_roles ur
       JOIN ccdi_roles r ON r.id = ur.role_id
       ${where}
       ORDER BY ur.assigned_at DESC LIMIT 200`,
      params,
    );
    res.json({ assignments: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.rbac.assignments failed");
    res.status(500).json({ error: "Failed to list assignments" });
  }
});

export default router;
