import { S } from './validate';
import { AgentRegistry } from './orchestrator';
import type { AgentContext, AgentDefinition, AgentDraft } from './orchestrator';
import type { AgentOutput, EvidenceRef, Finding, ProposedAction, Severity } from './types';
import { healthScore, rate, recommendationScore, weightedPipeline, SEVERITY_WEIGHT, triage } from './metrics';
import type { DomainScore } from './metrics';

const DAY = 86_400_000;
const empty = S.obj({}, [], true);
const sev = (n: number, high: number, med: number): Severity => (n >= high ? 'HIGH' : n >= med ? 'MEDIUM' : 'LOW');
const ev = (source: string, ref: string, note?: string): EvidenceRef => ({ source, ref, ...(note ? { note } : {}) });
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const FOLLOWUP_ROLES = ['staff', 'manager', 'admin'];

function f(id: string, category: string, severity: Severity, title: string, detail: string, evidence: EvidenceRef[], confidence = 0.9, meta?: Record<string, unknown>): Finding {
  // Computed-from-records findings are 'confirmed'; severe-but-weak ones are routed to verification (severity and confidence stay separate axes).
  const status = evidence.length === 0 ? 'hypothesis' : triage(severity, confidence) === 'needs_verification' ? 'needs_verification' : 'confirmed';
  return { id, category, severity, title, detail, evidence: evidence.slice(0, 12), confidence, status, ...(meta ? { meta } : {}) };
}
async function tool<T = any>(ctx: AgentContext, name: string, args: unknown = {}, why?: string): Promise<T | null> {
  const r = await ctx.tryTool(name, args);
  if (!r.ok) { ctx.markDegraded(`${why ?? name}:${r.reason}`); return null; }
  return r.value as T;
}
function followUp(kind: 'lead' | 'opportunity', id: number, label: string, why: string): ProposedAction {
  return { type: 'create_followup_activity', summary: `Create a follow-up task for ${kind} ${label}`, payload: { [kind === 'lead' ? 'leadId' : 'opportunityId']: id, subject: `Follow up: ${label}`, reason: why, dueInDays: 1 }, risk: 'low', reversible: true, requiredRoles: FOLLOWUP_ROLES };
}
const NO_DATA = (ctx: AgentContext, what: string): AgentDraft => ({ confidence: 0, uncertainties: [`${what} could not be read; no conclusions drawn.`], summary: `${what} unavailable.`, data: { coverage: 0 } });

// ───────────────────────── leaf analysts ─────────────────────────
const leadIntelligence: AgentDefinition = {
  role: 'lead_intelligence', title: 'Lead Intelligence', description: 'Finds neglected, overdue and unqualifiable leads and proposes follow-ups.', domain: 'sales',
  tools: ['sales.leads'], inputSchema: empty, completionCriteria: ['Reads the live lead funnel', 'Every finding cites lead records', 'Follow-ups are proposals, never sent'], autonomyCeiling: 3, maxCostUsd: 0.05,
  async handler(ctx) {
    const d = await tool<any>(ctx, 'sales.leads'); if (!d) return NO_DATA(ctx, 'Lead data');
    const c = d.counts, open = c.open_leads as number, findings: Finding[] = [], actions: ProposedAction[] = [];
    const label = (l: any) => [l.first_name, l.last_name].filter(Boolean).join(' ') + (l.company ? ` (${l.company})` : '');
    if (c.stale > 0) findings.push(f('lead_intelligence.stale_leads', 'sales.leads', sev(c.stale, Math.max(10, open * 0.3), 3), `${c.stale} open lead(s) untouched for 7+ days`, `${pct(c.stale, open)}% of open leads have had no contact in a week. Highest scored are listed.`, d.stale.map((l: any) => ev('sales_leads', `id=${l.id}`, `${label(l)} score ${l.score}, last touch ${l.last_touch}`)), 0.95, { count: c.stale, open }));
    if (c.overdue_followups > 0) findings.push(f('lead_intelligence.overdue_followups', 'sales.leads', sev(c.overdue_followups, 8, 3), `${c.overdue_followups} lead follow-up(s) are overdue`, 'Scheduled follow-up time has passed with the lead still open.', d.overdueFollowups.map((l: any) => ev('sales_leads', `id=${l.id}`, `${label(l)} was due ${l.due}`)), 0.95, { count: c.overdue_followups }));
    if (c.no_contact_info > 0) findings.push(f('lead_intelligence.no_contact_info', 'sales.leads', c.no_contact_info >= 5 ? 'MEDIUM' : 'LOW', `${c.no_contact_info} open lead(s) have no email or phone`, 'These leads cannot be contacted until qualification data is added.', [ev('sales_leads', 'email and phone empty', `${c.no_contact_info} records`)], 0.95, { count: c.no_contact_info }));
    for (const l of [...d.overdueFollowups, ...d.stale].filter((x: any, i: number, a: any[]) => a.findIndex((y) => y.id === x.id) === i).sort((a: any, b: any) => b.score - a.score).slice(0, 5))
      actions.push(followUp('lead', l.id, label(l), 'Lead is stale or overdue'));
    return { findings, recommendedActions: actions, confidence: open > 0 ? 0.9 : 0.5, evidence: [ev('sales_leads', 'funnel', `${open} open leads`)],
      uncertainties: open === 0 ? ['No open leads exist, so lead health cannot be assessed.'] : [], summary: `${open} open leads; ${c.stale} stale; ${c.overdue_followups} overdue follow-ups; ${c.hot} high-scoring.`,
      data: { coverage: open > 0 ? 1 : 0, funnel: d.funnel, bySource: d.bySource, counts: c, created30d: d.created30d } };
  },
};

