/** Financial Intelligence Phase 8 — budgets/scenarios and health alerts. */
import { route, ok, type Route, type Ctx } from "../core/route";
import { audit } from "../core/audit";
import { V, asObject, qstr, todayIn, ymd } from "../core/validate";
import { badRequest, conflict, notFound, unprocessable } from "../core/errors";
import { formatMoney, fromDb } from "../core/money";
import { nextNumber } from "./journals";

const BUD = "id, code, name, fiscal_year_id, period_from, period_to, currency, status, notes, created_by, created_at, updated_at";
const BLINE = "id, budget_id, account_id, category, label, amount, notes, created_at, updated_at";
const SCEN = "id, budget_id, code, name, scenario_type, adjustment_pct, notes, created_by, created_at, updated_at";
const RULE = "id, code, name, metric, operator, threshold, severity, is_active, notes, created_by, created_at, updated_at";
const EVT = "id, rule_id, metric, severity, title, message, observed_value, threshold_value, as_of_date, status, acknowledged_by, acknowledged_at, created_at";

const METRICS = ["current_ratio","quick_ratio","cash_ratio","net_margin_pct","gross_margin_pct","debt_to_equity","cash_balance","receivables","payables","working_capital","net_profit"] as const;
type Metric = (typeof METRICS)[number];

function balOf(row: { d: unknown; c: unknown; normal_balance?: string; type?: string }): bigint {
  const d = fromDb(row.d); const c = fromDb(row.c);
  const side = row.normal_balance ?? (row.type === "asset" || row.type === "expense" ? "debit" : "credit");
  return side === "debit" ? d - c : c - d;
}
function pctNum(n: bigint, d: bigint): number | null {
  if (d === 0n) return null;
  return Number(n) / Number(d) * 100;
}
function ratioNum(n: bigint, d: bigint): number | null {
  if (d === 0n) return null;
  return Number(n) / Number(d);
}

async function loadKpis(c: Ctx, asOf: string) {
  const org = (await c.q.query<any>("SELECT timezone, functional_currency FROM finance_organisations WHERE id = $1", [c.org.orgId])).rows[0];
  if (!org) throw badRequest("Organisation not found");
  const fy = (await c.q.query<any>("SELECT start_date FROM finance_fiscal_years WHERE org_id = $1 AND $2::date BETWEEN start_date AND end_date", [c.org.orgId, asOf])).rows[0];
  const fyStart = fy ? ymd(fy.start_date) : asOf;
  const balRows = (await c.q.query<any>(
    `SELECT a.type, a.category, a.subtype, a.normal_balance, COALESCE(SUM(e.debit),0) AS d, COALESCE(SUM(e.credit),0) AS c
       FROM finance_accounts a LEFT JOIN finance_ledger_entries e ON e.account_id = a.id AND e.org_id = a.org_id AND e.entry_date <= $2::date
      WHERE a.org_id = $1 GROUP BY a.type, a.category, a.subtype, a.normal_balance`, [c.org.orgId, asOf])).rows;
  const ytdRows = (await c.q.query<any>(
    `SELECT a.type, a.category, COALESCE(SUM(e.debit),0) AS d, COALESCE(SUM(e.credit),0) AS c
       FROM finance_ledger_entries e JOIN finance_accounts a ON a.id = e.account_id AND a.org_id = e.org_id
      WHERE e.org_id = $1 AND e.entry_date BETWEEN $2::date AND $3::date AND e.journal_type <> 'closing' AND a.type IN ('revenue','expense')
      GROUP BY a.type, a.category`, [c.org.orgId, fyStart, asOf])).rows;
  const sumBal = (pred: (r: any) => boolean) => balRows.filter(pred).reduce<bigint>((x, r) => x + balOf(r), 0n);
  const currentAssets = sumBal((r) => r.type === "asset" && r.category === "current_asset");
  const inventory = sumBal((r) => r.subtype === "inventory");
  const prepayments = sumBal((r) => r.subtype === "prepayment");
  const cash = sumBal((r) => ["cash","bank","mobile_money"].includes(r.subtype));
  const receivables = sumBal((r) => r.subtype === "accounts_receivable") - sumBal((r) => r.subtype === "contra_receivable");
  const currentLiabilities = sumBal((r) => r.type === "liability" && r.category === "current_liability");
  const totalLiabilities = sumBal((r) => r.type === "liability");
  const equity = sumBal((r) => r.type === "equity");
  const payables = sumBal((r) => r.subtype === "accounts_payable");
  const ytdCredit = (pred: (r: any) => boolean) => ytdRows.filter(pred).reduce<bigint>((x, r) => x + fromDb(r.c) - fromDb(r.d), 0n);
  const ytdDebit = (pred: (r: any) => boolean) => ytdRows.filter(pred).reduce<bigint>((x, r) => x + fromDb(r.d) - fromDb(r.c), 0n);
  const revenue = ytdCredit((r) => r.type === "revenue");
  const cogs = ytdDebit((r) => r.category === "cost_of_goods_sold");
  const totalExpenses = ytdDebit((r) => r.type === "expense");
  const grossProfit = revenue - cogs;
  const netProfit = revenue - totalExpenses;
  return {
    currency: org.functional_currency as string,
    as_of: asOf,
    current_ratio: ratioNum(currentAssets, currentLiabilities),
    quick_ratio: ratioNum(currentAssets - inventory - prepayments, currentLiabilities),
    cash_ratio: ratioNum(cash, currentLiabilities),
    net_margin_pct: pctNum(netProfit, revenue),
    gross_margin_pct: pctNum(grossProfit, revenue),
    debt_to_equity: ratioNum(totalLiabilities, equity),
    cash_balance: cash,
    receivables,
    payables,
    working_capital: currentAssets - currentLiabilities,
    net_profit: netProfit,
    revenue,
  };
}

