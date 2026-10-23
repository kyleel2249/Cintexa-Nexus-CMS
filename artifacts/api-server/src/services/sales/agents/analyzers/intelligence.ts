import { type AnalyzerCtx, type Finding, ev, focusedElsewhere, num, th } from "../types";
import { plural } from "./shared";

const d10 = (x: unknown) => (x ? String(x instanceof Date ? x.toISOString() : x).slice(0, 10) : null);
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : 0; };

// ─────────────────────────── Agent 14: Sales Performance & Coaching ───────────────────────────
export async function performanceCoaching(ctx: AnalyzerCtx): Promise<Finding[]> {
  if (ctx.focus) return [];
  const out: Finding[] = [];
  const minSample = th(ctx, "minClosedDeals", 5);
  const rows = (await ctx.q.query<any>(`SELECT m.id, m.display_name,
      count(o.id) FILTER (WHERE o.status = 'won')::int won, count(o.id) FILTER (WHERE o.status = 'lost')::int lost,
      COALESCE(avg(EXTRACT(EPOCH FROM (o.closed_at - o.created_at)) / 86400) FILTER (WHERE o.status = 'won'),0)::float8 cycle,
      (SELECT count(*) FROM sales_activities a WHERE a.owner_id = m.id AND a.status = 'done' AND a.completed_at > $1::timestamptz - interval '180 days')::int acts,
      (SELECT count(*) FROM sales_activities a WHERE a.owner_id = m.id AND a.status = 'open' AND COALESCE(a.due_at, a.start_at) < $1::timestamptz)::int overdue
    FROM sales_members m LEFT JOIN sales_opportunities o ON o.owner_id = m.id AND o.status IN ('won','lost') AND o.closed_at > $1::timestamptz - interval '180 days' AND o.archived_at IS NULL
    WHERE m.active AND m.role IN ('sales_rep','sales_manager') GROUP BY m.id, m.display_name`, [ctx.now.toISOString()])).rows;
  const eligible = rows.filter((r) => r.won + r.lost >= minSample);
  if (eligible.length >= 3) {
    const rates = eligible.map((r) => r.won / (r.won + r.lost) * 100);
    const med = median(rates);
    for (const r of eligible) {
      const rate = r.won / (r.won + r.lost) * 100;
      if (rate < med - 15) out.push({
        stage: "recommendation", severity: "medium", category: "efficiency", entityType: "member", entityId: r.id, ownerMemberId: r.id, dueInDays: 14,
        title: `Coaching opportunity: ${r.display_name ?? `member #${r.id}`}`, whatDetected: `Win rate ${rate.toFixed(0)}% over ${r.won + r.lost} closed deals versus a peer median of ${med.toFixed(0)}% (180 days). Overdue open activities: ${r.overdue}.`,
        whyItMatters: "A persistent gap suggests a skill or pipeline-quality issue worth a conversation.", action: "Manager to review the lost deals with the rep and agree one or two focus areas. This is a prompt for a conversation, not a conclusion about cause.",
        assumptions: { noCausalClaim: true, minimumSample: minSample, peers: eligible.length, caution: "Deal mix and territory differ between reps; volume of activity is not quality." },
        evidence: [ev("member", r.display_name ?? `#${r.id}`, null, r.id), ev("metric", "Win rate %", rate.toFixed(1)), ev("metric", "Peer median %", med.toFixed(1)), ev("metric", "Won/Lost", `${r.won}/${r.lost}`), ev("metric", "Avg won cycle days", r.cycle.toFixed(0))], dedupeKey: `perf:coach:${r.id}`,
      });
    }
    out.push({ stage: "metric", severity: "info", category: "info", title: "Team win-rate spread (180 days)", whatDetected: `Peer median win rate ${med.toFixed(0)}% across ${eligible.length} reps with at least ${minSample} closed deals.`, whyItMatters: "Baseline for coaching conversations.", evidence: [ev("metric", "Median win rate %", med.toFixed(1)), ev("metric", "Reps compared", eligible.length)], dedupeKey: "perf:spread" });
  } else out.push({ stage: "metric", severity: "info", category: "info", title: "Not enough closed deals for performance comparison", whatDetected: `Only ${eligible.length} rep(s) have at least ${minSample} closed deals in 180 days; comparisons would be unreliable so none were made.`, evidence: [ev("metric", "Eligible reps", eligible.length)], dedupeKey: "perf:insufficient" });
  const ac = (await ctx.q.query<any>(`SELECT o.status, avg(c.n)::float8 avg_acts, count(*)::int n FROM sales_opportunities o JOIN LATERAL (SELECT count(*)::int n FROM sales_activities a WHERE a.opportunity_id = o.id AND a.status = 'done') c ON TRUE WHERE o.status IN ('won','lost') AND o.closed_at > $1::timestamptz - interval '365 days' GROUP BY o.status`, [ctx.now.toISOString()])).rows;
  const won = ac.find((r: any) => r.status === "won"), lost = ac.find((r: any) => r.status === "lost");
  if (won && lost && won.n >= minSample && lost.n >= minSample) out.push({ stage: "metric", severity: "info", category: "info", title: "Completed activities per closed deal", whatDetected: `Won deals averaged ${won.avg_acts.toFixed(1)} completed activities; lost deals ${lost.avg_acts.toFixed(1)} (365 days).`, whyItMatters: "Shows whether effort and outcome move together here.", assumptions: { noCausalClaim: true, note: "Association only; activity count is not a quality measure." }, evidence: [ev("metric", "Won avg", won.avg_acts.toFixed(2)), ev("metric", "Lost avg", lost.avg_acts.toFixed(2))], dedupeKey: "perf:activity-outcome" });
  return out;
}

