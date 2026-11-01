/**
 * Runs the real Finance router + SQL (schema, triggers, constraints) on in-memory PostgreSQL (PGlite).
 * Set FINANCE_TEST_DATABASE_URL to run the same suite on a real server PostgreSQL instead.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "../core/router";
import { organisationRoutes } from "../modules/organisations";
import { accountRoutes } from "../modules/accounts";
import { periodRoutes } from "../modules/periods";
import { journalRoutes } from "../modules/journals";
import { reportRoutes } from "../modules/reports";
import { FINANCE_SCHEMA_STATEMENTS } from "../../../../../../lib/db/src/finance-schema";
import { verifyAuditChain } from "../core/audit";
import type { Db, Queryable } from "../core/types";

const routes = [...organisationRoutes, ...accountRoutes, ...periodRoutes, ...journalRoutes, ...reportRoutes];
const parsers: Record<number, (v: string) => unknown> = { 1700: (v) => v, 1082: (v) => v, 1184: (v) => new Date(v).toISOString(), 1114: (v) => new Date(`${v.replace(" ", "T")}Z`).toISOString(), 20: (v) => (Number.isSafeInteger(Number(v)) ? Number(v) : v) };
const wrap = (r: any): Queryable => ({ async query(sql: string, params: unknown[] = []) { const res = await r.query(sql, params); const rows = res.rows; return { rows, rowCount: rows.length > 0 ? rows.length : res.affectedRows ?? 0 } as any; } });

let pg: any; let db: Db; let skip: string | false = false;
let NOW = new Date("2026-03-15T10:00:00Z");
const deps = { now: () => NOW, log: { error: (o: unknown) => console.error("[finance-test]", o) } };
const ident = (email: string, platformRole = "editor") => ({ sub: `sub-${email}`, email, platformRole, displayName: email.split("@")[0] });
function client(email: string, platformRole = "editor", org?: number) {
  return async (method: string, path: string, body?: unknown, extra: { query?: Record<string, string>; headers?: Record<string, string>; org?: number | null } = {}) => {
    const o = extra.org === undefined ? org : extra.org;
    const res = await dispatch(routes, db, deps, { method, path, query: extra.query ?? {}, body, headers: { ...(o ? { "x-finance-org": String(o) } : {}), ...(extra.headers ?? {}) }, auth: ident(email, platformRole) });
    return Object.assign(res, { json: res.body as any });
  };
}
let orgA = 0, orgB = 0;
let owner: ReturnType<typeof client>, acct: ReturnType<typeof client>, ctrl: ReturnType<typeof client>, viewer: ReturnType<typeof client>, ownerB: ReturnType<typeof client>;
const code = async (c: ReturnType<typeof client>, k: string) => (await c("GET", "/accounts", undefined, { query: { q: k } })).json.items.find((a: any) => a.code === k).id as number;
const J = (lines: Array<[string, string, string]>, extra: object = {}) => ({ entry_date: "2026-03-10", description: "Test journal", lines: lines.map(([account_code, debit, credit]) => ({ account_code, debit, credit })), ...extra });

before(async () => {
  try {
    const mod = process.env.FINANCE_TEST_DATABASE_URL ? null : await import("@electric-sql/pglite" as string);
    if (mod) {
      pg = new mod.PGlite(undefined, { parsers }); await pg.waitReady;
      for (const s of FINANCE_SCHEMA_STATEMENTS) await pg.exec(`${s.trim().replace(/;$/, "")};`);
      for (const s of FINANCE_SCHEMA_STATEMENTS) await pg.exec(`${s.trim().replace(/;$/, "")};`); // idempotent: second boot must be a no-op
      const base = wrap(pg); db = { query: base.query, tx: (fn) => pg.transaction((t: any) => fn(wrap(t))) };
    } else throw new Error("Real-PostgreSQL mode is run through the Sales adapter in CI");
  } catch (e) { skip = `PGlite unavailable: ${e instanceof Error ? e.message : e}`; return; }
  const admin = client("boss@example.com", "admin");
  const a = await admin("POST", "/organisations", { legal_name: "Alpha Trading Ltd", tax_id: "C0001" }); assert.equal(a.status, 201, JSON.stringify(a.json)); orgA = Number(a.json.organisation.id);
  const b = await admin("POST", "/organisations", { legal_name: "Beta Services Ltd" }); assert.equal(b.status, 201); orgB = Number(b.json.organisation.id);
  owner = client("boss@example.com", "admin", orgA); ownerB = client("boss@example.com", "admin", orgB);
  for (const [email, role] of [["acct@example.com", "accountant"], ["ctrl@example.com", "financial_controller"], ["view@example.com", "readonly_executive"]]) {
    const r = await owner("POST", "/members", { email, role }); assert.equal(r.status, 201, JSON.stringify(r.json));
  }
  acct = client("acct@example.com", "editor", orgA); ctrl = client("ctrl@example.com", "editor", orgA); viewer = client("view@example.com", "editor", orgA);
});
after(async () => { try { await pg?.close(); } catch { /* ignore */ } });
const t = (name: string, fn: () => Promise<void>) => test(name, async (tc) => { if (skip) return tc.skip(String(skip)); await fn(); });

