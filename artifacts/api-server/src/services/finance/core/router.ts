import { createHash, randomUUID } from "node:crypto";
import { HttpError, forbidden, notFound, unauthorized, conflict, unprocessable } from "./errors";
import { hasPermission } from "./rbac";
import type { Route, Ctx } from "./route";
import type { Db, FinanceRequest, FinanceResponse, OrgContext, Actor } from "./types";
import { qstr } from "./validate";

export interface Deps { now: () => Date; log: { error: (o: unknown, m?: string) => void } }

const hdr = (h: FinanceRequest["headers"], k: string) => { const v = h[k] ?? h[k.toLowerCase()]; return Array.isArray(v) ? v[0] : v; };

async function resolveOrg(db: Db, req: FinanceRequest, actor: Actor): Promise<OrgContext> {
  const raw = hdr(req.headers, "x-finance-org") ?? qstr(req.query.organisation_id);
  const orgId = Number(raw);
  if (!raw || !Number.isInteger(orgId) || orgId <= 0) throw new HttpError(400, "organisation_required", "Select an organisation (X-Finance-Org header)");
  const m = (await db.query<any>(
    `SELECT m.id, m.role, m.status, m.user_sub, o.functional_currency, o.settings, o.archived_at
       FROM finance_members m JOIN finance_organisations o ON o.id = m.org_id
      WHERE m.org_id = $1 AND (m.user_sub = $2 OR lower(m.email) = lower($3)) ORDER BY (m.user_sub = $2) DESC NULLS LAST LIMIT 1`, [orgId, actor.sub, actor.email])).rows[0];
  // same response whether the organisation exists or not: do not reveal other tenants
  if (!m || m.status !== "active" || m.archived_at) throw forbidden("You do not have access to this organisation", "not_a_member");
  if (!m.user_sub) await db.query("UPDATE finance_members SET user_sub = $1, updated_at = now() WHERE id = $2 AND user_sub IS NULL", [actor.sub, m.id]);
  return { ...actor, orgId, role: m.role, memberId: Number(m.id), functionalCurrency: String(m.functional_currency).trim(), settings: m.settings ?? {} };
}

function mapError(e: any, deps: Deps, reqId: string): FinanceResponse {
  if (e instanceof HttpError) return { status: e.status, body: { error: e.message, code: e.code, details: e.details, requestId: reqId } };
  if (e?.code === "23505") return { status: 409, body: { error: "A record with the same unique value already exists", code: "duplicate", requestId: reqId } };
  if (e?.code === "23503") return { status: 422, body: { error: "Referenced record does not exist in this organisation", code: "invalid_reference", requestId: reqId } };
  if (e?.code === "23514") return { status: 422, body: { error: "Value violates a data rule", code: "constraint_violation", requestId: reqId } };
  // errors raised by our own integrity triggers carry a plain-language message
  if (e?.code === "P0001" && typeof e.message === "string") return { status: 422, body: { error: e.message, code: "integrity_violation", requestId: reqId } };
  deps.log.error({ err: e, reqId }, "finance request failed");
  return { status: 500, body: { error: "Internal server error", code: "internal_error", requestId: reqId } };
}

export async function dispatch(routes: Route[], db: Db, deps: Deps, req: FinanceRequest): Promise<FinanceResponse> {
  const reqId = hdr(req.headers, "x-request-id") ?? randomUUID();
  const h = { "X-Request-Id": reqId };
  try {
    if (!req.auth) throw unauthorized();
    if (req.auth.isApiKey) throw forbidden("API keys cannot access Finance", "api_key_forbidden");
    const actor: Actor = { sub: req.auth.sub, email: req.auth.email, platformRole: req.auth.platformRole, label: `${req.auth.displayName ?? req.auth.email} <${req.auth.email}>` };
    const path = req.path.replace(/\/+$/, "") || "/";
    let matched: { r: Route; params: Record<string, string> } | undefined; let pathHit = false;
    for (const r of routes) {
      const m = r.regex.exec(path);
      if (!m) continue;
      pathHit = true;
      if (r.method === req.method.toUpperCase()) { matched = { r, params: { ...(m.groups ?? {}) } }; break; }
    }
    if (!matched) throw pathHit ? new HttpError(405, "method_not_allowed", "Method not allowed") : notFound("Endpoint");
    const { r, params } = matched;
    if (r.platformAdmin && actor.platformRole !== "admin") throw forbidden("Only a platform administrator can do that");
    let org: OrgContext | undefined;
    if (r.needsOrg) {
      org = await resolveOrg(db, req, actor);
      if (r.perm && !hasPermission(org.role, r.perm)) throw forbidden(`Missing permission ${r.perm}`, "missing_permission");
    }
    const mutating = r.method !== "GET";
    const run = async (q: Ctx["q"]) => {
      const ctx: Ctx = { q, actor, org: org as OrgContext, params, query: req.query, body: req.body, now: deps.now(), reqId };
      const key = mutating && org ? hdr(req.headers, "idempotency-key") : undefined;
      if (key) {
        if (key.length > 200) throw unprocessable("Idempotency-Key too long");
        const hash = createHash("sha256").update(JSON.stringify(req.body ?? null)).digest("hex");
        const prev = (await q.query<any>("SELECT request_hash, status_code, response FROM finance_idempotency_keys WHERE org_id=$1 AND actor=$2 AND scope=$3 AND key=$4", [org!.orgId, actor.sub, `${r.method} ${r.path}`, key])).rows[0];
        if (prev) {
          if (prev.request_hash !== hash) throw unprocessable("Idempotency-Key was already used with a different request", "idempotency_key_reuse");
          return { status: Number(prev.status_code), body: prev.response ?? undefined, replay: true } as const;
        }
        const out = await r.handler(ctx);
        if (out.status < 400 && !out.raw) await q.query("INSERT INTO finance_idempotency_keys (org_id, actor, scope, key, request_hash, status_code, response) VALUES ($1,$2,$3,$4,$5,$6,$7)", [org!.orgId, actor.sub, `${r.method} ${r.path}`, key, hash, out.status, out.body === undefined ? null : JSON.stringify(out.body)]);
        return out;
      }
      return r.handler(ctx);
    };
    let out: any;
    try { out = mutating ? await db.tx(run) : await run(db); }
    catch (e: any) { if (e?.code === "23505" && hdr(req.headers, "idempotency-key")) throw conflict("A request with this Idempotency-Key is already in progress", "idempotency_conflict"); throw e; }
    const headers = { ...h, "Cache-Control": "no-store", ...(out.replay ? { "Idempotent-Replay": "true" } : {}) };
    return { status: out.status, body: out.body, raw: out.raw, headers };
  } catch (e) {
    const res = mapError(e, deps, reqId);
    return { ...res, headers: { ...h, "Cache-Control": "no-store" } };
  }
}
