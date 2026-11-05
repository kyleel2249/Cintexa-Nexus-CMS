/**
 * Test helper: a D1-compatible wrapper over node:sqlite (D1 is SQLite). Supports prepare/bind/run/all/first and atomic batch()
 * with rollback, plus optional fault injection to prove atomicity and recovery.
 */
import { DatabaseSync } from "node:sqlite";
import type { D1Like } from "../../functions/_lib/nexus-db.ts";

export type Fault = { when: (sql: string) => boolean; on: boolean };

export function makeD1(fault?: Fault): { db: D1Like; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  const mk = (sql: string, args: unknown[] = []): any => ({
    bind: (...a: unknown[]) => mk(sql, a),
    async run() {
      if (fault?.on && fault.when(sql)) throw new Error("injected failure");
      const r = sqlite.prepare(sql).run(...(args as any[]));
      return { meta: { changes: Number(r.changes) } };
    },
    async all() { return { results: sqlite.prepare(sql).all(...(args as any[])) as any[] }; },
    async first() { return (sqlite.prepare(sql).get(...(args as any[])) as any) ?? null; },
  });
  const db: D1Like = {
    prepare: (sql) => mk(sql),
    async batch(stmts) {
      sqlite.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        sqlite.exec("COMMIT");
        return out;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { db, sqlite };
}

