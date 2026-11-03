/**
 * CINTEXA Finance Financial Intelligence — Cloudflare Pages Function (/api/fi/*)
 * Zero third-party API keys.
 *
 * SINGLE SOURCE OF TRUTH: every figure is derived from the CINTEXA Finance ledger
 * (D1 binding FIN_DB: fin_accounts / fin_journals / fin_journal_lines — integer MINOR units).
 * FI never keeps its own books. Manual entries posted here are forwarded to Finance.
 * Only org display settings, FX rates and alert acknowledgements live in isolate memory.
 */
// Note: CF bundler may not resolve frontend path; inline minimal engine mirror for Worker isolation.

type Minor = number;
type LineType = "asset" | "liability" | "equity" | "revenue" | "expense" | "cogs";

interface Line { accountCode: string; accountName: string; type: LineType; debit: Minor; credit: Minor }
interface Entry { id: string; date: string; currency: string; lines: Line[]; status: "posted" | "draft" | "void"; memo?: string }

interface FxRate { id: string; base: string; quote: string; rate: number; effectiveDate: string; source: string }
interface Org { id: string; name: string; currency: string; createdAt: string }

interface Store {
  org: Org;
  entries: Entry[];
  fx: FxRate[];
  alertsAck: string[];
}

const defaultStore = (): Store => ({
  org: { id: "default", name: "Organisation", currency: "GHS", createdAt: new Date().toISOString() },
  entries: [],
  fx: [],
  alertsAck: [],
});

let memory: Store = defaultStore();
/** Demo overlay — never mixed into the ledger; merged only when ?includeDemo=1 */
let demoEntries: Entry[] = [];

/** Map a Finance account to the FI statement type (keeps FI profit identical to Finance profit). */
function fiType(type: string, subtype?: string | null): LineType {
  if (subtype === "cos" || subtype === "discount_received") return "cogs"; // discount received reduces cost
  if (subtype === "discount_allowed") return "revenue"; // contra-revenue: debit reduces revenue
  if (type === "asset" || type === "liability" || type === "equity" || type === "revenue" || type === "expense") return type;
  return "expense";
}

type LedgerResult = { entries: Entry[]; source: "finance-d1" | "finance-api" | "unavailable"; error?: string };

/** Load posted Finance journals as FI entries. Amounts are already minor units — never rescaled here. */
async function loadLedger(env: Env, origin: string): Promise<LedgerResult> {
  try {
    if (env.FIN_DB) {
      const accRows = (await env.FIN_DB.prepare("SELECT code, name, type, subtype FROM fin_accounts").all()).results || [];
      const acc = new Map<string, any>(accRows.map((r: any) => [String(r.code), r]));
      const rows = (await env.FIN_DB.prepare(
        `SELECT j.id AS jid, j.entry_date, j.currency, j.description, l.account_code, l.debit, l.credit
         FROM fin_journals j JOIN fin_journal_lines l ON l.journal_id = j.id
         WHERE j.status = 'posted' ORDER BY j.entry_date, j.number`,
      ).all()).results || [];
      const byId = new Map<string, Entry>();
      for (const r of rows as any[]) {
        let e = byId.get(r.jid);
        if (!e) {
          e = { id: r.jid, date: String(r.entry_date), currency: r.currency || "GHS", lines: [], status: "posted", memo: r.description || undefined };
          byId.set(r.jid, e);
        }
        const a = acc.get(String(r.account_code));
        e.lines.push({
          accountCode: String(r.account_code),
          accountName: a?.name || String(r.account_code),
          type: fiType(a?.type || "expense", a?.subtype),
          debit: Number(r.debit) || 0,
          credit: Number(r.credit) || 0,
        });
      }
      return { entries: [...byId.values()], source: "finance-d1" };
    }
    // No D1 binding (local/dev): read the Finance API in the same deployment.
    const [jr, ar] = await Promise.all([fetch(`${origin}/api/finance/journals`), fetch(`${origin}/api/finance/accounts`)]);
    if (!jr.ok || !ar.ok) throw new Error(`Finance API unavailable (${jr.status}/${ar.status})`);
    const journals = ((await jr.json()) as any).items || [];
    const accounts = new Map<string, any>((((await ar.json()) as any).items || []).map((a: any) => [String(a.code), a]));
    const entries: Entry[] = journals.filter((j: any) => j.status === "posted").map((j: any) => ({
      id: j.id, date: String(j.entryDate), currency: j.currency || "GHS", status: "posted" as const, memo: j.description || undefined,
      lines: (j.lines || []).map((l: any) => {
        const a = accounts.get(String(l.accountCode));
        return { accountCode: String(l.accountCode), accountName: a?.name || String(l.accountCode), type: fiType(a?.type || "expense", a?.subtype), debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 };
      }),
    }));
    return { entries, source: "finance-api" };
  } catch (e: any) {
    return { entries: [], source: "unavailable", error: String(e?.message || e) };
  }
}

