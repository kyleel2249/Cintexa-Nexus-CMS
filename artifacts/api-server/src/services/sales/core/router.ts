/**
 * Framework-free request dispatcher for /api/sales/*.
 *
 * The Express route (routes/sales.ts) only converts req -> SalesRequest and SalesResponse -> res, so everything of
 * substance - authentication mapping, authorisation, validation, transactions, idempotency, error mapping, audit - is
 * testable without a web server.
 */
import { createHash, randomUUID } from "./portable";
import type { Actor, Db, Queryable, SalesRequest, SalesResponse } from "./types";
import { HttpError, isHttpError, forbidden, notFound, conflict, unprocessable, badRequest, tooManyRequests } from "./errors";
import { require as requirePermission, type Permission } from "./rbac";
import { resolveActor } from "./actor";
import { loadSettings, type SalesSettings } from "./settings";
import type { Integrations } from "../integrations/providers";

export interface Deps {
  now: () => Date;
  integrations: Integrations;
  log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };
  /** fired after a request commits, e.g. automation events; failures never fail the request */
  onCommitted?: (events: DomainEvent[], ctx: { db: Db; deps: Deps; actor: Actor | null }) => Promise<void>;
}

export interface DomainEvent {
  type: string;
  entityType: string;
  entityId: number;
  data?: Record<string, unknown>;
  depth?: number;
}

export interface RouteCtx {
  actor: Actor;
  /** transaction for write routes, pool for reads */
  q: Queryable;
  db: Db;
  deps: Deps;
  now: Date;
  params: Record<string, string>;
  query: Record<string, string | string[] | undefined>;
  body: unknown;
  requestId: string;
  settings: SalesSettings;
  events: DomainEvent[];
  ip?: string;
  userAgent?: string;
}

export type Reply = { __reply: true; status: number; body?: unknown; raw?: SalesResponse["raw"]; headers?: Record<string, string> };
export const created = (body: unknown): Reply => ({ __reply: true, status: 201, body });
export const noContent = (): Reply => ({ __reply: true, status: 204 });
export const csv = (filename: string, data: string): Reply => ({ __reply: true, status: 200, raw: { contentType: "text/csv; charset=utf-8", data, filename } });
export const html = (data: string, filename?: string): Reply => ({ __reply: true, status: 200, raw: { contentType: "text/html; charset=utf-8", data, filename } });

export interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  /** null = any authenticated sales member */
  permission: Permission | null;
  /** run the handler inside a transaction (default: true for non-GET) */
  tx?: boolean;
  /** honour the Idempotency-Key header (replays the stored response) */
  idempotent?: boolean;
  /** no sign-in required (e.g. a web-form lead capture). Handlers must not rely on a real actor; requests are rate limited per IP. */
  public?: boolean;
  handler: (ctx: RouteCtx) => Promise<unknown>;
}

interface Compiled extends Route {
  regex: RegExp;
  keys: string[];
}

