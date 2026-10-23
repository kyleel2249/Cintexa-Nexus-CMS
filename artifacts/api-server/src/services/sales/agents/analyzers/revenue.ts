import { type AnalyzerCtx, type Finding, ev, focusSql, focusedElsewhere, num, th } from "../types";
import { plural } from "./shared";
import { accountHealth } from "../../modules/health-data";
import { rangeFor } from "../../core/time";
import { lineTotals, documentTotals, cmp } from "../../core/money";
import { accuracyOf } from "../../domain/forecast";

const d10 = (x: unknown) => (x ? String(x instanceof Date ? x.toISOString() : x).slice(0, 10) : null);

// ─────────────────────────── Agent 5: Account & Customer Intelligence ───────────────────────────
export async function accountIntel(ctx: AnalyzerCtx): Promise<Finding[]> {
  if (ctx.focus && ctx.focus.entityType !== "account") return [];
  const out: Finding[] = [];
  const { q, now, settings } = ctx;
  const top = (await q.query<any>(`SELECT a.id, a.name, a.owner_id, COALESCE(sum(o.net_total),0)::numeric(18,2)::text rev365, count(o.id)::int orders
    FROM sales_accounts a LEFT JOIN sales_orders o ON o.account_id = a.id AND o.status <> 'cancelled' AND o.booked_at >= $1::timestamptz - interval '365 days'
    WHERE a.archived_at IS NULL AND a.merged_into_id IS NULL AND a.status IN ('active','inactive')${focusSql(ctx, "account", "a.id")}
    GROUP BY a.id ORDER BY sum(o.net_total) DESC NULLS LAST LIMIT $2`, [now.toISOString(), Math.min(ctx.limit, 60)])).rows;
  const total = num((await q.query<any>(`SELECT COALESCE(sum(net_total),0)::numeric(18,2)::text t FROM sales_orders WHERE status <> 'cancelled' AND booked_at >= $1::timestamptz - interval '365 days'`, [now.toISOString()])).rows[0]?.t);
  const concentration = th(ctx, "concentrationPercent", 25);
  for (const a of top) {
    const rev = num(a.rev365);
    if (!ctx.focus && total > 0 && rev / total * 100 >= concentration) out.push({
      stage: "metric", severity: "medium", category: "risk", entityType: "account", entityId: a.id, ownerMemberId: a.owner_id, impactAmount: rev,
      title: `Customer concentration: ${a.name}`, whatDetected: `${a.name} accounts for ${(rev / total * 100).toFixed(1)}% of booked revenue in the last 365 days (${rev.toFixed(2)} of ${total.toFixed(2)}).`,
      whyItMatters: "Heavy dependence on one customer makes revenue fragile.", action: "Protect the relationship and grow other accounts; agree an executive sponsor.", assumptions: { thresholdPercent: concentration, basis: "booked net revenue, 365 days, excluding cancelled orders" },
      evidence: [ev("account", a.name, null, a.id), ev("metric", "Revenue 365d", a.rev365), ev("metric", "Total booked 365d", total.toFixed(2))], dedupeKey: `acct:concentration:${a.id}`,
    });
    if (a.orders > 0 || ctx.focus) {
      const h = await accountHealth(q, a.id, settings.retention, now);
      if (h.band === "at_risk" || h.band === "watch") out.push({
        stage: "prediction", severity: h.band === "at_risk" ? "high" : "medium", category: "risk", entityType: "account", entityId: a.id, ownerMemberId: a.owner_id, impactAmount: rev, dueInDays: 7,
        title: `Account health ${h.band.replace("_", " ")}: ${a.name}`, whatDetected: `Health score ${h.score} based on recorded orders, complaints and activities. This is an indicator, not a confirmed intention to leave.`,
        whyItMatters: "Declining engagement usually precedes lost revenue.", action: "Account owner to review the signals and plan a check-in.", expectedOutcome: "Engagement restored or risk confirmed early.",
        assumptions: { source: "deterministic health model in Sales settings", reasons: h.reasons }, evidence: [ev("account", a.name, `score ${h.score}`, a.id), ...h.reasons.slice(0, 5).map((r) => ev("signal", r))], dedupeKey: `acct:health:${a.id}`,
      });
    }
  }
  const peers = th(ctx, "crossSellMinPeers", 3);
  const cross = (await q.query<any>(`SELECT a.id account_id, a.name aname, a.owner_id, p.id product_id, p.name pname, count(DISTINCT b.id)::int peers
    FROM sales_accounts a JOIN sales_accounts b ON b.industry = a.industry AND b.id <> a.id AND b.archived_at IS NULL
    JOIN sales_orders o2 ON o2.account_id = b.id AND o2.status NOT IN ('cancelled','draft')
    JOIN sales_order_lines l2 ON l2.order_id = o2.id JOIN sales_products p ON p.id = l2.product_id AND p.archived_at IS NULL
    WHERE a.archived_at IS NULL AND a.merged_into_id IS NULL AND a.status = 'active' AND a.industry IS NOT NULL${focusSql(ctx, "account", "a.id")}
      AND EXISTS (SELECT 1 FROM sales_orders o4 WHERE o4.account_id = a.id AND o4.status NOT IN ('cancelled','draft'))
      AND NOT EXISTS (SELECT 1 FROM sales_orders o3 JOIN sales_order_lines l3 ON l3.order_id = o3.id WHERE o3.account_id = a.id AND l3.product_id = p.id AND o3.status <> 'cancelled')
    GROUP BY a.id, a.name, a.owner_id, p.id, p.name HAVING count(DISTINCT b.id) >= $1 ORDER BY peers DESC LIMIT $2`, [peers, 30])).rows;
  for (const c of cross) out.push({
    stage: "recommendation", severity: "low", category: "opportunity", entityType: "account", entityId: c.account_id, ownerMemberId: c.owner_id, dueInDays: 14,
    title: `Cross-sell idea: ${c.pname} for ${c.aname}`, whatDetected: `${plural(c.peers, "customer")} in the same industry buy ${c.pname}; ${c.aname} never has.`, whyItMatters: "Existing customers are the cheapest source of new revenue.",
    action: "Check fit with the customer and raise it at the next conversation.", assumptions: { basis: "peer purchase counts by identical industry label", note: "Correlation only; fit is not confirmed." }, evidence: [ev("account", c.aname, null, c.account_id), ev("product", c.pname, `${c.peers} peer customers`, c.product_id)], dedupeKey: `acct:xsell:${c.account_id}:${c.product_id}`,
  });
  const complaints = (await q.query<any>(`SELECT f.id, f.subject, f.account_id, a.name, a.owner_id, ($1::date - f.created_at::date)::int age FROM sales_feedback f JOIN sales_accounts a ON a.id = f.account_id WHERE f.kind = 'complaint' AND f.status IN ('open','in_progress') AND f.created_at < $1::date - 14${focusSql(ctx, "account", "f.account_id")} ORDER BY f.created_at LIMIT 30`, [ctx.today])).rows;
  for (const f of complaints) out.push({
    stage: "fact", severity: "high", category: "risk", entityType: "account", entityId: f.account_id, ownerMemberId: f.owner_id, dueInDays: 2,
    title: `Unresolved complaint: ${f.name}`, whatDetected: `Complaint "${String(f.subject).slice(0, 80)}" has been open ${plural(f.age, "day")}.`, whyItMatters: "Unresolved complaints are a leading churn driver.", action: "Resolve or escalate and update the customer.", evidence: [ev("feedback", String(f.subject).slice(0, 80), `${f.age} days`, f.id), ev("account", f.name, null, f.account_id)], dedupeKey: `acct:complaint:${f.id}`,
  });
  return out;
}

