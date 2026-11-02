/**
 * CCDI foundation — access context, tenant validation and permission checks.
 *
 * ACCESS MODES (env CCDI_ACCESS_MODE):
 *   open      (default) — sign-in is disabled platform-wide. Requests are served without
 *                         credentials and attributed to the actor "open-access". Permission
 *                         and membership checks are NOT enforced. Every response carries
 *                         `X-CCDI-Access-Mode: open`, and mutations are still audited.
 *   enforced            — requires an authenticated identity, active organisation membership
 *                         and the specific permission, all checked on the server.
 *
 * Switching to `enforced` needs no code change. Restricted capabilities
 * (CCDI_RESTRICTED_PERMISSIONS) are never implied by wildcard admin roles.
 */
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { pool, CCDI_RESTRICTED_PERMISSIONS } from "@workspace/db";
import { optionalAuth } from "../../lib/auth-middleware";
import { appendAudit } from "./audit";
import { HttpError, isUuid } from "./http";

export type AccessMode = "open" | "enforced";

export interface CcdiContext {
  mode: AccessMode;
  actorRef: string;
  actorEmail: string | null;
  authenticated: boolean;
  orgId: string | null;
  correlationId: string;
  ip: string | null;
  userAgent: string | null;
}

declare global {
  namespace Express {
    interface Request {
      ccdi?: CcdiContext;
    }
  }
}

export const OPEN_ACTOR = "open-access";
const RESTRICTED: string[] = [...CCDI_RESTRICTED_PERMISSIONS];
const CORRELATION_RE = /^[A-Za-z0-9._-]{8,64}$/;

export function accessMode(): AccessMode {
  return String(process.env.CCDI_ACCESS_MODE || "").toLowerCase() === "enforced" ? "enforced" : "open";
}

export function isRestricted(code: string): boolean {
  return RESTRICTED.includes(code);
}

/** Builds req.ccdi. Never rejects on its own; permission middleware decides. */
export const ccdiContext: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mode = accessMode();
    await optionalAuth(req, res, () => undefined);

    const header = req.headers["x-correlation-id"];
    const correlationId = typeof header === "string" && CORRELATION_RE.test(header) ? header : randomUUID();

    const orgHeader = req.headers["x-ccdi-organization"];
    const orgRaw = typeof orgHeader === "string" ? orgHeader : typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    if (orgRaw !== null && !isUuid(orgRaw)) throw new HttpError(400, "Organisation id must be a valid UUID");

    const authed = Boolean(req.auth);
    const email = req.auth?.email ? String(req.auth.email).toLowerCase() : null;
    req.ccdi = {
      mode,
      actorRef: authed ? String(req.auth!.sub) : OPEN_ACTOR,
      actorEmail: email,
      authenticated: authed,
      orgId: orgRaw ? orgRaw.toLowerCase() : null,
      correlationId,
      ip: req.ip || req.socket.remoteAddress || null,
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
    };

    res.setHeader("X-CCDI-Access-Mode", mode);
    res.setHeader("X-Correlation-Id", correlationId);
    res.setHeader("Cache-Control", "no-store");
    next();
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: "Internal error" });
  }
};

/** Permission codes the caller holds in an organisation (wildcard roles expand to non-restricted codes only). */
export async function permissionSet(userRef: string, orgId: string | null): Promise<Set<string>> {
  const { rows } = await pool.query(
    `SELECT DISTINCT p.code
     FROM ccdi_user_roles ur
     JOIN ccdi_org_members m ON m.organization_id = ur.organization_id AND m.user_ref = ur.user_ref AND m.status = 'active'
     JOIN ccdi_role_permissions rp ON rp.role_id = ur.role_id
     JOIN ccdi_permissions p ON p.id = rp.permission_id
     WHERE ur.user_ref = $1
       AND (ur.expires_at IS NULL OR ur.expires_at > now())
       AND ($2::uuid IS NULL OR ur.organization_id = $2::uuid)`,
    [userRef, orgId],
  );
  const held = new Set<string>(rows.map((r: { code: string }) => r.code));
  // Wildcards never cover restricted codes. An org admin does NOT inherit platform administration.
  const platformAdmin = held.has("ccdi.platform.admin");
  if (platformAdmin || held.has("ccdi.org.admin")) {
    const excluded = platformAdmin ? RESTRICTED : [...RESTRICTED, "ccdi.platform.admin"];
    const all = await pool.query(`SELECT code FROM ccdi_permissions WHERE NOT (code = ANY($1::text[]))`, [excluded]);
    for (const r of all.rows) held.add(r.code);
  }
  return held;
}