function compile(route: Route): Compiled {
  const keys: string[] = [];
  const pattern = route.path
    .split("/")
    .map((seg) => {
      if (seg.startsWith(":")) {
        keys.push(seg.slice(1));
        return "([^/]+)";
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { ...route, regex: new RegExp(`^${pattern}/?$`), keys };
}

export class Router {
  private routes: Compiled[] = [];
  add(...routes: Route[]): this {
    for (const r of routes) this.routes.push(compile(r));
    return this;
  }
  match(method: string, path: string): { route: Compiled; params: Record<string, string> } | { pathExists: true } | null {
    let pathExists = false;
    for (const r of this.routes) {
      const m = r.regex.exec(path);
      if (!m) continue;
      pathExists = true;
      if (r.method !== method) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => {
        try {
          params[k] = decodeURIComponent(m[i + 1]!);
        } catch {
          params[k] = m[i + 1]!;
        }
      });
      return { route: r, params };
    }
    return pathExists ? { pathExists: true } : null;
  }
  all(): Route[] {
    return this.routes;
  }
}

export function errorBody(err: HttpError, requestId: string) {
  return { error: err.message, code: err.code, ...(err.details !== undefined ? { details: err.details } : {}), requestId };
}

function hashBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

function header(h: SalesRequest["headers"], name: string): string | undefined {
  const v = h[name] ?? h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

function toResponse(result: unknown, requestId: string): SalesResponse {
  const headers = { "x-request-id": requestId, "cache-control": "no-store" };
  if (result && typeof result === "object" && (result as Reply).__reply) {
    const r = result as Reply;
    return { status: r.status, body: r.body, raw: r.raw, headers: { ...headers, ...(r.headers ?? {}) } };
  }
  return { status: 200, body: result === undefined ? { ok: true } : result, headers };
}

const MAX_BODY_BYTES = 2_000_000;

/** Stand-in identity for unauthenticated public routes: no permissions, no ownership, clearly labelled in audit logs. */
export const PUBLIC_ACTOR: Actor = { memberId: 0, userSub: "public", email: "", name: "Public web form", role: "readonly_exec", teamId: null, teamMemberIds: [], label: "Public web form", isApiKey: false };

const publicBuckets = new Map<string, { n: number; reset: number }>();
export function publicRateLimited(key: string, limit = 20, windowMs = 60_000, nowMs = Date.now()): boolean {
  const b = publicBuckets.get(key);
  if (!b || b.reset <= nowMs) {
    if (publicBuckets.size > 5000) for (const [k, x] of publicBuckets) if (x.reset <= nowMs) publicBuckets.delete(k);
    publicBuckets.set(key, { n: 1, reset: nowMs + windowMs });
    return false;
  }
  b.n += 1;
  return b.n > limit;
}

export async function dispatch(router: Router, db: Db, deps: Deps, req: SalesRequest): Promise<SalesResponse> {
  const requestId = header(req.headers, "x-request-id")?.slice(0, 64) || randomUUID();
  let actor: Actor | null = null;
  try {
    const method = req.method.toUpperCase();
    const path = "/" + req.path.replace(/^\/+|\/+$/g, "");
    const matched = router.match(method, path === "/" ? "/" : path);
    if (!matched) throw notFound("Endpoint");
    if ("pathExists" in matched) throw new HttpError(405, "method_not_allowed", `${method} is not supported on this endpoint`);
    const { route, params } = matched;

    // Reject absurd bodies early (the Express layer also limits size).
    if (req.body !== undefined && req.body !== null && JSON.stringify(req.body).length > MAX_BODY_BYTES) throw new HttpError(413, "payload_too_large", "Request body is too large");

    if (route.public) {
      if (publicRateLimited(`${req.ip ?? "unknown"}:${route.path}`)) throw tooManyRequests("Too many requests. Please try again in a minute.");
      actor = PUBLIC_ACTOR;
    } else {
      actor = await resolveActor(db, req.auth);
      if (route.permission) requirePermission(actor, route.permission);
    }

    const now = deps.now();
    const settings = await loadSettings(db, now.getTime());
    const events: DomainEvent[] = [];
    const useTx = route.tx ?? method !== "GET";
    const base = { actor, db, deps, now, params, query: req.query, body: req.body, requestId, settings, events, ip: req.ip, userAgent: header(req.headers, "user-agent")?.slice(0, 300) };

    let result: unknown;
    const idemKey = route.idempotent ? header(req.headers, "idempotency-key") : undefined;
    if (idemKey !== undefined && (idemKey.length < 8 || idemKey.length > 128 || !/^[A-Za-z0-9_\-.:]+$/.test(idemKey))) throw badRequest("Idempotency-Key must be 8-128 characters (letters, digits, _ - . :)");

    if (idemKey) {
      const scope = `${method} ${route.path}`;
      const reqHash = hashBody(req.body);
      const ins = await db.query(
        // A key stuck "in progress" for >5 minutes (crash between commit and response) may be taken over by a retry.
        `INSERT INTO sales_idempotency_keys (actor, scope, key, request_hash) VALUES ($1,$2,$3,$4)
         ON CONFLICT (actor, scope, key) DO UPDATE SET request_hash = EXCLUDED.request_hash, created_at = now()
         WHERE sales_idempotency_keys.status_code IS NULL AND sales_idempotency_keys.created_at < now() - interval '5 minutes'`,
        [actor.userSub, scope, idemKey, reqHash],
      );
      if (ins.rowCount === 0) {
        const prev = (await db.query<{ request_hash: string; status_code: number | null; response: unknown }>(
          "SELECT request_hash, status_code, response FROM sales_idempotency_keys WHERE actor = $1 AND scope = $2 AND key = $3",
          [actor.userSub, scope, idemKey],
        )).rows[0];
        if (!prev) throw conflict("Idempotency key conflict, retry", "idempotency_conflict");
        if (prev.request_hash !== reqHash) throw unprocessable("This Idempotency-Key was already used with a different request", "idempotency_key_reused");
        if (prev.status_code === null) throw conflict("A request with this Idempotency-Key is still in progress", "idempotency_in_progress");
        return { status: prev.status_code, body: prev.response ?? undefined, headers: { "x-request-id": requestId, "idempotent-replay": "true", "cache-control": "no-store" } };
      }
      try {
        result = await run(route, base, useTx);
      } catch (err) {
        // A failed attempt must be retryable with the same key.
        await db.query("DELETE FROM sales_idempotency_keys WHERE actor = $1 AND scope = $2 AND key = $3 AND status_code IS NULL", [actor.userSub, scope, idemKey]).catch(() => undefined);
        throw err;
      }
      const res = toResponse(result, requestId);
      await db.query("UPDATE sales_idempotency_keys SET status_code = $4, response = $5::text::jsonb WHERE actor = $1 AND scope = $2 AND key = $3", [actor.userSub, scope, idemKey, res.status, JSON.stringify(res.body ?? null)]);
      await fire(deps, db, events, actor);
      return res;
    }

    result = await run(route, base, useTx);
    await fire(deps, db, events, actor);
    return toResponse(result, requestId);
  } catch (err) {
    if (isHttpError(err)) return { status: err.status, body: errorBody(err, requestId), headers: { "x-request-id": requestId, "cache-control": "no-store" } };
    const pg = err as { code?: string; constraint?: string; message?: string };
    // Map database integrity failures to meaningful client errors; never leak SQL text.
    if (pg && typeof pg.code === "string") {
      if (pg.code === "23505") return { status: 409, body: errorBody(new HttpError(409, "duplicate", "A record with the same unique value already exists", { constraint: pg.constraint }), requestId), headers: { "x-request-id": requestId } };
      if (pg.code === "23503") return { status: 409, body: errorBody(new HttpError(409, "reference_conflict", "The record is referenced by, or refers to, another record that does not allow this change", { constraint: pg.constraint }), requestId), headers: { "x-request-id": requestId } };
      if (pg.code === "23514") return { status: 422, body: errorBody(new HttpError(422, "constraint_violation", "The values violate a business rule", { constraint: pg.constraint }), requestId), headers: { "x-request-id": requestId } };
      if (pg.code === "23502") return { status: 422, body: errorBody(new HttpError(422, "missing_value", "A required value is missing", { constraint: pg.constraint }), requestId), headers: { "x-request-id": requestId } };
      if (pg.code === "22P02" || pg.code === "22007" || pg.code === "22008") return { status: 400, body: errorBody(new HttpError(400, "bad_value", "A value has an invalid format"), requestId), headers: { "x-request-id": requestId } };
      if (pg.code === "40001" || pg.code === "40P01") return { status: 409, body: errorBody(new HttpError(409, "concurrent_update", "The record was changed by someone else. Reload and retry."), requestId), headers: { "x-request-id": requestId } };
    }
    deps.log.error({ err, requestId, path: req.path, actor: actor?.email }, "Sales request failed");
    return { status: 500, body: { error: "Internal server error", code: "internal_error", requestId }, headers: { "x-request-id": requestId } };
  }
}

async function run(route: Compiled, base: Omit<RouteCtx, "q">, useTx: boolean): Promise<unknown> {
  if (!useTx) return route.handler({ ...base, q: base.db });
  return base.db.tx((q) => route.handler({ ...base, q }));
}

async function fire(deps: Deps, db: Db, events: DomainEvent[], actor: Actor | null): Promise<void> {
  if (!events.length || !deps.onCommitted) return;
  try {
    await deps.onCommitted(events, { db, deps, actor });
  } catch (err) {
    deps.log.error({ err }, "Post-commit sales hooks failed");
  }
}

/** Used by modules: throw 403 unless the predicate holds. */
export function guard(ok: boolean, message?: string): void {
  if (!ok) throw forbidden(message);
}
