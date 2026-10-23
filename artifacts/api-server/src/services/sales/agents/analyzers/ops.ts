import { type AnalyzerCtx, type Finding, ev, focusSql, focusedElsewhere, num, th, personName } from "../types";
import { ACTIVE_LEAD, EMAIL_RE, lightestRep, money2, plural } from "./shared";

// ─────────────────────────── Agent 2: Sales Operations Manager ───────────────────────────
export async function salesOps(ctx: AnalyzerCtx): Promise<Finding[]> {
  const out: Finding[] = [];
  const { q, today } = ctx;
  const defaultStall = th(ctx, "stalledDays", 21);
  if (!ctx.focus || ctx.focus.entityType === "opportunity") {
    const stalled = (await q.query<any>(
      `SELECT * FROM (SELECT o.id, o.number, o.name, o.owner_id, o.amount::text amount, o.currency, s.name stage, COALESCE(s.stalled_after_days, $2)::int AS limit_days,
         ($1::date - COALESCE(o.last_activity_at, o.stage_entered_at, o.created_at)::date)::int AS idle
       FROM sales_opportunities o JOIN sales_pipeline_stages s ON s.id = o.stage_id
       WHERE o.status = 'open' AND o.archived_at IS NULL${focusSql(ctx, "opportunity", "o.id")}) x WHERE idle > limit_days ORDER BY amount::numeric DESC LIMIT $3`, [today, defaultStall, ctx.limit])).rows;
    for (const o of stalled) {
      const sev = num(o.amount) >= 50000 || o.idle > o.limit_days * 2 ? "high" : "medium";
      out.push({
        stage: "fact", severity: sev, category: "risk", entityType: "opportunity", entityId: o.id, ownerMemberId: o.owner_id, dueInDays: 2, impactAmount: num(o.amount),
        title: `Stalled opportunity: ${o.name}`,
        whatDetected: `${o.number} has had no recorded activity or stage movement for ${plural(o.idle, "day")} (limit for stage "${o.stage}" is ${o.limit_days}).`,
        whyItMatters: "Deals that go quiet are statistically harder to recover and distort the pipeline and forecast.",
        action: "Contact the buyer, confirm the next step and either set a dated next action or move the deal to lost.",
        expectedOutcome: "Deal progresses with a dated next step, or the pipeline is cleaned of a dead deal.",
        evidence: [ev("opportunity", `${o.number} ${o.name}`, `${o.amount} ${o.currency}`, o.id), ev("metric", "Idle days", o.idle), ev("setting", `Stalled limit for ${o.stage}`, o.limit_days)],
        dedupeKey: `ops:stalled:${o.id}`,
        proposal: o.owner_id ? { actionType: "notification.internal", entityType: "opportunity", entityId: o.id, summary: `Alert owner: ${o.number} is stalled`, payload: { member_id: o.owner_id, kind: "stalled_opportunity", title: `Stalled: ${o.name}`, body: `${plural(o.idle, "day")} without progress.`, link: `/sales/pipeline/${o.id}`, severity: "warning", dedupe_key: `agent:stalled:${o.id}:${today}` } } : undefined,
      });
    }
  }
  if (!ctx.focus || ctx.focus.entityType === "lead") {
    const hours = th(ctx, "unassignedLeadHours", 24);
    const leads = (await q.query<any>(`SELECT l.id, l.number, l.first_name, l.last_name, l.company, l.estimated_value::text ev, l.created_at FROM sales_leads l WHERE ${ACTIVE_LEAD} AND l.owner_id IS NULL AND l.created_at < $1::timestamptz - ($2 || ' hours')::interval${focusSql(ctx, "lead", "l.id")} ORDER BY l.created_at LIMIT $3`, [ctx.now.toISOString(), String(hours), ctx.limit])).rows;
    const rep = leads.length ? await lightestRep(ctx) : null;
    for (const l of leads) {
      out.push({
        stage: "recommendation", severity: "medium", category: "efficiency", entityType: "lead", entityId: l.id, dueInDays: 1,
        title: `Unassigned lead: ${personName(l) || l.number}`,
        whatDetected: `${l.number} has had no owner for more than ${plural(hours, "hour")}.`,
        whyItMatters: "Response speed is a leading driver of lead conversion; unowned leads are usually never worked.",
        action: rep ? `Assign to the sales rep with the lightest open workload (member #${rep.id}, ${rep.load} open items).` : "Assign an owner manually; no active sales representative is registered.",
        expectedOutcome: "Lead is contacted within the response target.",
        evidence: [ev("lead", `${l.number} ${l.company ?? ""}`.trim(), l.ev, l.id), ev("assumption", "Assignment rule", "lowest open lead+opportunity count among active sales reps")],
        dedupeKey: `ops:unassigned:${l.id}`,
        proposal: rep ? { actionType: "lead.assign", entityType: "lead", entityId: l.id, summary: `Assign ${l.number} to member #${rep.id}`, payload: { lead_id: l.id, owner_id: rep.id, reason: "Unassigned beyond response window; lightest workload" } } : undefined,
      });
    }
  }
  if (!ctx.focus) {
    const dups = (await q.query<any>(`SELECT lower(btrim(name)) k, count(*)::int n, min(id) first_id, array_agg(id ORDER BY id) ids FROM sales_accounts WHERE archived_at IS NULL AND merged_into_id IS NULL GROUP BY 1 HAVING count(*) > 1 ORDER BY n DESC LIMIT $1`, [ctx.limit])).rows;
    for (const d of dups) out.push({
      stage: "fact", severity: "medium", category: "efficiency", entityType: "account", entityId: d.first_id,
      title: `Possible duplicate accounts: ${d.k}`, whatDetected: `${d.n} active accounts share the same name (ids ${d.ids.join(", ")}).`,
      whyItMatters: "Duplicates split purchase history, hide the real customer value and cause double outreach.",
      action: "Review the records and merge them with the account merge tool if they are the same customer.",
      evidence: (d.ids as number[]).map((id) => ev("account", `Account #${id}`, null, id)), dedupeKey: `ops:dupacct:${d.first_id}`,
    });
    const qdays = th(ctx, "draftQuoteDays", 7);
    const quotes = (await q.query<any>(`SELECT x.id, x.number, x.owner_id, x.status, x.total::text total, x.currency, ($1::date - x.created_at::date)::int age FROM sales_quotations x WHERE x.status IN ('draft','internal_review','approved') AND x.created_at < $1::date - $2::int ORDER BY x.total DESC LIMIT $3`, [today, qdays, ctx.limit])).rows;
    for (const x of quotes) out.push({
      stage: "fact", severity: "medium", category: "efficiency", entityType: "quotation", entityId: x.id, ownerMemberId: x.owner_id, impactAmount: num(x.total), dueInDays: 2,
      title: `Quotation ${x.number} not sent after ${plural(x.age, "day")}`, whatDetected: `${x.number} is still "${x.status}" ${plural(x.age, "day")} after creation.`,
      whyItMatters: "Slow quotation turnaround lowers win rates.", action: "Finish approval and send the quotation, or cancel it.", evidence: [ev("quotation", x.number, `${x.total} ${x.currency}`, x.id), ev("metric", "Age (days)", x.age)], dedupeKey: `ops:quote-slow:${x.id}`,
    });
    const odays = th(ctx, "pendingOrderDays", 3);
    const orders = (await q.query<any>(`SELECT o.id, o.number, o.owner_id, o.total::text total, o.currency, ($1::date - o.created_at::date)::int age FROM sales_orders o WHERE o.status = 'pending_approval' AND o.created_at < $1::date - $2::int ORDER BY o.total DESC LIMIT $3`, [today, odays, ctx.limit])).rows;
    for (const o of orders) out.push({
      stage: "fact", severity: "high", category: "risk", entityType: "order", entityId: o.id, ownerMemberId: o.owner_id, impactAmount: num(o.total), dueInDays: 1,
      title: `Order ${o.number} waiting for approval ${plural(o.age, "day")}`, whatDetected: `${o.number} has been in pending approval for ${plural(o.age, "day")}.`,
      whyItMatters: "A blocked order delays delivery and cash collection.", action: "Ask the approver to decide.", evidence: [ev("order", o.number, `${o.total} ${o.currency}`, o.id)], dedupeKey: `ops:order-pending:${o.id}`,
    });
    const overdue = (await q.query<any>(`SELECT a.owner_id, count(*)::int n, min(COALESCE(a.due_at, a.start_at)) oldest FROM sales_activities a WHERE a.status = 'open' AND a.owner_id IS NOT NULL AND COALESCE(a.due_at, a.start_at) < $1::timestamptz GROUP BY a.owner_id HAVING count(*) >= $2 ORDER BY n DESC LIMIT 20`, [ctx.now.toISOString(), th(ctx, "overdueBacklog", 5)])).rows;
    for (const r of overdue) out.push({
      stage: "metric", severity: r.n >= 15 ? "high" : "medium", category: "efficiency", ownerMemberId: r.owner_id, entityType: "member", entityId: r.owner_id,
      title: `Overdue activity backlog: member #${r.owner_id}`, whatDetected: `${plural(r.n, "open activity")} past due; oldest due ${new Date(r.oldest).toISOString().slice(0, 10)}.`,
      whyItMatters: "Missed follow-ups are the most common cause of silent deal loss.", action: "Review the backlog with the owner; reschedule or close items that no longer apply; consider redistributing workload.",
      evidence: [ev("metric", "Overdue activities", r.n), ev("member", `Member #${r.owner_id}`, null, r.owner_id)], dedupeKey: `ops:overdue-backlog:${r.owner_id}`,
    });
  }
  return out;
}

