import { PGlite } from "@electric-sql/pglite";
import { SENTINEL_SCHEMA_STATEMENTS } from "../../../../../../../lib/db/src/sentinel-schema";
import type { Db, Queryable } from "../../types";

type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; affectedRows?: number }> };
const wrap = (r: Runner): Queryable => ({
  async query(sql, params = []) {
    const res = await r.query(sql, params);
    return { rows: res.rows as any[], rowCount: res.rows.length > 0 ? res.rows.length : res.affectedRows ?? 0 };
  },
});

export async function memoryDb(): Promise<{ db: Db; pg: PGlite }> {
  const pg = new PGlite(undefined, { parsers: { 1184: (v: string) => new Date(v).toISOString(), 1114: (v: string) => new Date(`${v.replace(" ", "T")}Z`).toISOString(), 20: (v: string) => Number(v) } } as any);
  await pg.waitReady;
  await pg.exec(SENTINEL_SCHEMA_STATEMENTS.map((s: string) => `${s.trim().replace(/;$/, "")};`).join("\n"));
  const base = wrap(pg as unknown as Runner);
  return { db: { query: base.query, tx: (fn) => pg.transaction((t) => fn(wrap(t as unknown as Runner))) }, pg };
}