const opportunityPipeline: AgentDefinition = {
  role: 'opportunity_pipeline', title: 'Opportunity & Pipeline', description: 'Finds stalled deals, unrealistic close dates and weak qualification.', domain: 'sales',
  tools: ['sales.pipeline'], inputSchema: empty, completionCriteria: ['Reads open opportunities', 'Stalled = stage age beyond that stage\'s own threshold', 'Weighted pipeline uses value x probability'], autonomyCeiling: 3, maxCostUsd: 0.05,
  async handler(ctx) {
    const d = await tool<any>(ctx, 'sales.pipeline'); if (!d) return NO_DATA(ctx, 'Pipeline data');
    const opps: any[] = d.opportunities, nowMs = Date.parse(d.asOf), findings: Finding[] = [], actions: ProposedAction[] = [];
    const wp = weightedPipeline(opps.map((o) => ({ id: String(o.id), value: o.amount, currency: o.currency, probability: Math.min(1, Math.max(0, o.probability / 100)) })));
    const totalCount = opps.length, o = (x: any) => ev('sales_opportunities', `id=${x.id}`, `${x.number} ${x.name}: ${x.amount} ${x.currency}, stage ${x.stage}`);
    const ageDays = (x: any) => (nowMs - Date.parse(x.last_stage_change ?? x.created_at)) / DAY;
    const stalled = opps.filter((x) => ageDays(x) > x.stall_days);
    const pastClose = opps.filter((x) => x.close_date && x.close_date < d.today);
    const pushed = opps.filter((x) => x.close_date_changes >= 3);
    const noStake = opps.filter((x) => x.no_stakeholders), noNext = opps.filter((x) => x.no_next_action);
    if (stalled.length) findings.push(f('opportunity_pipeline.stalled', 'sales.pipeline', sev(stalled.length, Math.max(5, totalCount * 0.3), 2), `${stalled.length} opportunit${stalled.length > 1 ? 'ies are' : 'y is'} stalled`, 'Time in the current stage exceeds that stage\'s configured stalled-after threshold.', stalled.map((x) => ev('sales_opportunities', `id=${x.id}`, `${x.number} in ${x.stage} for ${Math.floor(ageDays(x))}d (limit ${x.stall_days}d)`)), 0.9, { count: stalled.length }));
    if (pastClose.length) findings.push(f('opportunity_pipeline.past_close_date', 'sales.pipeline', sev(pastClose.length, 5, 1), `${pastClose.length} open opportunit${pastClose.length > 1 ? 'ies are' : 'y is'} past the expected close date`, 'An open deal whose close date has passed makes the forecast unreliable until the date or status is corrected.', pastClose.map((x) => ev('sales_opportunities', `id=${x.id}`, `${x.number} expected ${x.close_date}`)), 0.95, { count: pastClose.length }));
    if (pushed.length) findings.push(f('opportunity_pipeline.close_date_pushed', 'sales.pipeline', 'MEDIUM', `${pushed.length} deal(s) have had the close date moved 3+ times`, 'Repeated slippage is a recognised sign of weak qualification or a missing decision-maker. This is a risk signal, not proof.', pushed.map(o), 0.7, { count: pushed.length }));
    if (noStake.length >= 3) findings.push(f('opportunity_pipeline.no_stakeholders', 'sales.pipeline', 'MEDIUM', `${noStake.length} open deals have no stakeholders recorded`, 'Decision-makers are not identified.', noStake.map(o), 0.85, { count: noStake.length }));
    if (noNext.length >= 3) findings.push(f('opportunity_pipeline.no_next_action', 'sales.pipeline', 'LOW', `${noNext.length} open deals have no next action`, 'Deals without a defined next step tend to stall.', noNext.map(o), 0.85, { count: noNext.length }));
    for (const x of [...stalled, ...pastClose].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => b.amount - a.amount).slice(0, 5)) actions.push(followUp('opportunity', x.id, `${x.number} ${x.name}`, 'Opportunity is stalled or past its close date'));
    return { findings, recommendedActions: actions, confidence: totalCount ? 0.9 : 0.4, evidence: [ev('sales_opportunities', 'open', `${totalCount} open`)],
      uncertainties: [...(totalCount ? [] : ['There are no open opportunities.']), 'Probability values are those recorded on each opportunity; they are estimates, not outcomes.'], summary: `${totalCount} open opportunities; ${stalled.length} stalled; ${pastClose.length} past close date.`,
      data: { coverage: totalCount ? 1 : 0, weightedPipelineByCurrency: wp, counts: { open: totalCount, stalled: stalled.length, pastClose: pastClose.length, pushed: pushed.length, noStakeholders: noStake.length, noNextAction: noNext.length }, definition: 'Weighted Pipeline = sum(opportunity value x probability); not guaranteed revenue.' } };
  },
};