// ─────────────────────────── Agent 7: Opportunity & Pipeline Intelligence ───────────────────────────
export async function opportunityPipeline(ctx: AnalyzerCtx): Promise<Finding[]> {
  if (focusedElsewhere(ctx, "opportunity")) return [];
  const out: Finding[] = [];
  const { q, today, settings } = ctx;
  const minScore = th(ctx, "healthThreshold", 60);
  const opps = (await q.query<any>(`SELECT o.id, o.number, o.name, o.owner_id, o.amount::text amount, o.currency, o.expected_close_date, o.close_date_changes, o.next_action_date, o.last_activity_at, o.stage_entered_at, o.created_at, o.account_id,
      s.name stage, COALESCE(s.stalled_after_days, 21)::int stall_days,
      (SELECT count(*) FROM sales_contacts c WHERE c.account_id = o.account_id AND c.archived_at IS NULL)::int contacts,
      (SELECT count(*) FROM sales_activities a WHERE a.opportunity_id = o.id AND a.status = 'done')::int done_acts
    FROM sales_opportunities o JOIN sales_pipeline_stages s ON s.id = o.stage_id WHERE o.status = 'open' AND o.archived_at IS NULL${focusSql(ctx, "opportunity", "o.id")} ORDER BY o.amount DESC LIMIT $1`, [ctx.limit])).rows;
  for (const o of opps) {
    const deductions: Array<[string, number]> = [];
    const idle = Math.max(0, Math.floor((ctx.now.getTime() - new Date(o.last_activity_at ?? o.stage_entered_at ?? o.created_at).getTime()) / 86400000));
    if (idle > o.stall_days) deductions.push([`No activity for ${idle} days (stage limit ${o.stall_days})`, 25]); else if (idle > o.stall_days / 2) deductions.push([`Activity ${idle} days ago (over half the stage limit)`, 10]);
    const close = d10(o.expected_close_date);
    if (close && close < today) deductions.push([`Expected close date ${close} has passed`, 20]);
    if (!close) deductions.push(["No expected close date", 10]);
    if (o.close_date_changes >= 2) deductions.push([`Close date moved ${o.close_date_changes} times`, Math.min(20, o.close_date_changes * 7)]);
    if (!o.next_action_date) deductions.push(["No dated next action", 10]);
    if (o.contacts === 0) deductions.push(["No contacts recorded on the account", 10]);
    if (num(o.amount) === 0) deductions.push(["Amount is zero", 10]);
    if (o.done_acts === 0) deductions.push(["No completed activity recorded", 10]);
    const score = Math.max(0, 100 - deductions.reduce((a, [, n]) => a + n, 0));
    if (score >= minScore) continue;
    out.push({
      stage: "recommendation", severity: score < 30 ? "high" : "medium", category: "risk", entityType: "opportunity", entityId: o.id, ownerMemberId: o.owner_id, dueInDays: 3, impactAmount: num(o.amount),
      title: `Deal health ${score}/100: ${o.name}`, whatDetected: `${o.number} in stage "${o.stage}" scores ${score}/100. Each deduction below is a recorded fact about the deal.`,
      whyItMatters: "Low-health deals rarely close on the forecast date and overstate the pipeline.",
      action: deductions.some(([t]) => t.includes("next action")) ? "Agree and record a dated next step with the buyer." : "Resolve the highest deductions first, starting with the buyer conversation.",
      expectedOutcome: "Health score recovers above the threshold or the forecast is corrected.",
      assumptions: { scoring: "100 minus listed deductions; weights are fixed in code and shown here", threshold: minScore },
      evidence: [ev("opportunity", `${o.number} ${o.name}`, `${o.amount} ${o.currency}`, o.id), ...deductions.map(([t, n]) => ev("deduction", t, -n))], dedupeKey: `pipe:health:${o.id}`,
    });
  }
  if (!ctx.focus) {
    const moves = (await q.query<any>(`SELECT h.opportunity_id id, o.number, o.name, o.owner_id, fs.name from_name, ts.name to_name, fs.position fp, ts.position tp, h.at
      FROM sales_opportunity_stage_history h JOIN sales_opportunities o ON o.id = h.opportunity_id JOIN sales_pipeline_stages ts ON ts.id = h.to_stage_id JOIN sales_pipeline_stages fs ON fs.id = h.from_stage_id
      WHERE o.status = 'open' AND h.at > $1::timestamptz - interval '14 days' AND (ts.position < fs.position OR ts.position - fs.position >= 3) ORDER BY h.at DESC LIMIT 25`, [ctx.now.toISOString()])).rows;
    for (const m of moves) out.push({
      stage: "fact", severity: "low", category: "compliance", entityType: "opportunity", entityId: m.id, ownerMemberId: m.owner_id,
      title: `Unusual stage move: ${m.name}`, whatDetected: `${m.number} moved from "${m.from_name}" to "${m.to_name}" (${m.tp < m.fp ? "backwards" : "skipping stages"}).`, whyItMatters: "Backward or skipped moves can indicate data errors or inflated stages.", action: "Confirm the stage is accurate.", evidence: [ev("opportunity", m.number, null, m.id)], dedupeKey: `pipe:move:${m.id}:${new Date(m.at).toISOString().slice(0, 10)}`,
    });
    const wl = (await q.query<any>(`SELECT count(*) FILTER (WHERE status = 'won')::int won, count(*) FILTER (WHERE status = 'lost')::int lost FROM sales_opportunities WHERE closed_at >= $1::timestamptz - interval '365 days' AND archived_at IS NULL`, [ctx.now.toISOString()])).rows[0];
    if (wl.won + wl.lost > 0) out.push({
      stage: "metric", severity: "info", category: "info", title: "Historical win rate (365 days)", whatDetected: `${wl.won} won and ${wl.lost} lost of ${wl.won + wl.lost} closed opportunities (${(wl.won / (wl.won + wl.lost) * 100).toFixed(1)}%).`,
      whyItMatters: "Used to judge whether stage probabilities are realistic.", assumptions: { sample: wl.won + wl.lost, minimumForCalibration: settings.forecast.minimumClosedDeals, reliable: wl.won + wl.lost >= settings.forecast.minimumClosedDeals },
      evidence: [ev("metric", "Won", wl.won), ev("metric", "Lost", wl.lost)], dedupeKey: "pipe:winrate",
    });
    const tgt = await companyTarget(ctx);
    if (tgt) {
      const open = num((await q.query<any>(`SELECT COALESCE(sum(amount),0)::text t FROM sales_opportunities WHERE status = 'open' AND archived_at IS NULL AND expected_close_date BETWEEN $1::date AND $2::date`, [tgt.startsOn, tgt.endsOn])).rows[0].t);
      const gap = Math.max(0, tgt.amount - tgt.booked);
      const minCover = th(ctx, "minCoverage", 3);
      if (gap > 0) {
        const cover = open / gap;
        if (cover < minCover) out.push({
          stage: "metric", severity: cover < 1 ? "high" : "medium", category: "risk", impactAmount: gap, title: `Pipeline coverage ${cover.toFixed(2)}x of remaining target`,
          whatDetected: `Open pipeline closing in ${tgt.name} is ${open.toFixed(2)} against a remaining target of ${gap.toFixed(2)} (target ${tgt.amount.toFixed(2)}, booked ${tgt.booked.toFixed(2)}).`,
          whyItMatters: "Thin coverage means the target depends on near-perfect conversion.", action: "Generate pipeline: prioritise high-fit leads and re-engage lost-recently accounts.", assumptions: { coverageRule: `${minCover}x is a configurable threshold, not a law`, basis: "company booked revenue target" },
          evidence: [ev("target", tgt.name, tgt.amount.toFixed(2)), ev("metric", "Open pipeline in period", open.toFixed(2)), ev("metric", "Booked", tgt.booked.toFixed(2))], dedupeKey: `pipe:coverage:${tgt.periodId}`,
        });
      }
    }
  }
  return out;
}

