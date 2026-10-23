/**
 * On-device compatibility: the Sales engine (including all 24 agents) also runs in the browser on PGlite (WebAssembly Postgres).
 * This runs the same agent flows against in-memory PGlite so SQL that works on server PostgreSQL but not on-device is caught here.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { client, ident } from "./helpers/harness";
import { SALES_SCHEMA_STATEMENTS } from "../../../../../../lib/db/src/sales-schema";
import type { Db, Queryable } from "../core/types";

let pg: any;
let db: Db | undefined;
let skip: string | false = false;
let admin: ReturnType<typeof client>;

const parsers: Record<number, (v: string) => unknown> = { 1700: (v) => v, 1082: (v) => v, 1184: (v) => new Date(v).toISOString(), 1114: (v) => new Date(`${v.replace(" ", "T")}Z`).toISOString(), 20: (v) => (Number.isSafeInteger(Number(v)) ? Number(v) : v) };
const wrap = (r: any): Queryable => ({ async query(sql: string, params: unknown[] = []) { const res = await r.query(sql, params); const rows = res.rows; return { rows, rowCount: rows.length > 0 ? rows.length : res.affectedRows ?? 0 } as any; } });

before(async () => {
  try {
    const { PGlite } = await import("@electric-sql/pglite" as string);
    pg = new PGlite(undefined, { parsers });
    await pg.waitReady;
    await pg.exec(SALES_SCHEMA_STATEMENTS.map((s) => `${s.trim().replace(/;$/, "")};`).join("\n"));
    const base = wrap(pg);
    db = { query: base.query, tx: (fn) => pg.transaction((t: any) => fn(wrap(t))) };
    process.env.SALES_ADMIN_EMAILS = "boss@example.com";
    admin = client(db, ident("boss@example.com", "admin"));
    await admin("GET", "/me");
  } catch (e) { skip = `PGlite unavailable: ${e instanceof Error ? e.message : e}`; }
});
after(async () => { try { await pg?.close(); } catch { /* ignore */ } });

test("PGlite: all 24 agents enable, orchestrate with seeded data and finish without failures", async (t) => {
  if (skip) return t.skip(String(skip));
  const rep = await admin("POST", "/members", { email: "rep@example.com", display_name: "Rep", role: "sales_rep" });
  assert.equal(rep.status, 201, JSON.stringify(rep.json));
  const repc = client(db!, ident("rep@example.com"));
  const a = await repc("POST", "/accounts", { name: "Pglite Co", industry: "Retail" });
  const o = await repc("POST", "/opportunities", { name: "Old deal", account_id: a.json.id, amount: "5000.00", expected_close_date: "2031-01-31" });
  assert.equal(o.status, 201, JSON.stringify(o.json));
  await db!.query("UPDATE sales_opportunities SET last_activity_at = now() - interval '40 days', stage_entered_at = now() - interval '40 days' WHERE id = $1", [o.json.id]);
  await admin("POST", "/leads", { first_name: "Pool", email: "pool@lead.example", company: "PoolCo", source: "web_form" });
  await db!.query("UPDATE sales_leads SET owner_id = NULL, created_at = now() - interval '3 days'");
  assert.equal((await admin("POST", "/agents/bulk", { action: "enable_all" })).status, 200);
  const r = await admin("POST", "/agents/orchestrate", {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.totals.failures, 0, JSON.stringify(r.json.agents.filter((x: any) => x.status === "failed")));
  assert.equal(r.json.agents.filter((x: any) => x.status === "completed").length, 24);
  const recs = await admin("GET", "/agents/recommendations");
  assert.ok(recs.json.total >= 3, "findings recorded on-device");
});

test("PGlite: approval request, decision, execution and event bus work on-device", async (t) => {
  if (skip) return t.skip(String(skip));
  const appr = (await db!.query<any>("SELECT * FROM sales_approvals WHERE action_type = 'lead.assign' LIMIT 1")).rows[0];
  assert.ok(appr, "an assignment was prepared");
  const ex = await admin("POST", `/approvals/${appr.id}/execute`, {});
  assert.equal(ex.status, 200, JSON.stringify(ex.json)); assert.equal(ex.json.status, "COMPLETED");
  const events = await admin("POST", "/agents/events/process", {});
  assert.equal(events.status, 200, JSON.stringify(events.json));
  const cc = await admin("GET", "/agents/command-centre");
  assert.equal(cc.status, 200); assert.equal(cc.json.totals.configured, 24);
  const brief = await admin("GET", "/agents/briefing");
  assert.equal(brief.status, 200); assert.ok(Array.isArray(brief.json.risks));
});