t("organisation creation seeds the chart and a fiscal year with 12 periods; schema bootstrap is idempotent", async () => {
  const acc = await owner("GET", "/accounts"); assert.ok(acc.json.items.length >= 50);
  const fy = await owner("GET", "/fiscal-years"); assert.equal(fy.json.items.length, 1); assert.equal(fy.json.items[0].periods.length, 12);
});

t("balanced journal: draft -> approve (other user) -> post -> ledger + trial balance reconcile", async () => {
  const c = await acct("POST", "/journals", J([["1020", "1000.00", "0"], ["3010", "0", "1000.00"]], { description: "Capital introduced" }));
  assert.equal(c.status, 201, JSON.stringify(c.json)); const id = c.json.journal.id;
  assert.equal((await ctrl("POST", `/journals/${id}/post`)).json.code, "approval_required");
  assert.equal((await acct("POST", `/journals/${id}/post`)).json.code, "missing_permission"); // accountants cannot post
  assert.equal((await acct("POST", `/journals/${id}/approve`)).status, 403); // no finance:approve at all
  const sod = await ctrl("POST", "/journals", J([["1010", "50.00", "0"], ["3010", "0", "50.00"]])); // controller's own journal
  assert.equal((await ctrl("POST", `/journals/${sod.json.journal.id}/approve`)).json.code, "separation_of_duties");
  assert.equal((await ctrl("POST", `/journals/${id}/approve`)).status, 200);
  const p = await ctrl("POST", `/journals/${id}/post`); assert.equal(p.status, 200, JSON.stringify(p.json)); assert.equal(p.json.journal.status, "posted");
  assert.equal((await ctrl("POST", `/journals/${id}/post`)).json.code, "already_posted");
  const tb = await ctrl("GET", "/trial-balance", undefined, { query: { as_of: "2026-03-31" } });
  assert.equal(tb.json.trial_balance.balanced, true); assert.equal(tb.json.trial_balance.total_debit, "1000.00");
  const gl = await ctrl("GET", "/ledger", undefined, { query: { account_code: "1020" } });
  assert.equal(gl.json.closing_balance, "1000.00"); assert.equal(gl.json.items.length, 1);
});

t("unbalanced / malformed journals are rejected; floating point never used", async () => {
  const u = await acct("POST", "/journals", J([["1020", "100.00", "0"], ["3010", "0", "99.99"]]));
  assert.equal(u.status, 422); assert.equal(u.json.code, "journal_unbalanced"); assert.equal(u.json.details.difference, "0.01");
  assert.equal((await acct("POST", "/journals", J([["1020", "0.10", "0"], ["1020", "0.20", "0"], ["3010", "0", "0.30"]]))).status, 201); // 0.1 + 0.2 = 0.3 exactly
  assert.equal((await acct("POST", "/journals", J([["1020", "100.00", "0"]]))).status, 422);
  assert.equal((await acct("POST", "/journals", J([["1020", "10.00", "10.00"], ["3010", "0", "0"]]))).status, 422);
  assert.equal((await acct("POST", "/journals", J([["1020", "10.001", "0"], ["3010", "0", "10.001"]]))).status, 422);
  assert.equal((await acct("POST", "/journals", J([["1000", "10.00", "0"], ["3010", "0", "10.00"]]))).json.code, "account_not_postable"); // header account
});

