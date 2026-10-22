/**
 * On-device Sales Management runtime.
 *
 * The Sales engine (routes, RBAC, validation, audit, automation, jobs) is the same code that runs on the API server.
 * Here it runs in the browser against PGlite - a real PostgreSQL compiled to WebAssembly - persisted in IndexedDB, so
 * Sales needs no API server, no database server and no sign-in. Data lives in THIS browser profile: use Backup in
 * Sales Settings -> Data to keep a copy.
 */
import { buildRouter } from "@sales-engine/modules";
import { dispatch, type Deps } from "@sales-engine/core/router";
import { handleEvents } from "@sales-engine/modules/automation";
import { runSalesJobs } from "@sales-engine/jobs";
import type { Db, Queryable, SalesRequest, SalesResponse } from "@sales-engine/core/types";
import { SALES_SCHEMA_STATEMENTS } from "@sales-schema";

const DB_NAME = "cintexa-sales";
const IDB_NAME = `/pglite/${DB_NAME}`;

/** Fixed local identity. The engine's first-run bootstrap makes this person the Sales Administrator. */
const LOCAL_IDENTITY = { sub: "local-device-owner", email: "owner@cintexa.local", platformRole: "admin", isApiKey: false, displayName: "Device owner" };

type PgRunner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; affectedRows?: number }> };

interface PgLite extends PgRunner {
  exec: (sql: string) => Promise<unknown>;
  transaction: <T>(fn: (tx: PgRunner) => Promise<T>) => Promise<T>;
  waitReady: Promise<unknown>;
  close: () => Promise<void>;
  dumpDataDir: () => Promise<Blob>;
}

export interface LocalStatus {
  persistent: boolean;
  error?: string;
}

let ready: Promise<{ db: Db; pg: PgLite; deps: Deps; persistent: boolean }> | null = null;
let jobsTimer: ReturnType<typeof setInterval> | undefined;

// NUMERIC stays a string (decimal-safe money); DATE stays "YYYY-MM-DD"; timestamps are ISO strings; BIGINT is a number when safe.
const parsers: Record<number, (v: string) => unknown> = {
  1700: (v) => v,
  1082: (v) => v,
  1184: (v) => new Date(v).toISOString(),
  1114: (v) => new Date(`${v.replace(" ", "T")}Z`).toISOString(),
  20: (v) => (Number.isSafeInteger(Number(v)) ? Number(v) : v),
};

function wrap(r: PgRunner): Queryable {
  return {
    async query<T = any>(sql: string, params: unknown[] = []) {
      const res = await r.query(sql, params);
      const rows = res.rows as T[];
      return { rows, rowCount: rows.length > 0 ? rows.length : res.affectedRows ?? 0 };
    },
  };
}

async function open(): Promise<{ pg: PgLite; persistent: boolean }> {
  const { PGlite } = (await import("@electric-sql/pglite")) as unknown as { PGlite: new (dir?: string, opts?: Record<string, unknown>) => PgLite };
  let persistent = true;
  let pg: PgLite;
  try {
    pg = new PGlite(`idb://${DB_NAME}`, { parsers });
    await pg.waitReady;
  } catch {
    // IndexedDB blocked (private window, storage disabled): keep working in memory for this tab only.
    persistent = false;
    pg = new PGlite(undefined, { parsers });
    await pg.waitReady;
  }
  await pg.exec(SALES_SCHEMA_STATEMENTS.map((s) => `${s.trim().replace(/;$/, "")};`).join("\n"));
  return { pg, persistent };
}

function start() {
  if (!ready) {
    ready = (async () => {
      const g = globalThis as { __SALES_ENV__?: Record<string, string> };
      g.__SALES_ENV__ = { ...g.__SALES_ENV__, SALES_ADMIN_EMAILS: LOCAL_IDENTITY.email, SALES_PUBLIC_BASE_URL: `${location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}` };
      const { pg, persistent } = await open();
      const base = wrap(pg);
      const db: Db = { query: base.query, tx: (fn) => pg.transaction((t) => fn(wrap(t))) };
      const deps: Deps = {
        now: () => new Date(),
        integrations: {},
        log: { info: () => undefined, warn: (o, m) => console.warn("[sales]", m ?? "", o), error: (o, m) => console.error("[sales]", m ?? "", o) },
        onCommitted: (events, ctx) => handleEvents(events, ctx),
      };
      startJobs(db, deps);
      return { db, pg, deps, persistent };
    })();
    ready.catch(() => {
      ready = null; // allow a retry after a failed start
    });
  }
  return ready;
}

