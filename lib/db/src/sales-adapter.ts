/**
 * Query adapter used by the Sales Management service layer.
 *
 * Why a dedicated adapter: Sales needs (a) real multi-statement transactions on one connection, and
 * (b) predictable value types. node-postgres would turn DATE columns into local-midnight JS Dates, which shifts
 * business dates by a day on non-UTC servers - so DATE is returned as "YYYY-MM-DD", timestamps as ISO strings and
 * BIGINT as number when it is a safe integer. NUMERIC stays a string (decimal-safe money).
 */
import pg from "pg";

const PG_DATE = 1082;
const PG_TIMESTAMP = 1114;
const PG_TIMESTAMPTZ = 1184;
const PG_INT8 = 20;

const customTypes = {
  getTypeParser(oid: number, format?: string) {
    if (oid === PG_DATE) return (v: string) => v;
    if (oid === PG_TIMESTAMPTZ) return (v: string) => new Date(v).toISOString();
    if (oid === PG_TIMESTAMP) return (v: string) => new Date(`${v.replace(" ", "T")}Z`).toISOString();
    if (oid === PG_INT8) return (v: string) => (Number.isSafeInteger(Number(v)) ? Number(v) : v);
    return (pg.types as unknown as { getTypeParser: (o: number, f?: string) => (v: string) => unknown }).getTypeParser(oid, format);
  },
};

export interface SalesQueryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}
export interface SalesDb extends SalesQueryable {
  tx<T>(fn: (q: SalesQueryable) => Promise<T>): Promise<T>;
}

type Runner = { query: (config: { text: string; values?: unknown[]; types?: unknown }) => Promise<{ rows: any[]; rowCount: number | null }> };

function runner(target: Runner): SalesQueryable {
  return {
    async query(sql, params = []) {
      const r = await target.query({ text: sql, values: params, types: customTypes });
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
  };
}

export function createSalesDb(pool: pg.Pool): SalesDb {
  const base = runner(pool as unknown as Runner);
  return {
    query: base.query,
    async tx(fn) {
      const client = await pool.connect();
      const q = runner(client as unknown as Runner);
      try {
        await client.query("BEGIN");
        const out = await fn(q);
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