function metricValue(kpis: Awaited<ReturnType<typeof loadKpis>>, metric: Metric): number | null {
  const v = kpis[metric];
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v) / 100; // money minor → major for threshold compare in major units where thresholds are set as numbers
  return v as number;
}

function metricDisplay(kpis: Awaited<ReturnType<typeof loadKpis>>, metric: Metric): string {
  const v = kpis[metric];
  if (v === null || v === undefined) return "n/a";
  if (typeof v === "bigint") return formatMoney(v);
  if (metric.endsWith("_pct")) return `${(v as number).toFixed(2)}%`;
  if (typeof v === "number") return v.toFixed(2);
  return String(v);
}

function compare(op: string, observed: number, threshold: number): boolean {
  switch (op) {
    case "lt": return observed < threshold;
    case "lte": return observed <= threshold;
    case "gt": return observed > threshold;
    case "gte": return observed >= threshold;
    default: return false;
  }
}

// ── Budgets ──────────────────────────────────────────────────────────────

const listBudgets = route("GET", "/budgets", { perm: "ledger:read" }, async (c) => {
  const status = qstr(c.query.status);
  const p: unknown[] = [c.org.orgId];
  const w = ["org_id = $1"];
  if (status) { p.push(status); w.push(`status = $${p.length}`); }
  const items = (await c.q.query<any>(`SELECT ${BUD} FROM finance_budgets WHERE ${w.join(" AND ")} ORDER BY period_from DESC, id DESC`, p)).rows;
  return ok({ items });
});

const getBudget = route("GET", "/budgets/:id", { perm: "ledger:read" }, async (c) => {
  const r = (await c.q.query<any>(`SELECT ${BUD} FROM finance_budgets WHERE id = $1 AND org_id = $2`, [c.params.id, c.org.orgId])).rows[0];
  if (!r) throw notFound("Budget");
  const lines = (await c.q.query<any>(`SELECT ${BLINE} FROM finance_budget_lines WHERE org_id = $1 AND budget_id = $2 ORDER BY category, label`, [c.org.orgId, r.id])).rows.map((x: any) => ({ ...x, amount: formatMoney(fromDb(x.amount)) }));
  const scenarios = (await c.q.query<any>(`SELECT ${SCEN} FROM finance_budget_scenarios WHERE org_id = $1 AND budget_id = $2 ORDER BY scenario_type, code`, [c.org.orgId, r.id])).rows.map((x: any) => ({ ...x, adjustment_pct: String(x.adjustment_pct) }));
  return ok({ budget: r, lines, scenarios });
});