// ─────────────────────────── Agent 3: Lead Generation & Enrichment ───────────────────────────
export async function leadEnrichment(ctx: AnalyzerCtx): Promise<Finding[]> {
  if (focusedElsewhere(ctx, "lead")) return [];
  const out: Finding[] = [];
  const { q } = ctx;
  const leads = (await q.query<any>(`SELECT l.id, l.number, l.first_name, l.last_name, l.email, l.phone, l.company, l.job_title, l.industry, l.country, l.source, l.owner_id, l.created_by, l.estimated_value::text ev
    FROM sales_leads l WHERE ${ACTIVE_LEAD}${focusSql(ctx, "lead", "l.id")} ORDER BY l.created_at DESC LIMIT $1`, [ctx.limit])).rows;
  const accountNames = new Map<string, { id: number; name: string }>();
  for (const a of (await q.query<any>("SELECT id, name FROM sales_accounts WHERE archived_at IS NULL AND merged_into_id IS NULL")).rows) accountNames.set(String(a.name).trim().toLowerCase(), a);
  for (const l of leads) {
    const fields: Array<[string, unknown]> = [["email", l.email], ["phone", l.phone], ["company", l.company], ["job title", l.job_title], ["industry", l.industry], ["country", l.country]];
    const missing = fields.filter(([, val]) => val === null || String(val).trim() === "").map(([k]) => k);
    const known = fields.filter(([, val]) => !(val === null || String(val).trim() === "")).map(([k]) => k);
    const issues: string[] = [];
    if (l.email && !EMAIL_RE.test(String(l.email))) issues.push("email address format is invalid");
    if (l.phone && !/^\+?[0-9][0-9\s().-]{5,18}$/.test(String(l.phone))) issues.push("phone number format looks invalid");
    const label = personName(l) || l.number;
    const prov = ev("provenance", "Recorded source", `${l.source ?? "unknown"} (entered by ${l.created_by ?? "unknown"})`);
    if (missing.length >= 3 || (!l.email && !l.phone)) {
      out.push({
        stage: "fact", severity: !l.email && !l.phone ? "high" : "low", category: "efficiency", entityType: "lead", entityId: l.id, ownerMemberId: l.owner_id, dueInDays: 3, impactAmount: num(l.ev),
        title: `Incomplete lead: ${label}`, whatDetected: `${l.number} is missing: ${missing.join(", ")}. These fields are marked unknown; nothing has been guessed.`,
        whyItMatters: !l.email && !l.phone ? "With neither email nor phone the lead cannot be contacted." : "Missing profile data weakens qualification and routing.",
        action: "Ask the owner to collect the missing details from the lead or an authorised data source. Record the source of each value.",
        evidence: [ev("lead", l.number, l.company ?? "no company", l.id), ev("fields", "Known", known.join(", ") || "none"), ev("fields", "Unknown", missing.join(", ")), prov], dedupeKey: `enrich:missing:${l.id}`,
      });
    }
    if (issues.length) out.push({
      stage: "fact", severity: "medium", category: "compliance", entityType: "lead", entityId: l.id, ownerMemberId: l.owner_id,
      title: `Contact data needs correction: ${label}`, whatDetected: `${l.number}: ${issues.join("; ")}. Validation is format-only; deliverability has not been checked.`,
      whyItMatters: "Bad contact data causes bounced emails and wasted calls.", action: "Correct the value or confirm it with the lead.", evidence: [ev("lead", l.number, null, l.id), ev("email", "Recorded email", l.email), prov], dedupeKey: `enrich:invalid:${l.id}`,
    });
    const match = l.company ? accountNames.get(String(l.company).trim().toLowerCase()) : undefined;
    if (match) out.push({
      stage: "recommendation", severity: "low", category: "efficiency", entityType: "lead", entityId: l.id, ownerMemberId: l.owner_id,
      title: `Lead may belong to existing account: ${match.name}`, whatDetected: `${l.number}'s company name exactly matches existing account #${match.id}. This is a name match only and is unverified.`,
      whyItMatters: "Linking to the right account avoids a duplicate account on conversion.", action: "Confirm the match, then convert the lead into the existing account instead of creating a new one.",
      assumptions: { basis: "case-insensitive exact company name", verified: false }, evidence: [ev("lead", l.number, l.company, l.id), ev("account", match.name, null, match.id)], dedupeKey: `enrich:acct-match:${l.id}`,
    });
  }
  if (!ctx.focus) {
    const dups = (await q.query<any>(`SELECT lower(email) k, array_agg(l.id ORDER BY l.id) ids, count(*)::int n FROM sales_leads l WHERE ${ACTIVE_LEAD} AND l.email IS NOT NULL AND btrim(l.email) <> '' GROUP BY 1 HAVING count(*) > 1 LIMIT $1`, [ctx.limit])).rows;
    for (const d of dups) out.push({
      stage: "fact", severity: "medium", category: "efficiency", entityType: "lead", entityId: d.ids[0],
      title: `Duplicate leads share an email`, whatDetected: `${d.n} active leads use the same email address (lead ids ${d.ids.join(", ")}).`, whyItMatters: "Duplicate leads cause double outreach and inflate funnel numbers.",
      action: "Review and merge using the lead merge tool.", evidence: (d.ids as number[]).map((id) => ev("lead", `Lead #${id}`, null, id)), dedupeKey: `enrich:dup:${d.ids[0]}`,
    });
  }
  return out;
}

