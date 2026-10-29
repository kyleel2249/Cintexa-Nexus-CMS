/**
 * On-device Sentinel Key store: the same service code the API server runs, against PGlite (PostgreSQL compiled to
 * WebAssembly) persisted in IndexedDB. This app has no sign-in, so by default the store belongs to this browser profile
 * (one fixed owner). Set VITE_SENTINEL_API_MODE=remote to use the authenticated REST API instead.
 */
import { handleSentinelRequest } from "@sentinel-engine/router";
import type { Db, Queryable, SkRequest, SkResponse } from "@sentinel-engine/types";
import { SENTINEL_SCHEMA_STATEMENTS } from "@sentinel-schema";

const DB_NAME = "cintexa-sentinel";
const LOCAL_OWNER = "local-device-owner";

type PgRunner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; affectedRows?: number }> };
interface PgLite extends PgRunner { exec: (sql: string) => Promise<unknown>; transaction: <T>(fn: (tx: PgRunner) => Promise<T>) => Promise<T>; waitReady: Promise<unknown> }

const parsers: Record<number, (v: string) => unknown> = {
  1184: (v) => new Date(v).toISOString(),
  1114: (v) => new Date(`${v.replace(" ", "T")}Z`).toISOString(),
  20: (v) => (Number.isSafeInteger(Number(v)) ? Number(v) : v),
};

const wrap = (r: PgRunner): Queryable => ({
  async query<T = any>(sql: string, params: unknown[] = []) {
    const res = await r.query(sql, params);
    const rows = res.rows as T[];
    return { rows, rowCount: rows.length > 0 ? rows.length : res.affectedRows ?? 0 };
  },
});

let ready: Promise<{ db: Db; persistent: boolean }> | null = null;

function start() {
  if (!ready) {
    ready = (async () => {
      const { PGlite } = (await import("@electric-sql/pglite")) as unknown as { PGlite: new (dir?: string, opts?: Record<string, unknown>) => PgLite };
      let pg: PgLite; let persistent = true;
      try { pg = new PGlite(`idb://${DB_NAME}`, { parsers }); await pg.waitReady; }
      catch { persistent = false; pg = new PGlite(undefined, { parsers }); await pg.waitReady; } // IndexedDB blocked: this tab only
      await pg.exec(SENTINEL_SCHEMA_STATEMENTS.map((s) => `${s.trim().replace(/;$/, "")};`).join("\n"));
      const base = wrap(pg);
      return { db: { query: base.query, tx: (fn) => pg.transaction((t) => fn(wrap(t))) } as Db, persistent };
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

export async function localCall(req: Omit<SkRequest, "identity" | "isApiKey">): Promise<SkResponse> {
  const { db } = await start();
  return handleSentinelRequest(db, { ...req, identity: { ownerId: LOCAL_OWNER } });
}
export async function localPersistent(): Promise<boolean> { return (await start()).persistent; }