const createBudget = route("POST", "/budgets", { perm: "finance:create" }, async (c) => {
  const b = asObject(c.body); const v = new V(b);
  const name = v.str("name", { min: 1, max: 200 });
  const period_from = v.date("period_from");
  const period_to = v.date("period_to");
  const notes = v.str("notes", { optional: true, max: 2000 });
  const codeIn = v.str("code", { optional: true, max: 40 });
  const fiscal_year_id = v.int("fiscal_year_id", { optional: true, min: 1 });
  const currencyIn = v.str("currency", { optional: true, min: 3, max: 3 });
  v.done();
  if (period_to < period_from) throw badRequest("period_to must be on or after period_from");
  const org = (await c.q.query<any>(`SELECT functional_currency FROM finance_organisations WHERE id = $1`, [c.org.orgId])).rows[0];
  const currency = currencyIn ?? org?.functional_currency ?? "GHS";
  const code = codeIn ?? `BDG-${String(await nextNumber(c.q, c.org.orgId, "budget")).padStart(4, "0")}`;
  if (fiscal_year_id && !(await c.q.query<any>(`SELECT id FROM finance_fiscal_years WHERE id = $1 AND org_id = $2`, [fiscal_year_id, c.org.orgId])).rows[0]) throw notFound("Fiscal year");
  try {
    const r = (await c.q.query<any>(
      `INSERT INTO finance_budgets (org_id, code, name, fiscal_year_id, period_from, period_to, currency, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${BUD}`,
      [c.org.orgId, code, name, fiscal_year_id ?? null, period_from, period_to, currency, notes ?? null, c.actor.sub],
    )).rows[0];
    await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "budget.create", entityType: "finance_budget", entityId: r.id, summary: `Budget ${r.code}`, after: r, requestId: c.reqId });
    return ok({ budget: r }, 201);
  } catch (e: any) {
    if (e?.code === "23505") throw conflict("Budget code already exists", "duplicate_code");
    throw e;
  }
});

const addBudgetLine = route("POST", "/budgets/:id/lines", { perm: "finance:create" }, async (c) => {
  const budget = (await c.q.query<any>(`SELECT id, status FROM finance_budgets WHERE id = $1 AND org_id = $2`, [c.params.id, c.org.orgId])).rows[0];
  if (!budget) throw notFound("Budget");
  if (budget.status === "void" || budget.status === "closed") throw unprocessable("Cannot add lines to a closed or void budget", "budget_locked");
  const b = asObject(c.body); const v = new V(b);
  const category = v.str("category", { min: 1, max: 80 });
  const label = v.str("label", { min: 1, max: 200 });
  const amountMinor = v.money("amount");
  const account_id = v.int("account_id", { optional: true, min: 1 });
  const notes = v.str("notes", { optional: true, max: 1000 });
  v.done();
  if (amountMinor == null) throw badRequest("amount is required");
  if (account_id && !(await c.q.query<any>(`SELECT id FROM finance_accounts WHERE id = $1 AND org_id = $2`, [account_id, c.org.orgId])).rows[0]) throw notFound("Account");
  const r = (await c.q.query<any>(
    `INSERT INTO finance_budget_lines (org_id, budget_id, account_id, category, label, amount, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${BLINE}`,
    [c.org.orgId, budget.id, account_id ?? null, category, label, formatMoney(amountMinor), notes ?? null],
  )).rows[0];
  return ok({ line: { ...r, amount: formatMoney(fromDb(r.amount)) } }, 201);
});

const activateBudget = route("POST", "/budgets/:id/activate", { perm: "finance:approve" }, async (c) => {
  const before = (await c.q.query<any>(`SELECT ${BUD} FROM finance_budgets WHERE id = $1 AND org_id = $2`, [c.params.id, c.org.orgId])).rows[0];
  if (!before) throw notFound("Budget");
  if (before.status !== "draft") throw unprocessable("Only draft budgets can be activated", "not_draft");
  const r = (await c.q.query<any>(`UPDATE finance_budgets SET status = 'active', updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING ${BUD}`, [c.params.id, c.org.orgId])).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "budget.activate", entityType: "finance_budget", entityId: r.id, before, after: r, requestId: c.reqId });
  return ok({ budget: r });
});

