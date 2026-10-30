import { PGlite } from "@electric-sql/pglite";
import { SENTINEL_SCHEMA_STATEMENTS } from "../../../../../../../lib/db/src/sentinel-schema";
import pgModule from "pg";
import { createSalesDb } from "../../../../../../../lib/db/src/sales-adapter";
import type { Db, Queryable } from "../../types";

type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; affectedRows?: number }> };
const wrap = (r: Runner): Queryable => ({
  async query(sql, params = []) {
    const res = await r.query(sql, params);
    return { rows: res.rows as any[], rowCount: res.rows.length > 0 ? res.rows.length : res.affectedRows ?? 0 };
  },
});

let realPool: pgModule.Pool | undefined;
/** When SENTINEL_TEST_DATABASE_URL is set the very same tests run against a live PostgreSQL through the production adapter. */
async function realDb(url: string): Promise<{ db: Db; pg: PGlite }> {
  realPool ??= new pgModule.Pool({ connectionString: url, max: 6, allowExitOnIdle: true, idleTimeoutMillis: 1000 });
  const pool = realPool;
  for (const s of SENTINEL_SCHEMA_STATEMENTS) await pool.query(s);
  await pool.query("TRUNCATE sk_audit, sk_history, sk_vault_entries, sk_aliases, sk_user_keys RESTART IDENTITY CASCADE");
  return { db: createSalesDb(pool) as unknown as Db, pg: { query: (sql: string, params?: unknown[]) => pool.query(sql, params as any[]) } as unknown as PGlite };
}

export async function memoryDb(): Promise<{ db: Db; pg: PGlite }> {
  if (process.env.SENTINEL_TEST_DATABASE_URL) return realDb(process.env.SENTINEL_TEST_DATABASE_URL);
  const pg = new PGlite(undefined, { parsers: { 1184: (v: string) => new Date(v).toISOString(), 1114: (v: string) => new Date(`${v.replace(" ", "T")}Z`).toISOString(), 20: (v: string) => Number(v) } } as any);
  await pg.waitReady;
  await pg.exec(SENTINEL_SCHEMA_STATEMENTS.map((s: string) => `${s.trim().replace(/;$/, "")};`).join("\n"));
  const base = wrap(pg as unknown as Runner);
  return { db: { query: base.query, tx: (fn) => pg.transaction((t) => fn(wrap(t as unknown as Runner))) }, pg };
}
