import { route, ok, type Route } from "../core/route";
import { audit } from "../core/audit";
import { V, asObject, ymd } from "../core/validate";
import { conflict, forbidden, notFound, unprocessable } from "../core/errors";
import { fromDb, formatMoney } from "../core/money";
import { hasPermission } from "../core/rbac";
import { insertJournal, postJournal, loadPeriod, type Who, type LineIn } from "./journals";
import type { Q } from "../core/types";

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Creates a fiscal year of 12 monthly periods starting on the first day of `startMonth` in `startYear`. */
export async function createFiscalYear(q: Q, orgId: number, startYear: number, startMonth: number) {
  const endYear = startMonth === 1 ? startYear : startYear + 1; const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const name = startMonth === 1 ? `FY${startYear}` : `FY${startYear}-${endYear}`;
  const start = `${startYear}-${pad(startMonth)}-01`; const end = `${endYear}-${pad(endMonth)}-${pad(lastDay(endYear, endMonth))}`;
  const clash = (await q.query("SELECT 1 FROM finance_fiscal_years WHERE org_id = $1 AND start_date <= $3::date AND end_date >= $2::date", [orgId, start, end])).rowCount;
  if (clash) throw conflict("That fiscal year overlaps an existing one", "fiscal_year_overlap");
  const fy = (await q.query<any>("INSERT INTO finance_fiscal_years (org_id, name, start_date, end_date) VALUES ($1,$2,$3,$4) RETURNING id, name, start_date, end_date, status", [orgId, name, start, end])).rows[0];
  let y = startYear; let m = startMonth;
  for (let i = 0; i < 12; i++) {
    await q.query("INSERT INTO finance_periods (org_id, fiscal_year_id, name, start_date, end_date) VALUES ($1,$2,$3,$4,$5)", [orgId, fy.id, `${MON[m - 1]} ${y}`, `${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(lastDay(y, m))}`]);
    m++; if (m > 12) { m = 1; y++; }
  }
  return fy;
}

const years = route("GET", "/fiscal-years", { perm: "finance:read" }, async (c) => {
  const fys = (await c.q.query<any>("SELECT id, name, start_date, end_date, status, closing_journal_id FROM finance_fiscal_years WHERE org_id = $1 ORDER BY start_date", [c.org.orgId])).rows;
  const ps = (await c.q.query<any>("SELECT id, fiscal_year_id, name, start_date, end_date, status FROM finance_periods WHERE org_id = $1 ORDER BY start_date", [c.org.orgId])).rows;
  return ok({ items: fys.map((f: any) => ({ ...f, periods: ps.filter((p: any) => p.fiscal_year_id === f.id) })) });
});

const addYear = route("POST", "/fiscal-years", { perm: "finance:admin" }, async (c) => {
  const v = new V(asObject(c.body)); const sy = v.int("start_year", { min: 1990, max: 2200 }); v.done();
  const startMonth = Number((await c.q.query<any>("SELECT fiscal_year_start_month AS m FROM finance_organisations WHERE id = $1", [c.org.orgId])).rows[0].m);
  const fy = await createFiscalYear(c.q, c.org.orgId, sy!, startMonth);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "fiscal_year.create", entityType: "fiscal_year", entityId: fy.id, after: fy, requestId: c.reqId });
  return ok({ fiscal_year: fy }, 201);
});

const periods = route("GET", "/periods", { perm: "finance:read" }, async (c) =>
  ok({ items: (await c.q.query<any>("SELECT id, fiscal_year_id, name, start_date, end_date, status, status_changed_at FROM finance_periods WHERE org_id = $1 ORDER BY start_date", [c.org.orgId])).rows }));

const setStatus = route("POST", "/periods/:id/status", { perm: "finance:admin" }, async (c) => {
  const v = new V(asObject(c.body)); const status = v.str("status", { oneOf: ["open", "soft_closed", "hard_closed"] }); const reason = v.str("reason", { optional: true, max: 500 }); v.done();
  const p = (await c.q.query<any>("SELECT p.id, p.name, p.status, f.status AS fy_status FROM finance_periods p JOIN finance_fiscal_years f ON f.id = p.fiscal_year_id AND f.org_id = p.org_id WHERE p.id = $1 AND p.org_id = $2 FOR UPDATE OF p", [c.params.id, c.org.orgId])).rows[0];
  if (!p) throw notFound("Period");
  if (p.status === status) return ok({ period: p });
  const reopening = (p.status === "hard_closed" && status !== "hard_closed") || (p.status === "soft_closed" && status === "open");
  if (reopening) {
    if (!reason || reason.length < 5) throw unprocessable("Reopening a closed period needs a reason of at least 5 characters", "reason_required");
    if (p.fy_status === "closed") throw conflict("The fiscal year is closed; its periods cannot be reopened", "fiscal_year_closed");
    if (p.status === "hard_closed" && !hasPermission(c.org.role, "period:override")) throw forbidden("Reopening a hard-closed period needs the period:override permission", "override_required");
  }
  if (status === "hard_closed") {
    const n = Number((await c.q.query<any>("SELECT count(*)::int AS n FROM finance_journals WHERE org_id = $1 AND period_id = $2 AND status IN ('draft','approved')", [c.org.orgId, p.id])).rows[0].n);
    if (n) throw conflict(`${n} unposted journal(s) remain in ${p.name}; post or delete them before hard-closing`, "unposted_journals", { count: n });
  }
  const after = (await c.q.query<any>("UPDATE finance_periods SET status = $3, status_changed_by = $4, status_changed_at = now() WHERE id = $1 AND org_id = $2 RETURNING id, name, status, start_date, end_date", [p.id, c.org.orgId, status, c.actor.sub])).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "period.status", entityType: "period", entityId: p.id, summary: `${p.name}: ${p.status} -> ${status}${reason ? ` (${reason})` : ""}`, before: { status: p.status }, after: { status }, requestId: c.reqId });
  return ok({ period: after });
});