const createScenario = route("POST", "/budgets/:id/scenarios", { perm: "finance:create" }, async (c) => {
  const budget = (await c.q.query<any>(`SELECT id FROM finance_budgets WHERE id = $1 AND org_id = $2`, [c.params.id, c.org.orgId])).rows[0];
  if (!budget) throw notFound("Budget");
  const b = asObject(c.body); const v = new V(b);
  const name = v.str("name", { min: 1, max: 200 });
  const scenario_type = v.str("scenario_type", { optional: true, oneOf: ["conservative","base","aggressive","custom"] }) ?? "base";
  const notes = v.str("notes", { optional: true, max: 1000 });
  const codeIn = v.str("code", { optional: true, max: 40 });
  v.done();
  let adjustment_pct = "0";
  if (b.adjustment_pct != null) {
    const s = String(b.adjustment_pct);
    if (!/^-?\d+(\.\d{1,4})?$/.test(s)) throw badRequest("adjustment_pct must be a number");
    adjustment_pct = s;
  } else if (scenario_type === "conservative") adjustment_pct = "-10";
  else if (scenario_type === "aggressive") adjustment_pct = "10";
  const code = codeIn ?? scenario_type.toUpperCase().slice(0, 8);
  try {
    const r = (await c.q.query<any>(
      `INSERT INTO finance_budget_scenarios (org_id, budget_id, code, name, scenario_type, adjustment_pct, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${SCEN}`,
      [c.org.orgId, budget.id, code, name, scenario_type, adjustment_pct, notes ?? null, c.actor.sub],
    )).rows[0];
    return ok({ scenario: { ...r, adjustment_pct: String(r.adjustment_pct) } }, 201);
  } catch (e: any) {
    if (e?.code === "23505") throw conflict("Scenario code already exists on this budget", "duplicate_code");
    throw e;
  }
});

/** Budget vs actual from posted ledger for the budget period. */
const budgetVsActual = route("GET", "/budgets/:id/vs-actual", { perm: "ledger:read" }, async (c) => {
  const budget = (await c.q.query<any>(`SELECT ${BUD} FROM finance_budgets WHERE id = $1 AND org_id = $2`, [c.params.id, c.org.orgId])).rows[0];
  if (!budget) throw notFound("Budget");
  const lines = (await c.q.query<any>(`SELECT ${BLINE} FROM finance_budget_lines WHERE org_id = $1 AND budget_id = $2 ORDER BY category, label`, [c.org.orgId, budget.id])).rows;
  const scenarios = (await c.q.query<any>(`SELECT ${SCEN} FROM finance_budget_scenarios WHERE org_id = $1 AND budget_id = $2`, [c.org.orgId, budget.id])).rows;

  // Actuals: group posted revenue/expense by category (account category) in budget window
  const actualRows = (await c.q.query<any>(
    `SELECT a.category, a.type, COALESCE(SUM(e.debit),0) AS d, COALESCE(SUM(e.credit),0) AS c
       FROM finance_ledger_entries e
       JOIN finance_accounts a ON a.id = e.account_id AND a.org_id = e.org_id
      WHERE e.org_id = $1 AND e.entry_date BETWEEN $2::date AND $3::date AND e.journal_type <> 'closing' AND a.type IN ('revenue','expense')
      GROUP BY a.category, a.type`, [c.org.orgId, budget.period_from, budget.period_to])).rows;
  const actualByCategory = new Map<string, bigint>();
  for (const r of actualRows) {
    const amt = r.type === "revenue" ? fromDb(r.c) - fromDb(r.d) : fromDb(r.d) - fromDb(r.c);
    actualByCategory.set(r.category, (actualByCategory.get(r.category) ?? 0n) + amt);
  }

  const comparison = lines.map((l: any) => {
    const budgetAmt = fromDb(l.amount);
    const actualAmt = l.account_id
      ? null // per-account actual would need another query; use category aggregate
      : (actualByCategory.get(l.category) ?? 0n);
    // Prefer category actual
    const actual = actualByCategory.get(l.category) ?? 0n;
    const variance = actual - budgetAmt;
    const variancePct = budgetAmt === 0n ? null : Number(variance) / Number(budgetAmt) * 100;
    return {
      line_id: l.id,
      category: l.category,
      label: l.label,
      budget: formatMoney(budgetAmt),
      actual: formatMoney(actual),
      variance: formatMoney(variance),
      variance_pct: variancePct != null ? variancePct.toFixed(2) : null,
    };
  });

  const scenarioViews = scenarios.map((s: any) => {
    const adj = Number(s.adjustment_pct) / 100;
    return {
      code: s.code,
      name: s.name,
      scenario_type: s.scenario_type,
      adjustment_pct: String(s.adjustment_pct),
      lines: lines.map((l: any) => {
        const base = fromDb(l.amount);
        const adjusted = BigInt(Math.round(Number(base) * (1 + adj)));
        return { label: l.label, category: l.category, base: formatMoney(base), adjusted: formatMoney(adjusted) };
      }),
    };
  });

  let totalBudget = 0n, totalActual = 0n;
  for (const l of lines) totalBudget += fromDb(l.amount);
  for (const v of actualByCategory.values()) totalActual += v;

  return ok({
    budget: { id: budget.id, code: budget.code, name: budget.name, period_from: ymd(budget.period_from), period_to: ymd(budget.period_to), currency: budget.currency, status: budget.status },
    totals: { budget: formatMoney(totalBudget), actual: formatMoney(totalActual), variance: formatMoney(totalActual - totalBudget) },
    comparison,
    scenarios: scenarioViews,
    note: "Actuals are summed from posted ledger entries in the budget period by account category. Scenarios apply percentage adjustments to budget lines only — they do not invent actuals.",
  });
});