async function companyTarget(ctx: AnalyzerCtx): Promise<{ periodId: number; name: string; startsOn: string; endsOn: string; amount: number; booked: number } | null> {
  const r = (await ctx.q.query<any>(`SELECT p.id, p.name, p.starts_on, p.ends_on, t.amount::text amount FROM sales_target_periods p JOIN sales_targets t ON t.period_id = p.id AND t.scope = 'company' AND t.metric = 'revenue' AND t.basis = 'booked'
    WHERE p.status = 'approved' AND p.starts_on <= $1::date AND p.ends_on >= $1::date ORDER BY p.ends_on - p.starts_on LIMIT 1`, [ctx.today])).rows[0];
  if (!r) return null;
  const booked = num((await ctx.q.query<any>(`SELECT COALESCE(sum(net_total),0)::text t FROM sales_orders WHERE status <> 'cancelled' AND booked_at::date BETWEEN $1::date AND $2::date`, [d10(r.starts_on), d10(r.ends_on)])).rows[0].t);
  return { periodId: r.id, name: r.name, startsOn: d10(r.starts_on)!, endsOn: d10(r.ends_on)!, amount: num(r.amount), booked };
}

// ─────────────────────────── Agent 9: Sales Targets & Quotas ───────────────────────────
export async function targetsQuotas(ctx: AnalyzerCtx): Promise<Finding[]> {
  if (ctx.focus) return [];
  const out: Finding[] = [];
  const { q, today } = ctx;
  const avgDeal = num((await q.query<any>(`SELECT COALESCE(avg(amount),0)::text a FROM sales_opportunities WHERE status = 'won' AND closed_at >= $1::timestamptz - interval '365 days'`, [ctx.now.toISOString()])).rows[0].a);
  const rows = (await q.query<any>(`SELECT t.id, t.scope, t.scope_id, t.scope_key, t.metric, t.basis, t.amount::text amount, t.alert_threshold_percent::float8 alert, p.id period_id, p.name pname, p.starts_on, p.ends_on
    FROM sales_targets t JOIN sales_target_periods p ON p.id = t.period_id WHERE p.status = 'approved' AND p.starts_on <= $1::date AND p.ends_on >= $1::date AND t.metric = 'revenue' AND t.scope IN ('company','member') LIMIT $2`, [today, ctx.limit])).rows;
  for (const t of rows) {
    if (t.basis !== "booked") { out.push({ stage: "fact", severity: "info", category: "info", title: `Target basis "${t.basis}" not evaluated`, whatDetected: `Target #${t.id} uses the ${t.basis} basis; the agent only evaluates booked revenue here so that booked, invoiced and collected figures are never mixed.`, evidence: [ev("target", `${t.pname} ${t.scope}`, t.amount, t.id)], dedupeKey: `target:basis:${t.id}` }); continue; }
    const start = d10(t.starts_on)!, end = d10(t.ends_on)!;
    const actual = num((await q.query<any>(`SELECT COALESCE(sum(net_total),0)::text s FROM sales_orders WHERE status <> 'cancelled' AND booked_at::date BETWEEN $1::date AND $2::date ${t.scope === "member" ? "AND owner_id = $3" : ""}`, t.scope === "member" ? [start, end, t.scope_id] : [start, end])).rows[0].s);
    const total = (Date.parse(end) - Date.parse(start)) / 86400000 + 1, elapsed = Math.min(total, Math.max(1, (Date.parse(today) - Date.parse(start)) / 86400000 + 1));
    const amount = num(t.amount);
    if (amount <= 0) continue;
    const attainment = actual / amount * 100, expected = amount * elapsed / total;
    const pace = expected > 0 ? actual / expected * 100 : 100;
    if (pace < t.alert && actual < amount) {
      const gap = amount - actual, remainingDays = Math.max(0, total - elapsed);
      const dealsNeeded = avgDeal > 0 ? Math.ceil(gap / avgDeal) : null;
      out.push({
        stage: "prediction", severity: pace < t.alert / 2 ? "high" : "medium", category: "risk", entityType: t.scope === "member" ? "member" : undefined, entityId: t.scope === "member" ? t.scope_id : undefined, ownerMemberId: t.scope === "member" ? t.scope_id : null, impactAmount: gap, dueInDays: 3,
        title: `${t.scope === "member" ? `Member #${t.scope_id}` : "Company"} behind ${t.pname} target`, whatDetected: `Booked ${actual.toFixed(2)} of ${amount.toFixed(2)} (${attainment.toFixed(1)}%). At this point in the period the pace is ${pace.toFixed(0)}% of straight-line expectation; alert threshold ${t.alert}%.`,
        whyItMatters: "Corrective action is most effective early in the period.", action: dealsNeeded ? `Close roughly ${dealsNeeded} more deals at the historical average deal size (${avgDeal.toFixed(2)}) in the remaining ${remainingDays} days, or agree a recovery plan.` : "Agree a recovery plan; no historical won deals exist to size the required activity.",
        assumptions: { paceModel: "straight-line within the period (no seasonality)", averageDealSize: avgDeal.toFixed(2), averageBasis: "won opportunities, 365 days", note: "Booked, invoiced and collected revenue are not interchangeable; this uses booked orders." },
        evidence: [ev("target", `${t.pname} ${t.scope}`, amount.toFixed(2), t.id), ev("metric", "Booked in period", actual.toFixed(2)), ev("metric", "Elapsed", `${elapsed.toFixed(0)}/${total.toFixed(0)} days`)], dedupeKey: `target:behind:${t.id}`,
      });
    }
  }
  const periods = (await q.query<any>(`SELECT p.id, p.name, c.amount::text company, (SELECT COALESCE(sum(m.amount),0) FROM sales_targets m WHERE m.period_id = p.id AND m.scope = 'member' AND m.metric = 'revenue' AND m.basis = 'booked')::text members
    FROM sales_target_periods p JOIN sales_targets c ON c.period_id = p.id AND c.scope = 'company' AND c.metric = 'revenue' AND c.basis = 'booked' WHERE p.status IN ('approved','pending_approval')`)).rows;
  for (const p of periods) if (cmp(Number(p.members).toFixed(2), "0.00") > 0 && Math.abs(num(p.members) - num(p.company)) / Math.max(1, num(p.company)) > 0.2) out.push({
    stage: "fact", severity: "low", category: "compliance", title: `Quota allocation differs from company target: ${p.name}`, whatDetected: `Member revenue targets total ${num(p.members).toFixed(2)} versus a company target of ${num(p.company).toFixed(2)} (more than 20% apart).`,
    whyItMatters: "Over-allocation is common and intentional; under-allocation leaves target unowned.", action: "Confirm the difference is intended.", evidence: [ev("target", p.name, p.company, p.id)], dedupeKey: `target:alloc:${p.id}`,
  });
  return out;
}