function startJobs(db: Db, deps: Deps) {
  if (jobsTimer) return;
  const pass = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    runSalesJobs(db, deps).catch((err) => console.error("[sales] background jobs failed", err));
  };
  setTimeout(pass, 8_000);
  jobsTimer = setInterval(pass, 60_000);
}

/** Raw query handle on the same on-device database (used by Intelligence, which reads Sales tables and keeps its own intel_* tables beside them). */
export async function getLocalQueryable(): Promise<{ query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }> {
  const rt = await start();
  return { query: (sql, params) => rt.pg.query(sql, params) };
}

export async function localStatus(): Promise<LocalStatus> {
  try {
    const r = await start();
    return { persistent: r.persistent };
  } catch (e) {
    return { persistent: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function headerRecord(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  new Headers(h).forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

/** Answers a request for `/sales/...` (the same paths the API serves) from the on-device engine. */
export async function localFetch(pathWithQuery: string, init: RequestInit = {}): Promise<Response> {
  let rt: Awaited<ReturnType<typeof start>>;
  try {
    rt = await start();
  } catch (e) {
    const message = `The on-device Sales database could not start: ${e instanceof Error ? e.message : String(e)}`;
    return new Response(JSON.stringify({ error: message, code: "local_db_unavailable" }), { status: 500, headers: { "content-type": "application/json" } });
  }
  const url = new URL(pathWithQuery, "http://device.local");
  const path = url.pathname.replace(/^\/sales/, "") || "/";
  const query: Record<string, string | string[] | undefined> = {};
  url.searchParams.forEach((v, k) => {
    const prev = query[k];
    query[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  });
  let body: unknown;
  if (typeof init.body === "string" && init.body.length > 0) {
    try {
      body = JSON.parse(init.body);
    } catch {
      return new Response(JSON.stringify({ error: "Request body is not valid JSON", code: "invalid_json" }), { status: 400, headers: { "content-type": "application/json" } });
    }
  }
  const req: SalesRequest = {
    method: (init.method ?? "GET").toUpperCase(),
    path,
    query,
    body,
    headers: headerRecord(init.headers),
    auth: path.startsWith("/public/") ? undefined : LOCAL_IDENTITY,
    ip: "device",
  };
  let out: SalesResponse;
  try {
    out = await dispatch(buildRouterOnce(), rt.db, rt.deps, req);
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Internal error", code: "internal_error" }), { status: 500, headers: { "content-type": "application/json" } });
  }
  const headers = new Headers(out.headers ?? {});
  if (out.raw) {
    headers.set("content-type", out.raw.contentType);
    if (out.raw.filename) headers.set("content-disposition", `attachment; filename="${out.raw.filename.replace(/[^\w.-]/g, "_")}"`);
    return new Response(out.raw.data, { status: out.status, headers });
  }
  if (out.status === 204 || out.body === undefined) return new Response(null, { status: out.status === 204 ? 204 : out.status, headers });
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(out.body), { status: out.status, headers });
}

let router: ReturnType<typeof buildRouter> | null = null;
function buildRouterOnce() {
  if (!router) router = buildRouter();
  return router;
}

/** Download a full copy of the on-device Sales database. */
export async function backupLocalData(): Promise<{ blob: Blob; filename: string }> {
  const { pg } = await start();
  const blob = await pg.dumpDataDir();
  return { blob, filename: `cintexa-sales-backup-${new Date().toISOString().slice(0, 10)}.tar` };
}

function deleteIdb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(IDB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

/** Replace the on-device database with a backup made by backupLocalData(), then reload. */
export async function restoreLocalData(file: File): Promise<void> {
  const { PGlite } = (await import("@electric-sql/pglite")) as unknown as { PGlite: new (dir?: string, opts?: Record<string, unknown>) => PgLite };
  const current = await start();
  if (jobsTimer) clearInterval(jobsTimer);
  jobsTimer = undefined;
  await current.pg.close();
  await deleteIdb();
  const restored = new PGlite(`idb://${DB_NAME}`, { loadDataDir: file, parsers });
  await restored.waitReady;
  await restored.close();
  location.reload();
}

/** Permanently erase every Sales record on this device, then reload. */
export async function eraseLocalData(): Promise<void> {
  const current = await start();
  if (jobsTimer) clearInterval(jobsTimer);
  jobsTimer = undefined;
  await current.pg.close();
  await deleteIdb();
  location.reload();
}