// ── Health / alerts ──────────────────────────────────────────────────────

const listRules = route("GET", "/alerts/rules", { perm: "ledger:read" }, async (c) => {
  const items = (await c.q.query<any>(`SELECT ${RULE} FROM finance_alert_rules WHERE org_id = $1 ORDER BY severity DESC, name`, [c.org.orgId])).rows.map((r: any) => ({ ...r, threshold: String(r.threshold) }));
  return ok({ items });
});

const createRule = route("POST", "/alerts/rules", { perm: "finance:create" }, async (c) => {
  const b = asObject(c.body); const v = new V(b);
  const name = v.str("name", { min: 1, max: 200 });
  const metric = v.str("metric", { oneOf: METRICS as unknown as string[] });
  const operator = v.str("operator", { oneOf: ["lt","lte","gt","gte"] });
  const severity = v.str("severity", { optional: true, oneOf: ["info","warning","critical"] }) ?? "warning";
  const notes = v.str("notes", { optional: true, max: 1000 });
  const codeIn = v.str("code", { optional: true, max: 40 });
  v.done();
  if (b.threshold == null || !/^-?\d+(\.\d{1,4})?$/.test(String(b.threshold))) throw badRequest("threshold must be a number");
  const threshold = String(b.threshold);
  const code = codeIn ?? `ALR-${String(await nextNumber(c.q, c.org.orgId, "alert_rule")).padStart(4, "0")}`;
  try {
    const r = (await c.q.query<any>(
      `INSERT INTO finance_alert_rules (org_id, code, name, metric, operator, threshold, severity, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${RULE}`,
      [c.org.orgId, code, name, metric, operator, threshold, severity, notes ?? null, c.actor.sub],
    )).rows[0];
    await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "alert_rule.create", entityType: "finance_alert_rule", entityId: r.id, summary: `Alert rule ${r.code}`, after: r, requestId: c.reqId });
    return ok({ rule: { ...r, threshold: String(r.threshold) } }, 201);
  } catch (e: any) {
    if (e?.code === "23505") throw conflict("Alert rule code already exists", "duplicate_code");
    throw e;
  }
});