// ─────────────────────────── Agent 10: Product & Price Book Intelligence ───────────────────────────
export async function productPricebook(ctx: AnalyzerCtx): Promise<Finding[]> {
  if (ctx.focus) return [];
  const out: Finding[] = [];
  const { q, settings, today } = ctx;
  const noprice = (await q.query<any>(`SELECT p.id, p.sku, p.name FROM sales_products p WHERE p.archived_at IS NULL AND p.status = 'active' AND COALESCE(p.base_price,0) = 0 AND NOT EXISTS (SELECT 1 FROM sales_price_book_entries e WHERE e.product_id = p.id) LIMIT $1`, [ctx.limit])).rows;
  for (const p of noprice) out.push({ stage: "fact", severity: "medium", category: "compliance", entityType: "product", entityId: p.id, title: `Active product has no price: ${p.name}`, whatDetected: `${p.name} (${p.sku ?? "no SKU"}) has a zero base price and no price book entry.`, whyItMatters: "It cannot be quoted correctly; approved prices are never invented.", action: "Add an approved price or deactivate the product.", evidence: [ev("product", p.name, p.sku, p.id)], dedupeKey: `price:none:${p.id}` });
  const incomplete = (await q.query<any>(`SELECT count(*)::int n FROM sales_products WHERE archived_at IS NULL AND status = 'active' AND (sku IS NULL OR btrim(sku) = '' OR description IS NULL OR btrim(description) = '')`)).rows[0].n;
  if (incomplete > 0) out.push({ stage: "metric", severity: "low", category: "compliance", title: "Products missing SKU or description", whatDetected: `${plural(incomplete, "active product")} lack a SKU or description.`, whyItMatters: "Incomplete products produce unclear quotations.", action: "Complete the product records.", evidence: [ev("metric", "Incomplete products", incomplete)], dedupeKey: "price:incomplete" });
  const expired = (await q.query<any>(`SELECT id, name, valid_to FROM sales_price_books WHERE active AND archived_at IS NULL AND valid_to IS NOT NULL AND valid_to < $1::date LIMIT 20`, [today])).rows;
  for (const b of expired) out.push({ stage: "fact", severity: "medium", category: "compliance", title: `Price book expired but still active: ${b.name}`, whatDetected: `Price book #${b.id} ended on ${d10(b.valid_to)} and is still marked active.`, whyItMatters: "Quotations may be using outdated pricing.", action: "Renew or deactivate the price book.", evidence: [ev("price_book", b.name, d10(b.valid_to), b.id)], dedupeKey: `price:expired:${b.id}` });
  const maxDisc = settings.discounts.directorMaxPercent;
  const disc = (await q.query<any>(`SELECT x.id, x.number, x.owner_id, x.total::text total, max(l.discount_percent)::float8 maxd FROM sales_quotations x JOIN sales_quotation_lines l ON l.quotation_id = x.id WHERE x.created_at > $1::timestamptz - interval '90 days' AND x.status NOT IN ('cancelled','superseded') GROUP BY x.id HAVING max(l.discount_percent) > $2 ORDER BY maxd DESC LIMIT 20`, [ctx.now.toISOString(), maxDisc])).rows;
  for (const x of disc) out.push({ stage: "fact", severity: "high", category: "compliance", entityType: "quotation", entityId: x.id, ownerMemberId: x.owner_id, impactAmount: num(x.total), title: `Discount above policy: ${x.number}`, whatDetected: `${x.number} has a line discount of ${x.maxd}%, above the director limit of ${maxDisc}%.`, whyItMatters: "Discounts beyond policy erode margin and need explicit approval.", action: "Check that an exceptional-discount approval exists.", evidence: [ev("quotation", x.number, `${x.maxd}%`, x.id), ev("setting", "Director max discount", `${maxDisc}%`)], dedupeKey: `price:discount:${x.id}` });
  const lowm = (await q.query<any>(`SELECT id, number, owner_id, margin_percent::float8 m FROM sales_quotations WHERE status IN ('draft','internal_review','pending_approval','approved','sent','viewed') AND margin_percent IS NOT NULL AND margin_percent < $1 LIMIT 20`, [settings.discounts.minMarginPercent])).rows;
  for (const x of lowm) out.push({ stage: "fact", severity: "medium", category: "compliance", entityType: "quotation", entityId: x.id, ownerMemberId: x.owner_id, title: `Margin below policy: ${x.number}`, whatDetected: `${x.number} has a margin of ${x.m}%, below the minimum ${settings.discounts.minMarginPercent}%.`, whyItMatters: "Sub-minimum margin needs approval.", action: "Review pricing or obtain approval.", evidence: [ev("quotation", x.number, `${x.m}%`, x.id)], dedupeKey: `price:margin:${x.id}` });
  const drift = (await q.query<any>(`SELECT x.id, x.number, x.owner_id, p.name, l.list_price::text listed, p.base_price::text current FROM sales_quotations x JOIN sales_quotation_lines l ON l.quotation_id = x.id JOIN sales_products p ON p.id = l.product_id WHERE x.status IN ('draft','internal_review') AND l.list_price IS NOT NULL AND p.base_price > 0 AND l.list_price <> p.base_price LIMIT 20`)).rows;
  for (const d of drift) out.push({ stage: "fact", severity: "low", category: "compliance", entityType: "quotation", entityId: d.id, ownerMemberId: d.owner_id, title: `Draft quotation uses an outdated list price: ${d.number}`, whatDetected: `${d.name} is listed at ${d.listed} on the draft but the current base price is ${d.current}. Historical prices on sent quotations are intentionally preserved.`, whyItMatters: "Customers should be quoted the current approved price unless a different price was agreed.", action: "Refresh the line or confirm the agreed price.", evidence: [ev("quotation", d.number, null, d.id), ev("product", d.name, `${d.listed} vs ${d.current}`)], dedupeKey: `price:drift:${d.id}:${d.name}` });
  return out;
}