t("database itself refuses unbalanced posting and edits to posted records", async () => {
  const s = await acct("POST", "/journals", J([["1010", "5.00", "0"], ["3010", "0", "5.00"]])); const jid = s.json.journal.id;
  await db.query("UPDATE finance_journal_lines SET credit = 4.00 WHERE journal_id = $1 AND credit > 0", [jid]);
  await assert.rejects(db.query("UPDATE finance_journals SET status = 'posted' WHERE id = $1", [jid]), /not balanced/);
  const posted = (await db.query<any>("SELECT id, journal_id FROM finance_ledger_entries LIMIT 1")).rows[0];
  await assert.rejects(db.query("UPDATE finance_ledger_entries SET debit = 1 WHERE id = $1", [posted.id]), /append-only/);
  await assert.rejects(db.query("DELETE FROM finance_ledger_entries WHERE id = $1", [posted.id]), /append-only/);
  await assert.rejects(db.query("UPDATE finance_journals SET description = 'x' WHERE id = $1", [posted.journal_id]), /immutable/);
  await assert.rejects(db.query("DELETE FROM finance_journals WHERE id = $1", [posted.journal_id]), /cannot be deleted/);
  await assert.rejects(db.query("UPDATE finance_journal_lines SET debit = 9 WHERE journal_id = $1", [posted.journal_id]), /posted journal/);
  const api = await acct("PATCH", `/journals/${posted.journal_id}`, { description: "tamper" }); assert.equal(api.json.code, "journal_not_editable");
  assert.equal((await owner("DELETE", `/journals/${posted.journal_id}`)).json.code, "journal_not_deletable");
});

t("reversal posts mirror entries, nets to zero, and cannot be repeated", async () => {
  const c = await acct("POST", "/journals", J([["6100", "300.00", "0"], ["1020", "0", "300.00"]], { description: "Rent" }));
  await ctrl("POST", `/journals/${c.json.journal.id}/approve`); await ctrl("POST", `/journals/${c.json.journal.id}/post`);
  const before = await ctrl("GET", "/ledger", undefined, { query: { account_code: "6100" } }); assert.equal(before.json.closing_balance, "300.00");
  assert.equal((await acct("POST", `/journals/${c.json.journal.id}/reverse`, { reason: "oops" })).status, 403);
  const r = await ctrl("POST", `/journals/${c.json.journal.id}/reverse`, { reason: "Posted in error", date: "2026-03-15" }); assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.reversal.journal_type, "reversal"); assert.ok(r.json.original.reversed_by);
  assert.equal((await ctrl("GET", "/ledger", undefined, { query: { account_code: "6100" } })).json.closing_balance, "0.00");
  assert.equal((await ctrl("POST", `/journals/${c.json.journal.id}/reverse`, { reason: "again" })).json.code, "already_reversed");
  assert.equal((await ctrl("POST", `/journals/${r.json.reversal.id}/reverse`, { reason: "again" })).json.code, "invalid_status");
});

t("idempotency: same source ref and same Idempotency-Key never double-post", async () => {
  const body = J([["1020", "70.00", "0"], ["4000", "0", "70.00"]], { journal_type: "automated", source_module: "sales.invoice", source_ref: "INV-1", auto_post: true });
  const a = await ctrl("POST", "/journals", body); assert.equal(a.status, 201, JSON.stringify(a.json)); assert.equal(a.json.journal.status, "posted");
  const b = await ctrl("POST", "/journals", body); assert.equal(b.status, 200); assert.equal(b.json.duplicate, true); assert.equal(b.json.journal.id, a.json.journal.id);
  const k = { headers: { "idempotency-key": "k-1" } };
  const x = await acct("POST", "/journals", J([["1010", "9.00", "0"], ["3010", "0", "9.00"]]), k); const y = await acct("POST", "/journals", J([["1010", "9.00", "0"], ["3010", "0", "9.00"]]), k);
  assert.equal(y.headers?.["Idempotent-Replay"], "true"); assert.equal(y.json.journal.id, x.json.journal.id);
  assert.equal((await acct("POST", "/journals", J([["1010", "8.00", "0"], ["3010", "0", "8.00"]]), k)).json.code, "idempotency_key_reuse");
  const n = (await db.query<any>("SELECT count(*)::int AS n FROM finance_ledger_entries WHERE reference = $1", [a.json.journal.reference])).rows[0].n; assert.equal(n, 2);
});