const patchRule = route("PATCH", "/alerts/rules/:id", { perm: "finance:update" }, async (c) => {
  const before = (await c.q.query<any>(`SELECT ${RULE} FROM finance_alert_rules WHERE id = $1 AND org_id = $2`, [c.params.id, c.org.orgId])).rows[0];
  if (!before) throw notFound("Alert rule");
  const b = asObject(c.body); const v = new V(b);
  const name = v.str("name", { optional: true, min: 1, max: 200 });
  const is_active = v.bool("is_active");
  const severity = v.str("severity", { optional: true, oneOf: ["info","warning","critical"] });
  const notes = v.str("notes", { optional: true, max: 1000 });
  v.done();
  let threshold: string | null = null;
  if (b.threshold != null) {
    if (!/^-?\d+(\.\d{1,4})?$/.test(String(b.threshold))) throw badRequest("threshold must be a number");
    threshold = String(b.threshold);
  }
  const r = (await c.q.query<any>(
    `UPDATE finance_alert_rules SET name = COALESCE($3,name), is_active = COALESCE($4,is_active), severity = COALESCE($5,severity), notes = COALESCE($6,notes), threshold = COALESCE($7,threshold), updated_at = now()
     WHERE id = $1 AND org_id = $2 RETURNING ${RULE}`,
    [c.params.id, c.org.orgId, name ?? null, is_active ?? null, severity ?? null, notes ?? null, threshold],
  )).rows[0];
  return ok({ rule: { ...r, threshold: String(r.threshold) } });
});

const listEvents = route("GET", "/alerts/events", { perm: "ledger:read" }, async (c) => {
  const status = qstr(c.query.status);
  const p: unknown[] = [c.org.orgId];
  const w = ["org_id = $1"];
  if (status) { p.push(status); w.push(`status = $${p.length}`); }
  const limit = Math.min(200, Math.max(1, Number(qstr(c.query.limit)) || 50));
  const items = (await c.q.query<any>(`SELECT ${EVT} FROM finance_alert_events WHERE ${w.join(" AND ")} ORDER BY created_at DESC LIMIT ${limit}`, p)).rows;
  return ok({ items });
});

const acknowledgeEvent = route("POST", "/alerts/events/:id/acknowledge", { perm: "finance:update" }, async (c) => {
  const r = (await c.q.query<any>(
    `UPDATE finance_alert_events SET status = 'acknowledged', acknowledged_by = $3, acknowledged_at = now()
     WHERE id = $1 AND org_id = $2 AND status = 'open' RETURNING ${EVT}`,
    [c.params.id, c.org.orgId, c.actor.sub],
  )).rows[0];
  if (!r) throw notFound("Open alert event");
  return ok({ event: r });
});

/** Evaluate active rules against current KPIs and open new events. */
const evaluateAlerts = route("POST", "/alerts/evaluate", { perm: "finance:create" }, async (c) => {
  const org = (await c.q.query<any>(`SELECT timezone FROM finance_organisations WHERE id = $1`, [c.org.orgId])).rows[0];
  const asOf = qstr(c.query.as_of) ?? todayIn(org.timezone, c.now);
  const kpis = await loadKpis(c, asOf);
  const rules = (await c.q.query<any>(`SELECT ${RULE} FROM finance_alert_rules WHERE org_id = $1 AND is_active = TRUE`, [c.org.orgId])).rows;
  const created = [];
  for (const rule of rules) {
    const metric = rule.metric as Metric;
    // Money metrics: thresholds entered in major units; compare major units
    const moneyMetrics = new Set(["cash_balance","receivables","payables","working_capital","net_profit"]);
    let observed: number | null;
    if (moneyMetrics.has(metric)) {
      const minor = kpis[metric] as bigint;
      observed = Number(minor) / 100;
    } else {
      observed = metricValue(kpis, metric);
    }
    if (observed === null) continue;
    const threshold = Number(rule.threshold);
    if (!compare(rule.operator, observed, threshold)) continue;
    // Avoid duplicate open events for same rule+date
    const existing = (await c.q.query<any>(
      `SELECT id FROM finance_alert_events WHERE org_id = $1 AND rule_id = $2 AND as_of_date = $3::date AND status = 'open'`,
      [c.org.orgId, rule.id, asOf],
    )).rows[0];
    if (existing) continue;
    const observedDisplay = moneyMetrics.has(metric) ? formatMoney(kpis[metric] as bigint) : metricDisplay(kpis, metric);
    const title = `${rule.name}`;
    const message = `${rule.metric} is ${observedDisplay} (rule: ${rule.operator} ${rule.threshold}).`;
    const evt = (await c.q.query<any>(
      `INSERT INTO finance_alert_events (org_id, rule_id, metric, severity, title, message, observed_value, threshold_value, as_of_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date) RETURNING ${EVT}`,
      [c.org.orgId, rule.id, rule.metric, rule.severity, title, message, observedDisplay, String(rule.threshold), asOf],
    )).rows[0];
    created.push(evt);
  }
  return ok({ as_of: asOf, currency: kpis.currency, evaluated_rules: rules.length, new_events: created.length, events: created, kpis: {
    current_ratio: kpis.current_ratio, quick_ratio: kpis.quick_ratio, cash_ratio: kpis.cash_ratio,
    net_margin_pct: kpis.net_margin_pct, gross_margin_pct: kpis.gross_margin_pct, debt_to_equity: kpis.debt_to_equity,
    cash_balance: formatMoney(kpis.cash_balance), receivables: formatMoney(kpis.receivables),
    payables: formatMoney(kpis.payables), working_capital: formatMoney(kpis.working_capital),
    net_profit: formatMoney(kpis.net_profit), revenue: formatMoney(kpis.revenue),
  }});
});

