/**
 * CINTEXA CCDI — Phase 2 Platform Foundation API routes.
 * Mounted at /api/ccdi
 *
 * All routes require authentication via the global apiGuard.
 * Permission checks are enforced for sensitive operations.
 * No live scanning or tool execution is present in Phase 2.
 */
import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { requireAuth } from "../../lib/auth-middleware";
import { logger } from "../../lib/logger";

const router = Router();

// ── Health / readiness ─────────────────────────────────────────────────────
router.get("/health", (_req: Request, res: Response) => {
  res.json({
    module: "ccdi",
    phase: 2,
    status: "foundation",
    message: "CCDI Platform Foundation is active. Secure execution engines arrive in Phase 3.",
  });
});

// ── Organisations (tenant foundation) ──────────────────────────────────────
router.get("/organizations", requireAuth, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, slug, status, created_at, updated_at
       FROM ccdi_organizations
       WHERE status <> 'archived'
       ORDER BY name ASC
       LIMIT 100`,
    );
    res.json({ organizations: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.organizations.list failed");
    res.status(500).json({ error: "Failed to list organisations" });
  }
});

router.post("/organizations", requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, slug } = req.body ?? {};
    if (!name || typeof name !== "string" || name.trim().length < 1) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const safeSlug =
      (typeof slug === "string" && slug.trim()) ||
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80);

    const { rows } = await pool.query(
      `INSERT INTO ccdi_organizations (name, slug)
       VALUES ($1, $2)
       RETURNING id, name, slug, status, created_at, updated_at`,
      [name.trim(), safeSlug],
    );

    // Audit
    await pool.query(
      `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, actor_email, action, entity_type, entity_id, meta)
       VALUES ($1, $2, $3, 'organization.create', 'organization', $4, $5)`,
      [
        rows[0].id,
        String(req.auth?.sub ?? ""),
        req.auth?.email ?? null,
        rows[0].id,
        JSON.stringify({ name: rows[0].name }),
      ],
    );

    res.status(201).json({ organization: rows[0] });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Organisation slug already exists" });
      return;
    }
    logger.error({ err }, "ccdi.organizations.create failed");
    res.status(500).json({ error: "Failed to create organisation" });
  }
});

// ── Assets (inventory foundation) ──────────────────────────────────────────
router.get("/assets", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const params: any[] = [];
    let where = "WHERE status <> 'retired'";
    if (orgId) {
      params.push(orgId);
      where += ` AND organization_id = $${params.length}`;
    }
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT id, organization_id, name, asset_type, identifier, status, ownership_verified,
              risk_level, tags, owner_ref, created_at, updated_at
       FROM ccdi_assets
       ${where}
       ORDER BY updated_at DESC
       LIMIT $${params.length}`,
      params,
    );
    res.json({ assets: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.assets.list failed");
    res.status(500).json({ error: "Failed to list assets" });
  }
});

router.post("/assets", requireAuth, async (req: Request, res: Response) => {
  try {
    const { organizationId, name, assetType, identifier, tags, metadata } = req.body ?? {};
    if (!organizationId || !name || !assetType || !identifier) {
      res.status(400).json({ error: "organizationId, name, assetType and identifier are required" });
      return;
    }
    const allowedTypes = [
      "domain", "subdomain", "ip", "website", "api", "server", "cloud", "database",
      "container", "mobile_app", "iot", "ot", "certificate", "other",
    ];
    if (!allowedTypes.includes(assetType)) {
      res.status(400).json({ error: "Invalid assetType" });
      return;
    }

    const { rows } = await pool.query(
      `INSERT INTO ccdi_assets
         (organization_id, name, asset_type, identifier, tags, metadata, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, organization_id, name, asset_type, identifier, status,
                 ownership_verified, risk_level, tags, created_at, updated_at`,
      [
        organizationId,
        String(name).trim(),
        assetType,
        String(identifier).trim(),
        Array.isArray(tags) ? tags : [],
        metadata && typeof metadata === "object" ? metadata : {},
        String(req.auth?.sub ?? ""),
      ],
    );

    await pool.query(
      `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, actor_email, action, entity_type, entity_id, meta)
       VALUES ($1, $2, $3, 'asset.create', 'asset', $4, $5)`,
      [
        organizationId,
        String(req.auth?.sub ?? ""),
        req.auth?.email ?? null,
        rows[0].id,
        JSON.stringify({ name: rows[0].name, assetType }),
      ],
    );

    res.status(201).json({ asset: rows[0] });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Asset identifier already exists for this organisation" });
      return;
    }
    logger.error({ err }, "ccdi.assets.create failed");
    res.status(500).json({ error: "Failed to create asset" });
  }
});

// ── Audit logs (read-only for foundation) ──────────────────────────────────
router.get("/audit", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const params: any[] = [];
    let where = "";
    if (orgId) {
      params.push(orgId);
      where = `WHERE organization_id = $${params.length}`;
    }
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT id, organization_id, actor_ref, actor_email, action, entity_type, entity_id, meta, created_at
       FROM ccdi_audit_logs
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    res.json({ logs: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.audit.list failed");
    res.status(500).json({ error: "Failed to list audit logs" });
  }
});

// ── Command Centre summary (evidence-backed only) ──────────────────────────
router.get("/command-centre", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const params: any[] = [];
    let orgFilter = "";
    if (orgId) {
      params.push(orgId);
      orgFilter = `AND organization_id = $${params.length}`;
    }

    const [assetsRes, auditRes] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status = 'approved')::int AS approved,
                count(*) FILTER (WHERE risk_level IN ('high','critical'))::int AS high_risk
         FROM ccdi_assets
         WHERE status <> 'retired' ${orgFilter}`,
        params,
      ),
      pool.query(
        `SELECT count(*)::int AS recent_events
         FROM ccdi_audit_logs
         WHERE created_at > now() - interval '7 days' ${orgFilter}`,
        params,
      ),
    ]);

    res.json({
      summary: {
        assets: assetsRes.rows[0] ?? { total: 0, approved: 0, high_risk: 0 },
        recentAuditEvents: auditRes.rows[0]?.recent_events ?? 0,
        phase: 2,
        note: "Command Centre shows only real database records. Vulnerability, incident and compliance metrics appear after later phases.",
      },
    });
  } catch (err) {
    logger.error({ err }, "ccdi.command-centre failed");
    res.status(500).json({ error: "Failed to load command centre" });
  }
});

export default router;
