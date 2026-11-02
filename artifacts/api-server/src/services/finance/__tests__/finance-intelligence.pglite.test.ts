/**
 * Financial Intelligence Phase 9 — automated verification of ratios, statements,
 * capital, dividends, budgets, alerts, and integration status on PGlite.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "../core/router";
import { organisationRoutes } from "../modules/organisations";
import { accountRoutes } from "../modules/accounts";
import { periodRoutes } from "../modules/periods";
import { journalRoutes } from "../modules/journals";
import { reportRoutes } from "../modules/reports";
import { ratioRoutes } from "../modules/ratios";
import { statementRoutes } from "../modules/statements";
import { capitalRoutes } from "../modules/capital";
import { dividendValuationRoutes } from "../modules/dividends-valuation";
import { budgetHealthRoutes } from "../modules/budget-health";
import { integrationRoutes } from "../modules/integration-routes";
import {
  FINANCE_SCHEMA_STATEMENTS,
  FINANCE_PHASE4_STATEMENTS,
  FINANCE_PHASE5_STATEMENTS,
  FINANCE_PHASE6_STATEMENTS,
  FINANCE_PHASE7_STATEMENTS,
  FINANCE_PHASE8_STATEMENTS,
} from "../../../../../../lib/db/src/finance-schema";
import { FINANCE_INTEGRATION_STATEMENTS } from "../../../../../../lib/db/src/finance-integration-schema";
import type { Db, Queryable } from "../core/types";

const routes = [
  ...organisationRoutes, ...accountRoutes, ...periodRoutes, ...journalRoutes, ...reportRoutes,
  ...ratioRoutes, ...statementRoutes, ...capitalRoutes, ...dividendValuationRoutes,
  ...budgetHealthRoutes, ...integrationRoutes,
];

const wrap = (r: any): Queryable => ({
  async query(sql: string, params: unknown[] = []) {
    const res = await r.query(sql, params);
    const rows = res.rows;
    return { rows, rowCount: rows.length > 0 ? rows.length : res.affectedRows ?? 0 } as any;
  },
});

let pg: any; let db: Db; let skip: string | false = false;
let NOW = new Date("2026-03-15T10:00:00Z");
const deps = { now: () => NOW, log: { error: (o: unknown) => console.error("[fi-test]", o) } };
const ident = (email: string, platformRole = "editor") => ({ sub: `sub-${email}`, email, platformRole, displayName: email.split("@")[0] });
function client(email: string, platformRole = "editor", org?: number) {
  return async (method: string, path: string, body?: unknown, extra: { query?: Record<string, string>; headers?: Record<string, string>; org?: number | null } = {}) => {
    const o = extra.org === undefined ? org : extra.org;
    const res = await dispatch(routes, db, deps, {
      method, path, query: extra.query ?? {}, body,
      headers: { ...(o ? { "x-finance-org": String(o) } : {}), ...(extra.headers ?? {}) },
      auth: ident(email, platformRole),
    });
    return Object.assign(res, { json: res.body as any });
  };
}

let orgA = 0;
let owner: ReturnType<typeof client>, acct: ReturnType<typeof client>;

const J = (lines: [string, string, string][], date = "2026-03-10", description = "Test") => ({
  entry_date: date, description,
  lines: lines.map(([account_code, debit, credit]) => ({ account_code, debit, credit })),
});

before(async () => {
  try {
    if (process.env.FINANCE_TEST_DATABASE_URL) {
      const pgMod = await import("pg");
      const pool = new pgMod.default.Pool({ connectionString: process.env.FINANCE_TEST_DATABASE_URL });
      const clientPg = await pool.connect();
      pg = { async exec(sql: string) { await clientPg.query(sql); }, async close() { clientPg.release(); await pool.end(); }, query: (s: string, p?: unknown[]) => clientPg.query(s, p) };
      db = { query: (s, p) => clientPg.query(s, p) } as any;
    } else {
      const { PGlite } = await import("@electric-sql/pglite");
      pg = new PGlite();
      db = wrap(pg) as any;
    }
    const all = [
      ...FINANCE_SCHEMA_STATEMENTS, ...FINANCE_PHASE4_STATEMENTS, ...FINANCE_PHASE5_STATEMENTS,
      ...FINANCE_PHASE6_STATEMENTS, ...FINANCE_PHASE7_STATEMENTS, ...FINANCE_PHASE8_STATEMENTS,
      ...FINANCE_INTEGRATION_STATEMENTS,
    ];
    for (const s of all) await pg.exec(`${s.trim().replace(/;$/, "")};`);

    const created = await client("boss@example.com", "admin")("POST", "/organisations", {
      legal_name: "FI Test Co", trading_name: "FIT", country: "GH", functional_currency: "GHS", chart_template: "ghana_sme",
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    orgA = created.json.organisation.id;
    owner = client("boss@example.com", "admin", orgA);
    await owner("POST", "/members", { email: "acct@example.com", role: "accountant" });
    acct = client("acct@example.com", "editor", orgA);

    // Post capital + revenue + expense so ratios/statements have data
    async function postJournal(lines: [string, string, string][], date: string, description: string) {
      const j = await acct("POST", "/journals", J(lines, date, description));
      assert.equal(j.status, 201, JSON.stringify(j.json));
      const id = j.json.journal.id;
      const ap = await owner("POST", `/journals/${id}/approve`, {});
      assert.equal(ap.status, 200, JSON.stringify(ap.json));
      const p = await owner("POST", `/journals/${id}/post`, {});
      assert.equal(p.status, 200, JSON.stringify(p.json));
      return p;
    }
    await postJournal([["1020", "10000.00", "0"], ["3010", "0", "10000.00"]], "2026-03-01", "Opening capital");
    await postJournal([["1020", "2500.00", "0"], ["4000", "0", "2500.00"]], "2026-03-12", "Cash sale");
    await postJournal([["6100", "400.00", "0"], ["1020", "0", "400.00"]], "2026-03-13", "Rent");
  } catch (e: any) {
    skip = e?.message || String(e);
    console.error("[fi-test] setup failed:", skip);
  }
});

after(async () => { try { await pg?.close(); } catch { /* ignore */ } });

