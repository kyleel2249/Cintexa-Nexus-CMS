/**
 * CINTEXA CCDI — Phase 2–5 API routes.
 * Mounted at /api/ccdi
 */
import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { requireAuth } from "../../lib/auth-middleware";
import { logger } from "../../lib/logger";
import * as orch from "../../services/ccdi-orchestration";
import * as engines from "../../services/ccdi-engines";
import findingsRouter from "./findings";
import advancedRouter from "./advanced";

const router = Router();

function actor(req: Request): string {
  return String(req.auth?.sub ?? "unknown");
}

// ── Health / readiness ─────────────────────────────────────────────────────
router.get("/health", async (_req: Request, res: Response) => {
  const kill = await orch.isKillSwitchActive().catch(() => false);
  res.json({
    module: "ccdi",
    phase: 5,
    status: kill ? "emergency_stop" : "advanced_engines_ready",
    killSwitchActive: kill,
    message: kill
      ? "Global emergency stop is ACTIVE. All new execution is blocked."
      : "CCDI Advanced Security Engines (Phase 5) are active. Cloud, server, container, mobile, database and IoT assessments require approved scopes and human approval.",
  });
});

// Mount Phase 4 + Phase 5 routers
router.use(findingsRouter);
router.use(advancedRouter);

// ── Organisations ──────────────────────────────────────────────────────────
router.get("/organizations", requireAuth, async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, slug, status, created_at, updated_at
       FROM ccdi_organizations WHERE status <> 'archived' ORDER BY name ASC LIMIT 100`,
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
      name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

    const { rows } = await pool.query(
      `INSERT INTO ccdi_organizations (name, slug) VALUES ($1, $2)
       RETURNING id, name, slug, status, created_at, updated_at`,
      [name.trim(), safeSlug],
    );
    await pool.query(
      `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, actor_email, action, entity_type, entity_id, meta)
       VALUES ($1,$2,$3,'organization.create','organization',$4,$5)`,
      [rows[0].id, actor(req), req.auth?.email ?? null, rows[0].id, JSON.stringify({ name: rows[0].name })],
    );
    await orch.ensureBuiltinConnectors(rows[0].id).catch(() => undefined);
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

// ── Assets ─────────────────────────────────────────────────────────────────
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
       FROM ccdi_assets ${where} ORDER BY updated_at DESC LIMIT $${params.length}`,
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
    const asset = await engines.discoverOrUpsertAsset({
      organizationId,
      name: String(name).trim(),
      assetType,
      identifier: String(identifier).trim(),
      tags: Array.isArray(tags) ? tags : [],
      metadata: metadata && typeof metadata === "object" ? metadata : {},
      createdBy: actor(req),
    });
    await pool.query(
      `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, actor_email, action, entity_type, entity_id, meta)
       VALUES ($1,$2,$3,'asset.create','asset',$4,$5)`,
      [organizationId, actor(req), req.auth?.email ?? null, asset.id, JSON.stringify({ name: asset.name, assetType })],
    );
    res.status(201).json({ asset });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Asset identifier already exists for this organisation" });
      return;
    }
    logger.error({ err }, "ccdi.assets.create failed");
    res.status(500).json({ error: "Failed to create asset" });
  }
});

// ── Scopes ─────────────────────────────────────────────────────────────────
router.get("/scopes", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const params: any[] = [];
    let where = "";
    if (orgId) {
      params.push(orgId);
      where = `WHERE organization_id = $1`;
    }
    const { rows } = await pool.query(
      `SELECT id, organization_id, name, description, asset_ids, allowed_categories, excluded_targets,
              status, approved_by, approved_at, expires_at, created_by, created_at, updated_at
       FROM ccdi_scopes ${where} ORDER BY updated_at DESC LIMIT 100`,
      params,
    );
    res.json({ scopes: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.scopes.list failed");
    res.status(500).json({ error: "Failed to list scopes" });
  }
});

