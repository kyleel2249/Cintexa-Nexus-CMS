import type { Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import net from "node:net";
import jwt from "jsonwebtoken";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { logger } from "./logger";
import {
  DEFAULT_SECURITY,
  getSetting,
  setSetting,
  type SecuritySettings,
  type StoredApiKey,
} from "./platform-settings";

const JWT_SECRET = process.env.JWT_SECRET ?? "cintexa-dev-secret-change-in-production";
const COOKIE_NAME = "cintexa_token";
// Optional: verify Firebase-issued ID tokens if presented. Core Nexus tools do NOT require Firebase.
// Set OPEN_ACCESS=1 for bootstrap admin without any external IdP.
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "cintexa-nexus";
const FIREBASE_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
const FIREBASE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));

/**
 * AUTH_MODE
 *  - "open" (DEFAULT): authentication is switched off. Every request is served as an administrator, whether it carries no
 *                      credential, a valid or an invalid cxk_ API key, a Firebase token or a legacy JWT. API keys are accepted
 *                      unconditionally (scopes and the settings/users restriction are not applied).
 *  - "enforced"       : every non-public route needs a valid credential (original behaviour).
 */
const AUTH_MODE: "open" | "enforced" = (process.env.AUTH_MODE ?? "open").trim().toLowerCase() === "enforced" ? "enforced" : "open";
const OPEN_ACCESS_EMAIL = (process.env.OPEN_ACCESS_EMAIL ?? "open-access@cintexa.local").trim();
if (AUTH_MODE === "open") {
  logger.warn("AUTH_MODE=open - authentication is disabled; every API request is treated as an administrator. Set AUTH_MODE=enforced to re-enable it.");
}

/** Comma separated list of admin e-mails (only used when AUTH_MODE=enforced). When empty, every signed-in user is an admin. */
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export interface AuthPayload {
  sub: string | number;
  email: string;
  role: string;
  firebase?: boolean;
  apiKeyId?: string;
  scopes?: Array<"read" | "write">;
  /** true when AUTH_MODE=open granted this identity without a usable credential */
  openAccess?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

function openAccessIdentity(): AuthPayload {
  return { sub: "open-access", email: OPEN_ACCESS_EMAIL, role: "admin", openAccess: true, scopes: ["read", "write"] };
}

function resolveRole(email: string, adminClaim: boolean): string {
  if (adminClaim) return "admin";
  if (!ADMIN_EMAILS.length) return "admin";
  return ADMIN_EMAILS.includes(email.toLowerCase()) ? "admin" : "editor";
}

async function verifyFirebaseToken(raw: string): Promise<AuthPayload | null> {
  try {
    const { payload } = await jwtVerify(raw, FIREBASE_JWKS, {
      issuer: FIREBASE_ISSUER,
      audience: FIREBASE_PROJECT_ID,
    });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
    const email = typeof payload.email === "string" ? payload.email : "";
    return {
      sub: payload.sub,
      email,
      role: resolveRole(email, payload.admin === true),
      firebase: true,
    };
  } catch {
    return null;
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

async function verifyApiKey(raw: string): Promise<AuthPayload | null> {
  if (!raw.startsWith("cxk_")) return null;
  try {
    const keys = await getSetting<StoredApiKey[]>("api_keys", []);
    const hash = sha256(raw);
    const key = keys.find((k) => k.hash && safeEqual(k.hash, hash));
    if (!key || key.revokedAt) return null;
    if (key.expiresAt && new Date(key.expiresAt).getTime() < Date.now()) return null;
    // Update lastUsedAt at most once a minute to avoid write amplification
    const last = key.lastUsedAt ? new Date(key.lastUsedAt).getTime() : 0;
    if (Date.now() - last > 60_000) {
      key.lastUsedAt = new Date().toISOString();
      void setSetting("api_keys", keys).catch(() => undefined);
    }
    return { sub: `apikey:${key.id}`, email: "", role: "api", apiKeyId: key.id, scopes: key.scopes ?? ["read"] };
  } catch {
    return null;
  }
}

function extractToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7).trim();
  const apiKeyHeader = req.headers["x-api-key"];
  if (typeof apiKeyHeader === "string" && apiKeyHeader.trim()) return apiKeyHeader.trim();
  return (req as any).cookies?.[COOKIE_NAME];
}

/** Resolve whatever credential the request carries (API key, Firebase token or legacy JWT) or null. */
async function resolveCredential(req: Request): Promise<AuthPayload | null> {
  const raw = extractToken(req);
  if (!raw) return null;
  const apiKey = await verifyApiKey(raw);
  if (apiKey) return apiKey;
  const firebaseAuth = await verifyFirebaseToken(raw);
  if (firebaseAuth) return firebaseAuth;
  try {
    const decoded = jwt.verify(raw, JWT_SECRET) as AuthPayload;
    return { ...decoded, role: resolveRole(decoded.email ?? "", decoded.role === "admin") };
  } catch {
    return null;
  }
}

/**
 * Attach auth to req.auth.
 *  - AUTH_MODE=open: always succeeds. A recognised user token keeps its identity (promoted to admin); an API key or anything
 *    else becomes the open-access administrator, so keys are never rejected.
 *  - AUTH_MODE=enforced: only a valid credential sets req.auth.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  if (req.auth) return next();
  let cred: AuthPayload | null = null;
  try {
    cred = await resolveCredential(req);
  } catch (err) {
    logger.warn({ err }, "credential check failed");
  }
  if (AUTH_MODE === "open") {
    req.auth = cred && cred.role !== "api" ? { ...cred, role: "admin", scopes: ["read", "write"] } : openAccessIdentity();
    return next();
  }
  if (cred) req.auth = cred;
  next();
}

/** Reject unauthenticated requests with 401 (never happens in AUTH_MODE=open). */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  void optionalAuth(req, res, () => {
    if (!req.auth) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    next();
  });
}