const salesForecasting: AgentDefinition = {
  role: 'sales_forecasting', title: 'Sales Forecasting', description: 'Transparent weighted-pipeline forecast compared with a trailing-average baseline.', domain: 'sales',
  tools: ['sales.pipeline', 'sales.revenue', 'sales.targets'], inputSchema: empty, completionCriteria: ['Scenarios use stated formulas', 'Baseline disclosed', 'Insufficient history is stated, not hidden'], autonomyCeiling: 1, maxCostUsd: 0.05,
  async handler(ctx) {
    const [p, r, t] = [await tool<any>(ctx, 'sales.pipeline'), await tool<any>(ctx, 'sales.revenue', { days: 90 }), await tool<any>(ctx, 'sales.targets')];
    if (!p || !r) return NO_DATA(ctx, 'Forecast inputs');
    const asOf = new Date(p.asOf), end90 = new Date(asOf.getTime() + 90 * DAY).toISOString().slice(0, 10);
    const thisMonth = p.asOf.slice(0, 7);
    const forecast: Record<string, any> = {}, unc: string[] = ['Forecasts are estimates from recorded probabilities and past bookings, not guaranteed revenue.'], findings: Finding[] = [];
    const currencies = new Set<string>([...p.opportunities.map((o: any) => o.currency), ...r.monthly.map((m: any) => m.currency)]);
    for (const cur of currencies) {
      const open = p.opportunities.filter((o: any) => o.currency === cur && o.close_date && o.close_date >= p.today && o.close_date <= end90);
      const val = (xs: any[]) => xs.reduce((s, o) => s + o.amount, 0);
      const weighted = open.reduce((s: number, o: any) => s + o.amount * (o.probability / 100), 0);
      const commit = val(open.filter((o: any) => o.forecast_category === 'commit'));
      const best = val(open.filter((o: any) => ['commit', 'best_case'].includes(o.forecast_category)));
      const complete = r.monthly.filter((m: any) => m.currency === cur && m.month < thisMonth).slice(-3);
      const baseline = complete.length >= 3 ? complete.reduce((s: number, m: any) => s + m.booked, 0) / 3 : null;
      if (baseline === null) unc.push(`${cur}: fewer than 3 complete months of booked orders, so no trailing baseline is shown.`);
      forecast[cur] = { next90d: { weightedPipeline: Math.round(weighted), commitOnly: Math.round(commit), commitPlusBestCase: Math.round(best), dealsClosingInWindow: open.length }, baselineMonthlyBooked: baseline === null ? null : Math.round(baseline), baselineBasis: baseline === null ? 'insufficient_history' : 'mean of last 3 complete months of booked orders', formulas: { weightedPipeline: 'sum(amount x probability) for open deals with close date in the next 90 days', commitOnly: 'sum(amount) where forecast category = commit', commitPlusBestCase: 'sum(amount) where category in commit, best_case' } };
    }
    if (t?.period && t.actualByCurrency.length <= 1) {
      const cur = t.actualByCurrency[0]?.currency ?? Object.keys(forecast)[0];
      const remaining = Math.max(0, t.period.target - (t.actualByCurrency[0]?.booked ?? 0));
      const w = forecast[cur]?.next90d.weightedPipeline ?? 0;
      forecast.targetGap = { period: t.period.name, remaining, weightedPipelineNext90d: w, currency: cur };
      if (remaining > 0 && w < remaining) findings.push(f('sales_forecasting.pipeline_below_gap', 'sales.forecast', 'HIGH', `Weighted pipeline (${w}) does not cover the remaining target gap (${Math.round(remaining)})`, `Period ${t.period.name}: even if every deal closes at its recorded probability the target is not met on current pipeline.`, [ev('sales_targets', `period=${t.period.id}`, `target ${t.period.target}`), ev('sales_opportunities', 'open weighted', `${w}`)], 0.75, { remaining, weighted: w }));
    } else if (t && !t.period) unc.push('No approved company revenue target for the current period, so coverage vs target is not computed.');
    return { findings, confidence: p.opportunities.length ? 0.7 : 0.3, evidence: [ev('sales_opportunities', 'open'), ev('sales_orders', 'booked_at')], uncertainties: unc, summary: `Forecast scenarios for ${[...currencies].join(', ') || 'no currency'}.`, data: { coverage: p.opportunities.length || r.monthly.length ? 1 : 0, forecast } };
  },
};

const customerIntelligence: AgentDefinition = {
  role: 'customer_intelligence', title: 'Account & Customer Intelligence', description: 'Revenue concentration, overdue reorders and silent active accounts.', domain: 'sales',
  tools: ['sales.accounts'], inputSchema: empty, completionCriteria: ['Measured values are labelled as measured', 'No churn prediction without evidence'], autonomyCeiling: 1, maxCostUsd: 0.05,
  async handler(ctx) {
    const d = await tool<any>(ctx, 'sales.accounts'); if (!d) return NO_DATA(ctx, 'Account data');
    const findings: Finding[] = [];
    for (const t of d.revenue365ByCurrency) {
      const top = d.topAccounts.find((a: any) => a.currency === t.currency); const share = top && t.revenue > 0 ? top.revenue / t.revenue : 0;
      if (share > 0.4) findings.push(f(`customer_intelligence.concentration:${t.currency}`, 'sales.customers', share > 0.5 ? 'HIGH' : 'MEDIUM', `${top.name} is ${Math.round(share * 100)}% of ${t.currency} revenue (12 months)`, 'Measured share of booked order value. High concentration raises revenue risk if the account leaves.', [ev('sales_accounts', `id=${top.id}`, `${Math.round(top.revenue)} of ${Math.round(t.revenue)}`)], 0.9, { share }));
    }
    if (d.reorderOverdue.length) findings.push(f('customer_intelligence.reorder_overdue', 'sales.customers', sev(d.reorderOverdue.length, 8, 3), `${d.reorderOverdue.length} active account(s) are past their expected reorder date`, 'Expected reorder date comes from each account\'s recorded reorder interval (a measured schedule, not a churn prediction).', d.reorderOverdue.map((a: any) => ev('sales_accounts', `id=${a.id}`, `${a.name} expected ${a.expected_reorder_on}`)), 0.85, { count: d.reorderOverdue.length }));
    if (d.silentActive.length) findings.push(f('customer_intelligence.silent_active', 'sales.customers', 'MEDIUM', `${d.silentActive.length} active account(s) have not ordered in 120+ days`, 'Active accounts with no recent orders are candidates for a retention check. Whether they will churn is not predicted here.', d.silentActive.map((a: any) => ev('sales_accounts', `id=${a.id}`, `${a.name} last order ${a.last_order}`)), 0.8, { count: d.silentActive.length }));
    return { findings, confidence: d.counts.total ? 0.85 : 0.3, evidence: [ev('sales_accounts', 'active')], uncertainties: ['Customer lifetime value is not computed; only measured 12-month revenue is used.', ...(d.counts.total ? [] : ['No accounts exist.'])], summary: `${d.counts.active} active accounts.`, data: { coverage: d.counts.total ? 1 : 0, topAccounts: d.topAccounts.slice(0, 5), counts: d.counts } };
  },
};