router.post("/scopes", requireAuth, async (req: Request, res: Response) => {
  try {
    const { organizationId, name, description, assetIds, allowedCategories, excludedTargets } = req.body ?? {};
    if (!organizationId || !name) {
      res.status(400).json({ error: "organizationId and name are required" });
      return;
    }
    const { rows } = await pool.query(
      `INSERT INTO ccdi_scopes
         (organization_id, name, description, asset_ids, allowed_categories, excluded_targets, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        organizationId, String(name).trim(), description ?? null,
        Array.isArray(assetIds) ? assetIds : [],
        Array.isArray(allowedCategories) ? allowedCategories : [],
        Array.isArray(excludedTargets) ? excludedTargets : [],
        actor(req),
      ],
    );
    await pool.query(
      `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, action, entity_type, entity_id, meta)
       VALUES ($1,$2,'scope.create','scope',$3,$4)`,
      [organizationId, actor(req), rows[0].id, JSON.stringify({ name })],
    );
    res.status(201).json({ scope: rows[0] });
  } catch (err) {
    logger.error({ err }, "ccdi.scopes.create failed");
    res.status(500).json({ error: "Failed to create scope" });
  }
});

router.post("/scopes/:id/submit", requireAuth, async (req: Request, res: Response) => {
  const orgId = req.body?.organizationId ?? req.query.organizationId;
  if (!orgId) {
    res.status(400).json({ error: "organizationId is required" });
    return;
  }
  const result = await orch.submitScopeForApproval(req.params.id, String(orgId), actor(req));
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result);
});

router.post("/scopes/:id/decide", requireAuth, async (req: Request, res: Response) => {
  const { organizationId, decision, note, expiresAt } = req.body ?? {};
  if (!organizationId || !["approved", "rejected"].includes(decision)) {
    res.status(400).json({ error: "organizationId and decision (approved|rejected) are required" });
    return;
  }
  const result = await orch.decideScopeApproval(
    req.params.id, String(organizationId), actor(req), decision, note, expiresAt,
  );
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result);
});

// ── Jobs ───────────────────────────────────────────────────────────────────
router.get("/jobs", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const params: any[] = [];
    let where = "";
    if (orgId) {
      params.push(orgId);
      where = `WHERE organization_id = $1`;
    }
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT id, organization_id, scope_id, connector_id, name, job_type, status, priority,
              targets, rate_limit_rps, max_runtime_seconds, requested_by, approved_by,
              approved_at, queued_at, started_at, finished_at, cancel_requested, created_at, updated_at
       FROM ccdi_jobs ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    );
    res.json({ jobs: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.jobs.list failed");
    res.status(500).json({ error: "Failed to list jobs" });
  }
});

router.post("/jobs", requireAuth, async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const result = await orch.createJob({
    organizationId: body.organizationId,
    scopeId: body.scopeId,
    connectorId: body.connectorId,
    name: body.name,
    jobType: body.jobType,
    parameters: body.parameters,
    targets: body.targets,
    rateLimitRps: body.rateLimitRps,
    maxRuntimeSeconds: body.maxRuntimeSeconds,
    requestedBy: actor(req),
  });
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(201).json(result);
});

router.post("/jobs/:id/submit", requireAuth, async (req: Request, res: Response) => {
  const orgId = req.body?.organizationId;
  if (!orgId) {
    res.status(400).json({ error: "organizationId is required" });
    return;
  }
  const result = await orch.submitJobForApproval(req.params.id, String(orgId), actor(req));
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result);
});

router.post("/jobs/:id/decide", requireAuth, async (req: Request, res: Response) => {
  const { organizationId, decision, note } = req.body ?? {};
  if (!organizationId || !["approved", "rejected"].includes(decision)) {
    res.status(400).json({ error: "organizationId and decision (approved|rejected) are required" });
    return;
  }
  const result = await orch.decideJobApproval(req.params.id, String(organizationId), actor(req), decision, note);
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result);
});

router.post("/jobs/:id/cancel", requireAuth, async (req: Request, res: Response) => {
  const orgId = req.body?.organizationId;
  if (!orgId) {
    res.status(400).json({ error: "organizationId is required" });
    return;
  }
  const result = await orch.cancelJob(req.params.id, String(orgId), actor(req));
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result);
});

// ── Connectors / Evidence / Approvals / Kill-switch / Audit ────────────────
router.get("/connectors", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const params: any[] = [];
    let where = "";
    if (orgId) {
      params.push(orgId);
      where = `WHERE organization_id = $1 OR organization_id IS NULL`;
    }
    const { rows } = await pool.query(
      `SELECT id, organization_id, connector_key, name, category, version, status,
              health_checked_at, last_error, created_at, updated_at
       FROM ccdi_connectors ${where} ORDER BY category, name LIMIT 200`,
      params,
    );
    res.json({
      connectors: rows,
      note: "Connectors are registered. Actual tool execution requires later worker phases and verified credentials.",
    });
  } catch (err) {
    logger.error({ err }, "ccdi.connectors.list failed");
    res.status(500).json({ error: "Failed to list connectors" });
  }
});

router.get("/evidence", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const params: any[] = [];
    let where = "";
    if (orgId) {
      params.push(orgId);
      where = `WHERE organization_id = $1`;
    }
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT id, organization_id, execution_id, job_id, evidence_type, filename, content_type,
              size_bytes, sha256, storage_provider, redacted, collected_at, collected_by, created_at
       FROM ccdi_evidence ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    );
    res.json({ evidence: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.evidence.list failed");
    res.status(500).json({ error: "Failed to list evidence" });
  }
});

router.get("/approvals", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const status = typeof req.query.status === "string" ? req.query.status : "pending";
    const params: any[] = [status];
    let where = `WHERE status = $1`;
    if (orgId) {
      params.push(orgId);
      where += ` AND organization_id = $2`;
    }
    const { rows } = await pool.query(
      `SELECT id, organization_id, entity_type, entity_id, status, requested_by, requested_at,
              decided_by, decided_at, decision_note, expires_at, created_at
       FROM ccdi_approvals ${where} ORDER BY requested_at DESC LIMIT 100`,
      params,
    );
    res.json({ approvals: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.approvals.list failed");
    res.status(500).json({ error: "Failed to list approvals" });
  }
});

router.get("/kill-switch", requireAuth, async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM ccdi_kill_switch WHERE id = 1`);
    res.json({ killSwitch: rows[0] ?? { active: false } });
  } catch (err) {
    logger.error({ err }, "ccdi.kill-switch.get failed");
    res.status(500).json({ error: "Failed to read kill switch" });
  }
});