/** Reject non-admin requests with 403 (never happens in AUTH_MODE=open). API keys are never admins when enforced. */
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

// ---------------------------------------------------------------------------
// Public routes (no credentials needed even when AUTH_MODE=enforced)
// ---------------------------------------------------------------------------

const PUBLIC_ROUTES: Array<{ method: string; pattern: RegExp }> = [
  { method: "GET", pattern: /^\/healthz?$/ },
  { method: "*", pattern: /^\/auth\/(login|register|logout)$/ },
  // CCDI foundation API: sign-in is disabled for now (CCDI_ACCESS_MODE=open). The router builds its own
  // access context and, when CCDI_ACCESS_MODE=enforced, rejects unauthenticated or unauthorised callers itself.
  { method: "*", pattern: /^\/ccdi\/v1(\/|$)/ },
  { method: "GET", pattern: /^\/settings\/public$/ },
  { method: "GET", pattern: /^\/intake\/public\/[^/]+$/ },
  { method: "POST", pattern: /^\/intake\/public\/[^/]+\/submit$/ },
  { method: "GET", pattern: /^\/public\/forms\/\d+$/ },
  { method: "POST", pattern: /^\/public\/forms\/\d+\/submissions$/ },
  { method: "GET", pattern: /^\/subscribers\/unsubscribe$/ },
  { method: "GET", pattern: /^\/seo\/(sitemap\.xml|robots\.txt)$/ },
  { method: "GET", pattern: /^\/v1\/website-audits\/public\/[A-Za-z0-9_-]{24,64}$/ },
  // Sales Management: web-to-lead capture and the customer quotation link (token-protected, rate limited in the Sales layer)
  { method: "GET", pattern: /^\/sales\/public\/lead-forms\/[A-Za-z0-9_-]{16,128}$/ },
  { method: "POST", pattern: /^\/sales\/public\/lead-forms\/[A-Za-z0-9_-]{16,128}\/submit$/ },
  { method: "GET", pattern: /^\/sales\/public\/quotations\/[A-Za-z0-9_-]{16,128}$/ },
  { method: "POST", pattern: /^\/sales\/public\/quotations\/[A-Za-z0-9_-]{16,128}\/(accept|decline)$/ },
];

function isPublic(req: Request): boolean {
  return PUBLIC_ROUTES.some((r) => (r.method === "*" || r.method === req.method) && r.pattern.test(req.path));
}

// ---------------------------------------------------------------------------
// IP allow-list (Settings -> Security) and per-client rate limit
// ---------------------------------------------------------------------------

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function ipMatches(ip: string, rule: string): boolean {
  const clean = ip.replace(/^::ffff:/, "");
  if (rule.includes("/") && net.isIPv4(clean)) {
    const [range, bitsRaw] = rule.split("/");
    const bits = Number(bitsRaw);
    if (!net.isIPv4(range) || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipv4ToInt(clean) & mask) === (ipv4ToInt(range) & mask);
  }
  return clean === rule;
}

export function isIpAllowed(ip: string, allowlist: string): boolean {
  const rules = allowlist.split(/[\s,]+/).map((r) => r.trim()).filter(Boolean);
  if (!rules.length) return true;
  return rules.some((rule) => ipMatches(ip, rule));
}

const buckets = new Map<string, { count: number; reset: number }>();

function rateLimited(key: string, limit: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + 60_000 });
    return false;
  }
  b.count += 1;
  return b.count > limit;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
}, 120_000).unref?.();

/**
 * Global API guard, mounted once in routes/index.ts.
 *  - public routes pass straight through
 *  - AUTH_MODE=open (default): no credential is required or rejected; the IP allow-list (if you set one) and the rate limit
 *    still apply (DISABLE_IP_ALLOWLIST=1 bypasses the allow-list)
 *  - AUTH_MODE=enforced: needs a valid Firebase token / legacy JWT / API key; keys are read-only unless issued with "write"
 */
export async function apiGuard(req: Request, res: Response, next: NextFunction) {
  if (req.method === "OPTIONS" || isPublic(req)) return next();

  await optionalAuth(req, res, () => undefined);
  if (!req.auth) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const security = { ...DEFAULT_SECURITY, ...(await getSetting<Partial<SecuritySettings>>("security", {})) };
    const ip = req.ip || req.socket.remoteAddress || "";
    if (process.env.DISABLE_IP_ALLOWLIST !== "1" && security.ipAllowlist && !isIpAllowed(ip, security.ipAllowlist)) {
      res.status(403).json({ error: "Your IP address is not on the allow-list" });
      return;
    }
    // The open-access identity is shared by everyone, so bucket it per client IP instead of globally.
    const bucketKey = req.auth.openAccess ? `open:${ip}` : `${req.auth.sub}`;
    if (rateLimited(bucketKey, Math.max(30, Number(security.apiRateLimitPerMinute) || 240))) {
      res.status(429).json({ error: "Rate limit exceeded. Try again in a minute." });
      return;
    }
  } catch (err) {
    logger.warn({ err }, "security settings unavailable - continuing");
  }

  if (req.auth.role === "api") {
    const writing = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (writing && !req.auth.scopes?.includes("write")) {
      res.status(403).json({ error: "This API key is read-only" });
      return;
    }
    if (/^\/(settings|users)(\/|$)/.test(req.path)) {
      res.status(403).json({ error: "API keys cannot access settings or users" });
      return;
    }
  }
  next();
}