// ─────────────────────────── Agent 11: Quotation & Proposal ───────────────────────────
export async function quotationProposal(ctx: AnalyzerCtx): Promise<Finding[]> {
  if (focusedElsewhere(ctx, "quotation")) return [];
  const out: Finding[] = [];
  const { q, today, settings } = ctx;
  const win = settings.quotations.expiryReminderDays;
  const expiring = (await q.query<any>(`SELECT x.id, x.number, x.owner_id, x.status, x.total::text total, x.currency, x.validity_date, x.opportunity_id, c.id contact_id, c.first_name, c.email, c.consent_email, c.unsubscribed_at, a.name account_name,
      (x.validity_date - $1::date)::int days_left
    FROM sales_quotations x JOIN sales_accounts a ON a.id = x.account_id LEFT JOIN sales_contacts c ON c.id = x.contact_id
    WHERE x.status IN ('sent','viewed') AND x.validity_date BETWEEN $1::date AND $1::date + $2::int${focusSql(ctx, "quotation", "x.id")} ORDER BY x.validity_date LIMIT $3`, [today, win, ctx.limit])).rows;
  for (const x of expiring) {
    const canEmail = x.email && x.consent_email && !x.unsubscribed_at;
    const body = `Hello ${x.first_name ?? "there"},\n\nA quick reminder that quotation ${x.number} remains valid until ${d10(x.validity_date)}. If you have any questions or would like to go ahead, please reply to this message.\n\nKind regards`;
    out.push({
      stage: canEmail ? "proposed_action" : "recommendation", severity: x.days_left <= 2 ? "high" : "medium", category: "opportunity", entityType: "quotation", entityId: x.id, ownerMemberId: x.owner_id, dueInDays: Math.max(0, x.days_left - 1), impactAmount: num(x.total),
      title: `Quotation ${x.number} expires in ${plural(x.days_left, "day")}`, whatDetected: `${x.number} for ${x.account_name} (${x.total} ${x.currency}) is ${x.status} and valid until ${d10(x.validity_date)}.`, whyItMatters: "Quotes that lapse without contact are rarely accepted later.",
      action: canEmail ? "Send the prepared reminder after approval." : "Call the customer; no email with recorded consent is available for this quotation's contact.", expectedOutcome: "Customer responds before the quotation expires.",
      assumptions: { messageIsDraft: true, consentChecked: Boolean(canEmail) }, evidence: [ev("quotation", x.number, `${x.total} ${x.currency}`, x.id), ev("metric", "Days to expiry", x.days_left), ev("consent", "Email consent recorded", canEmail ? "yes" : "no")], dedupeKey: `quote:expiring:${x.id}`,
      proposal: canEmail ? { actionType: "message.customer", entityType: "quotation", entityId: x.id, summary: `Email quotation reminder for ${x.number}`, amount: x.total, currency: x.currency, payload: { channel: "email", to: x.email, contact_id: x.contact_id, subject: `Reminder: quotation ${x.number}`, body, quotation_id: x.id } } : undefined,
    });
  }
  const live = (await q.query<any>(`SELECT x.id, x.number, x.owner_id, x.total::text total, x.net_total::text net, x.tax_total::text tax, x.subtotal::text sub, x.discount_total::text disc FROM sales_quotations x WHERE x.status NOT IN ('superseded','cancelled','rejected','expired')${focusSql(ctx, "quotation", "x.id")} ORDER BY x.updated_at DESC LIMIT $1`, [ctx.limit])).rows;
  for (const x of live) {
    const lines = (await q.query<any>(`SELECT quantity::text qty, unit_price::text up, discount_percent::text dp, discount_amount::text da, tax_rate::text tr FROM sales_quotation_lines WHERE quotation_id = $1`, [x.id])).rows;
    if (!lines.length) continue;
    const calc = documentTotals(lines.map((l: any) => lineTotals({ quantity: l.qty, unitPrice: l.up, discountPercent: l.dp, discountAmount: l.da, taxRate: l.tr }, settings.business.rounding)));
    const stored = Number(x.total).toFixed(2);
    if (calc.total !== stored) out.push({
      stage: "fact", severity: "critical", category: "compliance", entityType: "quotation", entityId: x.id, ownerMemberId: x.owner_id, impactAmount: Math.abs(num(calc.total) - num(stored)),
      title: `Quotation total does not reconcile: ${x.number}`, whatDetected: `Recomputing the lines gives ${calc.total} but ${x.number} stores ${stored}. Calculated by deterministic code, not by an AI model.`, whyItMatters: "A wrong total is a contractual and financial error.", action: "Open the quotation, review the lines and re-save to recalculate before sending.",
      evidence: [ev("quotation", x.number, null, x.id), ev("calc", "Recomputed total", calc.total), ev("stored", "Stored total", stored)], dedupeKey: `quote:mismatch:${x.id}`,
    });
  }
  if (!ctx.focus) {
    const r = (await q.query<any>(`SELECT count(*) FILTER (WHERE status = 'accepted')::int acc, count(*) FILTER (WHERE status = 'rejected')::int rej, count(*) FILTER (WHERE status = 'expired')::int exp FROM sales_quotations WHERE sent_at > $1::timestamptz - interval '90 days'`, [ctx.now.toISOString()])).rows[0];
    const decided = r.acc + r.rej + r.exp;
    if (decided > 0) {
      const reasons = (await q.query<any>(`SELECT lower(btrim(rejected_reason)) reason, count(*)::int n FROM sales_quotations WHERE status = 'rejected' AND rejected_reason IS NOT NULL AND sent_at > $1::timestamptz - interval '90 days' GROUP BY 1 ORDER BY n DESC LIMIT 3`, [ctx.now.toISOString()])).rows;
      out.push({ stage: "metric", severity: "info", category: "info", title: "Quotation outcomes (90 days)", whatDetected: `${r.acc} accepted, ${r.rej} rejected, ${r.exp} expired of ${decided} decided quotations (${(r.acc / decided * 100).toFixed(1)}% accepted).`, whyItMatters: "Shows how well quotations convert and why they fail.", assumptions: { definition: "accepted ÷ (accepted + rejected + expired), quotations sent in the last 90 days", sample: decided }, evidence: [ev("metric", "Accepted", r.acc), ev("metric", "Rejected", r.rej), ev("metric", "Expired", r.exp), ...reasons.map((x: any) => ev("rejection_reason", x.reason, x.n))], dedupeKey: "quote:outcomes" });
    }
  }
  return out;
}