router.post("/kill-switch", requireAuth, async (req: Request, res: Response) => {
  try {
    const { active, reason } = req.body ?? {};
    if (typeof active !== "boolean") {
      res.status(400).json({ error: "active (boolean) is required" });
      return;
    }
    const result = await orch.setKillSwitch(active, actor(req), reason);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "ccdi.kill-switch.set failed");
    res.status(500).json({ error: "Failed to update kill switch" });
  }
});

router.get("/audit", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const params: any[] = [];
    let where = "";
    if (orgId) {
      params.push(orgId);
      where = `WHERE organization_id = $1`;
    }
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT id, organization_id, actor_ref, actor_email, action, entity_type, entity_id, meta, created_at
       FROM ccdi_audit_logs ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    );
    res.json({ logs: rows });
  } catch (err) {
    logger.error({ err }, "ccdi.audit.list failed");
    res.status(500).json({ error: "Failed to list audit logs" });
  }
});

// ── Command Centre (evidence-backed) ───────────────────────────────────────
router.get("/command-centre", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const params: any[] = [];
    let orgFilter = "";
    if (orgId) {
      params.push(orgId);
      orgFilter = `AND organization_id = $1`;
    }

    const [assetsRes, jobsRes, auditRes, killRes, findings] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status = 'approved')::int AS approved,
                count(*) FILTER (WHERE risk_level IN ('high','critical'))::int AS high_risk
         FROM ccdi_assets WHERE status <> 'retired' ${orgFilter}`,
        params,
      ),
      pool.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status = 'running')::int AS running,
                count(*) FILTER (WHERE status = 'queued')::int AS queued,
                count(*) FILTER (WHERE status = 'pending_approval')::int AS pending_approval
         FROM ccdi_jobs WHERE true ${orgFilter}`,
        params,
      ),
      pool.query(
        `SELECT count(*)::int AS recent_events FROM ccdi_audit_logs
         WHERE created_at > now() - interval '7 days' ${orgFilter}`,
        params,
      ),
      pool.query(`SELECT active FROM ccdi_kill_switch WHERE id = 1`),
      engines.findingsSummary(orgId),
    ]);

    res.json({
      summary: {
        assets: assetsRes.rows[0] ?? { total: 0, approved: 0, high_risk: 0 },
        jobs: jobsRes.rows[0] ?? { total: 0, running: 0, queued: 0, pending_approval: 0 },
        findings,
        recentAuditEvents: auditRes.rows[0]?.recent_events ?? 0,
        killSwitchActive: Boolean(killRes.rows[0]?.active),
        phase: 5,
        note: "All metrics are derived from real database records. No fabricated statistics.",
      },
    });
  } catch (err) {
    logger.error({ err }, "ccdi.command-centre failed");
    res.status(500).json({ error: "Failed to load command centre" });
  }
});

export default router;