const salesPerformance: AgentDefinition = {
  role: 'sales_performance', title: 'Sales Performance', description: 'Target pace, win rate, cycle length and follow-up discipline.', domain: 'sales',
  tools: ['sales.targets', 'sales.outcomes', 'sales.activities'], inputSchema: empty, completionCriteria: ['Pace uses elapsed share of the period', 'Win rate needs a minimum sample'], autonomyCeiling: 1, maxCostUsd: 0.05,
  async handler(ctx) {
    const [t, o, a] = [await tool<any>(ctx, 'sales.targets'), await tool<any>(ctx, 'sales.outcomes', { days: 180 }), await tool<any>(ctx, 'sales.activities')];
    if (!o && !t && !a) return NO_DATA(ctx, 'Performance data');
    const findings: Finding[] = [], unc: string[] = [], data: Record<string, unknown> = {};
    if (t?.period && t.actualByCurrency.length <= 1) {
      const p = t.period, s = Date.parse(p.starts_on), e = Date.parse(p.ends_on) + DAY, nowMs = Date.parse(t.asOf);
      const elapsed = Math.min(1, Math.max(0, (nowMs - s) / (e - s))), booked = t.actualByCurrency[0]?.booked ?? 0;
      const attainment = pct(booked, p.target), pace = p.target > 0 && elapsed > 0 ? booked / (p.target * elapsed) : null;
      Object.assign(data, { target: { period: p.name, target: p.target, booked, attainmentPercent: attainment, elapsedPercent: Math.round(elapsed * 1000) / 10, pace, basis: p.basis } });
      if (pace !== null && elapsed >= 0.25 && pace < 0.8) findings.push(f('sales_performance.target_pace', 'sales.performance', pace < 0.5 ? 'HIGH' : 'MEDIUM', `Booked revenue is at ${Math.round(pace * 100)}% of the pace needed for ${p.name}`, `Pace = booked / (target x elapsed share of period). ${attainment}% of target booked with ${Math.round(elapsed * 100)}% of the period elapsed.`, [ev('sales_targets', `period=${p.id}`, `target ${p.target}`), ev('sales_orders', 'booked in period', `${booked}`)], 0.85, { pace, attainment }));
    } else if (t?.period) unc.push('Target attainment skipped: orders in more than one currency fall in the period and the target has no currency.');
    else if (t) unc.push('No approved company revenue target covers today.');
    if (o) {
      data.outcomes = o.byCurrency.map((c: any) => { const n = c.won + c.lost; return { currency: c.currency, won: c.won, lost: c.lost, winRatePercent: n >= 5 ? pct(c.won, n) : null, winRateNote: n >= 5 ? undefined : 'fewer than 5 closed deals: win rate not reported', avgCycleDays: c.avg_cycle_days === null ? null : Math.round(c.avg_cycle_days), avgWonDeal: c.won ? Math.round(c.won_amount / c.won) : null, lossReasons: o.lossReasons }; });
      for (const c of o.byCurrency) { const n = c.won + c.lost; const wr = n >= 10 ? c.won / n : null; if (wr !== null && wr < 0.2) findings.push(f(`sales_performance.low_win_rate:${c.currency}`, 'sales.performance', 'MEDIUM', `Win rate is ${Math.round(wr * 100)}% on ${n} closed ${c.currency} deals (180 days)`, 'Below 20% on a meaningful sample. Loss reasons are in the data section.', [ev('sales_opportunities', 'closed 180d', `${c.won} won / ${c.lost} lost`)], 0.8, { winRate: wr })); }
    }
    if (a) { data.activities = a.totals; if (a.totals.overdue > 0) findings.push(f('sales_performance.overdue_activities', 'sales.performance', sev(a.totals.overdue, 15, 5), `${a.totals.overdue} sales activit${a.totals.overdue > 1 ? 'ies are' : 'y is'} overdue`, 'Open activities whose due time has passed.', a.overdueByType.map((x: any) => ev('sales_activities', `type=${x.type}`, `${x.n} overdue, oldest ${x.oldest}`)), 0.95, { count: a.totals.overdue })); }
    return { findings, confidence: 0.8, evidence: [ev('sales_targets', 'company revenue'), ev('sales_opportunities', 'closed')], uncertainties: unc, summary: `Performance review over ${o ? '180d outcomes' : 'available data'}.`, data: { coverage: [t?.period, o, a].filter(Boolean).length / 3, ...data } };
  },
};

const dataQuality: AgentDefinition = {
  role: 'data_quality', title: 'Data Quality & Verification', description: 'Detects structural data defects that distort analytics and scores data reliability.', domain: 'governance',
  tools: ['sales.data_quality'], inputSchema: empty, completionCriteria: ['Reports defect ratios not just counts', 'Produces a 0-100 reliability score with its formula'], autonomyCeiling: 1, maxCostUsd: 0.02,
  async handler(ctx) {
    const d = await tool<any>(ctx, 'sales.data_quality'); if (!d) return NO_DATA(ctx, 'Data-quality checks');
    const checks: [string, string, number, number, Severity][] = [
      ['oppsZeroAmount', 'Open opportunities with zero amount', d.oppsZeroAmount, d.openOpportunities, 'MEDIUM'],
      ['oppsNoCloseDate', 'Open opportunities with no expected close date', d.oppsNoCloseDate, d.openOpportunities, 'MEDIUM'],
      ['oppsNoOwner', 'Open opportunities with no owner', d.oppsNoOwner, d.openOpportunities, 'MEDIUM'],
      ['leadsNoContact', 'Leads with neither email nor phone', d.leadsNoContact, d.leads, 'LOW'],
      ['leadsNoOwner', 'Open leads with no owner', d.leadsNoOwner, d.leads, 'LOW'],
      ['duplicateLeadEmails', 'Email addresses shared by several leads (possible duplicates)', d.duplicateLeadEmails, d.leads, 'LOW'],
      ['accountsNoOwner', 'Active accounts with no owner', d.accountsNoOwner, d.accounts, 'LOW'],
      ['ordersNoBookedAt', 'Booked orders missing a booked date (excluded from revenue)', d.ordersNoBookedAt, d.orders, 'HIGH'],
    ];
    const findings: Finding[] = [], ratios: number[] = [];
    for (const [key, title, n, base, severity] of checks) {
      const r = rate(n, base); if (r !== null) ratios.push(r);
      if (n > 0 && r !== null && r >= 0.1) findings.push(f(`data_quality.${key}`, 'governance.data_quality', severity, `${title}: ${n} of ${base} (${Math.round(r * 100)}%)`, 'At or above the 10% threshold, so metrics that depend on this field are unreliable.', [ev('sales_*', key, `${n}/${base}`)], 0.95, { count: n, base, ratio: r }));
    }
    const score = ratios.length ? Math.round(100 * (1 - ratios.reduce((s, x) => s + x, 0) / ratios.length)) : null;
    return { findings, confidence: ratios.length ? 0.95 : 0.2, evidence: [ev('sales_*', 'structural checks')], uncertainties: ratios.length ? [] : ['No records exist to check.'], summary: score === null ? 'No records to assess.' : `Data reliability ${score}/100.`, data: { coverage: ratios.length ? 1 : 0, reliabilityScore: score, formula: '100 x (1 - mean defect ratio across checks that have a denominator)', counts: d } };
  },
};