// ─────────────────────────── Agent 12: Sales Order & Commercial Execution ───────────────────────────
export async function salesOrder(ctx: AnalyzerCtx): Promise<Finding[]> {
  if (focusedElsewhere(ctx, "order")) return [];
  const out: Finding[] = [];
  const { q, today } = ctx;
  const f = focusSql(ctx, "order", "o.id");
  const late = (await q.query<any>(`SELECT o.id, o.number, o.owner_id, o.total::text total, o.currency, o.requested_delivery_on, ($1::date - o.requested_delivery_on)::int days FROM sales_orders o WHERE o.status IN ('confirmed','processing','partially_fulfilled') AND o.requested_delivery_on < $1::date${f} ORDER BY days DESC LIMIT $2`, [today, ctx.limit])).rows;
  for (const o of late) out.push({ stage: "fact", severity: "high", category: "risk", entityType: "order", entityId: o.id, ownerMemberId: o.owner_id, impactAmount: num(o.total), dueInDays: 1, title: `Order ${o.number} past requested delivery`, whatDetected: `${o.number} was requested by ${d10(o.requested_delivery_on)} (${plural(o.days, "day")} ago) and is not fulfilled. Fulfilment status is taken from the order record only.`, whyItMatters: "Late delivery damages the customer relationship and delays payment.", action: "Check the blocker with operations and update the customer.", evidence: [ev("order", o.number, `${o.total} ${o.currency}`, o.id)], dedupeKey: `order:late:${o.id}` });
  const blocked = (await q.query<any>(`SELECT o.id, o.number, o.owner_id FROM sales_orders o WHERE o.inventory_status = 'unavailable' AND o.status NOT IN ('cancelled','completed','fulfilled')${f} LIMIT $1`, [ctx.limit])).rows;
  for (const o of blocked) out.push({ stage: "fact", severity: "high", category: "risk", entityType: "order", entityId: o.id, ownerMemberId: o.owner_id, dueInDays: 1, title: `Order ${o.number} blocked: stock unavailable`, whatDetected: `The inventory provider reported ${o.number} as unavailable.`, whyItMatters: "The order cannot ship until stock is resolved.", action: "Agree a revised date with the customer or source the stock.", evidence: [ev("order", o.number, "inventory unavailable", o.id)], dedupeKey: `order:blocked:${o.id}` });
  const unpaid = (await q.query<any>(`SELECT o.id, o.number, o.owner_id, (o.total - o.paid_total)::text due, o.currency, ($1::date - o.invoice_due_on)::int days FROM sales_orders o WHERE o.invoice_due_on < $1::date AND o.payment_status IN ('unpaid','partial') AND o.status <> 'cancelled'${f} ORDER BY days DESC LIMIT $2`, [today, ctx.limit])).rows;
  for (const o of unpaid) out.push({ stage: "fact", severity: o.days > 30 ? "high" : "medium", category: "risk", entityType: "order", entityId: o.id, ownerMemberId: o.owner_id, impactAmount: num(o.due), title: `Overdue payment on ${o.number}`, whatDetected: `Invoice due ${plural(o.days, "day")} ago; recorded outstanding amount ${o.due} ${o.currency}. Payment status is from recorded payments only.`, whyItMatters: "Overdue receivables hurt cash flow.", action: "Finance to follow up per credit policy.", evidence: [ev("order", o.number, `${o.due} ${o.currency}`, o.id)], dedupeKey: `order:overdue-pay:${o.id}` });
  const broken = (await q.query<any>(`SELECT o.id, o.number, o.owner_id, o.net_total::text net, COALESCE((SELECT sum(l.net) FROM sales_order_lines l WHERE l.order_id = o.id),0)::text lines, (SELECT count(*) FROM sales_order_lines l WHERE l.order_id = o.id)::int n FROM sales_orders o WHERE o.status NOT IN ('cancelled','draft')${f} AND (NOT EXISTS (SELECT 1 FROM sales_order_lines l WHERE l.order_id = o.id) OR o.net_total <> COALESCE((SELECT sum(l.net) FROM sales_order_lines l WHERE l.order_id = o.id),0)) LIMIT $1`, [ctx.limit])).rows;
  for (const o of broken) out.push({ stage: "fact", severity: "critical", category: "compliance", entityType: "order", entityId: o.id, ownerMemberId: o.owner_id, title: `Order ${o.number} fails validation`, whatDetected: o.n === 0 ? `${o.number} has no order lines.` : `Order net total ${o.net} does not equal the sum of its lines (${o.lines}).`, whyItMatters: "Totals must reconcile before fulfilment and invoicing.", action: "Correct the order through the Sales Orders screen.", evidence: [ev("order", o.number, null, o.id), ev("calc", "Sum of lines", o.lines), ev("stored", "Order net total", o.net)], dedupeKey: `order:invalid:${o.id}` });
  if (!ctx.focus) {
    const dup = (await q.query<any>(`SELECT quotation_id, array_agg(id ORDER BY id) ids, count(*)::int n FROM sales_orders WHERE quotation_id IS NOT NULL AND status <> 'cancelled' GROUP BY 1 HAVING count(*) > 1 LIMIT 20`)).rows;
    for (const d of dup) out.push({ stage: "fact", severity: "critical", category: "compliance", entityType: "order", entityId: d.ids[0], title: "Duplicate orders for one quotation", whatDetected: `${d.n} active orders reference quotation #${d.quotation_id} (order ids ${d.ids.join(", ")}).`, whyItMatters: "Likely double booking.", action: "Cancel the duplicate after checking with the customer.", evidence: (d.ids as number[]).map((id) => ev("order", `Order #${id}`, null, id)), dedupeKey: `order:dup:${d.quotation_id}` });
  }
  return out;
}