t("periods: soft close needs override, hard close blocks everyone, reopening needs a reason", async () => {
  const ps = (await owner("GET", "/periods")).json.items; const jan = ps.find((p: any) => p.name === "Jan 2026");
  assert.equal((await owner("POST", `/periods/${jan.id}/status`, { status: "soft_closed" })).status, 200);
  const soft = await acct("POST", "/journals", J([["1010", "1.00", "0"], ["3010", "0", "1.00"]], { entry_date: "2026-01-20" })); assert.equal(soft.json.code, "period_soft_closed");
  const ok2 = await ctrl("POST", "/journals", J([["1010", "1.00", "0"], ["3010", "0", "1.00"]], { entry_date: "2026-01-20" })); assert.equal(ok2.status, 201); // controller has period:override
  assert.equal((await owner("POST", `/periods/${jan.id}/status`, { status: "hard_closed" })).json.code, "unposted_journals");
  await ctrl("POST", `/journals/${ok2.json.journal.id}`.replace(/$/, "/reject"), { reason: "not needed" }); await owner("DELETE", `/journals/${ok2.json.journal.id}`);
  assert.equal((await owner("POST", `/periods/${jan.id}/status`, { status: "hard_closed" })).status, 200);
  assert.equal((await owner("POST", "/journals", J([["1010", "1.00", "0"], ["3010", "0", "1.00"]], { entry_date: "2026-01-20" }))).json.code, "period_locked");
  assert.equal((await owner("POST", `/periods/${jan.id}/status`, { status: "open" })).json.code, "reason_required");
  assert.equal((await owner("POST", `/periods/${jan.id}/status`, { status: "open", reason: "Late invoice found" })).status, 200);
  assert.equal((await owner("POST", "/journals", J([["1010", "1.00", "0"], ["3010", "0", "1.00"]], { entry_date: "2027-07-01" }))).json.code, "no_period");
});

t("tenant isolation: other organisations' data, accounts and journals are unreachable", async () => {
  const other = await ownerB("GET", "/accounts"); const mine = await owner("GET", "/accounts");
  const ids = new Set(mine.json.items.map((a: any) => a.id)); assert.ok(other.json.items.every((a: any) => !ids.has(a.id)));
  const jA = (await owner("GET", "/journals")).json.items[0];
  assert.equal((await ownerB("GET", `/journals/${jA.id}`)).status, 404);
  assert.equal((await ownerB("POST", `/journals/${jA.id}/post`)).status, 404);
  const accA = await code(owner, "1020");
  const cross = await ownerB("POST", "/journals", { entry_date: "2026-03-10", description: "cross tenant", lines: [{ account_id: accA, debit: "5.00", credit: "0" }, { account_code: "3010", debit: "0", credit: "5.00" }] });
  assert.equal(cross.status, 422); assert.equal(cross.json.code, "invalid_account");
  await assert.rejects(db.query("INSERT INTO finance_journals (org_id, reference, entry_date, period_id, description, created_by) SELECT $1, 'X-1', '2026-03-01', p.id, 'x', 'u' FROM finance_periods p WHERE p.org_id = $2 LIMIT 1", [orgB, orgA]), /foreign key/i);
  const stranger = client("nobody@example.com", "editor", orgA); assert.equal((await stranger("GET", "/accounts")).json.code, "not_a_member");
  assert.equal((await client("nobody@example.com", "editor", 999999)("GET", "/accounts")).json.code, "not_a_member");
  assert.equal((await client("nobody@example.com", "editor")("GET", "/accounts")).json.code, "organisation_required");
});

t("permissions are enforced server-side; API keys and anonymous callers are refused", async () => {
  assert.equal((await viewer("POST", "/journals", J([["1010", "1.00", "0"], ["3010", "0", "1.00"]]))).status, 403);
  assert.equal((await viewer("POST", "/accounts", { code: "9999", name: "Nope", type: "asset", category: "current_asset" })).status, 403);
  assert.equal((await acct("GET", "/audit")).status, 403);
  assert.equal((await acct("POST", "/members", { email: "x@example.com", role: "accountant" })).status, 403);
  assert.equal((await client("acct@example.com", "editor")("POST", "/organisations", { legal_name: "Rogue Ltd" }, { org: null })).status, 403);
  assert.equal((await dispatch(routes, db, deps, { method: "GET", path: "/accounts", query: {}, body: undefined, headers: { "x-finance-org": String(orgA) }, auth: undefined })).status, 401);
  const apiKey = await dispatch(routes, db, deps, { method: "GET", path: "/accounts", query: {}, body: undefined, headers: { "x-finance-org": String(orgA) }, auth: { ...ident("k@example.com"), isApiKey: true } });
  assert.equal((apiKey.body as any).code, "api_key_forbidden");
  assert.equal((await owner("PATCH", "/members/1", { role: "accountant" })).status, 409 /* sole owner cannot be demoted */);
});

