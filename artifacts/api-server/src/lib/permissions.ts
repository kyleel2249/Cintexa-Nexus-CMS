import type { Request, Response, NextFunction } from "express";
import { optionalAuth, type AuthPayload } from "./auth-middleware";

/** Module permissions (logical). Map roles → allowed actions. */
export type ModulePermission =
  | "cd_optimizer.view"
  | "cd_optimizer.upload"
  | "cd_optimizer.compress"
  | "cd_optimizer.download"
  | "cd_optimizer.admin"
  | "finance.view"
  | "finance.analyze"
  | "finance.audit"
  | "finance.export"
  | "finance.admin"
  | "sales.view"
  | "sales.act"
  | "sales.admin";

const ROLE_PERMS: Record<string, ModulePermission[]> = {
  admin: [
    "cd_optimizer.view", "cd_optimizer.upload", "cd_optimizer.compress", "cd_optimizer.download", "cd_optimizer.admin",
    "finance.view", "finance.analyze", "finance.audit", "finance.export", "finance.admin",
    "sales.view", "sales.act", "sales.admin",
  ],
  editor: [
    "cd_optimizer.view", "cd_optimizer.upload", "cd_optimizer.compress", "cd_optimizer.download",
    "finance.view", "finance.analyze", "finance.export",
    "sales.view", "sales.act",
  ],
  viewer: [
    "cd_optimizer.view", "cd_optimizer.download",
    "finance.view",
    "sales.view",
  ],
};

export function permissionsForRole(role: string): ModulePermission[] {
  return ROLE_PERMS[role] || ROLE_PERMS.viewer;
}

export function hasPermission(auth: AuthPayload | undefined, perm: ModulePermission): boolean {
  if (!auth) return false;
  return permissionsForRole(auth.role).includes(perm);
}

declare global {
  namespace Express {
    interface Request {
      organizationId?: string | null;
    }
  }
}

/** Attach org from JWT claim or X-Organization-Id (never trust body alone). */
export function attachTenant(req: Request, _res: Response, next: NextFunction) {
  const headerOrg = req.headers["x-organization-id"];
  const fromHeader = typeof headerOrg === "string" ? headerOrg.trim() : null;
  const fromAuth = (req.auth as AuthPayload & { organizationId?: string })?.organizationId || null;
  req.organizationId = fromAuth || fromHeader || null;
  next();
}

/**
 * Enforce auth when AUTH_ENFORCE=true or NODE_ENV=production.
 * Health/read endpoints can pass { optional: true }.
 */
export function enforceModuleAuth(perm: ModulePermission, opts?: { optional?: boolean }) {
  return (req: Request, res: Response, next: NextFunction) => {
    void optionalAuth(req, res, () => {
      attachTenant(req, res, () => {
        const enforce =
          process.env.AUTH_ENFORCE === "true" ||
          process.env.NODE_ENV === "production";

        if (!enforce && opts?.optional) {
          next();
          return;
        }
        if (!enforce) {
          // Dev: allow but still attach tenant if present
          next();
          return;
        }
        if (!req.auth) {
          res.status(401).json({ error: "Authentication required" });
          return;
        }
        if (!hasPermission(req.auth, perm)) {
          res.status(403).json({ error: `Permission denied: ${perm}` });
          return;
        }
        next();
      });
    });
  };
}

export function tenantMatch(rowOrgId: string | null | undefined, reqOrgId: string | null | undefined): boolean {
  // If neither side has org context, allow (single-tenant / dev)
  if (!rowOrgId && !reqOrgId) return true;
  // Authenticated tenant must match row tenant
  if (reqOrgId && rowOrgId && reqOrgId !== rowOrgId) return false;
  // Row has org but request has none in production → deny when enforcing
  if (process.env.AUTH_ENFORCE === "true" && rowOrgId && !reqOrgId) return false;
  return true;
}
