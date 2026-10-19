/**
 * Integration harness: runs the real router + SQL against a real PostgreSQL database.
 * Set SALES_TEST_DATABASE_URL. Uses the production `pg` adapter when available, otherwise Bun's client (authoring sandbox).
 */
import { handleEvents } from "../../modules/automation";
import { dispatch, type Deps } from "../../core/router";
import { buildRouter } from "../../modules";
import { NO_INTEGRATIONS } from "../../integrations/providers";
import type { Db, SalesResponse, AuthIdentity } from "../../core/types";
import { SALES_SCHEMA_STATEMENTS } from "../../../../../../../lib/db/src/sales-schema";

export const TEST_DB_URL = process.env.SALES_TEST_DATABASE_URL;

export async function openDb(): Promise<Db & { close(): Promise<void> }> {
  if (!TEST_DB_URL) throw new Error("SALES_TEST_DATABASE_URL is not set");
  if ((globalThis as any).Bun) {
    const { createBunDb } = await import("./bun-db");
    return createBunDb(TEST_DB_URL);
  }
  const pg = await import("pg");
  const { createSalesDb } = await import("../../../../../../../lib/db/src/sales-adapter");
  const pool = new pg.default.Pool({ connectionString: TEST_DB_URL, max: 8 });
  return Object.assign(createSalesDb(pool), { close: () => pool.end() });
}

export async function resetDb(db: Db): Promise<void> {
  for (const s of SALES_SCHEMA_STATEMENTS) await db.query(s);
  const tables = (await db.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename LIKE 'sales\\_%'")).rows.map((t) => t.tablename);
  // the audit table is append-only (trigger blocks DELETE but not TRUNCATE); tests start from a clean slate
  await db.query(`TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export const deps: Deps = {
  now: () => new Date(),
  integrations: NO_INTEGRATIONS,
  log: { info: () => undefined, warn: () => undefined, error: (o) => console.error("[sales-test]", o) },
  onCommitted: (events, c) => handleEvents(events, c),
};

export const router = buildRouter();

export const ident = (email: string, platformRole = "editor"): AuthIdentity => ({ sub: `sub-${email}`, email, platformRole, displayName: email.split("@")[0] });

export function client(db: Db, auth: AuthIdentity | undefined, opts: { now?: () => Date; ip?: string; integrations?: Deps["integrations"] } = {}) {
  const d: Deps = { ...deps, now: opts.now ?? deps.now, integrations: opts.integrations ?? deps.integrations };
  return async (method: string, path: string, body?: unknown, extra: { query?: Record<string, string>; headers?: Record<string, string> } = {}): Promise<SalesResponse & { json: any }> => {
    const res = await dispatch(router, db, d, { method, path, query: extra.query ?? {}, body, headers: extra.headers ?? {}, auth, ip: opts.ip ?? "10.0.0.1" });
    return Object.assign(res, { json: res.body as any });
  };
}