// ─────────────────────────── Agent 4: Lead Qualification & Conversion ───────────────────────────
export async function leadQualification(ctx: AnalyzerCtx): Promise<Finding[]> {
  if (focusedElsewhere(ctx, "lead")) return [];
  const out: Finding[] = [];
  const { q, settings } = ctx;
  const qualifyAt = th(ctx, "qualifyScore", 70);
  const staleDays = th(ctx, "nurtureStaleDays", 45);
  const titles = settings.leads.scoring.decisionMakerTitles.map((t) => t.toLowerCase());
  const leads = (await q.query<any>(`SELECT l.*, l.estimated_value::text ev, l.budget::text budget_txt,
      (SELECT count(*) FROM sales_touches t WHERE t.lead_id = l.id)::int touches,
      (SELECT a.id FROM sales_accounts a WHERE l.company IS NOT NULL AND lower(btrim(a.name)) = lower(btrim(l.company)) AND a.archived_at IS NULL AND a.merged_into_id IS NULL ORDER BY a.id LIMIT 1) AS matching_account_id
    FROM sales_leads l WHERE ${ACTIVE_LEAD}${focusSql(ctx, "lead", "l.id")} ORDER BY l.score DESC, l.id LIMIT $1`, [ctx.limit])).rows;
  for (const l of leads) {
    const label = personName(l) || l.number;
    const engaged = Boolean(l.first_response_at || l.last_contact_at || l.touches > 0);
    const criteria = [
      { name: "Budget", status: l.budget !== null ? "known" : "unknown", detail: l.budget !== null ? `recorded budget ${l.budget_txt}` : "no budget recorded" },
      { name: "Authority", status: "unconfirmed", detail: l.job_title && titles.some((t) => String(l.job_title).toLowerCase().includes(t)) ? `title "${l.job_title}" is a decision-maker title in settings, but a title does not prove purchasing authority` : "no confirmed decision-maker access recorded" },
      { name: "Need", status: l.product_interest ? "known" : "unknown", detail: l.product_interest ? `interest in ${l.product_interest}` : "no product or service need recorded" },
      { name: "Timeline", status: "unknown", detail: "purchase timeline is not captured on the lead record" },
      { name: "Engagement", status: engaged ? "known" : "unknown", detail: engaged ? "contact or response recorded" : "no response or contact recorded" },
    ];
    const known = criteria.filter((c) => c.status === "known").length;
    const idleDays = l.last_contact_at ? Math.floor((ctx.now.getTime() - new Date(l.last_contact_at).getTime()) / 86400000) : Math.floor((ctx.now.getTime() - new Date(l.created_at).getTime()) / 86400000);
    const ev0 = [ev("lead", `${l.number} ${l.company ?? ""}`.trim(), `score ${l.score}`, l.id), ...criteria.map((c) => ev("criterion", `${c.name}: ${c.status}`, c.detail)), ev("score_breakdown", "Recorded score components", JSON.stringify(l.score_breakdown ?? {}).slice(0, 400))];
    const assumptions = { framework: "BANT-style coverage from recorded fields", knownCriteria: `${known} of 5`, note: "Coverage counts only values present in the record; authority and timeline are never inferred." };
    if (l.status === "qualified" && !l.converted_opportunity_id) {
      const dup = l.matching_account_id;
      out.push({
        stage: "proposed_action", severity: "medium", category: "opportunity", entityType: "lead", entityId: l.id, ownerMemberId: l.owner_id, dueInDays: 2, impactAmount: num(l.ev),
        title: `Ready to convert: ${label}`, whatDetected: `${l.number} is qualified (score ${l.score}) and has not been converted.${dup ? ` An account named "${l.company}" already exists (#${dup}); converting blindly would create a duplicate.` : ""}`,
        whyItMatters: "Qualified leads that are not converted leave revenue out of the pipeline.",
        action: dup ? "Convert into the existing account after confirming it is the same company." : "Convert into an account, contact and opportunity.",
        expectedOutcome: "Opportunity created and tracked in the pipeline.", assumptions, evidence: ev0, dedupeKey: `qual:convert:${l.id}`,
        proposal: { actionType: "lead.convert", entityType: "lead", entityId: l.id, summary: `Convert ${l.number} (${label})`, payload: { lead_id: l.id, link_existing_account_id: dup ?? null, note: "Converting is a person-performed step in the Leads screen; approval records the decision." }, amount: l.ev ?? undefined },
      });
    } else if ((l.status === "new" || l.status === "contacted") && l.score >= qualifyAt && known >= 2) {
      out.push({
        stage: "recommendation", severity: "medium", category: "opportunity", entityType: "lead", entityId: l.id, ownerMemberId: l.owner_id, dueInDays: 2, impactAmount: num(l.ev),
        title: `High-scoring lead to qualify: ${label}`, whatDetected: `${l.number} scores ${l.score} (threshold ${qualifyAt}) with ${known} of 5 qualification criteria known.`, whyItMatters: "Strong leads convert best when worked quickly.",
        action: "Run a discovery call to confirm budget, authority and timeline, then mark qualified.", expectedOutcome: "Lead is qualified or disqualified with evidence.", assumptions, evidence: ev0, dedupeKey: `qual:qualify:${l.id}`,
      });
    } else if (idleDays >= staleDays && l.score < qualifyAt) {
      out.push({
        stage: "recommendation", severity: "low", category: "efficiency", entityType: "lead", entityId: l.id, ownerMemberId: l.owner_id,
        title: `Low-score stale lead: ${label}`, whatDetected: `${l.number} scores ${l.score} and has had no contact for ${plural(idleDays, "day")}.`, whyItMatters: "Stale leads clutter the queue and hide the live ones.",
        action: "Move to nurturing or disqualify with a reason; do not chase without a new signal.", assumptions, evidence: ev0, dedupeKey: `qual:stale:${l.id}`,
      });
    }
  }
  return out;
}

// ─────────────────────────── Agent 6: Contact & Relationship Intelligence ───────────────────────────
export async function contactRelationship(ctx: AnalyzerCtx): Promise<Finding[]> {
  if (ctx.focus && ctx.focus.entityType !== "opportunity") return [];
  const out: Finding[] = [];
  const { q } = ctx;
  const opps = (await q.query<any>(`SELECT o.id, o.number, o.name, o.owner_id, o.amount::text amount, o.currency, o.account_id,
      (SELECT count(*) FROM sales_contacts c WHERE c.account_id = o.account_id AND c.archived_at IS NULL)::int contacts,
      (SELECT count(*) FROM sales_contacts c WHERE c.account_id = o.account_id AND c.archived_at IS NULL AND (c.email IS NOT NULL OR c.phone IS NOT NULL))::int reachable
    FROM sales_opportunities o WHERE o.status = 'open' AND o.archived_at IS NULL${focusSql(ctx, "opportunity", "o.id")} ORDER BY o.amount DESC LIMIT $1`, [ctx.limit])).rows;
  for (const o of opps) {
    if (o.contacts === 0 && !o.account_id) continue;
    if (o.contacts === 0) out.push({
      stage: "fact", severity: "high", category: "risk", entityType: "opportunity", entityId: o.id, ownerMemberId: o.owner_id, impactAmount: num(o.amount), dueInDays: 3,
      title: `No contact on file: ${o.name}`, whatDetected: `${o.number} is open but the account has no contact records.`, whyItMatters: "A deal with no known stakeholder cannot be progressed or forecast reliably.",
      action: "Identify and record at least the main buyer and one other stakeholder.", evidence: [ev("opportunity", o.number, `${o.amount} ${o.currency}`, o.id), ev("account", `Account #${o.account_id}`, null, o.account_id)], dedupeKey: `contact:none:${o.id}`,
    });
    else if (o.contacts === 1) out.push({
      stage: "fact", severity: num(o.amount) >= 25000 ? "medium" : "low", category: "risk", entityType: "opportunity", entityId: o.id, ownerMemberId: o.owner_id, impactAmount: num(o.amount),
      title: `Single point of contact: ${o.name}`, whatDetected: `Only one contact is recorded for ${o.number}. Whether that person can approve the purchase is not recorded.`, whyItMatters: "Single-threaded deals stall when that person is unavailable or leaves.",
      action: "Ask who else is involved in the decision and add them as contacts with their roles.", assumptions: { note: "Job title is not treated as proof of purchasing authority." }, evidence: [ev("opportunity", o.number, null, o.id), ev("metric", "Contacts on account", o.contacts)], dedupeKey: `contact:single:${o.id}`,
    });
    else if (o.reachable === 0) out.push({
      stage: "fact", severity: "medium", category: "efficiency", entityType: "opportunity", entityId: o.id, ownerMemberId: o.owner_id,
      title: `Contacts unreachable: ${o.name}`, whatDetected: `${o.number} has ${o.contacts} contacts but none has an email or phone number.`, whyItMatters: "Outreach is impossible without a channel.", action: "Add contact channels.", evidence: [ev("opportunity", o.number, null, o.id)], dedupeKey: `contact:unreachable:${o.id}`,
    });
  }
  if (!ctx.focus) {
    const gap = (await q.query<any>(`SELECT count(*)::int n FROM sales_contacts c WHERE c.archived_at IS NULL AND c.email IS NOT NULL AND c.unsubscribed_at IS NULL AND c.consent_email = FALSE`)).rows[0];
    if (gap.n > 0) out.push({
      stage: "metric", severity: "low", category: "compliance",
      title: `Contacts with an email but no email consent`, whatDetected: `${plural(gap.n, "contact")} have an email address recorded without email consent.`, whyItMatters: "Marketing or automated outreach to them would breach consent rules.",
      action: "Exclude them from campaigns until consent is recorded.", evidence: [ev("metric", "Contacts without email consent", gap.n)], dedupeKey: "contact:consent-gap",
    });
    const dups = (await q.query<any>(`SELECT lower(email) k, array_agg(id ORDER BY id) ids, count(*)::int n FROM sales_contacts WHERE archived_at IS NULL AND email IS NOT NULL AND btrim(email) <> '' GROUP BY 1 HAVING count(*) > 1 LIMIT $1`, [ctx.limit])).rows;
    for (const d of dups) out.push({
      stage: "fact", severity: "low", category: "efficiency", entityType: "contact", entityId: d.ids[0],
      title: "Duplicate contacts share an email", whatDetected: `${d.n} contacts share one email address (ids ${d.ids.join(", ")}).`, whyItMatters: "Duplicates fragment interaction history.", action: "Review and consolidate.", evidence: (d.ids as number[]).map((id) => ev("contact", `Contact #${id}`, null, id)), dedupeKey: `contact:dup:${d.ids[0]}`,
    });
  }
  return out;
}

// ─────────────────────────── Agent 8: Activities & Follow-up ───────────────────────────
export async function activitiesFollowup(ctx: AnalyzerCtx): Promise<Finding[]> {
  const out: Finding[] = [];
  const { q, today } = ctx;
  if (!ctx.focus) {
    const overdue = (await q.query<any>(`SELECT a.id, a.type, a.subject, a.owner_id, a.priority, a.opportunity_id, a.lead_id, a.account_id, ($1::date - COALESCE(a.due_at, a.start_at)::date)::int days
      FROM sales_activities a WHERE a.status = 'open' AND COALESCE(a.due_at, a.start_at) < $2::timestamptz ORDER BY days DESC LIMIT $3`, [today, ctx.now.toISOString(), ctx.limit])).rows;
    for (const a of overdue) out.push({
      stage: "fact", severity: a.days > 14 ? "high" : a.days > 7 ? "medium" : "low", category: "efficiency", entityType: "activity", entityId: a.id, ownerMemberId: a.owner_id, dueInDays: 1,
      title: `Overdue ${a.type}: ${String(a.subject).slice(0, 80)}`, whatDetected: `Activity #${a.id} is ${plural(a.days, "day")} past due.`, whyItMatters: "Missed follow-ups are a leading cause of lost deals.",
      action: "Complete it, reschedule it, or cancel it if it is no longer relevant.", evidence: [ev("activity", String(a.subject).slice(0, 80), `${a.days} days overdue`, a.id)], dedupeKey: `follow:overdue:${a.id}`,
    });
  }
  if (!ctx.focus || ctx.focus.entityType === "opportunity") {
    const opps = (await q.query<any>(`SELECT o.id, o.number, o.name, o.owner_id, o.amount::text amount, o.currency FROM sales_opportunities o
      WHERE o.status = 'open' AND o.archived_at IS NULL AND o.owner_id IS NOT NULL${focusSql(ctx, "opportunity", "o.id")}
        AND (o.next_action_date IS NULL OR o.next_action_date < $1::date)
        AND NOT EXISTS (SELECT 1 FROM sales_activities a WHERE a.opportunity_id = o.id AND a.status = 'open')
      ORDER BY o.amount DESC LIMIT $2`, [today, ctx.limit])).rows;
    for (const o of opps) {
      const week = `${today.slice(0, 4)}-W${Math.ceil(Number(today.slice(5, 7)) * 4.35 + Number(today.slice(8, 10)) / 7)}`;
      const due = new Date(ctx.now.getTime() + 2 * 86400000).toISOString().slice(0, 10);
      out.push({
        stage: "proposed_action", severity: num(o.amount) >= 50000 ? "high" : "medium", category: "efficiency", entityType: "opportunity", entityId: o.id, ownerMemberId: o.owner_id, dueInDays: 2, impactAmount: num(o.amount),
        title: `No next step scheduled: ${o.name}`, whatDetected: `${o.number} is open with no dated next action and no open activity.`, whyItMatters: "Deals without a scheduled next step lose momentum.",
        action: "Create a follow-up task for the owner.", expectedOutcome: "Owner has a dated task to progress the deal.", evidence: [ev("opportunity", o.number, `${o.amount} ${o.currency}`, o.id)], dedupeKey: `follow:nonext:${o.id}`,
        proposal: { actionType: "activity.create_followup", entityType: "opportunity", entityId: o.id, summary: `Create follow-up task for ${o.number}`, payload: { subject: `Plan next step for ${o.name}`.slice(0, 200), description: "Created by the Activities & Follow-up agent: this open opportunity has no scheduled next step.", due_on: due, owner_id: o.owner_id, opportunity_id: o.id, priority: num(o.amount) >= 50000 ? "high" : "medium", dedupe_key: `agent:nextstep:opp:${o.id}:${week}` } },
      });
    }
  }
  if (!ctx.focus || ctx.focus.entityType === "lead") {
    const leads = (await q.query<any>(`SELECT l.id, l.number, l.first_name, l.last_name, l.owner_id, l.created_at FROM sales_leads l
      WHERE l.status = 'new' AND l.archived_at IS NULL AND l.merged_into_id IS NULL AND l.owner_id IS NOT NULL AND l.first_response_at IS NULL${focusSql(ctx, "lead", "l.id")}
        AND l.created_at < $1::timestamptz - interval '2 days'
        AND NOT EXISTS (SELECT 1 FROM sales_activities a WHERE a.lead_id = l.id AND a.status = 'open') LIMIT $2`, [ctx.now.toISOString(), ctx.limit])).rows;
    for (const l of leads) {
      const due = new Date(ctx.now.getTime() + 86400000).toISOString().slice(0, 10);
      out.push({
        stage: "proposed_action", severity: "medium", category: "efficiency", entityType: "lead", entityId: l.id, ownerMemberId: l.owner_id, dueInDays: 1,
        title: `Lead not yet contacted: ${personName(l) || l.number}`, whatDetected: `${l.number} was created more than 2 days ago, has no first response and no open task.`, whyItMatters: "First-response time strongly affects conversion.",
        action: "Create a first-contact task for the owner.", evidence: [ev("lead", l.number, null, l.id)], dedupeKey: `follow:lead-first:${l.id}`,
        proposal: { actionType: "activity.create_followup", entityType: "lead", entityId: l.id, summary: `Create first-contact task for ${l.number}`, payload: { subject: `Make first contact with ${personName(l) || l.number}`.slice(0, 200), due_on: due, owner_id: l.owner_id, lead_id: l.id, priority: "high", dedupe_key: `agent:firstcontact:lead:${l.id}` } },
      });
    }
  }
  return out;
}
void money2;
