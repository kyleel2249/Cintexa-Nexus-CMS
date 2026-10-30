/**
 * Request dispatcher for /sentinel/*. Transport-agnostic: the Express adapter (routes/sentinel.ts) and the on-device
 * runtime both call handleSentinelRequest(). Authentication itself is the platform's apiGuard (server) or the device
 * owner identity (on-device); this layer refuses API keys, scopes every query by owner and rate-limits per owner.
 */
import { SkError, type Db, type SkRequest, type SkResponse } from "./types";
import * as svc from "./service";

interface Bucket { count: number; reset: number }
const buckets = new Map<string, Bucket>();
export function rateLimit(key: string, limit: number, windowMs = 60_000, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || b.reset <= now) { buckets.set(key, { count: 1, reset: now + windowMs }); if (buckets.size > 5000) for (const [k, x] of buckets) if (x.reset <= now) buckets.delete(k); return false; }
  b.count += 1;
  return b.count > limit;
}
export const resetRateLimits = () => buckets.clear();

const LIMITS = { read: 300, write: 120, generate: 90, key: 20, export: 10 };

type Handler = (db: Db, owner: string, req: SkRequest, params: string[]) => Promise<unknown>;
const q1 = (req: SkRequest) => Object.fromEntries(Object.entries(req.query ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;

const ROUTES: { method: string; re: RegExp; cls: keyof typeof LIMITS; status?: number; run: Handler }[] = [
  { method: "GET", re: /^\/summary$/, cls: "read", run: (db, o) => svc.summary(db, o) },
  { method: "GET", re: /^\/key$/, cls: "key", run: (db, o) => svc.getKey(db, o) },
  { method: "PUT", re: /^\/key$/, cls: "key", status: 201, run: (db, o, r) => svc.createKey(db, o, r.body) },
  { method: "POST", re: /^\/key\/rotate$/, cls: "key", run: (db, o, r) => svc.rotateKey(db, o, r.body) },
  { method: "GET", re: /^\/aliases$/, cls: "read", run: (db, o, r) => svc.listAliases(db, o, q1(r)) },
  { method: "POST", re: /^\/aliases$/, cls: "write", status: 201, run: (db, o, r) => svc.createAlias(db, o, r.body) },
  { method: "PATCH", re: /^\/aliases\/([^/]+)$/, cls: "write", run: (db, o, r, p) => svc.updateAlias(db, o, p[0]!, r.body) },
  { method: "DELETE", re: /^\/aliases\/([^/]+)$/, cls: "write", run: (db, o, _r, p) => svc.deleteAlias(db, o, p[0]!) },
  { method: "POST", re: /^\/aliases\/([^/]+)\/archive$/, cls: "write", run: (db, o, _r, p) => svc.setAliasArchived(db, o, p[0]!, true) },
  { method: "POST", re: /^\/aliases\/([^/]+)\/restore$/, cls: "write", run: (db, o, _r, p) => svc.setAliasArchived(db, o, p[0]!, false) },
  { method: "POST", re: /^\/generations$/, cls: "generate", status: 201, run: (db, o, r) => svc.beginGeneration(db, o, r.body) },
  { method: "POST", re: /^\/generations\/([^/]+)\/commit$/, cls: "generate", run: (db, o, r, p) => svc.commitGeneration(db, o, p[0]!, r.body) },
  { method: "POST", re: /^\/generations\/([^/]+)\/fail$/, cls: "generate", run: (db, o, r, p) => svc.failGeneration(db, o, p[0]!, r.body) },
  { method: "GET", re: /^\/history$/, cls: "read", run: (db, o, r) => svc.listHistory(db, o, q1(r)) },
  { method: "GET", re: /^\/history\/([^/]+)$/, cls: "read", run: (db, o, _r, p) => svc.getHistory(db, o, p[0]!) },
  { method: "DELETE", re: /^\/history\/([^/]+)$/, cls: "write", run: (db, o, r, p) => svc.deleteHistory(db, o, p[0]!, q1(r).withVault === "true") },
  { method: "GET", re: /^\/vault$/, cls: "read", run: (db, o, r) => svc.listVault(db, o, q1(r)) },
  { method: "GET", re: /^\/vault-export$/, cls: "export", run: (db, o) => svc.exportVault(db, o) },
  { method: "GET", re: /^\/vault\/([^/]+)$/, cls: "read", run: (db, o, _r, p) => svc.getEntry(db, o, p[0]!) },
  { method: "PATCH", re: /^\/vault\/([^/]+)$/, cls: "write", run: (db, o, r, p) => svc.updateEntry(db, o, p[0]!, r.body) },
  { method: "DELETE", re: /^\/vault\/([^/]+)$/, cls: "write", run: (db, o, r, p) => svc.deleteEntry(db, o, p[0]!, q1(r).withHistory === "true") },
];

export async function handleSentinelRequest(db: Db, req: SkRequest, log?: (msg: string, meta?: unknown) => void): Promise<SkResponse> {
  try {
    if (!req.identity?.ownerId) throw new SkError(401, "unauthenticated", "Authentication required");
    if (req.isApiKey) throw new SkError(403, "forbidden", "API keys cannot access the Sentinel Key vault");
    const path = req.path.replace(/\/+$/, "") || "/";
    const method = req.method.toUpperCase();
    const route = ROUTES.find((r) => r.method === method && r.re.test(path));
    if (!route) {
      if (ROUTES.some((r) => r.re.test(path))) throw new SkError(405, "method_not_allowed", "Method not allowed");
      throw new SkError(404, "not_found", "Not found");
    }
    const owner = req.identity.ownerId;
    if (rateLimit(`${owner}:${route.cls}`, LIMITS[route.cls])) throw new SkError(429, "rate_limited", "Too many requests. Try again in a minute.");
    const m = path.match(route.re)!;
    const body = await route.run(db, owner, req, m.slice(1));
    return { status: route.status ?? 200, body };
  } catch (e) {
    if (e instanceof SkError) return { status: e.status, body: { error: e.message, code: e.code, details: e.details } };
    // Never echo internals (they could contain query text). Log a code only.
    log?.("sentinel request failed", { name: (e as Error)?.name });
    return { status: 500, body: { error: "Internal server error", code: "internal_error" } };
  }
}
