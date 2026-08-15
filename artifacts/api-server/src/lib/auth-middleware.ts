import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { createRemoteJWKSet, jwtVerify } from "jose";

const JWT_SECRET = process.env.JWT_SECRET ?? "cintexa-dev-secret-change-in-production";
const COOKIE_NAME = "cintexa_token";
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "cintexa-nexus";
const FIREBASE_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
const FIREBASE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));

export interface AuthPayload {
  sub: string | number;
  email: string;
  role: string;
  firebase?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

async function verifyFirebaseToken(raw: string): Promise<AuthPayload | null> {
  try {
    const { payload } = await jwtVerify(raw, FIREBASE_JWKS, {
      issuer: FIREBASE_ISSUER,
      audience: FIREBASE_PROJECT_ID,
    });

    if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;

    return {
      sub: payload.sub,
      email: typeof payload.email === "string" ? payload.email : "",
      role: payload.admin === true ? "admin" : "editor",
      firebase: true,
    };
  } catch {
    return null;
  }
}

/** Attach Firebase or legacy JWT auth to req.auth when a valid token is present. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const cookieToken = (req as any).cookies?.[COOKIE_NAME];
  const raw = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : cookieToken;

  if (!raw) {
    next();
    return;
  }

  const firebaseAuth = await verifyFirebaseToken(raw);
  if (firebaseAuth) {
    req.auth = firebaseAuth;
    next();
    return;
  }

  try {
    req.auth = jwt.verify(raw, JWT_SECRET) as AuthPayload;
  } catch {
    // expired / invalid — leave req.auth undefined
  }
  next();
}

/** Reject unauthenticated requests with 401. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  void optionalAuth(req, res, () => {
    if (!req.auth) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    next();
  });
}

/** Reject non-admin requests with 403. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  void optionalAuth(req, res, () => {
    if (!req.auth) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (req.auth.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  });
}