// ─────────────────────────── Agent 13: Sales Forecasting ───────────────────────────
function wilson(wins: number, n: number): { low: number; high: number } {
  const z = 1.96, p = wins / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n), m = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
  return { low: Math.max(0, (c - m) / d), high: Math.min(1, (c + m) / d) };
}
export async function forecasting(ctx: AnalyzerCtx): Promise<Finding[]> {
  if (ctx.focus) return [];
  const out: Finding[] = [];
  const { q, settings, now } = ctx;
  const range = rangeFor("quarter", now, settings.business.timezone, settings.business.weekStartsOn);
  const f = (await q.query<any>(`SELECT
      COALESCE(sum(amount) FILTER (WHERE status = 'won'),0)::float8 closed,
      COALESCE(sum(amount) FILTER (WHERE status = 'open' AND forecast_category = 'commit'),0)::float8 commit,
      COALESCE(sum(amount) FILTER (WHERE status = 'open' AND forecast_category = 'best_case'),0)::float8 best,
      COALESCE(sum(amount * probability / 100) FILTER (WHERE status = 'open' AND forecast_category <> 'omitted'),0)::float8 weighted,
      COALESCE(max(amount) FILTER (WHERE status = 'open'),0)::float8 biggest, count(*) FILTER (WHERE status = 'open')::int open_n
    FROM sales_opportunities WHERE archived_at IS NULL AND ((status = 'open' AND expected_close_date >= $1::timestamptz::date AND expected_close_date < $2::timestamptz::date) OR (status = 'won' AND closed_at >= $1::timestamptz AND closed_at < $2::timestamptz))`, [range.from, range.to])).rows[0];
  const wl = (await q.query<any>(`SELECT count(*) FILTER (WHERE status = 'won')::int won, count(*)::int n FROM sales_opportunities WHERE status IN ('won','lost') AND closed_at >= $1::timestamptz - interval '365 days' AND archived_at IS NULL`, [now.toISOString()])).rows[0];
  const enough = wl.n >= settings.forecast.minimumClosedDeals;
  const ci = enough ? wilson(wl.won, wl.n) : null;
  if (f.open_n > 0 || f.closed > 0) {
    const worst = f.closed + f.commit, expected = f.closed + f.weighted, best = f.closed + f.commit + f.best;
    out.push({
      stage: "prediction", severity: "info", category: "info", title: `Forecast for ${range.label}`,
      whatDetected: `Worst case ${worst.toFixed(2)}, expected ${expected.toFixed(2)}, best case ${best.toFixed(2)} (closed so far ${f.closed.toFixed(2)}).`, whyItMatters: "Shows the realistic range for the period rather than a single number.",
      assumptions: { worstCase: "closed + opportunities in the commit category", expected: "closed + stage-probability-weighted open pipeline", bestCase: "closed + commit + best_case category", winRate365: wl.n ? `${(wl.won / wl.n * 100).toFixed(1)}% of ${wl.n} closed deals` : "no closed deals", confidenceInterval: ci ? `win-rate 95% Wilson interval ${(ci.low * 100).toFixed(1)}%–${(ci.high * 100).toFixed(1)}%` : `not shown: needs at least ${settings.forecast.minimumClosedDeals} closed deals, have ${wl.n}`, limitations: "Does not model seasonality or deal-level timing; probabilities are those stored on each deal." },
      evidence: [ev("metric", "Closed", f.closed.toFixed(2)), ev("metric", "Commit", f.commit.toFixed(2)), ev("metric", "Weighted pipeline", f.weighted.toFixed(2)), ev("metric", "Open deals closing in period", f.open_n)], dedupeKey: `fc:range:${range.from.slice(0, 10)}`,
    });
    const tgt = await companyTarget(ctx);
    if (tgt && expected < tgt.amount * 0.9) out.push({
      stage: "prediction", severity: expected < tgt.amount * 0.6 ? "high" : "medium", category: "risk", impactAmount: tgt.amount - expected, dueInDays: 5, title: "Expected forecast is below target",
      whatDetected: `Expected case ${expected.toFixed(2)} versus company target ${tgt.amount.toFixed(2)} for ${tgt.name}.`, whyItMatters: "Early warning leaves time to add pipeline or reset expectations.", action: "Review commit deals, accelerate best-case deals and open new pipeline; consider a scenario review with the director.",
      assumptions: { basis: "see the forecast above", targetBasis: "booked revenue" }, evidence: [ev("target", tgt.name, tgt.amount.toFixed(2)), ev("forecast", "Expected case", expected.toFixed(2))], dedupeKey: `fc:below-target:${tgt.periodId}`,
    });
    if (f.biggest > 0 && f.weighted > 0 && f.biggest / (f.closed + f.commit + f.best + 1) > 0.4) out.push({ stage: "metric", severity: "medium", category: "risk", title: "Forecast depends on one large deal", whatDetected: `The largest open deal (${f.biggest.toFixed(2)}) is more than 40% of the best-case total.`, whyItMatters: "Slipping that deal would move the whole forecast.", action: "Inspect that deal's health and buyer commitment.", evidence: [ev("metric", "Largest open deal", f.biggest.toFixed(2))], dedupeKey: `fc:concentration:${range.from.slice(0, 10)}` });
  }
  const weak = (await q.query<any>(`SELECT o.id, o.number, o.name, o.owner_id, o.amount::text amount FROM sales_opportunities o WHERE o.status = 'open' AND o.forecast_category = 'commit' AND o.archived_at IS NULL AND (o.last_activity_at IS NULL OR o.last_activity_at < $1::timestamptz - interval '14 days') AND NOT EXISTS (SELECT 1 FROM sales_activities a WHERE a.opportunity_id = o.id AND a.status = 'open') ORDER BY o.amount DESC LIMIT 15`, [now.toISOString()])).rows;
  for (const o of weak) out.push({ stage: "fact", severity: "high", category: "risk", entityType: "opportunity", entityId: o.id, ownerMemberId: o.owner_id, impactAmount: num(o.amount), dueInDays: 2, title: `Committed deal lacks recent evidence: ${o.name}`, whatDetected: `${o.number} is in the commit category but has no activity in 14 days and no scheduled next step.`, whyItMatters: "Commit deals without evidence make the forecast unreliable.", action: "Validate with the buyer or downgrade the forecast category.", evidence: [ev("opportunity", o.number, o.amount, o.id)], dedupeKey: `fc:weak-commit:${o.id}` });
  const snaps = (await q.query<any>(`SELECT s.id, s.label, s.weighted::text forecast, (SELECT COALESCE(sum(amount),0) FROM sales_opportunities o WHERE o.status = 'won' AND o.closed_at >= s.range_from::timestamptz AND o.closed_at < s.range_to::timestamptz)::numeric(18,2)::text actual
    FROM sales_forecast_snapshots s WHERE s.range_to < $1::timestamptz ORDER BY s.taken_at DESC LIMIT 24`, [now.toISOString()])).rows;
  const acc = accuracyOf(snaps.filter((s: any) => num(s.actual) > 0).map((s: any) => ({ forecast: Number(s.forecast).toFixed(2), actual: Number(s.actual).toFixed(2) })));
  if (acc.n > 0) out.push({ stage: "metric", severity: acc.mape !== null && acc.mape > 30 ? "medium" : "info", category: "info", title: "Forecast accuracy", whatDetected: `Mean absolute error ${acc.mape}% across ${acc.n} completed snapshots; bias ${acc.bias}% (positive means over-forecast).`, whyItMatters: "Tells you how far to trust the next forecast.", assumptions: { definition: "|weighted snapshot − won revenue in snapshot range| ÷ won revenue", leakage: "each snapshot is compared only with outcomes after its own period ended" }, evidence: [ev("metric", "MAPE %", acc.mape), ev("metric", "Bias %", acc.bias), ev("metric", "Snapshots", acc.n)], dedupeKey: "fc:accuracy" });
  else out.push({ stage: "metric", severity: "info", category: "info", title: "Forecast accuracy cannot be measured yet", whatDetected: "No completed forecast snapshot with won revenue exists, so accuracy is not claimed.", whyItMatters: "Accuracy is reported only from evidence.", evidence: [], dedupeKey: "fc:accuracy-none" });
  return out;
}