export async function hasPermission(userRef: string, orgId: string | null, code: string): Promise<boolean> {
  return (await permissionSet(userRef, orgId)).has(code);
}

async function organisationExists(orgId: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM ccdi_organizations WHERE id = $1 AND status <> 'archived'`, [orgId]);
  return rows.length > 0;
}

export interface GuardOptions {
  /** Route is scoped to one organisation (tenant-owned data). */
  tenant?: boolean;
  /** Route is platform-wide (requires the platform admin wildcard or the exact code with no org). */
  platform?: boolean;
}

/**
 * Enforces authentication, tenant membership and the permission code on the server.
 * In open mode it only validates that the referenced organisation exists.
 */
export function requirePermission(code: string, opts: GuardOptions = {}): RequestHandler {
  return async (req, res, next) => {
    try {
      const ctx = req.ccdi;
      if (!ctx) throw new HttpError(500, "Access context missing");

      // Organisation scope may come from the path (:orgId) which then must match the header/query.
      const pathOrg = typeof req.params.orgId === "string" ? req.params.orgId : null;
      if (pathOrg !== null) {
        if (!isUuid(pathOrg)) throw new HttpError(400, "Organisation id must be a valid UUID");
        if (ctx.orgId && ctx.orgId !== pathOrg.toLowerCase()) throw new HttpError(400, "Organisation context does not match the request path");
        ctx.orgId = pathOrg.toLowerCase();
      }
      if (opts.tenant && !ctx.orgId) throw new HttpError(400, "An organisation context is required (x-ccdi-organization header or organizationId)");

      if (ctx.orgId && !(await organisationExists(ctx.orgId))) throw new HttpError(404, "Organisation not found");

      if (ctx.mode === "open") {
        next();
        return;
      }

      if (!ctx.authenticated) {
        await appendAudit({ actorRef: ctx.actorRef, action: "access.denied", entityType: "permission", entityId: code, outcome: "denied", correlationId: ctx.correlationId, ip: ctx.ip, userAgent: ctx.userAgent, meta: { reason: "unauthenticated", path: req.path } }).catch(() => undefined);
        res.status(401).json({ error: "Authentication required", correlationId: ctx.correlationId });
        return;
      }

      const ok = opts.platform
        ? (await permissionSet(ctx.actorRef, null)).has("ccdi.platform.admin")
        : await hasPermission(ctx.actorRef, ctx.orgId, code);
      if (!ok) {
        await appendAudit({ organizationId: ctx.orgId, actorRef: ctx.actorRef, actorEmail: ctx.actorEmail, action: "access.denied", entityType: "permission", entityId: code, outcome: "denied", correlationId: ctx.correlationId, ip: ctx.ip, userAgent: ctx.userAgent, meta: { reason: "missing_permission", path: req.path } }).catch(() => undefined);
        res.status(403).json({ error: `Missing permission: ${code}`, correlationId: ctx.correlationId });
        return;
      }
      next();
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message, correlationId: req.ccdi?.correlationId });
        return;
      }
      res.status(500).json({ error: "Permission check failed", correlationId: req.ccdi?.correlationId });
    }
  };
}

/**
 * Anti-escalation: in enforced mode a caller may only grant permissions they hold themselves.
 * In open mode there is no identity, so restricted permissions can never be granted.
 */
export async function assertCanGrant(ctx: CcdiContext, orgId: string, codes: string[]): Promise<void> {
  if (ctx.mode === "open") {
    const restricted = codes.filter(isRestricted);
    if (restricted.length) throw new HttpError(403, `Restricted permissions cannot be granted in open-access mode: ${restricted.join(", ")}`);
    return;
  }
  const held = await permissionSet(ctx.actorRef, orgId);
  const missing = codes.filter((c) => !held.has(c));
  if (missing.length) throw new HttpError(403, `You cannot grant permissions you do not hold: ${missing.join(", ")}`);
}