type Env = { FIN_DB?: D1Database; FI_DB?: D1Database; API_ORIGIN?: string };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,x-api-key",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data ?? {}), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

async function readJson(request: Request): Promise<any> {
  try {
    const t = await request.text();
    return t?.trim() ? JSON.parse(t) : {};
  } catch {
    return {};
  }
}

function inPeriod(date: string, from?: string, to?: string) {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function netByType(entries: Entry[], type: LineType, from?: string, to?: string): Minor {
  let n = 0;
  for (const e of entries) {
    if (e.status !== "posted") continue;
    if (!inPeriod(e.date, from, to)) continue;
    for (const l of e.lines) {
      if (l.type !== type) continue;
      if (type === "asset" || type === "expense" || type === "cogs") n += l.debit - l.credit;
      else n += l.credit - l.debit;
    }
  }
  return n;
}

function pnl(entries: Entry[], from?: string, to?: string) {
  const revenue = netByType(entries, "revenue", from, to);
  const cogs = netByType(entries, "cogs", from, to);
  const operatingExpenses = netByType(entries, "expense", from, to);
  const grossProfit = revenue - cogs;
  const operatingProfit = grossProfit - operatingExpenses;
  const netProfit = operatingProfit;
  const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 10000) / 100);
  return {
    revenue, cogs, grossProfit, operatingExpenses, operatingProfit, netProfit,
    grossMarginPct: pct(grossProfit, revenue),
    operatingMarginPct: pct(operatingProfit, revenue),
    netMarginPct: pct(netProfit, revenue),
    formula: {
      grossProfit: "revenue − cogs",
      operatingProfit: "grossProfit − operatingExpenses",
      netProfit: "operatingProfit",
    },
  };
}

function balanceSheet(entries: Entry[], to?: string) {
  const assets = netByType(entries, "asset", undefined, to);
  const liabilities = netByType(entries, "liability", undefined, to);
  const equityAccounts = netByType(entries, "equity", undefined, to);
  const { netProfit } = pnl(entries, undefined, to);
  const equity = equityAccounts + netProfit;
  const balanced = assets === liabilities + equity;
  return { assets, liabilities, equity, balanced, equationCheck: `A=${assets} L=${liabilities} E=${equity} ${balanced ? "OK" : "IMBALANCE"}` };
}

function health(entries: Entry[]) {
  const posted = entries.filter((e) => e.status === "posted");
  if (!posted.length) return { score: null, insufficientData: true, components: [], method: "Requires posted entries" };
  const p = pnl(posted);
  const bs = balanceSheet(posted);
  const currentRatio = bs.liabilities === 0 ? null : Math.round((bs.assets / bs.liabilities) * 100) / 100;
  const components = [
    { key: "liquidity", weight: 0.35, score: currentRatio == null ? null : Math.max(0, Math.min(100, currentRatio * 40)), note: "current ratio scaled" },
    { key: "profitability", weight: 0.35, score: p.netMarginPct == null ? null : Math.max(0, Math.min(100, 50 + p.netMarginPct * 2)), note: "net margin map" },
    { key: "solvency", weight: 0.3, score: bs.equity === 0 ? null : Math.max(0, Math.min(100, 100 - (bs.liabilities / bs.equity) * 25)), note: "debt/equity inverse" },
  ];
  const usable = components.filter((c) => c.score != null) as { key: string; weight: number; score: number; note: string }[];
  if (!usable.length) return { score: null, insufficientData: true, components, method: "Weighted components" };
  const w = usable.reduce((s, c) => s + c.weight, 0);
  return { score: Math.round(usable.reduce((s, c) => s + c.score * c.weight, 0) / w), insufficientData: false, components, method: "Weighted average" };
}

function monthlyRevenue(entries: Entry[]) {
  const map = new Map<string, number>();
  for (const e of entries) {
    if (e.status !== "posted") continue;
    const m = e.date.slice(0, 7);
    const rev = e.lines.filter((l) => l.type === "revenue").reduce((s, l) => s + (l.credit - l.debit), 0);
    map.set(m, (map.get(m) || 0) + rev);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([period, value]) => ({ period, value }));
}

function linearForecast(series: { period: string; value: number }[], ahead: number) {
  if (series.length < 2) return [];
  const n = series.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += series[i]!.value; sumXY += i * series[i]!.value; sumXX += i * i;
  }
  const den = n * sumXX - sumX * sumX;
  if (den === 0) return [];
  const slope = (n * sumXY - sumX * sumY) / den;
  const intercept = (sumY - slope * sumX) / n;
  const out = [];
  for (let k = 1; k <= ahead; k++) {
    out.push({ period: `+${k}`, value: Math.round(intercept + slope * (n - 1 + k)), method: "OLS linear regression" });
  }
  return out;
}