const financialDiagnostic: AgentDefinition = {
  role: 'financial_diagnostic', title: 'Financial Performance Diagnostic', description: 'Booked vs collected vs outstanding sales, growth and returns. Not audited statements.', domain: 'financial',
  tools: ['sales.revenue'], inputSchema: empty, completionCriteria: ['Booked, collected and outstanding are kept separate', 'States that no expense data was used'], autonomyCeiling: 1, maxCostUsd: 0.05,
  async handler(ctx) {
    const d = await tool<any>(ctx, 'sales.revenue', { days: 90 }); if (!d) return NO_DATA(ctx, 'Revenue data');
    const findings: Finding[] = [], series: any[] = [];
    for (const c of d.current) {
      const p = d.previous.find((x: any) => x.currency === c.currency), out = d.outstanding.find((x: any) => x.currency === c.currency);
      const growth = p && p.booked > 0 ? (c.booked - p.booked) / p.booked : null, collect = rate(c.collected, c.booked), returns = rate(c.returned, c.booked);
      series.push({ currency: c.currency, booked: c.booked, collected: c.collected, outstanding: out?.amount ?? 0, overdue: out?.overdue_amount ?? 0, previousBooked: p?.booked ?? null, growthPercent: growth === null ? null : Math.round(growth * 1000) / 10, collectionRatioPercent: collect === null ? null : Math.round(collect * 1000) / 10, returnsPercent: returns === null ? null : Math.round(returns * 1000) / 10 });
      if (growth !== null && growth <= -0.15) findings.push(f(`financial_diagnostic.revenue_decline:${c.currency}`, 'financial.revenue', growth <= -0.3 ? 'HIGH' : 'MEDIUM', `Booked ${c.currency} sales fell ${Math.round(-growth * 100)}% vs the previous 90 days`, `Booked ${Math.round(c.booked)} vs ${Math.round(p.booked)}. Cause is not determined by this agent.`, [ev('sales_orders', '90d vs prior 90d', `${Math.round(c.booked)} vs ${Math.round(p.booked)}`)], 0.9, { growth }));
      if (out && out.overdue_amount > 0) findings.push(f(`financial_diagnostic.overdue_receivables:${c.currency}`, 'financial.receivables', out.overdue_amount > c.booked * 0.2 ? 'HIGH' : 'MEDIUM', `${Math.round(out.overdue_amount)} ${c.currency} is overdue across ${out.overdue_orders} order(s)`, 'Orders past invoice due date with an unpaid or partial status.', [ev('sales_orders', 'invoice_due_on < today', `${out.overdue_orders} orders`)], 0.9, { overdue: out.overdue_amount }));
      if (returns !== null && returns > 0.1) findings.push(f(`financial_diagnostic.returns:${c.currency}`, 'financial.returns', 'MEDIUM', `Returns are ${Math.round(returns * 100)}% of booked ${c.currency} sales`, 'Returned value over booked value in the window.', [ev('sales_orders', 'returned_total', `${Math.round(c.returned)}`)], 0.9, { returns }));
    }
    return { findings, confidence: series.length ? 0.85 : 0.3, evidence: [ev('sales_orders', 'booked_at, total, paid_total')], uncertainties: ['Based on sales records only: no expenses, margins or ledger data were used, and this is not an audited financial statement.', ...(series.length ? [] : ['No booked orders in the window.'])], summary: series.length ? `Booked/collected/outstanding computed for ${series.length} currenc${series.length > 1 ? 'ies' : 'y'}.` : 'No booked orders in the window.', data: { coverage: series.length ? 1 : 0, series, definitions: { booked: 'sum(total) of non-draft, non-cancelled orders by booked date', collected: 'sum(paid_total)', outstanding: 'total - paid - returned for unpaid/partial orders' } } };
  },
};