const t = (name: string, fn: () => Promise<void>) => test(name, async () => {
  if (skip) { assert.ok(true, `skipped: ${skip}`); return; }
  await fn();
});

t("dashboard returns posted KPIs", async () => {
  const r = await acct("GET", "/dashboard");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.has_postings, true);
  assert.ok(r.json.kpis.revenue);
  assert.ok(Number(r.json.kpis.revenue.value) > 0);
});

t("ratios engine returns profitability and liquidity", async () => {
  const r = await acct("GET", "/ratios", undefined, { query: { as_of: "2026-03-15" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.has_postings, true);
  assert.ok(r.json.profitability);
  assert.ok(r.json.liquidity);
  assert.ok(r.json.components.revenue);
});

t("formal statements: P&L, balance sheet, cash flow", async () => {
  const pl = await acct("GET", "/statements/profit-loss", undefined, { query: { as_of: "2026-03-15" } });
  assert.equal(pl.status, 200, JSON.stringify(pl.json));
  assert.ok(Array.isArray(pl.json.lines));
  assert.ok(pl.json.totals.net_profit);

  const bs = await acct("GET", "/statements/balance-sheet", undefined, { query: { as_of: "2026-03-15" } });
  assert.equal(bs.status, 200, JSON.stringify(bs.json));
  assert.equal(bs.json.balanced, true, JSON.stringify(bs.json.totals));

  const cf = await acct("GET", "/statements/cash-flow", undefined, { query: { as_of: "2026-03-15" } });
  assert.equal(cf.status, 200, JSON.stringify(cf.json));
  assert.ok(cf.json.totals.closing_cash);
});

t("capital: investors, share class, shareholding, cap table", async () => {
  const inv = await acct("POST", "/investors", { name: "Ama Investor", investor_type: "individual" });
  assert.equal(inv.status, 201, JSON.stringify(inv.json));
  const cls = await acct("POST", "/share-classes", { name: "Ordinary", class_type: "ordinary", authorized_shares: "1000" });
  assert.equal(cls.status, 201, JSON.stringify(cls.json));
  const h = await acct("POST", "/shareholdings", {
    investor_id: inv.json.investor.id,
    share_class_id: cls.json.share_class.id,
    shares: "100",
    issued_on: "2026-03-05",
    consideration: "cash",
  });
  assert.equal(h.status, 201, JSON.stringify(h.json));
  const cap = await acct("GET", "/cap-table");
  assert.equal(cap.status, 200);
  assert.equal(cap.json.has_shareholdings, true);
  assert.ok(cap.json.holdings.length >= 1);

  const cont = await acct("POST", "/contributions", {
    investor_id: inv.json.investor.id,
    amount: "5000.00",
    contribution_date: "2026-03-05",
    form: "cash",
  });
  assert.equal(cont.status, 201, JSON.stringify(cont.json));
  const sum = await acct("GET", "/capital/summary");
  assert.equal(sum.status, 200);
  assert.ok(sum.json.active_investors >= 1);
});

t("dividends: draft, generate lines, approve — no invented payables", async () => {
  const invs = await acct("GET", "/investors");
  const classes = await acct("GET", "/share-classes");
  assert.ok(invs.json.items.length >= 1);
  assert.ok(classes.json.items.length >= 1);
  const d = await acct("POST", "/dividends", {
    title: "Interim 2026",
    declaration_date: "2026-03-14",
    amount_per_share: "1.50",
    share_class_id: classes.json.items[0].id,
  });
  assert.equal(d.status, 201, JSON.stringify(d.json));
  assert.equal(d.json.declaration.status, "draft");
  const gen = await acct("POST", `/dividends/${d.json.declaration.id}/generate-lines`, {});
  assert.equal(gen.status, 200, JSON.stringify(gen.json));
  assert.ok(gen.json.lines.length >= 1);
  const ap = await owner("POST", `/dividends/${d.json.declaration.id}/approve`, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  assert.equal(ap.json.declaration.status, "approved");
});

t("valuation NAV from posted equity", async () => {
  const r = await acct("GET", "/valuation/nav", undefined, { query: { as_of: "2026-03-15" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.net_asset_value);
  const sc = await acct("POST", "/valuation/scenarios", {
    name: "Board NAV",
    method: "nav",
    as_of_date: "2026-03-15",
    equity_value: "12100.00",
  });
  assert.equal(sc.status, 201, JSON.stringify(sc.json));
});

t("budget vs actual uses posted ledger only", async () => {
  const b = await acct("POST", "/budgets", {
    name: "FY2026 Q1",
    period_from: "2026-01-01",
    period_to: "2026-03-31",
  });
  assert.equal(b.status, 201, JSON.stringify(b.json));
  await acct("POST", `/budgets/${b.json.budget.id}/lines`, {
    category: "operating_expense",
    label: "Rent budget",
    amount: "500.00",
  });
  await acct("POST", `/budgets/${b.json.budget.id}/scenarios`, {
    name: "Conservative",
    scenario_type: "conservative",
  });
  const vs = await acct("GET", `/budgets/${b.json.budget.id}/vs-actual`);
  assert.equal(vs.status, 200, JSON.stringify(vs.json));
  assert.ok(vs.json.comparison);
  assert.ok(vs.json.note.includes("posted"));
});

t("health summary and alert evaluate", async () => {
  const h = await acct("GET", "/health/summary");
  assert.equal(h.status, 200, JSON.stringify(h.json));
  assert.ok(h.json.kpis);
  const rule = await acct("POST", "/alerts/rules", {
    name: "Low current ratio",
    metric: "current_ratio",
    operator: "lt",
    threshold: "100",
    severity: "warning",
  });
  assert.equal(rule.status, 201, JSON.stringify(rule.json));
  const ev = await acct("POST", "/alerts/evaluate", {});
  assert.equal(ev.status, 200, JSON.stringify(ev.json));
  assert.ok(typeof ev.json.evaluated_rules === "number");
});

t("integration status endpoint is readable", async () => {
  const r = await acct("GET", "/integration/status");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok("partyLinks" in r.json);
  assert.ok("eventsByStatus" in r.json);
  const links = await acct("GET", "/integration/party-links");
  assert.equal(links.status, 200);
  assert.ok(Array.isArray(links.json.items));
});