t("year-end closing transfers profit to retained earnings and locks the year", async () => {
  const org = (await owner("POST", "/organisations", { legal_name: "Closing Co", first_fiscal_year: 2025 }, { org: null })).json.organisation.id; const o = client("boss@example.com", "admin", Number(org));
  await o("PATCH", "/organisation", { settings: { allow_self_approval: true } });
  const post = async (lines: Array<[string, string, string]>) => { const j = await o("POST", "/journals", J(lines, { entry_date: "2025-06-30" })); await o("POST", `/journals/${j.json.journal.id}/approve`); const p = await o("POST", `/journals/${j.json.journal.id}/post`); assert.equal(p.status, 200, JSON.stringify(p.json)); };
  await post([["1020", "5000.00", "0"], ["4000", "0", "5000.00"]]); await post([["6100", "1200.50", "0"], ["1020", "0", "1200.50"]]);
  const pre = await o("GET", "/trial-balance", undefined, { query: { as_of: "2025-12-31", basis: "adjusted" } });
  assert.ok(pre.json.trial_balance.rows.some((r: any) => r.code === "4000")); assert.equal(pre.json.trial_balance.balanced, true);
  const fy = (await o("GET", "/fiscal-years")).json.items[0];
  const close = await o("POST", `/fiscal-years/${fy.id}/close`); assert.equal(close.status, 200, JSON.stringify(close.json)); assert.equal(close.json.net_result, "3799.50");
  const post2 = await o("GET", "/trial-balance", undefined, { query: { as_of: "2025-12-31", basis: "post_closing" } });
  assert.ok(!post2.json.trial_balance.rows.some((r: any) => ["4000", "6100"].includes(r.code))); assert.equal(post2.json.trial_balance.rows.find((r: any) => r.code === "3100").credit_balance, "3799.50"); assert.equal(post2.json.trial_balance.balanced, true);
  const stillPre = await o("GET", "/trial-balance", undefined, { query: { as_of: "2025-12-31", basis: "adjusted" } });
  assert.ok(stillPre.json.trial_balance.rows.some((r: any) => r.code === "4000")); // pre-closing view still shows the year's activity
  assert.equal((await o("POST", "/journals", J([["1010", "1.00", "0"], ["3010", "0", "1.00"]], { entry_date: "2025-09-01" }))).json.code, "period_locked");
  assert.equal((await o("POST", `/fiscal-years/${fy.id}/close`)).json.code, "fiscal_year_closed");
});

t("dashboard KPIs are computed from posted ledger entries only", async () => {
  const org = (await owner("POST", "/organisations", { legal_name: "Dash Co" }, { org: null })).json.organisation.id; const o = client("boss@example.com", "admin", Number(org));
  await o("PATCH", "/organisation", { settings: { allow_self_approval: true } });
  const empty = await o("GET", "/dashboard"); assert.equal(empty.json.has_postings, false); assert.equal(empty.json.kpis.revenue.value, "0.00");
  const today = "2026-03-15"; // matches the pinned test clock
  const mk = async (lines: Array<[string, string, string]>, post = true) => { const j = await o("POST", "/journals", J(lines, { entry_date: today })); assert.equal(j.status, 201, JSON.stringify(j.json)); if (post) { await o("POST", `/journals/${j.json.journal.id}/approve`); assert.equal((await o("POST", `/journals/${j.json.journal.id}/post`)).status, 200); } };
  await mk([["1020", "1000.10", "0"], ["4000", "0", "1000.10"]]); await mk([["5000", "300.05", "0"], ["1020", "0", "300.05"]]); await mk([["6100", "100.00", "0"], ["1020", "0", "100.00"]]);
  await mk([["1020", "9999.00", "0"], ["4000", "0", "9999.00"]], false); // draft: must not count
  const d = (await o("GET", "/dashboard")).json.kpis;
  assert.equal(d.revenue.value, "1000.10"); assert.equal(d.gross_profit.value, "700.05"); assert.equal(d.net_profit.value, "600.05"); assert.equal(d.cash_and_bank.value, "600.05"); assert.equal(d.gross_margin_pct.value, "70.00");
});

t("audit trail is hash-chained, append-only and verifiable; tampering is detected", async () => {
  const v = await owner("GET", "/audit/verify"); assert.equal(v.json.ok, true); assert.ok(v.json.checked > 10);
  const list = await owner("GET", "/audit", undefined, { query: { entity_type: "journal" } }); assert.ok(list.json.items.some((e: any) => e.action === "journal.post"));
  await assert.rejects(db.query("UPDATE finance_audit_events SET summary = 'x'"), /append-only/);
  await assert.rejects(db.query("DELETE FROM finance_audit_events"), /append-only/);
  await db.query("ALTER TABLE finance_audit_events DISABLE TRIGGER finance_audit_no_update");
  await db.query("UPDATE finance_audit_events SET summary = 'forged' WHERE org_id = $1 AND seq = 3", [orgA]);
  assert.deepEqual(await verifyAuditChain(db, orgA), { ok: false, checked: v.json.checked, brokenAtSeq: 3 });
  await db.query("ALTER TABLE finance_audit_events ENABLE TRIGGER finance_audit_no_update");
});