// ─────────────────────────── Agent 16: Commissions & Incentives ───────────────────────────
export async function commissions(ctx: AnalyzerCtx): Promise<Finding[]> {
  if (ctx.focus) return [];
  const out: Finding[] = [];
  const { q } = ctx;
  const plans = (await q.query<any>(`SELECT count(*)::int n FROM sales_commission_plans WHERE active`)).rows[0].n;
  if (plans > 0) {
    const missing = (await q.query<any>(`SELECT o.id, o.number, o.owner_id, o.net_total::text net FROM sales_orders o WHERE o.status IN ('fulfilled','completed') AND o.owner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sales_commission_entries e WHERE e.order_id = o.id AND e.status <> 'void') ORDER BY o.net_total DESC LIMIT $1`, [ctx.limit])).rows;
    for (const o of missing) out.push({ stage: "fact", severity: "medium", category: "compliance", entityType: "order", entityId: o.id, ownerMemberId: o.owner_id, impactAmount: num(o.net), dueInDays: 5, title: `No commission entry for ${o.number}`, whatDetected: `${o.number} is complete with an owner but has no commission entry although active commission plans exist. Some orders are legitimately outside plans.`, whyItMatters: "Missing entries become payroll disputes.", action: "Finance to calculate commission (or record why none applies).", evidence: [ev("order", o.number, o.net, o.id)], dedupeKey: `comm:missing:${o.id}` });
  }
  const odd = (await q.query<any>(`SELECT e.id, e.member_id, e.order_id, e.amount::text amount, e.basis_amount::text basis FROM sales_commission_entries e WHERE e.kind = 'commission' AND e.status <> 'void' AND (e.amount::numeric > e.basis_amount::numeric OR e.amount::numeric < 0) LIMIT 20`)).rows;
  for (const e of odd) out.push({ stage: "fact", severity: "high", category: "compliance", entityType: "member", entityId: e.member_id, ownerMemberId: e.member_id, impactAmount: Math.abs(num(e.amount)), title: `Commission entry looks anomalous (#${e.id})`, whatDetected: `Entry #${e.id} pays ${e.amount} on a basis of ${e.basis}. A commission greater than its basis or below zero is unusual; fixed-amount plans can be legitimate.`, whyItMatters: "Possible calculation error.", action: "Finance to review the stored breakdown. The agent never changes or approves commissions.", evidence: [ev("commission", `Entry #${e.id}`, e.amount, e.id)], dedupeKey: `comm:anomaly:${e.id}` });
  const backlog = (await q.query<any>(`SELECT count(*)::int n, COALESCE(sum(amount),0)::text amount FROM sales_commission_entries WHERE status NOT IN ('approved','paid','void') AND created_at < $1::timestamptz - interval '14 days'`, [ctx.now.toISOString()])).rows[0];
  if (backlog.n > 0) out.push({ stage: "metric", severity: "medium", category: "efficiency", title: "Commission approvals waiting over 14 days", whatDetected: `${plural(backlog.n, "entry")} totalling ${backlog.amount} have waited more than 14 days for approval.`, whyItMatters: "Late commission payments hurt morale.", action: "Finance to review the queue.", evidence: [ev("metric", "Entries", backlog.n), ev("metric", "Amount", backlog.amount)], dedupeKey: "comm:backlog" });
  return out;
}
