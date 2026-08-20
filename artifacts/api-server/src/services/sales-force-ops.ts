/**
 * Sales Force ops: sequence runner, war-room commands, performance, reactivation, upsell, attribution.
 */

import { FOLLOW_UP_SEQUENCE } from "./sales-force-engine";
import { sequenceStepDue } from "./sales-force-advanced";
import { buildOutreachCopy } from "./sales-outreach";

export type LeadLike = {
  id: number;
  companyName: string;
  contactName?: string | null;
  contactEmail?: string | null;
  industry?: string | null;
  stage: string;
  priorityScore?: number | null;
  consentEmail?: boolean;
  optedOut?: boolean;
  lastContactAt?: string | Date | null;
  assignedAgentId?: number | null;
  isDemo?: boolean;
};

export type OppLike = {
  id: number;
  name: string;
  companyName: string;
  stage: string;
  amount?: string | number | null;
  riskScore?: number | null;
  assignedAgentId?: number | null;
  probability?: number | null;
};

export type ActivityLike = {
  agentId?: number | null;
  actorName?: string | null;
  action: string;
  leadId?: number | null;
  opportunityId?: number | null;
};

export function planSequenceActions(leads: LeadLike[]) {
  const planned: Array<{
    leadId: number;
    companyName: string;
    sequenceDay: number;
    theme: string;
    label: string;
    due: boolean;
    reason: string;
    prepared?: { subject: string; body: string };
  }> = [];

  for (const lead of leads) {
    if (lead.optedOut) continue;
    if (["closed_won", "closed_lost", "qualified", "discovery", "proposal_sent", "negotiation", "verbal_commitment"].includes(lead.stage)) {
      // late stages handled by AE, not SDR sequence
      if (!["contacted", "engaged", "new_lead"].includes(lead.stage)) continue;
    }
    for (const step of FOLLOW_UP_SEQUENCE) {
      const check = sequenceStepDue({
        sequenceDay: step.day,
        lastContactAt: lead.lastContactAt ? String(lead.lastContactAt) : null,
        optedOut: lead.optedOut,
        replied: false,
      });
      if (check.due && check.action === "send_sequence_step") {
        const theme =
          step.theme === "insight" || step.theme === "social_proof"
            ? "follow_up"
            : step.theme === "close_loop"
              ? "breakup"
              : "intro";
        const copy = buildOutreachCopy({
          companyName: lead.companyName,
          contactName: lead.contactName,
          industry: lead.industry,
          theme,
          agentName: "Ryan",
        });
        planned.push({
          leadId: lead.id,
          companyName: lead.companyName,
          sequenceDay: step.day,
          theme: step.theme,
          label: step.label,
          due: true,
          reason: check.reason,
          prepared: { subject: copy.subject, body: copy.body },
        });
        break; // one next step per lead
      }
    }
  }
  return {
    planned,
    note: "Prepared sequence steps only. Sends require consent, autonomy ≥ 3, and SMTP.",
  };
}

export function scoreAgentPerformance(input: {
  agentId: number;
  agentName: string;
  activities: ActivityLike[];
  opportunities: OppLike[];
}) {
  const acts = input.activities.filter(
    (a) => a.agentId === input.agentId || (a.actorName || "").toLowerCase() === input.agentName.toLowerCase(),
  );
  const opps = input.opportunities.filter((o) => o.assignedAgentId === input.agentId);
  const won = opps.filter((o) => o.stage === "closed_won");
  const lost = opps.filter((o) => o.stage === "closed_lost");
  const contacted = acts.filter((a) => /email_sent|outreach|contact/i.test(a.action)).length;
  const scored = acts.filter((a) => /score|qualif/i.test(a.action)).length;
  const proposals = acts.filter((a) => /proposal/i.test(a.action)).length;
  const revenue = won.reduce((s, o) => s + (o.amount != null ? Number(o.amount) : 0), 0);

  let score = 40;
  score += Math.min(20, contacted * 2);
  score += Math.min(15, scored * 3);
  score += Math.min(15, proposals * 4);
  score += Math.min(20, won.length * 8);
  score -= Math.min(15, lost.length * 3);
  score = Math.max(0, Math.min(100, score));

  return {
    agentId: input.agentId,
    agentName: input.agentName,
    performanceScore: score,
    metrics: {
      activities: acts.length,
      contacts: contacted,
      qualifications: scored,
      proposals,
      dealsWon: won.length,
      dealsLost: lost.length,
      revenueClosed: revenue,
      openOpportunities: opps.filter((o) => !["closed_won", "closed_lost"].includes(o.stage)).length,
    },
    evidence: "CALCULATED",
    note: "Score from recorded activities and assigned opportunities only.",
  };
}

export function findReactivationCandidates(leads: LeadLike[], opps: OppLike[]) {
  const dormantLeads = leads.filter((l) => {
    if (l.optedOut) return false;
    if (!l.lastContactAt) return l.stage === "new_lead" || l.stage === "contacted";
    const days = (Date.now() - new Date(l.lastContactAt).getTime()) / 86400000;
    return days >= 21 && !["closed_won", "qualified", "negotiation", "verbal_commitment"].includes(l.stage);
  });
  const lostOpps = opps.filter((o) => o.stage === "closed_lost");
  const abandoned = opps.filter((o) => ["proposal_sent", "negotiation"].includes(o.stage));

  return {
    dormantLeads: dormantLeads.map((l) => ({
      id: l.id,
      companyName: l.companyName,
      reason: "No recent contact or early-stage stall",
      suggestedAction: l.consentEmail ? "reactivation_email" : "obtain_consent_or_pause",
    })),
    lostOpportunities: lostOpps.map((o) => ({
      id: o.id,
      name: o.name,
      companyName: o.companyName,
      suggestedAction: "reactivation_with_new_value",
    })),
    abandonedProposals: abandoned.map((o) => ({
      id: o.id,
      name: o.name,
      companyName: o.companyName,
      suggestedAction: "follow_up_proposal",
    })),
    note: "Candidates only — no automatic spam. Respect frequency limits and consent.",
  };
}