const operationsDiagnostic: AgentDefinition = {
  role: 'operations_diagnostic', title: 'Operations Diagnostic', description: 'Overdue work, quotation bottlenecks and discount discipline.', domain: 'operations',
  tools: ['sales.activities', 'sales.quotes'], inputSchema: empty, completionCriteria: ['Cites overdue and bottleneck records'], autonomyCeiling: 1, maxCostUsd: 0.05,
  async handler(ctx) {
    const [a, qt] = [await tool<any>(ctx, 'sales.activities'), await tool<any>(ctx, 'sales.quotes')];
    if (!a && !qt) return NO_DATA(ctx, 'Operations data');
    const findings: Finding[] = [];
    if (qt?.expiredOpen.length) findings.push(f('operations_diagnostic.expired_open_quotes', 'operations.quotes', sev(qt.expiredOpen.length, 8, 3), `${qt.expiredOpen.length} quotation(s) are past validity but still open`, 'Expired quotes should be renewed or closed.', qt.expiredOpen.map((x: any) => ev('sales_quotations', `id=${x.id}`, `${x.number} valid to ${x.validity_date}`)), 0.95, { count: qt.expiredOpen.length }));
    if (qt?.pendingApproval >= 3) findings.push(f('operations_diagnostic.approval_backlog', 'operations.quotes', qt.pendingApproval >= 8 ? 'HIGH' : 'MEDIUM', `${qt.pendingApproval} quotations are waiting for approval`, 'A growing approval queue delays customers.', [ev('sales_quotations', 'status=pending_approval', `${qt.pendingApproval}`)], 0.95, { count: qt.pendingApproval }));
    if (qt?.heavyDiscount.length) findings.push(f('operations_diagnostic.heavy_discounting', 'operations.pricing', qt.heavyDiscount.length >= 5 ? 'MEDIUM' : 'LOW', `${qt.heavyDiscount.length} live quotation(s) carry a discount above 20%`, 'Discount level is recorded on each quote. Whether it is justified is a commercial decision.', qt.heavyDiscount.map((x: any) => ev('sales_quotations', `id=${x.id}`, `${x.number} ${x.discount}%`)), 0.95, { count: qt.heavyDiscount.length }));
    if (a?.totals.overdue >= 5) findings.push(f('operations_diagnostic.activity_backlog', 'operations.activities', sev(a.totals.overdue, 20, 5), `${a.totals.overdue} of ${a.totals.open} open activities are overdue`, 'Recurring delays in completing logged work.', a.overdueByType.map((x: any) => ev('sales_activities', `type=${x.type}`, `${x.n}`)), 0.9, { overdue: a.totals.overdue, open: a.totals.open }));
    return { findings, confidence: 0.85, evidence: [ev('sales_quotations', 'status'), ev('sales_activities', 'open')], uncertainties: ['Workforce and non-sales operations data are not connected, so only sales operations are assessed.'], summary: `${findings.length} operational finding(s).`, data: { coverage: [a, qt].filter(Boolean).length / 2, quoteStatus: qt?.statusCounts ?? null, activities: a?.totals ?? null } };
  },
};

const websiteAudit: AgentDefinition = {
  role: 'website_audit', title: 'Website Audit', description: 'Surfaces unresolved findings from the latest Website Intelligence audit.', domain: 'digital',
  tools: ['wi.latest_audit'], inputSchema: empty, completionCriteria: ['Only reports audits that actually ran', 'Page text is treated as untrusted data'], autonomyCeiling: 1, maxCostUsd: 0.02,
  async handler(ctx) {
    const d = await tool<any>(ctx, 'wi.latest_audit');
    if (!d) return { confidence: 0, uncertainties: ['Website audit history is not available to the orchestrator in this runtime (run audits from Website Intelligence on the API server).'], summary: 'Website audit data unavailable.', data: { coverage: 0 } };
    if (!d.audit) return { confidence: 0, uncertainties: ['No completed website audit exists yet.'], summary: 'No audit has been run.', data: { coverage: 0 } };
    const findings = (d.findings as any[]).map((x) => f(`website_audit.${x.id}`, 'digital.website', (x.severity as Severity) ?? 'LOW', String(x.title).slice(0, 160), String(x.detail ?? '').slice(0, 400), [ev('wi_findings', String(x.id), `${d.audit.url} (${d.audit.finished_at})`)], 0.8, { audit: d.audit.id }));
    return { findings, confidence: 0.8, evidence: [ev('wi_audits', String(d.audit.id), d.audit.url)], uncertainties: ['Synthetic lab audit; not real-user field data. Page content was treated as untrusted.'], summary: `Latest audit of ${d.audit.url}: ${findings.length} open finding(s).`, data: { coverage: 1, audit: d.audit } };
  },
};

const securityGovernance: AgentDefinition = {
  role: 'security_governance', title: 'Security & Governance', description: 'Verifies the audit chain and approval hygiene.', domain: 'governance',
  tools: ['gov.audit_chain', 'gov.approvals'], inputSchema: empty, completionCriteria: ['Audit chain verified by hash recomputation'], autonomyCeiling: 1, maxCostUsd: 0.01,
  async handler(ctx) {
    const [c, a] = [await tool<any>(ctx, 'gov.audit_chain'), await tool<any>(ctx, 'gov.approvals')];
    const findings: Finding[] = [];
    if (c && c.valid === false) findings.push(f('security_governance.audit_chain_broken', 'governance.audit', 'CRITICAL', 'The intelligence audit chain failed verification', 'A recomputed hash does not match: records were altered, removed or reordered.', [ev('intel_audit', 'hash chain', `${c.events} events checked`)], 0.99));
    if (a?.stalePending > 0) findings.push(f('security_governance.stale_approvals', 'governance.approvals', a.stalePending >= 5 ? 'MEDIUM' : 'LOW', `${a.stalePending} approval request(s) have waited more than 3 days`, 'Consequential actions are queued for a human decision.', [ev('intel_approvals', 'status=pending', `${a.stalePending}`)], 0.95, { count: a.stalePending }));
    return { findings, confidence: c ? 0.99 : 0.3, evidence: [ev('intel_audit', 'chain')], uncertainties: c ? [] : ['Audit chain could not be read.'], summary: c ? `Audit chain ${c.valid ? 'valid' : 'INVALID'} (${c.events} events); ${a?.pending ?? 0} pending approvals.` : 'Governance data unavailable.', data: { coverage: c ? 1 : 0, chain: c, approvals: a } };
  },
};

