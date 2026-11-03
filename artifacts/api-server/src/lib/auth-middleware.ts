import type { Request, Response, NextFunction } from "express";
import net from "node:net";
import { logger } from "./logger";
import { DEFAULT_SECURITY, getSetting, type SecuritySettings } from "./platform-settings";

/**
 * CINTEXA Nexus has NO authentication: no login, no sessions, no tokens, no API keys, no roles to sign in with.
 *
 * Every request is served as the single built-in local operator below. `req.auth` is still populated because many routes
 * record "who did this" (audit trails, owner columns) and the Sales / Sentinel / Website-Intelligence layers key their
 * records on it, so they all see the same fixed identity.
 *
 * What remains here is NOT authentication: an optional IP allow-list (Settings -> Security, empty = off) and a per-client
 * rate limit, both of which protect the service from abuse and misconfiguration.
 */

// Identity values are unchanged from earlier releases on purpose: existing Sales members, audit owners and Sentinel records
// are keyed on them, so changing them would orphan that data.
const OPERATOR_SUB = "open-access";
const OPERATOR_EMAIL = (process.env.OPEN_ACCESS_EMAIL ?? "open-access@cintexa.local").trim();

export interface AuthPayload {
  sub: string | number;
  email: string;
  role: string;
  scopes?: Array<"read" | "write">;
  /** Always true: the identity is the fixed built-in operator, never a verified person. */
  openAccess?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

function operatorIdentity(): AuthPayload {
  return { sub: OPERATOR_SUB, email: OPERATOR_EMAIL, role: "admin", openAccess: true, scopes: ["read", "write"] };
}

/** Attach the built-in operator identity. Never rejects. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) req.auth = operatorIdentity();
  next();
}

/** Kept so existing route registrations keep working; there is nothing to require. */
export const requireAuth = optionalAuth;
/** Kept so existing route registrations keep working; there is nothing to require. */
export const requireAdmin = optionalAuth;

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
 * Global guard, mounted once in routes/index.ts. Attaches the operator identity, then applies the optional IP allow-list
 * (DISABLE_IP_ALLOWLIST=1 bypasses it) and the per-client rate limit.
 */
export async function apiGuard(req: Request, res: Response, next: NextFunction) {
  if (req.method === "OPTIONS") return next();
  req.auth = operatorIdentity();

  try {
    const security = { ...DEFAULT_SECURITY, ...(await getSetting<Partial<SecuritySettings>>("security", {})) };
    const ip = req.ip || req.socket.remoteAddress || "";
    if (process.env.DISABLE_IP_ALLOWLIST !== "1" && security.ipAllowlist && !isIpAllowed(ip, security.ipAllowlist)) {
      res.status(403).json({ error: "Your IP address is not on the allow-list" });
      return;
    }
    if (rateLimited(`ip:${ip}`, Math.max(30, Number(security.apiRateLimitPerMinute) || 240))) {
      res.status(429).json({ error: "Rate limit exceeded. Try again in a minute." });
      return;
    }
  } catch (err) {
    logger.warn({ err }, "security settings unavailable - continuing");
  }
  next();
}