export function suggestUpsells(input: {
  companyName: string;
  existingProducts?: string[];
  industry?: string | null;
  wonAmount?: number | null;
}) {
  const have = new Set((input.existingProducts || []).map((p) => p.toLowerCase()));
  const recs: Array<{ product: string; why: string; confidence: string }> = [];
  if (have.has("crm") || have.size === 0) {
    if (!have.has("marketing")) {
      recs.push({ product: "CINTEXA Marketing Automation", why: "Complement CRM with acquisition nurture", confidence: "medium" });
    }
    if (!have.has("support") && !have.has("customer service")) {
      recs.push({ product: "CINTEXA Customer Service", why: "Protect retention after sales process is instrumented", confidence: "medium" });
    }
  }
  if (!have.has("analytics")) {
    recs.push({ product: "CINTEXA Business Intelligence", why: "Executive visibility on revenue and funnel", confidence: "low" });
  }
  if (!recs.length) {
    recs.push({ product: "Account review", why: "No clear white-space from provided products", confidence: "low" });
  }
  return {
    companyName: input.companyName,
    recommendations: recs,
    evidence: "INFERRED",
    note: "Confirm need with account manager before outreach.",
  };
}

export function simpleAttribution(opps: OppLike[], activities: ActivityLike[]) {
  const won = opps.filter((o) => o.stage === "closed_won");
  const byAgent: Record<string, number> = {};
  for (const o of won) {
    const key = o.assignedAgentId != null ? `agent:${o.assignedAgentId}` : "unassigned";
    byAgent[key] = (byAgent[key] || 0) + (o.amount != null ? Number(o.amount) : 0);
  }
  const influenced: Record<string, number> = {};
  for (const a of activities) {
    if (!a.opportunityId) continue;
    const name = a.actorName || "unknown";
    influenced[name] = (influenced[name] || 0) + 1;
  }
  return {
    lastTouchByAgent: byAgent,
    activityInfluenceCounts: influenced,
    totalWonRevenue: won.reduce((s, o) => s + (o.amount != null ? Number(o.amount) : 0), 0),
    evidence: "CALCULATED",
    note: "Simple last-touch on assigned agent + activity counts. Not multi-touch ML attribution.",
  };
}

/** Lightweight command parser — keyword intents over real data, not free-form LLM claims */
export function parseSalesCommand(command: string, ctx: {
  leads: LeadLike[];
  opps: OppLike[];
}) {
  const c = command.toLowerCase().trim();
  if (!c) return { intent: "empty", result: null, message: "Enter a command." };

  if (/high[- ]?value|not been contacted|uncontacted/.test(c)) {
    const items = ctx.leads
      .filter((l) => !l.optedOut && (l.stage === "new_lead" || !l.lastContactAt) && (l.priorityScore ?? 0) >= 50)
      .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
      .slice(0, 25)
      .map((l) => ({ id: l.id, companyName: l.companyName, priorityScore: l.priorityScore, stage: l.stage }));
    return { intent: "list_uncontacted_high_value", result: items, message: `${items.length} lead(s) matched.` };
  }

  if (/at[- ]?risk|stalled/.test(c)) {
    const items = ctx.opps
      .filter((o) => (o.riskScore ?? 0) >= 40 && !["closed_won", "closed_lost"].includes(o.stage))
      .map((o) => ({ id: o.id, name: o.name, riskScore: o.riskScore, stage: o.stage }));
    return { intent: "list_at_risk", result: items, message: `${items.length} at-risk deal(s).` };
  }

  if (/top .*opportunit|revenue opportunit/.test(c)) {
    const items = ctx.opps
      .filter((o) => !["closed_lost"].includes(o.stage))
      .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
      .slice(0, 5)
      .map((o) => ({ id: o.id, name: o.name, amount: o.amount, stage: o.stage }));
    return { intent: "top_opportunities", result: items, message: `Top ${items.length} by amount.` };
  }

  if (/who should i contact|contact today/.test(c)) {
    const items = ctx.leads
      .filter((l) => !l.optedOut && l.consentEmail)
      .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
      .slice(0, 15)
      .map((l) => ({ id: l.id, companyName: l.companyName, priorityScore: l.priorityScore, canEmail: true }));
    return { intent: "who_to_contact", result: items, message: `${items.length} contactable lead(s) with consent.` };
  }

  if (/deals? (likely|close)|this month/.test(c)) {
    const items = ctx.opps
      .filter((o) => (o.probability ?? 0) >= 50 && !["closed_won", "closed_lost"].includes(o.stage))
      .map((o) => ({ id: o.id, name: o.name, probability: o.probability, amount: o.amount }));
    return { intent: "likely_to_close", result: items, message: `${items.length} deal(s) with probability ≥ 50%.` };
  }

  return {
    intent: "unknown",
    result: null,
    message:
      "Supported: uncontacted high-value leads, at-risk deals, top opportunities, who to contact, deals likely to close. Commands use live data only.",
  };
}
