/**
 * Test-only Db adapter backed by Bun's built-in Postgres client. It exists because the authoring sandbox cannot
 * `npm install pg`; on a normal machine the integration tests use the production adapter (see test-db.ts).
 * Behaviour is normalised to match lib/db/src/sales-adapter.ts: timestamps and dates become ISO strings.
 */
import type { Db, Queryable } from "../../core/types";

function norm(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(norm);
  return v;
}

function wrap(runner: { unsafe: (sql: string, params?: unknown[]) => Promise<any> }): Queryable {
  return {
    async query(sql, params = []) {
      let res: any;
      try {
        res = await runner.unsafe(sql, params as unknown[]);
      } catch (e: any) {
        // Bun reports the SQLSTATE in `errno`; node-postgres uses `code`. Normalise so route error mapping is identical.
        if (e && typeof e.errno === "string" && /^[0-9A-Z]{5}$/.test(e.errno)) e.code = e.errno;
        throw e;
      }
      const rows = Array.from(res as any[]).map((row) => {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(row)) out[k] = norm(row[k]);
        return out;
      });
      return { rows: rows as any, rowCount: (res as any).count ?? rows.length };
    },
  };
}

export function createBunDb(url: string): Db & { close(): Promise<void> } {
  const BunSQL = (globalThis as any).Bun?.SQL;
  if (!BunSQL) throw new Error("createBunDb requires the Bun runtime");
  const sql = new BunSQL(url, { max: Number(process.env.SALES_TEST_POOL ?? 8) });
  const base = wrap(sql);
  return {
    query: base.query,
    async tx(fn) {
      return sql.begin(async (t: any) => fn(wrap(t)));
    },
    close: () => sql.close(),
  };
}