const healthSummary = route("GET", "/health/summary", { perm: "ledger:read" }, async (c) => {
  const org = (await c.q.query<any>(`SELECT timezone, functional_currency FROM finance_organisations WHERE id = $1`, [c.org.orgId])).rows[0];
  const asOf = qstr(c.query.as_of) ?? todayIn(org.timezone, c.now);
  const kpis = await loadKpis(c, asOf);
  const open = (await c.q.query<any>(
    `SELECT severity, count(*)::int AS n FROM finance_alert_events WHERE org_id = $1 AND status = 'open' GROUP BY severity`,
    [c.org.orgId],
  )).rows;
  const bySev: Record<string, number> = { info: 0, warning: 0, critical: 0 };
  for (const r of open) bySev[r.severity] = Number(r.n);
  const signals = [];
  if (kpis.current_ratio != null && kpis.current_ratio < 1) signals.push({ level: "critical", text: `Current ratio ${kpis.current_ratio.toFixed(2)} is below 1.0` });
  else if (kpis.current_ratio != null && kpis.current_ratio < 1.5) signals.push({ level: "warning", text: `Current ratio ${kpis.current_ratio.toFixed(2)} is below 1.5` });
  if (kpis.net_margin_pct != null && kpis.net_margin_pct < 0) signals.push({ level: "critical", text: `Net margin ${kpis.net_margin_pct.toFixed(2)}% is negative` });
  if (kpis.cash_balance < 0n) signals.push({ level: "critical", text: "Cash & bank balance is negative" });
  if (kpis.working_capital < 0n) signals.push({ level: "warning", text: "Working capital is negative" });
  if (signals.length === 0) signals.push({ level: "info", text: "No automatic risk flags from standard thresholds. Configure custom alert rules as needed." });
  return ok({
    currency: kpis.currency,
    as_of: asOf,
    open_alerts: bySev,
    signals,
    kpis: {
      current_ratio: kpis.current_ratio, quick_ratio: kpis.quick_ratio, cash_ratio: kpis.cash_ratio,
      net_margin_pct: kpis.net_margin_pct, gross_margin_pct: kpis.gross_margin_pct, debt_to_equity: kpis.debt_to_equity,
      cash_balance: formatMoney(kpis.cash_balance), receivables: formatMoney(kpis.receivables),
      payables: formatMoney(kpis.payables), working_capital: formatMoney(kpis.working_capital),
      net_profit: formatMoney(kpis.net_profit), revenue: formatMoney(kpis.revenue),
    },
    note: "Signals use posted ledger KPIs only. Alert rules are evaluated on demand via POST /alerts/evaluate.",
  });
});

export const budgetHealthRoutes: Route[] = [
  listBudgets, getBudget, createBudget, addBudgetLine, activateBudget, createScenario, budgetVsActual,
  listRules, createRule, patchRule, listEvents, acknowledgeEvent, evaluateAlerts, healthSummary,
];
