import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "cintexa-dev-secret-change-in-production";
const COOKIE_NAME = "cintexa_token";

export interface AuthPayload {
  sub: number;
  email: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

/** Attach auth payload to req.auth if a valid token is present. Never rejects — just leaves req.auth undefined. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const cookieToken = (req as any).cookies?.[COOKIE_NAME];
  const raw = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : cookieToken;
  if (raw) {
    try {
      req.auth = jwt.verify(raw, JWT_SECRET) as AuthPayload;
    } catch {
      // expired / invalid — just ignore
    }
  }
  next();
}

/** Reject unauthenticated requests with 401. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  optionalAuth(req, res, () => {
    if (!req.auth) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    next();
  });
}

/** Reject non-admin requests with 403. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (req.auth?.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  });
}