// ───────────────────────── directors ─────────────────────────
type Child = { role: string; task: string; out: AgentOutput | null; status: string };
async function runChildren(ctx: AgentContext, roles: string[], inputs: Record<string, Record<string, unknown>> = {}): Promise<Child[]> {
  const ids = await Promise.all(roles.map((r) => ctx.delegate(r, inputs[r] ?? {})));
  const done = await ctx.awaitTasks(ids);
  return done.map((t, i) => ({ role: roles[i], task: t.id, out: t.result, status: t.status }));
}
function merge(children: Child[], ctx: AgentContext): { findings: Finding[]; actions: ProposedAction[]; unc: string[]; evidence: EvidenceRef[] } {
  const seen = new Map<string, Finding>(), unc: string[] = [], actions: ProposedAction[] = [], evidence: EvidenceRef[] = [];
  for (const c of children) {
    if (!c.out) { unc.push(`${c.role} ${c.status}; its area is not assessed.`); ctx.markDegraded(`child_failed:${c.role}`); continue; }
    if (c.out.status === 'degraded') ctx.markDegraded(`child_degraded:${c.role}`);
    for (const x of c.out.findings) if (!seen.has(x.id)) seen.set(x.id, x);
    for (const u of c.out.uncertainties) if (!u.startsWith('degraded:')) unc.push(`${c.role}: ${u}`);
    evidence.push(...c.out.evidence.slice(0, 2));
  }
  return { findings: [...seen.values()], actions, unc: [...new Set(unc)], evidence };
}
const covOf = (cs: Child[], ...roles: string[]) => { const xs = cs.filter((c) => roles.includes(c.role)).map((c) => Number((c.out?.data as any)?.coverage ?? 0)); return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0; };
const domainValue = (fs: Finding[]) => Math.max(0, 100 - fs.reduce((s, x) => s + ({ CRITICAL: 40, HIGH: 20, MEDIUM: 8, LOW: 3, INFORMATIONAL: 0 } as const)[x.severity], 0));

const salesDirector: AgentDefinition = {
  role: 'sales_director', title: 'Sales Director', description: 'Coordinates lead, pipeline, forecast, customer, performance and data-quality analysts.', domain: 'sales',
  tools: [], inputSchema: empty, completionCriteria: ['All six analysts completed or their absence is stated', 'Findings de-duplicated by id'], autonomyCeiling: 1, maxCostUsd: 0.05, defaultTimeoutMs: 60_000,
  async handler(ctx) {
    const roles = ['lead_intelligence', 'opportunity_pipeline', 'sales_forecasting', 'customer_intelligence', 'sales_performance', 'data_quality'];
    const kids = await runChildren(ctx, roles); const m = merge(kids, ctx);
    return { findings: m.findings, evidence: m.evidence, confidence: kids.filter((k) => k.out).length / roles.length, uncertainties: m.unc, summary: `${m.findings.length} finding(s) from ${kids.filter((k) => k.out).length}/${roles.length} sales analysts.`,
      data: { coverage: covOf(kids, 'lead_intelligence', 'opportunity_pipeline', 'customer_intelligence', 'sales_performance'), children: kids.map((k) => ({ role: k.role, taskId: k.task, status: k.status })), results: Object.fromEntries(kids.map((k) => [k.role, k.out?.data ?? null])), sourceFindings: Object.fromEntries(kids.map((k) => [k.role, (k.out?.findings ?? []).length])) } };
  },
};

const businessDiagnosticDirector: AgentDefinition = {
  role: 'business_diagnostic_director', title: 'Business Diagnostic Director', description: 'Runs the diagnostic domains and computes a transparent business health score.', domain: 'diagnostics',
  tools: [], inputSchema: S.obj({ weights: S.obj({ sales: S.num({ min: 0, max: 1 }), financial: S.num({ min: 0, max: 1 }), operations: S.num({ min: 0, max: 1 }), data: S.num({ min: 0, max: 1 }) }, ['sales', 'financial', 'operations', 'data']) }, ['weights']),
  completionCriteria: ['Score withheld when coverage is insufficient', 'Weights and formula disclosed'], autonomyCeiling: 1, maxCostUsd: 0.05, defaultTimeoutMs: 90_000,
  async handler(ctx, input: { weights?: Record<string, number> }) {
    const kids = await runChildren(ctx, ['financial_diagnostic', 'operations_diagnostic', 'sales_director', 'data_quality']);
    const m = merge(kids, ctx), by = (prefixes: string[]) => m.findings.filter((x) => prefixes.some((p) => x.id.startsWith(p)));
    const w = { sales: 0.35, financial: 0.25, operations: 0.2, data: 0.2, ...(input.weights ?? {}) };
    const dq = kids.find((k) => k.role === 'data_quality')?.out;
    const domains: DomainScore[] = [
      { domain: 'sales', value: domainValue(by(['lead_intelligence', 'opportunity_pipeline', 'sales_forecasting', 'customer_intelligence', 'sales_performance'])), weight: w.sales, coverage: covOf(kids, 'sales_director') },
      { domain: 'financial', value: domainValue(by(['financial_diagnostic'])), weight: w.financial, coverage: covOf(kids, 'financial_diagnostic') },
      { domain: 'operations', value: domainValue(by(['operations_diagnostic'])), weight: w.operations, coverage: covOf(kids, 'operations_diagnostic') },
      { domain: 'data_reliability', value: (dq?.data as any)?.reliabilityScore ?? null, weight: w.data, coverage: covOf(kids, 'data_quality') },
    ];
    const hs = healthScore(domains);
    return { findings: m.findings, evidence: m.evidence, confidence: hs.score === null ? 0.3 : hs.dataCoverage, uncertainties: [...m.unc, ...(hs.score === null ? [`Health score withheld: ${hs.reason} (coverage ${Math.round(hs.dataCoverage * 100)}%).`] : [])],
      summary: hs.score === null ? 'Business health score withheld: insufficient data.' : `Business health ${hs.score}/100 on ${Math.round(hs.dataCoverage * 100)}% data coverage.`,
      data: { coverage: hs.dataCoverage, healthScore: hs, weights: w, method: 'Each domain = 100 minus penalties per open finding (CRITICAL 40, HIGH 20, MEDIUM 8, LOW 3), floored at 0; data reliability uses the data-quality score. Domains are combined with the weights shown, re-normalised over domains that have data. Not an audited measure.', children: kids.map((k) => ({ role: k.role, taskId: k.task, status: k.status })) } };
  },
};