function buildAlerts(entries: Entry[], currency: string) {
  const p = pnl(entries);
  const bs = balanceSheet(entries);
  const alerts: { id: string; level: string; title: string; evidence: string }[] = [];
  if (bs.assets - bs.liabilities < 0) alerts.push({ id: "neg-wc", level: "critical", title: "Negative working capital", evidence: `assets ${bs.assets} − liabilities ${bs.liabilities}` });
  if (p.netProfit < 0) alerts.push({ id: "neg-profit", level: "warning", title: "Negative net profit (period)", evidence: `net ${p.netProfit} ${currency} minor units` });
  if (bs.assets === 0 && entries.filter((e) => e.status === "posted").length === 0) {
    alerts.push({ id: "no-data", level: "info", title: "No posted entries", evidence: "Post journals via POST /api/fi/entries to populate analytics" });
  }
  return alerts;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const raw = params.path;
  const parts = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const path = parts.join("/");
  const url = new URL(request.url);
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;

  const includeDemo = url.searchParams.get("includeDemo") === "1";
  const ledger = await loadLedger(env, url.origin);
  const entries: Entry[] = includeDemo ? [...ledger.entries, ...demoEntries] : ledger.entries;
  const ledgerInfo = { source: ledger.source, error: ledger.error || null, postedJournals: ledger.entries.length };

  if (path === "" || path === "dashboard") {
    const p = pnl(entries, from, to);
    const bs = balanceSheet(entries, to);
    const h = health(entries);
    const alerts = buildAlerts(entries, memory.org.currency).filter((a) => !memory.alertsAck.includes(a.id));
    return json({
      org: memory.org,
      currency: memory.org.currency,
      asOf: to || new Date().toISOString().slice(0, 10),
      hasPostings: entries.some((e) => e.status === "posted"),
      pnl: p,
      balanceSheet: bs,
      health: h,
      alerts,
      ledger: ledgerInfo,
      engine: "native-fi-v2-finance-ledger",
    });
  }

  if (path === "pnl") return json({ currency: memory.org.currency, ...pnl(entries, from, to) });
  if (path === "balance-sheet") return json({ currency: memory.org.currency, ...balanceSheet(entries, to) });
  if (path === "ratios") {
    const bs = balanceSheet(entries, to);
    const p = pnl(entries, from, to);
    const currentRatio = bs.liabilities === 0 ? null : Math.round((bs.assets / bs.liabilities) * 100) / 100;
    return json({
      currency: memory.org.currency,
      currentRatio,
      workingCapital: bs.assets - bs.liabilities,
      debtToEquity: bs.equity === 0 ? null : Math.round((bs.liabilities / bs.equity) * 100) / 100,
      netMarginPct: p.netMarginPct,
      grossMarginPct: p.grossMarginPct,
      formulas: {
        currentRatio: "assets / liabilities",
        workingCapital: "assets − liabilities",
        debtToEquity: "liabilities / equity",
        netMarginPct: "netProfit / revenue × 100",
      },
    });
  }

  if (path === "health") return json(health(entries));
  if (path === "forecast") {
    const series = monthlyRevenue(entries);
    const ahead = Math.min(12, Math.max(1, Number(url.searchParams.get("ahead") || 3)));
    return json({
      series,
      forecast: linearForecast(series, ahead),
      note: series.length < 2 ? "Need at least two months of posted revenue for linear forecast." : "OLS on monthly revenue; not a guarantee.",
    });
  }

  if (path === "scenarios" && request.method === "POST") {
    const body = await readJson(request);
    const base = pnl(entries, from, to);
    const rg = Number(body.revenueGrowthPct) || 0;
    const eg = Number(body.expenseGrowthPct) || 0;
    const revenue = Math.round(base.revenue * (1 + rg / 100));
    const cogs = Math.round(base.cogs * (1 + rg / 100));
    const operatingExpenses = Math.round(base.operatingExpenses * (1 + eg / 100));
    const grossProfit = revenue - cogs;
    const operatingProfit = grossProfit - operatingExpenses;
    return json({
      base,
      scenario: {
        revenue, cogs, grossProfit, operatingExpenses, operatingProfit, netProfit: operatingProfit,
        assumptions: { revenueGrowthPct: rg, expenseGrowthPct: eg },
        note: "Scenario does not modify stored ledger entries.",
      },
    });
  }

  if (path === "entries" && request.method === "GET") {
    return json({ items: entries, currency: memory.org.currency, ledger: ledgerInfo });
  }

  if (path === "entries" && request.method === "POST") {
    // Rebuilt: FI no longer keeps a private ledger. The entry is validated here and posted to Finance.
    const body = await readJson(request);
    const lines: any[] = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length) return json({ error: "lines required" }, 400);
    const debit = lines.reduce((t, l) => t + (Number(l.debit) || 0), 0);
    const credit = lines.reduce((t, l) => t + (Number(l.credit) || 0), 0);
    if (Math.round(debit) !== Math.round(credit)) return json({ error: "Entry must balance (debits = credits)", debit, credit }, 400);
    const res = await fetch(`${url.origin}/api/finance/journals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        journalType: "general",
        entryDate: body.date,
        description: body.memo || "Entry posted from Financial Intelligence",
        currency: body.currency || memory.org.currency,
        sourceModule: "fi",
        post: body.status !== "draft",
        // amounts are MINOR units, identical to the Finance contract
        lines: lines.map((l) => ({ accountCode: String(l.accountCode || ""), memo: l.accountName, debit: Math.round(Number(l.debit) || 0), credit: Math.round(Number(l.credit) || 0) })),
      }),
    });
    const out: any = await res.json().catch(() => ({}));
    return json(res.ok ? { entry: out.journal, ledger: "finance" } : out, res.status);
  }

  if (path === "org" && request.method === "GET") return json(memory.org);
  if (path === "org" && request.method === "PUT") {
    const body = await readJson(request);
    if (body.name) memory.org.name = String(body.name).slice(0, 200);
    if (body.currency) memory.org.currency = String(body.currency).slice(0, 8).toUpperCase();
    return json(memory.org);
  }

  if (path === "fx" && request.method === "GET") return json({ items: memory.fx });
  if (path === "fx" && request.method === "POST") {
    const body = await readJson(request);
    const rate = Number(body.rate);
    if (!body.base || !body.quote || !Number.isFinite(rate) || rate <= 0) return json({ error: "base, quote, positive rate required" }, 400);
    const row: FxRate = {
      id: crypto.randomUUID(),
      base: String(body.base).toUpperCase(),
      quote: String(body.quote).toUpperCase(),
      rate,
      effectiveDate: String(body.effectiveDate || new Date().toISOString().slice(0, 10)),
      source: String(body.source || "manual"),
    };
    memory.fx.push(row);
    return json({ rate: row }, 201);
  }

  if (path === "alerts/ack" && request.method === "POST") {
    const body = await readJson(request);
    if (body.id) memory.alertsAck.push(String(body.id));
    return json({ ok: true });
  }

  if (path === "seed-demo" && request.method === "POST") {
    // Deterministic demo pack — clearly labelled, not live market data
    if (demoEntries.length) return json({ ok: true, message: "Demo overlay already loaded" });
    const cur = memory.org.currency;
    const mk = (date: string, lines: Line[], memo: string): Entry => ({
      id: crypto.randomUUID(), date, currency: cur, lines, status: "posted", memo,
    });
    demoEntries.push(
      mk("2026-01-15", [
        { accountCode: "1000", accountName: "Cash", type: "asset", debit: 5000000, credit: 0 },
        { accountCode: "3000", accountName: "Capital", type: "equity", debit: 0, credit: 5000000 },
      ], "DEMO_SEED"),
      mk("2026-02-10", [
        { accountCode: "1100", accountName: "Receivables", type: "asset", debit: 1200000, credit: 0 },
        { accountCode: "4000", accountName: "Sales", type: "revenue", debit: 0, credit: 1200000 },
      ], "DEMO_SEED"),
      mk("2026-02-28", [
        { accountCode: "5000", accountName: "Operating expenses", type: "expense", debit: 450000, credit: 0 },
        { accountCode: "1000", accountName: "Cash", type: "asset", debit: 0, credit: 450000 },
      ], "DEMO_SEED"),
      mk("2026-03-12", [
        { accountCode: "1100", accountName: "Receivables", type: "asset", debit: 900000, credit: 0 },
        { accountCode: "4000", accountName: "Sales", type: "revenue", debit: 0, credit: 900000 },
      ], "DEMO_SEED"),
    );
    return json({ ok: true, message: "Demo overlay loaded in memory only. It is NOT written to the Finance ledger; view it with ?includeDemo=1. Not live market data." });
  }

  if (path === "meta") {
    return json({
      name: "CINTEXA Finance Financial Intelligence",
      version: "1.0.0",
      storage: "finance-ledger",
      ledger: ledgerInfo,
      engine: "native-fi-v2-finance-ledger",
    });
  }

  return json({ error: "Not found", path }, 404);
};