// ─────────────────────────── Agent 15: Territory & Team Optimisation ───────────────────────────
export async function territoryTeam(ctx: AnalyzerCtx): Promise<Finding[]> {
  if (ctx.focus) return [];
  const out: Finding[] = [];
  const { q } = ctx;
  const load = (await q.query<any>(`SELECT m.id, m.display_name,
    ((SELECT count(*) FROM sales_leads l WHERE l.owner_id = m.id AND l.status IN ('new','contacted','qualified','nurturing') AND l.archived_at IS NULL AND l.merged_into_id IS NULL)
   + (SELECT count(*) FROM sales_opportunities o WHERE o.owner_id = m.id AND o.status = 'open' AND o.archived_at IS NULL))::int load FROM sales_members m WHERE m.active AND m.role = 'sales_rep'`)).rows;
  if (load.length >= 3) {
    const med = median(load.map((r: any) => r.load));
    for (const r of load) if (med > 0 && r.load >= med * 2 && r.load - med >= 10) out.push({
      stage: "recommendation", severity: "medium", category: "efficiency", entityType: "member", entityId: r.id, ownerMemberId: r.id, dueInDays: 7, title: `Heavy workload: ${r.display_name ?? `member #${r.id}`}`,
      whatDetected: `${r.load} open leads and opportunities versus a team median of ${med}.`, whyItMatters: "Overloaded reps drop follow-ups while others have capacity.", action: "Manager to rebalance new leads toward lighter workloads. Strategic accounts are not moved automatically.",
      assumptions: { rule: "at least 2× the median and 10 more items", strategicAccounts: "never reassigned by an agent" }, evidence: [ev("member", r.display_name ?? `#${r.id}`, r.load, r.id), ev("metric", "Median load", med)], dedupeKey: `terr:load:${r.id}`,
    });
  }
  const noTerr = (await q.query<any>(`SELECT (SELECT count(*) FROM sales_accounts WHERE archived_at IS NULL AND merged_into_id IS NULL AND territory_id IS NULL)::int accounts, (SELECT count(*) FROM sales_leads l WHERE l.archived_at IS NULL AND l.merged_into_id IS NULL AND l.territory_id IS NULL AND l.status IN ('new','contacted','qualified','nurturing'))::int leads, (SELECT count(*) FROM sales_territories WHERE archived_at IS NULL)::int territories`)).rows[0];
  if (noTerr.territories > 0 && (noTerr.accounts > 0 || noTerr.leads > 0)) out.push({ stage: "metric", severity: "low", category: "efficiency", title: "Records without a territory", whatDetected: `${plural(noTerr.accounts, "account")} and ${plural(noTerr.leads, "active lead")} have no territory although ${noTerr.territories} territories are defined.`, whyItMatters: "Routing and territory reporting are incomplete.", action: "Assign territories or refine the territory rules.", evidence: [ev("metric", "Accounts", noTerr.accounts), ev("metric", "Leads", noTerr.leads)], dedupeKey: "terr:unassigned" });
  const orphan = (await q.query<any>(`SELECT m.id, m.display_name, (SELECT count(*) FROM sales_opportunities o WHERE o.owner_id = m.id AND o.status = 'open' AND o.archived_at IS NULL)::int opps, (SELECT count(*) FROM sales_leads l WHERE l.owner_id = m.id AND l.status IN ('new','contacted','qualified','nurturing') AND l.archived_at IS NULL)::int leads, (SELECT count(*) FROM sales_accounts a WHERE a.owner_id = m.id AND a.archived_at IS NULL)::int accounts FROM sales_members m WHERE NOT m.active`)).rows.filter((r: any) => r.opps + r.leads + r.accounts > 0);
  for (const r of orphan) out.push({ stage: "fact", severity: "high", category: "risk", entityType: "member", entityId: r.id, title: `Inactive member still owns records: ${r.display_name ?? `#${r.id}`}`, whatDetected: `${r.opps} open opportunities, ${r.leads} active leads and ${r.accounts} accounts are owned by an inactive member.`, whyItMatters: "Nobody is working these records.", action: "Reassign them (a manager decision; accounts are not moved by agents).", evidence: [ev("member", r.display_name ?? `#${r.id}`, null, r.id)], dedupeKey: `terr:orphan:${r.id}` });
  return out;
}

// ─────────────────────────── Agent 17: Customer Retention & Expansion ───────────────────────────
export async function retentionExpansion(ctx: AnalyzerCtx): Promise<Finding[]> {
  if (ctx.focus && ctx.focus.entityType !== "account") return [];
  const out: Finding[] = [];
  const { q, today, settings } = ctx;
  const ren = (await q.query<any>(`SELECT r.id, r.account_id, a.name, r.owner_id, a.owner_id aowner, r.description, r.expected_amount::text amount, r.renewal_on, (r.renewal_on - $1::date)::int days FROM sales_renewals r JOIN sales_accounts a ON a.id = r.account_id WHERE r.status = 'upcoming' AND r.renewal_on <= $1::date + 90 ORDER BY r.renewal_on LIMIT $2`, [today, ctx.limit])).rows;
  for (const r of ren) {
    const owner = r.owner_id ?? r.aowner;
    out.push({
      stage: "fact", severity: r.days < 0 ? "high" : r.days <= 30 ? "high" : "medium", category: "risk", entityType: "account", entityId: r.account_id, ownerMemberId: owner, dueInDays: Math.max(1, Math.min(7, r.days)), impactAmount: num(r.amount),
      title: `Renewal ${r.days < 0 ? "overdue" : `in ${plural(r.days, "day")}`}: ${r.name}`, whatDetected: `"${String(r.description ?? "Renewal").slice(0, 80)}" renews on ${d10(r.renewal_on)} (expected ${r.amount ?? "unknown"}).`,
      whyItMatters: "Renewals are the most predictable revenue and the easiest to lose by neglect.", action: "Account owner to confirm intent, update the customer and agree next steps.", expectedOutcome: "Renewal confirmed or the risk is recorded early.",
      evidence: [ev("renewal", String(r.description ?? "Renewal").slice(0, 80), d10(r.renewal_on), r.id), ev("account", r.name, null, r.account_id)], dedupeKey: `ret:renewal:${r.id}`,
      proposal: owner && r.days <= 30 ? { actionType: "notification.internal", entityType: "account", entityId: r.account_id, summary: `Alert owner: renewal for ${r.name}`, payload: { member_id: owner, kind: "renewal_approaching", title: `Renewal ${r.days < 0 ? "overdue" : `in ${plural(r.days, "day")}`}: ${r.name}`, link: `/sales/retention?account=${r.account_id}`, severity: "warning", dedupe_key: `agent:renewal:${r.id}:${today}` } } : undefined,
    });
  }
  const reorder = (await q.query<any>(`SELECT a.id, a.name, a.owner_id, a.expected_reorder_on, ($1::date - a.expected_reorder_on)::int days FROM sales_accounts a WHERE a.archived_at IS NULL AND a.merged_into_id IS NULL AND a.status = 'active' AND a.expected_reorder_on IS NOT NULL AND a.expected_reorder_on < $1::date - 7${ctx.focus ? ` AND a.id = ${Number(ctx.focus.entityId) | 0}` : ""} ORDER BY days DESC LIMIT $2`, [today, ctx.limit])).rows;
  for (const a of reorder) out.push({ stage: "prediction", severity: "medium", category: "risk", entityType: "account", entityId: a.id, ownerMemberId: a.owner_id, dueInDays: 5, title: `Reorder overdue: ${a.name}`, whatDetected: `Expected reorder date was ${d10(a.expected_reorder_on)} (${plural(a.days, "day")} ago) and no later order is recorded. The expected date is an estimate from past ordering, not a customer statement.`, whyItMatters: "A missed reorder cycle can be the first sign of a lost customer.", action: "Call to check stock and needs.", evidence: [ev("account", a.name, d10(a.expected_reorder_on), a.id)], dedupeKey: `ret:reorder:${a.id}` });
  if (!ctx.focus) {
    const grow = (await q.query<any>(`SELECT a.id, a.name, a.owner_id, r90.v::float8 now90, r180.v::float8 prev90 FROM sales_accounts a
      JOIN LATERAL (SELECT COALESCE(sum(net_total),0) v FROM sales_orders o WHERE o.account_id = a.id AND o.status <> 'cancelled' AND o.booked_at > $1::timestamptz - interval '90 days') r90 ON TRUE
      JOIN LATERAL (SELECT COALESCE(sum(net_total),0) v FROM sales_orders o WHERE o.account_id = a.id AND o.status <> 'cancelled' AND o.booked_at > $1::timestamptz - interval '180 days' AND o.booked_at <= $1::timestamptz - interval '90 days') r180 ON TRUE
      WHERE a.archived_at IS NULL AND a.status = 'active' AND r180.v > 0 AND r90.v >= r180.v * 1.25 ORDER BY r90.v DESC LIMIT 15`, [ctx.now.toISOString()])).rows;
    for (const a of grow) out.push({ stage: "recommendation", severity: "low", category: "opportunity", entityType: "account", entityId: a.id, ownerMemberId: a.owner_id, dueInDays: 14, impactAmount: a.now90, title: `Growing account: ${a.name}`, whatDetected: `Booked revenue in the last 90 days (${a.now90.toFixed(2)}) is at least 25% above the previous 90 days (${a.prev90.toFixed(2)}).`, whyItMatters: "Growing customers are the best expansion candidates.", action: "Review their needs for additional products or a larger agreement.", assumptions: { basis: "booked orders, non-cancelled" }, evidence: [ev("account", a.name, null, a.id), ev("metric", "Last 90d", a.now90.toFixed(2)), ev("metric", "Prior 90d", a.prev90.toFixed(2))], dedupeKey: `ret:expand:${a.id}` });
    const silent = (await q.query<any>(`SELECT a.id, a.name, a.owner_id, max(o.booked_at) last_order FROM sales_accounts a JOIN sales_orders o ON o.account_id = a.id AND o.status <> 'cancelled' WHERE a.archived_at IS NULL AND a.status = 'active' GROUP BY a.id HAVING max(o.booked_at) < $1::timestamptz - ($2 || ' days')::interval AND NOT EXISTS (SELECT 1 FROM sales_activities x WHERE x.account_id = a.id AND COALESCE(x.completed_at, x.start_at, x.created_at) > $1::timestamptz - interval '60 days') ORDER BY last_order DESC LIMIT 15`, [ctx.now.toISOString(), String(settings.retention.inactiveDays)])).rows;
    for (const a of silent) out.push({ stage: "prediction", severity: "medium", category: "risk", entityType: "account", entityId: a.id, ownerMemberId: a.owner_id, dueInDays: 10, title: `No orders or contact: ${a.name}`, whatDetected: `Last order ${d10(a.last_order)} (more than ${settings.retention.inactiveDays} days) and no recorded contact in 60 days.`, whyItMatters: "Silent customers are the likeliest to churn, but silence is not proof they will.", action: "Reach out with a genuine check-in.", assumptions: { indicatorOnly: true }, evidence: [ev("account", a.name, d10(a.last_order), a.id)], dedupeKey: `ret:silent:${a.id}` });
  }
  return out;
}

// ─────────────────────────── Agent 18: Sales Campaign Intelligence ───────────────────────────
export async function campaignIntel(ctx: AnalyzerCtx): Promise<Finding[]> {
  if (ctx.focus) return [];
  const out: Finding[] = [];
  const { q, today } = ctx;
  const rows = (await q.query<any>(`SELECT c.id, c.name, c.owner_id, c.status, c.starts_on, c.budget::float8 budget, c.spend::float8 spend, c.currency,
      (SELECT count(*) FROM sales_leads l WHERE l.campaign_id = c.id)::int leads,
      (SELECT count(*) FROM sales_leads l WHERE l.campaign_id = c.id AND l.status IN ('qualified','converted'))::int qualified,
      COALESCE((SELECT sum(o.amount) FROM sales_opportunities o WHERE o.campaign_id = c.id AND o.status = 'won'),0)::float8 won
    FROM sales_campaigns c WHERE c.archived_at IS NULL AND c.status IN ('active','completed','paused') LIMIT $1`, [ctx.limit])).rows;
  for (const c of rows) {
    const ageDays = c.starts_on ? Math.floor((Date.parse(today) - Date.parse(d10(c.starts_on)!)) / 86400000) : 0;
    if (c.spend > 0 && c.leads === 0 && ageDays >= 14) out.push({ stage: "fact", severity: "medium", category: "efficiency", entityType: "campaign", entityId: c.id, ownerMemberId: c.owner_id, dueInDays: 5, impactAmount: c.spend, title: `Campaign with spend but no leads: ${c.name}`, whatDetected: `${c.spend.toFixed(2)} ${c.currency} spent over ${ageDays} days with no attributed leads. Attribution depends on UTM/campaign tagging being used.`, whyItMatters: "Either the campaign is not working or it is not tracked.", action: "Check tracking first, then decide to pause or change the offer.", evidence: [ev("campaign", c.name, `${c.spend.toFixed(2)} spent`, c.id)], dedupeKey: `camp:noleads:${c.id}` });
    if (c.spend > 0 && c.leads >= 10) {
      const cpl = c.spend / c.leads;
      out.push({ stage: "metric", severity: "info", category: "info", entityType: "campaign", entityId: c.id, ownerMemberId: c.owner_id, title: `Campaign performance: ${c.name}`, whatDetected: `${c.leads} leads, ${c.qualified} qualified, cost per lead ${cpl.toFixed(2)}${c.won > 0 ? `, won revenue ${c.won.toFixed(2)} (return ${(((c.won - c.spend) / c.spend) * 100).toFixed(0)}%)` : ", no won revenue attributed yet"}.`, assumptions: { roi: "(attributed won revenue − spend) ÷ spend; only where spend is recorded", attributionModel: ctx.settings.attribution.model }, evidence: [ev("metric", "Leads", c.leads), ev("metric", "Cost per lead", cpl.toFixed(2))], dedupeKey: `camp:perf:${c.id}` });
    }
    if (c.budget > 0 && c.spend > c.budget) out.push({ stage: "fact", severity: "medium", category: "compliance", entityType: "campaign", entityId: c.id, ownerMemberId: c.owner_id, impactAmount: c.spend - c.budget, title: `Campaign over budget: ${c.name}`, whatDetected: `Spend ${c.spend.toFixed(2)} exceeds budget ${c.budget.toFixed(2)}.`, whyItMatters: "Overspend needs approval.", action: "Review and approve or pause.", evidence: [ev("campaign", c.name, null, c.id)], dedupeKey: `camp:over:${c.id}` });
  }
  const good = rows.filter((c: any) => c.spend > 0 && c.leads >= 10).map((c: any) => ({ ...c, cpl: c.spend / c.leads })).sort((a: any, b: any) => a.cpl - b.cpl);
  if (good.length >= 2 && good[good.length - 1].cpl >= good[0].cpl * 2) out.push({ stage: "recommendation", severity: "low", category: "opportunity", title: "Consider reallocating campaign budget", whatDetected: `${good[0].name} costs ${good[0].cpl.toFixed(2)} per lead versus ${good[good.length - 1].name} at ${good[good.length - 1].cpl.toFixed(2)}.`, whyItMatters: "Lead cost alone ignores lead quality.", action: "Compare qualified-lead and won-revenue rates before moving budget.", assumptions: { caution: "Cost per lead is not return; check quality first." }, evidence: [ev("campaign", good[0].name, good[0].cpl.toFixed(2), good[0].id), ev("campaign", good[good.length - 1].name, good[good.length - 1].cpl.toFixed(2), good[good.length - 1].id)], dedupeKey: "camp:realloc" });
  const fat = (await q.query<any>(`SELECT lead_id, count(*)::int n FROM sales_touches WHERE lead_id IS NOT NULL AND at > $1::timestamptz - interval '30 days' GROUP BY lead_id HAVING count(*) >= $2 ORDER BY n DESC LIMIT 20`, [ctx.now.toISOString(), th(ctx, "fatigueTouches", 5)])).rows;
  if (fat.length) out.push({ stage: "fact", severity: "low", category: "compliance", title: "Possible contact fatigue", whatDetected: `${plural(fat.length, "lead")} received ${th(ctx, "fatigueTouches", 5)} or more campaign touches in 30 days.`, whyItMatters: "Over-contacting raises unsubscribes and complaints.", action: "Apply frequency limits before the next send.", evidence: fat.slice(0, 5).map((f: any) => ev("lead", `Lead #${f.lead_id}`, `${f.n} touches`, f.lead_id)), dedupeKey: "camp:fatigue" });
  return out;
}

// ─────────────────────────── Agent 19: Competitor Intelligence ───────────────────────────
export async function competitorIntel(ctx: AnalyzerCtx): Promise<Finding[]> {
  if (ctx.focus) return [];
  const out: Finding[] = [];
  const { q } = ctx;
  const lost = (await q.query<any>(`SELECT c.id, c.name, count(*)::int n, COALESCE(sum(o.amount),0)::float8 amt FROM sales_opportunity_competitors oc JOIN sales_competitors c ON c.id = oc.competitor_id JOIN sales_opportunities o ON o.id = oc.opportunity_id WHERE oc.outcome = 'lost_to' AND o.closed_at > $1::timestamptz - interval '365 days' GROUP BY c.id, c.name ORDER BY n DESC, amt DESC LIMIT 5`, [ctx.now.toISOString()])).rows;
  for (const c of lost) if (c.n >= 2) out.push({ stage: "metric", severity: c.n >= 4 ? "high" : "medium", category: "risk", entityType: "competitor", entityId: c.id, impactAmount: c.amt, title: `Frequent in lost deals: ${c.name}`, whatDetected: `${c.name} is recorded as the winner in ${plural(c.n, "lost deal")} worth ${c.amt.toFixed(2)} in the last 365 days. This comes from competitor tags entered by sales reps.`, whyItMatters: "Repeated losses to one rival point to a positioning or price gap.", action: "Review those deals, check or build a battlecard, and verify claims about the rival.", assumptions: { source: "rep-entered opportunity competitor outcomes", verified: false }, evidence: [ev("competitor", c.name, `${c.n} losses`, c.id)], dedupeKey: `comp:lost:${c.id}` });
  const stale = (await q.query<any>(`SELECT i.id, i.title, c.id cid, c.name, i.observed_on, i.verified, i.confidence, i.kind FROM sales_competitor_intel i JOIN sales_competitors c ON c.id = i.competitor_id WHERE i.archived_at IS NULL AND i.kind IN ('pricing','product') AND (i.verified = FALSE OR i.observed_on < $1::date - 180) ORDER BY i.observed_on NULLS FIRST LIMIT 20`, [ctx.today])).rows;
  for (const i of stale) out.push({ stage: "fact", severity: "low", category: "compliance", entityType: "competitor", entityId: i.cid, title: `${i.verified ? "Outdated" : "Unverified"} competitor ${i.kind}: ${i.name}`, whatDetected: `"${String(i.title).slice(0, 80)}" ${i.verified ? `was last observed ${d10(i.observed_on)}` : "has not been verified"} (confidence ${i.confidence}).`, whyItMatters: "Battlecards built on stale or unverified claims mislead sales reps.", action: "Re-check the public source and update or verify the observation.", evidence: [ev("intel", String(i.title).slice(0, 80), d10(i.observed_on), i.id), ev("competitor", i.name, null, i.cid)], dedupeKey: `comp:stale:${i.id}` });
  const bare = (await q.query<any>(`SELECT c.id, c.name FROM sales_competitors c WHERE c.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM sales_competitor_intel i WHERE i.competitor_id = c.id AND i.archived_at IS NULL) LIMIT 20`)).rows;
  for (const c of bare) out.push({ stage: "fact", severity: "info", category: "efficiency", entityType: "competitor", entityId: c.id, title: `No evidence recorded: ${c.name}`, whatDetected: `${c.name} has no sourced observations, so no claim about it can be shown.`, whyItMatters: "Positioning needs evidence, not assumptions.", action: "Add sourced observations with URL and date.", evidence: [ev("competitor", c.name, null, c.id)], dedupeKey: `comp:bare:${c.id}` });
  return out;
}

// ─────────────────────────── Agent 20: Sales Reporting & Analytics ───────────────────────────
export async function reportingAnalytics(ctx: AnalyzerCtx): Promise<Finding[]> {
  if (ctx.focus) return [];
  const out: Finding[] = [];
  const { q, now } = ctx;
  const iso = now.toISOString();
  const b = (await q.query<any>(`SELECT COALESCE(sum(net_total) FILTER (WHERE booked_at > $1::timestamptz - interval '30 days'),0)::float8 cur, COALESCE(sum(net_total) FILTER (WHERE booked_at > $1::timestamptz - interval '60 days' AND booked_at <= $1::timestamptz - interval '30 days'),0)::float8 prev,
      count(*) FILTER (WHERE booked_at > $1::timestamptz - interval '30 days')::int n_cur, count(*) FILTER (WHERE booked_at > $1::timestamptz - interval '60 days' AND booked_at <= $1::timestamptz - interval '30 days')::int n_prev FROM sales_orders WHERE status <> 'cancelled' AND booked_at IS NOT NULL`, [iso])).rows[0];
  const def = (name: string, calc: string, src: string, period: string) => ({ metric: name, calculation: calc, source: src, period, aggregation: "as stated; cancelled orders excluded; each order counted once" });
  out.push({ stage: "metric", severity: "info", category: "info", title: "Booked revenue (30 days)", whatDetected: `${b.cur.toFixed(2)} from ${b.n_cur} orders; previous 30 days ${b.prev.toFixed(2)} from ${b.n_prev} orders.`, assumptions: def("Booked revenue", "sum of order net totals by booking date (not invoiced or collected)", "sales_orders", "rolling 30 days"), evidence: [ev("metric", "Booked 30d", b.cur.toFixed(2)), ev("metric", "Booked prior 30d", b.prev.toFixed(2))], dedupeKey: "rep:booked" });
  if (b.n_prev >= 5 && b.prev > 0) {
    const chg = (b.cur - b.prev) / b.prev * 100;
    if (Math.abs(chg) >= th(ctx, "anomalyPercent", 40)) out.push({ stage: "fact", severity: chg < 0 ? "high" : "low", category: chg < 0 ? "risk" : "opportunity", title: `Booked revenue ${chg < 0 ? "fell" : "rose"} ${Math.abs(chg).toFixed(0)}%`, whatDetected: `Booked revenue moved from ${b.prev.toFixed(2)} to ${b.cur.toFixed(2)} versus the previous 30 days (${b.n_prev} prior orders).`, whyItMatters: "A large swing deserves an explanation before it is reported upward.", action: "Check for large one-off orders, timing shifts or data-entry changes.", assumptions: { rule: `change of at least ${th(ctx, "anomalyPercent", 40)}% with at least 5 prior orders` }, evidence: [ev("metric", "Change %", chg.toFixed(1))], dedupeKey: `rep:anomaly:${now.toISOString().slice(0, 10)}` });
  }
  const f = (await q.query<any>(`SELECT (SELECT count(*) FROM sales_leads WHERE created_at > $1::timestamptz - interval '30 days')::int leads,
      (SELECT count(*) FROM sales_leads WHERE converted_at > $1::timestamptz - interval '30 days')::int converted,
      (SELECT count(*) FROM sales_opportunities WHERE status = 'won' AND closed_at > $1::timestamptz - interval '90 days')::int won,
      (SELECT count(*) FROM sales_opportunities WHERE status = 'lost' AND closed_at > $1::timestamptz - interval '90 days')::int lost,
      (SELECT COALESCE(avg(amount),0) FROM sales_opportunities WHERE status = 'won' AND closed_at > $1::timestamptz - interval '90 days')::float8 avg_deal,
      (SELECT COALESCE(avg(EXTRACT(EPOCH FROM (closed_at - created_at)) / 86400),0) FROM sales_opportunities WHERE status = 'won' AND closed_at > $1::timestamptz - interval '90 days')::float8 cycle,
      (SELECT COALESCE(sum(amount),0) FROM sales_opportunities WHERE status = 'open' AND archived_at IS NULL)::float8 pipeline`, [iso])).rows[0];
  out.push({ stage: "metric", severity: "info", category: "info", title: "Funnel summary", whatDetected: `Last 30 days: ${f.leads} leads created, ${f.converted} converted. Last 90 days: ${f.won} won, ${f.lost} lost${f.won + f.lost ? ` (win rate ${(f.won / (f.won + f.lost) * 100).toFixed(1)}%)` : ""}, average won deal ${f.avg_deal.toFixed(2)}, average cycle ${f.cycle.toFixed(0)} days. Open pipeline ${f.pipeline.toFixed(2)}.`, assumptions: def("Funnel", "counts by creation/conversion/closing date; win rate = won ÷ (won + lost); cycle = created to closed (won)", "sales_leads, sales_opportunities", "30 / 90 days"), evidence: [ev("metric", "Open pipeline", f.pipeline.toFixed(2))], dedupeKey: "rep:funnel" });
  return out;
}

// ─────────────────────────── Agent 21: Sales Automation & Workflow ───────────────────────────
export async function automationWorkflow(ctx: AnalyzerCtx): Promise<Finding[]> {
  if (ctx.focus) return [];
  const out: Finding[] = [];
  const { q, now } = ctx;
  const iso = now.toISOString();
  const runs = (await q.query<any>(`SELECT r.rule_id, ru.name, count(*)::int n, max(r.error) err FROM sales_automation_runs r JOIN sales_automation_rules ru ON ru.id = r.rule_id WHERE r.status IN ('failed','dead') AND r.started_at > $1::timestamptz - interval '7 days' AND NOT r.is_test GROUP BY r.rule_id, ru.name ORDER BY n DESC LIMIT 10`, [iso])).rows;
  for (const r of runs) out.push({ stage: "fact", severity: r.n >= 5 ? "high" : "medium", category: "risk", entityType: "automation_rule", entityId: r.rule_id, title: `Automation failing: ${r.name}`, whatDetected: `${plural(r.n, "failed or dead run")} in 7 days. Latest error: ${String(r.err ?? "none recorded").slice(0, 160)}.`, whyItMatters: "Failed automations silently drop work.", action: "Open the rule's execution history, fix the cause, then retry dead runs from the Automation screen.", evidence: [ev("automation_rule", r.name, `${r.n} failures`, r.rule_id)], dedupeKey: `auto:failing:${r.rule_id}` });
  const dead = (await q.query<any>(`SELECT kind, count(*)::int n FROM sales_outbox WHERE status IN ('dead','failed') GROUP BY kind`)).rows;
  for (const d of dead) out.push({ stage: "fact", severity: "high", category: "risk", title: `Outbox ${d.kind} items are failing`, whatDetected: `${plural(d.n, "queued external action")} of type ${d.kind} failed or are dead.`, whyItMatters: "Customers or systems have not received these messages or updates.", action: "Review the failure queue; non-idempotent operations are never retried blindly.", evidence: [ev("outbox", d.kind, d.n)], dedupeKey: `auto:outbox:${d.kind}` });
  const ev1 = (await q.query<any>(`SELECT count(*) FILTER (WHERE status = 'dead')::int dead, count(*) FILTER (WHERE status = 'pending' AND occurred_at < $1::timestamptz - interval '15 minutes')::int lagging FROM sales_events`, [iso])).rows[0];
  if (ev1.dead > 0) out.push({ stage: "fact", severity: "high", category: "risk", title: "Dead-lettered sales events", whatDetected: `${plural(ev1.dead, "event")} exhausted retries.`, whyItMatters: "Agent reactions to those events never happened.", action: "Inspect and retry from the Command Centre events panel.", evidence: [ev("metric", "Dead events", ev1.dead)], dedupeKey: "auto:events-dead" });
  if (ev1.lagging > 0) out.push({ stage: "metric", severity: "medium", category: "efficiency", title: "Event processing is lagging", whatDetected: `${plural(ev1.lagging, "event")} waited over 15 minutes. The background scheduler may be off (SALES_JOBS=off) or overloaded.`, action: "Check the scheduler.", evidence: [ev("metric", "Lagging events", ev1.lagging)], dedupeKey: "auto:events-lag" });
  const stuck = (await q.query<any>(`SELECT id FROM sales_approvals WHERE status = 'EXECUTING' AND updated_at < $1::timestamptz - interval '15 minutes' LIMIT 10`, [iso])).rows;
  for (const s of stuck) out.push({ stage: "fact", severity: "high", category: "risk", title: `Approval #${s.id} stuck in EXECUTING`, whatDetected: "Execution began more than 15 minutes ago and never finished (a crash or timeout).", action: "Verify the real-world effect before marking it failed or re-requesting; the system never retries it blindly.", evidence: [ev("approval", `#${s.id}`, null, s.id)], dedupeKey: `auto:stuck:${s.id}` });
  const failing = (await q.query<any>(`SELECT agent_key, count(*)::int n FROM sales_agent_executions WHERE status = 'failed' AND started_at > $1::timestamptz - interval '24 hours' GROUP BY agent_key HAVING count(*) >= 3`, [iso])).rows;
  for (const f of failing) out.push({ stage: "fact", severity: "medium", category: "risk", title: `Agent failing repeatedly: ${f.agent_key}`, whatDetected: `${f.n} failed runs in 24 hours.`, action: "Inspect execution logs; pause the agent if the cause is unclear.", evidence: [ev("agent", f.agent_key, `${f.n} failures`)], dedupeKey: `auto:agentfail:${f.agent_key}` });
  return out;
}

// ─────────────────────────── Agent 22: Sales Playback & Training ───────────────────────────
export async function playbackTraining(ctx: AnalyzerCtx): Promise<Finding[]> {
  if (ctx.focus) return [];
  const out: Finding[] = [];
  const { q, now } = ctx;
  const iso = now.toISOString();
  const notes = (await q.query<any>(`SELECT count(*) FILTER (WHERE meeting_notes IS NOT NULL AND btrim(meeting_notes) <> '')::int notes, count(*) FILTER (WHERE type IN ('meeting','call','demo'))::int sessions FROM sales_activities WHERE status = 'done' AND completed_at > $1::timestamptz - interval '90 days'`, [iso])).rows[0];
  out.push({ stage: "metric", severity: "info", category: "info", title: "Evidence available for interaction review", whatDetected: `${notes.notes} of ${notes.sessions} completed calls/meetings/demos in 90 days have written notes. No call recordings or transcripts are stored by this system, so none are analysed.`, whyItMatters: "Coaching conclusions are limited to what is recorded.", action: notes.sessions > 0 && notes.notes / notes.sessions < 0.5 ? "Ask reps to record meeting notes after each session." : undefined, evidence: [ev("metric", "With notes", notes.notes), ev("metric", "Sessions", notes.sessions)], dedupeKey: "train:evidence" });
  const reasons = (await q.query<any>(`SELECT lower(btrim(lost_reason)) reason, count(*)::int n FROM sales_opportunities WHERE status = 'lost' AND lost_reason IS NOT NULL AND closed_at > $1::timestamptz - interval '180 days' GROUP BY 1 HAVING count(*) >= 2 ORDER BY n DESC LIMIT 3`, [iso])).rows;
  const pb = (await q.query<any>(`SELECT count(*)::int n FROM sales_playbook_articles WHERE status = 'published' AND kind IN ('objection','negotiation','closing')`)).rows[0].n;
  if (reasons.length && pb === 0) out.push({ stage: "recommendation", severity: "medium", category: "efficiency", title: "Common loss reasons have no playbook guidance", whatDetected: `Top loss reasons: ${reasons.map((r: any) => `"${String(r.reason).slice(0, 40)}" (${r.n})`).join(", ")}. No published objection, negotiation or closing article exists.`, whyItMatters: "Reps handle repeat objections better with approved responses.", action: "Create playbook articles for the top reasons, using wins against the same objection as source material.", evidence: reasons.map((r: any) => ev("lost_reason", String(r.reason).slice(0, 60), r.n)), dedupeKey: "train:objection-gap" });
  const req = (await q.query<any>(`SELECT count(*)::int n FROM sales_playbook_articles WHERE status = 'published' AND kind IN ('training','onboarding')`)).rows[0].n;
  if (req > 0) {
    const gaps = (await q.query<any>(`SELECT m.id, m.display_name, $1::int - (SELECT count(*) FROM sales_training_completions c JOIN sales_playbook_articles a ON a.id = c.article_id WHERE c.member_id = m.id AND a.status = 'published' AND a.kind IN ('training','onboarding'))::int AS missing FROM sales_members m WHERE m.active AND m.role = 'sales_rep'`, [req])).rows.filter((g: any) => g.missing > 0);
    for (const g of gaps.slice(0, 20)) out.push({ stage: "fact", severity: "low", category: "efficiency", entityType: "member", entityId: g.id, ownerMemberId: g.id, dueInDays: 14, title: `Training incomplete: ${g.display_name ?? `member #${g.id}`}`, whatDetected: `${plural(g.missing, "published training or onboarding article")} not yet completed.`, whyItMatters: "Untrained reps produce inconsistent customer conversations.", action: "Schedule time to complete the material.", evidence: [ev("member", g.display_name ?? `#${g.id}`, `${g.missing} missing`, g.id)], dedupeKey: `train:incomplete:${g.id}` });
  }
  return out;
}

// ─────────────────────────── Agent 23: Sales Document Intelligence ───────────────────────────
export async function documentIntel(ctx: AnalyzerCtx): Promise<Finding[]> {
  if (ctx.focus) return [];
  const out: Finding[] = [];
  const { q, now } = ctx;
  const old = (await q.query<any>(`SELECT d.kind, d.title, d.entity_type, d.entity_id, array_agg(d.id ORDER BY d.version) ids, max(d.version)::int latest, count(*)::int n FROM sales_documents d WHERE d.archived_at IS NULL GROUP BY d.kind, d.title, d.entity_type, d.entity_id HAVING count(*) > 1 AND count(DISTINCT d.version) > 1 LIMIT 20`)).rows;
  for (const d of old) out.push({ stage: "fact", severity: "low", category: "compliance", title: `Several versions active: ${String(d.title).slice(0, 60)}`, whatDetected: `${d.n} non-archived versions of this ${d.kind} exist (latest v${d.latest}).`, whyItMatters: "People may use an outdated version.", action: "Archive superseded versions; version history is kept.", evidence: (d.ids as number[]).map((id) => ev("document", `Document #${id}`, null, id)), dedupeKey: `doc:versions:${d.ids[0]}` });
  const orphan = (await q.query<any>(`SELECT count(*)::int n FROM sales_documents WHERE archived_at IS NULL AND entity_id IS NULL AND created_at < $1::timestamptz - interval '30 days'`, [now.toISOString()])).rows[0].n;
  if (orphan > 0) out.push({ stage: "metric", severity: "info", category: "efficiency", title: "Documents not linked to a record", whatDetected: `${plural(orphan, "document")} older than 30 days are not linked to a lead, account, opportunity, quotation or order. Classification uses metadata only; document text is not read or executed by any agent.`, whyItMatters: "Unlinked documents are hard to find and cannot inherit access rules.", action: "Link them to the right record.", evidence: [ev("metric", "Unlinked documents", orphan)], dedupeKey: "doc:orphans" });
  const unsigned = (await q.query<any>(`SELECT x.id, x.number, x.owner_id FROM sales_quotations x WHERE x.status = 'accepted' AND x.accepted_at < $1::timestamptz - interval '7 days' AND NOT EXISTS (SELECT 1 FROM sales_orders o WHERE o.quotation_id = x.id AND o.status <> 'cancelled') LIMIT 15`, [now.toISOString()])).rows;
  for (const x of unsigned) out.push({ stage: "fact", severity: "high", category: "risk", entityType: "quotation", entityId: x.id, ownerMemberId: x.owner_id, dueInDays: 2, title: `Accepted quotation not converted: ${x.number}`, whatDetected: `${x.number} was accepted more than 7 days ago and no order exists.`, whyItMatters: "Accepted business that is not booked is revenue at risk of being forgotten.", action: "Convert the quotation to a sales order.", evidence: [ev("quotation", x.number, null, x.id)], dedupeKey: `doc:accepted-unconverted:${x.id}` });
  return out;
}

// ─────────────────────────── Agent 24: Sales Administration & Governance ───────────────────────────
export async function adminGovernance(ctx: AnalyzerCtx): Promise<Finding[]> {
  if (ctx.focus) return [];
  const out: Finding[] = [];
  const { q, settings, integrations } = ctx;
  const admins = (await q.query<any>(`SELECT count(*)::int n FROM sales_members WHERE active AND role = 'sales_admin'`)).rows[0].n;
  if (admins === 0) out.push({ stage: "fact", severity: "critical", category: "compliance", title: "No active Sales Administrator", whatDetected: "No active member has the sales_admin role.", whyItMatters: "Nobody can change protected settings, policies or agents.", action: "Assign the sales_admin role (SALES_ADMIN_EMAILS can bootstrap one).", evidence: [ev("metric", "Active admins", 0)], dedupeKey: "gov:no-admin" });
  else if (admins > 3) out.push({ stage: "metric", severity: "low", category: "compliance", title: "Many Sales Administrators", whatDetected: `${admins} active members hold the highest role.`, whyItMatters: "Least privilege reduces risk.", action: "Review whether each needs full administrative access.", evidence: [ev("metric", "Active admins", admins)], dedupeKey: "gov:many-admins" });
  const i = settings.integrations;
  const miss: Array<[string, boolean, boolean]> = [["email", i.email.enabled, integrations.email], ["whatsapp", i.whatsapp.enabled, integrations.whatsapp], ["inventory", i.inventory.enabled, integrations.inventory], ["finance", i.finance.enabled, integrations.finance], ["ai", i.ai.enabled, integrations.ai]];
  for (const [name, enabled, installed] of miss) if (enabled && !installed) out.push({ stage: "fact", severity: "medium", category: "compliance", title: `Integration enabled but not installed: ${name}`, whatDetected: `Settings enable the ${name} integration but no adapter is installed in this deployment, so actions stay queued and nothing is claimed as sent.`, whyItMatters: "Teams may assume the integration works.", action: "Install and verify the adapter, or turn the setting off.", evidence: [ev("setting", `integrations.${name}.enabled`, "true")], dedupeKey: `gov:integration:${name}` });
  const stages = (await q.query<any>(`SELECT pipeline_id, name, probability::float8 p FROM sales_pipeline_stages WHERE kind = 'open' AND archived_at IS NULL ORDER BY pipeline_id, position`)).rows;
  let prev: any = null;
  for (const s of stages) { if (prev && prev.pipeline_id === s.pipeline_id && s.p < prev.p) out.push({ stage: "fact", severity: "low", category: "compliance", title: `Stage probability decreases: ${s.name}`, whatDetected: `"${s.name}" (${s.p}%) has a lower probability than the stage before it "${prev.name}" (${prev.p}%).`, whyItMatters: "Distorts the weighted forecast.", action: "Review stage probabilities.", evidence: [ev("stage", s.name, `${s.p}%`)], dedupeKey: `gov:stage-prob:${s.pipeline_id}:${s.name}` }); prev = s; }
  const d = settings.discounts;
  if (!(d.repMaxPercent <= d.managerMaxPercent && d.managerMaxPercent <= d.directorMaxPercent)) out.push({ stage: "fact", severity: "medium", category: "compliance", title: "Discount limits are not ordered", whatDetected: `Rep ${d.repMaxPercent}%, manager ${d.managerMaxPercent}%, director ${d.directorMaxPercent}%: limits should not decrease with seniority.`, whyItMatters: "Approval routing may behave unexpectedly.", action: "Correct the discount policy in Settings.", evidence: [ev("setting", "discounts", `${d.repMaxPercent}/${d.managerMaxPercent}/${d.directorMaxPercent}`)], dedupeKey: "gov:discount-order" });
  const agents = (await q.query<any>(`SELECT key, name, level, use_ai FROM sales_agents WHERE status = 'active'`)).rows;
  for (const a of agents.filter((x: any) => x.level === 3)) out.push({ stage: "metric", severity: "info", category: "compliance", title: `Autonomous execution enabled: ${a.name}`, whatDetected: `${a.name} runs at level 3 and may execute policy-allowed internal actions without per-action approval. Protected actions still require approval.`, whyItMatters: "Visibility of where autonomy is granted.", evidence: [ev("agent", a.key, "level 3")], dedupeKey: `gov:level3:${a.key}` });
  if (agents.some((a: any) => a.use_ai) && !(i.ai.enabled && i.ai.allowExternalProvider)) out.push({ stage: "metric", severity: "info", category: "compliance", title: "AI narration is off", whatDetected: "Agents are set to use AI but the administrator has not enabled AI and external-provider use in Settings, so they run deterministically.", whyItMatters: "Record data is only sent to a third-party AI provider when an administrator allows it.", evidence: [ev("setting", "integrations.ai", `enabled=${i.ai.enabled}, external=${i.ai.allowExternalProvider}`)], dedupeKey: "gov:ai-off" });
  const pend = (await q.query<any>(`SELECT count(*)::int n FROM sales_approvals WHERE status = 'PENDING' AND created_at < $1::timestamptz - interval '48 hours'`, [ctx.now.toISOString()])).rows[0].n;
  if (pend > 0) out.push({ stage: "metric", severity: "medium", category: "efficiency", title: "Approvals waiting over 48 hours", whatDetected: `${plural(pend, "approval")} have been pending for more than 48 hours and will expire if not decided.`, action: "Approvers should clear the queue.", evidence: [ev("metric", "Pending > 48h", pend)], dedupeKey: "gov:approval-backlog" });
  return out;
}
void focusedElsewhere;