/** Year-end close: zero revenue/expense accounts into Retained Earnings with a closing journal, then hard-close the year. */
const closeYear = route("POST", "/fiscal-years/:id/close", { perm: "finance:admin" }, async (c) => {
  const fy = (await c.q.query<any>("SELECT id, name, start_date, end_date, status FROM finance_fiscal_years WHERE id = $1 AND org_id = $2 FOR UPDATE", [c.params.id, c.org.orgId])).rows[0];
  if (!fy) throw notFound("Fiscal year");
  if (fy.status === "closed") throw conflict("This fiscal year is already closed", "fiscal_year_closed");
  const unposted = Number((await c.q.query<any>("SELECT count(*)::int AS n FROM finance_journals j JOIN finance_periods p ON p.id = j.period_id AND p.org_id = j.org_id WHERE j.org_id = $1 AND p.fiscal_year_id = $2 AND j.status IN ('draft','approved')", [c.org.orgId, fy.id])).rows[0].n);
  if (unposted) throw conflict(`${unposted} unposted journal(s) remain in ${fy.name}`, "unposted_journals", { count: unposted });
  const re = (await c.q.query<any>("SELECT id FROM finance_accounts WHERE org_id = $1 AND subtype = 'retained_earnings' AND is_active ORDER BY code LIMIT 1", [c.org.orgId])).rows[0];
  if (!re) throw unprocessable("No active Retained Earnings account (subtype retained_earnings) is configured", "retained_earnings_missing");
  const bal = (await c.q.query<any>(
    `SELECT a.id, a.type, COALESCE(SUM(e.debit),0) AS d, COALESCE(SUM(e.credit),0) AS c FROM finance_accounts a
       JOIN finance_ledger_entries e ON e.account_id = a.id AND e.org_id = a.org_id AND e.entry_date BETWEEN $2::date AND $3::date AND e.journal_type <> 'closing'
      WHERE a.org_id = $1 AND a.type IN ('revenue','expense') GROUP BY a.id, a.type HAVING SUM(e.debit) <> SUM(e.credit)`, [c.org.orgId, ymd(fy.start_date), ymd(fy.end_date)])).rows;
  const who: Who = { orgId: c.org.orgId, sub: c.actor.sub, label: c.actor.label };
  let closing: any = null; let net = 0n;
  if (bal.length) {
    const lines: LineIn[] = []; let toRe = 0n; // credit to retained earnings = profit
    for (const b of bal) {
      const diff = fromDb(b.d) - fromDb(b.c); // >0: debit balance -> credit to close
      if (diff > 0n) lines.push({ account_id: Number(b.id), debit: 0n, credit: diff, description: `Close ${fy.name}` }); else lines.push({ account_id: Number(b.id), debit: -diff, credit: 0n, description: `Close ${fy.name}` });
      toRe -= diff;
    }
    net = toRe;
    if (toRe > 0n) lines.push({ account_id: Number(re.id), debit: 0n, credit: toRe, description: `Net profit ${fy.name}` }); else if (toRe < 0n) lines.push({ account_id: Number(re.id), debit: -toRe, credit: 0n, description: `Net loss ${fy.name}` });
    const endDate = ymd(fy.end_date);
    const period = await loadPeriod(c.q, c.org.orgId, endDate);
    const j = await insertJournal(c.q, who, { type: "closing", date: endDate, description: `Year-end closing entry ${fy.name}`, lines, sourceModule: "finance.year_end", sourceRef: String(fy.id) }, period);
    closing = await postJournal(c.q, who, Number(j.id), c.now, true);
    await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "journal.post", entityType: "journal", entityId: closing.id, summary: `Posted closing journal ${closing.reference}`, requestId: c.reqId, sourceModule: "finance.year_end" });
  }
  await c.q.query("UPDATE finance_periods SET status = 'hard_closed', status_changed_by = $3, status_changed_at = now() WHERE org_id = $1 AND fiscal_year_id = $2", [c.org.orgId, fy.id, c.actor.sub]);
  await c.q.query("UPDATE finance_fiscal_years SET status = 'closed', closing_journal_id = $3, closed_by = $4, closed_at = now() WHERE id = $1 AND org_id = $2", [fy.id, c.org.orgId, closing?.id ?? null, c.actor.sub]);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "fiscal_year.close", entityType: "fiscal_year", entityId: fy.id, summary: `Closed ${fy.name}; net result ${formatMoney(net)}`, after: { closing_journal: closing?.reference ?? null, net_result: formatMoney(net) }, requestId: c.reqId });
  return ok({ fiscal_year: { ...fy, status: "closed" }, closing_journal: closing?.reference ?? null, net_result: formatMoney(net) });
});

export const periodRoutes: Route[] = [years, addYear, periods, setStatus, closeYear];