const websiteDirector: AgentDefinition = {
  role: 'website_director', title: 'Website Intelligence Director', description: 'Coordinates website analysis agents.', domain: 'digital',
  tools: [], inputSchema: empty, completionCriteria: ['Reports unavailability honestly'], autonomyCeiling: 1, maxCostUsd: 0.02,
  async handler(ctx) {
    const kids = await runChildren(ctx, ['website_audit']); const m = merge(kids, ctx);
    return { findings: m.findings, evidence: m.evidence, confidence: kids[0]?.out?.confidence ?? 0, uncertainties: m.unc, summary: kids[0]?.out?.summary ?? 'Website analysis unavailable.', data: { coverage: covOf(kids, 'website_audit'), audit: (kids[0]?.out?.data as any)?.audit ?? null } };
  },
};

const recommendationPlanner: AgentDefinition = {
  role: 'recommendation_planner', title: 'Recommendation & Action Planning', description: 'Ranks findings into a transparent, de-duplicated action plan.', domain: 'planning',
  tools: [], inputSchema: S.obj({ findings: S.arr(S.any, 500) }), completionCriteria: ['Score = impact x confidence x urgency / (effort x risk)', 'Inputs shown for every item'], autonomyCeiling: 1, maxCostUsd: 0.02,
  async handler(_ctx, input: { findings: Finding[] }) {
    const seen = new Set<string>(), items: any[] = [];
    const impact = (s: Severity) => SEVERITY_WEIGHT[s];
    for (const x of input.findings) {
      if (seen.has(x.id)) continue; seen.add(x.id);
      const urgency = x.severity === 'CRITICAL' ? 5 : x.severity === 'HIGH' ? 4 : x.severity === 'MEDIUM' ? 3 : 2;
      const effort = /data_quality|no_|missing/.test(x.id) ? 2 : /concentration|decline|pipeline_below/.test(x.id) ? 4 : 3;
      const inputs = { impact: impact(x.severity), confidence: x.confidence, urgency, effort, risk: 2 };
      items.push({ findingId: x.id, title: x.title, severity: x.severity, evidenceStatus: x.status, inputs, score: Math.round(recommendationScore(inputs) * 100) / 100, owner: 'unassigned', successCriteria: 'Finding is no longer observed on the next reassessment.', verification: 'Re-run the diagnostic and confirm the finding id is absent.', dependsOn: x.id.startsWith('data_quality.') ? [] : seen.size && [...seen].some((i) => i.startsWith('data_quality.')) && /^(sales_forecasting|sales_performance|opportunity_pipeline)\./.test(x.id) ? ['data_quality (fix data first: results above may be distorted)'] : [] });
    }
    items.sort((a, b) => b.score - a.score || a.findingId.localeCompare(b.findingId));
    return { confidence: 0.9, evidence: [], uncertainties: ['Effort and risk are rule-of-thumb estimates by finding type, not project estimates; owners are unassigned until a person assigns them.'], summary: `${items.length} prioritised item(s).`, data: { coverage: 1, plan: items, formula: 'score = impact x confidence x urgency / (effort x risk); impact from severity, urgency from severity, effort/risk fixed per type' } };
  },
};

const chiefExecutive: AgentDefinition = {
  role: 'chief_executive', title: 'Chief Executive Intelligence', description: 'Runs the full executive brief across sales, diagnostics, website and governance.', domain: 'executive',
  tools: [], inputSchema: empty, completionCriteria: ['All directors completed or absence stated', 'Plan ranked by transparent score', 'AI narrative is optional and never alters figures'], autonomyCeiling: 1, maxCostUsd: 0.2, defaultTimeoutMs: 180_000,
  async handler(ctx) {
    const kids = await runChildren(ctx, ['business_diagnostic_director', 'website_director', 'security_governance']);
    const m = merge(kids, ctx);
    const plan = (await ctx.awaitTasks([await ctx.delegate('recommendation_planner', { findings: m.findings })]))[0];
    const diag = kids.find((k) => k.role === 'business_diagnostic_director')?.out?.data as any;
    let narrative: string | null = null;
    if (ctx.aiConfigured) {
      const facts = { health: diag?.healthScore?.score ?? null, coverage: diag?.coverage ?? null, top: ((plan.result?.data as any)?.plan ?? []).slice(0, 8).map((p: any) => ({ id: p.findingId, title: p.title, severity: p.severity })) };
      const r = await ctx.llmJson<{ narrative: string }>('executive_summary', 'You write a 4-sentence executive summary. Use ONLY the facts in the JSON. Do not invent numbers. Return {"narrative": string}.', JSON.stringify(facts), S.obj({ narrative: S.str({ min: 1, max: 1200 }) }));
      if (r.ok) narrative = r.value.narrative;
    }
    return { findings: m.findings, evidence: m.evidence, confidence: Math.min(...kids.map((k) => k.out?.confidence ?? 0).concat(1)), uncertainties: [...m.unc, ...(ctx.aiConfigured ? [] : ['AI narrative is not configured; all figures and rankings are deterministic.'])],
      summary: `${m.findings.length} finding(s); ${(plan.result?.data as any)?.plan?.length ?? 0} ranked action(s).`, data: { coverage: diag?.coverage ?? 0, healthScore: diag?.healthScore ?? null, plan: (plan.result?.data as any)?.plan ?? [], narrative, directors: kids.map((k) => ({ role: k.role, taskId: k.task, status: k.status })), plannerTaskId: plan.id } };
  },
};

export const ALL_AGENTS: AgentDefinition[] = [leadIntelligence, opportunityPipeline, salesForecasting, customerIntelligence, salesPerformance, dataQuality, financialDiagnostic, operationsDiagnostic, websiteAudit, securityGovernance, salesDirector, businessDiagnosticDirector, websiteDirector, recommendationPlanner, chiefExecutive];
export function buildAgentRegistry(): AgentRegistry { const r = new AgentRegistry(); for (const a of ALL_AGENTS) r.register(a); return r; }
