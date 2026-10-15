import { randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { registerWiRoutes, buildBundle as buildSharedBundle, type RouterLike } from "@workspace/wi-engine/routes";
import type { EngineRepo } from "@workspace/wi-engine/repo";
import { normalizeConfig } from "../services/website-intelligence/config";
import { explainFinding } from "../services/website-intelligence/explain";
import { integrationStatuses } from "../services/website-intelligence/integrations";
import { cancelAudit, enqueueAudit, queueDepth } from "../services/website-intelligence/queue";
import { holdCredential } from "../services/website-intelligence/engine";
import { hostAllowed, loadWiSettings, saveWiSettings } from "../services/website-intelligence/settings";
import * as store from "../services/website-intelligence/store";

const router = Router();

const uid = (req: Request): string => String(req.auth?.sub ?? "");
const isAdmin = (req: Request): boolean => req.auth?.role === "admin";
const email = (req: Request): string => req.auth?.email || uid(req);
const bad = (res: Response, error: string, status = 400, field?: string) => res.status(status).json({ error, ...(field ? { field } : {}) });

async function owned(req: Request, res: Response, id: string) {
  const row = await store.getAuditRow(id);
  if (!row || (row.owner_id !== uid(req) && !isAdmin(req))) { bad(res, "Audit not found.", 404); return null; }
  return row;
}

const buildBundle = (auditId: string, publicView = false) => buildSharedBundle(store as unknown as EngineRepo, auditId, publicView);

// ---------------------------------------------------------------------------
// Server-only routes (scheduled monitors, public share links). They are static paths and must be registered
// before the shared `/:id` routes.
// ---------------------------------------------------------------------------

// ---- monitors
router.get("/monitors", async (req, res) => res.json({ monitors: await store.listMonitors(isAdmin(req) ? null : uid(req)) }));
router.post("/monitors", async (req, res) => {
  const settings = await loadWiSettings();
  const r = normalizeConfig(req.body ?? {}, settings.limits, { userEmail: email(req), allowAuthenticated: false });
  if (!r.ok || !r.cfg) return bad(res, r.error ?? "Invalid configuration.", 400, r.field);
  const host = new URL(r.cfg.url).hostname.toLowerCase();
  const allowed = hostAllowed(host, settings);
  if (!allowed.ok) return bad(res, allowed.reason ?? "Host not permitted.", 403, "url");
  const freq = ["daily", "weekly", "monthly"].includes(req.body?.frequency) ? req.body.frequency : "weekly";
  const mon = await store.createMonitor({ ownerId: uid(req), cfg: r.cfg, hostname: host, frequency: freq, workspace: r.cfg.workspace ?? null, notify: { email: Array.isArray(req.body?.notifyEmails) ? req.body.notifyEmails.filter((e: unknown) => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).slice(0, 5) : [], webhook: true, scoreDropThreshold: Number(req.body?.scoreDropThreshold) > 0 ? Number(req.body.scoreDropThreshold) : 5 } });
  res.status(201).json(mon);
});
async function ownedMonitor(req: Request, res: Response) {
  const m = await store.getMonitor(String(req.params.id));
  if (!m || (m.ownerId !== uid(req) && !isAdmin(req))) { bad(res, "Monitor not found.", 404); return null; }
  return m;
}
router.patch("/monitors/:id", async (req, res) => {
  const m = await ownedMonitor(req, res); if (!m) return;
  const b = req.body ?? {};
  res.json(await store.patchMonitor(m.id, { enabled: typeof b.enabled === "boolean" ? b.enabled : undefined, frequency: ["daily", "weekly", "monthly"].includes(b.frequency) ? b.frequency : undefined, name: typeof b.name === "string" ? b.name.slice(0, 120) : undefined, notify: b.notify && typeof b.notify === "object" ? { ...m.notify, ...b.notify } : undefined }));
});
router.delete("/monitors/:id", async (req, res) => { const m = await ownedMonitor(req, res); if (!m) return; await store.deleteMonitor(m.id); res.status(204).end(); });
router.post("/monitors/:id/run", async (req, res) => {
  const m = await ownedMonitor(req, res); if (!m) return;
  const audit = await store.createAudit({ ownerId: m.ownerId, ownerEmail: email(req), hostname: m.hostname, cfg: m.config, monitorId: m.id, workspace: m.workspace });
  enqueueAudit(audit.id);
  res.status(202).json(audit);
});

// ---- public share (no authentication; see PUBLIC_ROUTES)
router.get("/public/:token", async (req, res) => {
  const settings = await loadWiSettings();
  if (!settings.allowPublicShare) return bad(res, "Sharing is disabled.", 404);
  const a = await store.getByShareToken(String(req.params.token));
  if (!a) return bad(res, "This shared report is not available.", 404);
  res.setHeader("Cache-Control", "no-store");
  res.json(await buildBundle(a.id, true));
});


// ---- sharing (agency / client workspace)
router.post("/:id/share", async (req, res) => {
  const row = await owned(req, res, String(req.params.id)); if (!row) return;
  const settings = await loadWiSettings();
  if (!settings.allowPublicShare) return bad(res, "Sharing is disabled by the platform administrator.", 403);
  if (!["completed", "partial"].includes(row.status)) return bad(res, "Only finished audits can be shared.", 409);
  const token = randomBytes(24).toString("base64url");
  await store.setShareToken(row.id, token);
  res.status(201).json({ token, path: `/website-intelligence/shared/${token}`, note: "Anyone with this link can read the report (no notes, owners or evidence of workflow). Revoke it at any time." });
});
router.delete("/:id/share", async (req, res) => { const row = await owned(req, res, String(req.params.id)); if (!row) return; await store.setShareToken(row.id, null); res.status(204).end(); });
router.get("/:id/share", async (req, res) => { const row = await owned(req, res, String(req.params.id)); if (!row) return; res.json({ shared: Boolean(row.share_token), token: row.share_token ?? null }); });


// ---------------------------------------------------------------------------
// Shared routes: identical code serves the browser's serverless local mode (see @workspace/wi-engine/routes).
// ---------------------------------------------------------------------------

registerWiRoutes(router as unknown as RouterLike, {
  repo: store as unknown as EngineRepo,
  settings: { load: loadWiSettings, save: saveWiSettings },
  enqueue: enqueueAudit,
  cancel: cancelAudit,
  holdCredential,
  queueDepth,
  integrations: integrationStatuses,
  explain: explainFinding,
  quota: { countActive: store.countActive, countRecent: store.countRecent },
});

export default router;
