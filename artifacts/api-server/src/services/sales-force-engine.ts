/**
 * CINTEXA Nexus — AI Sales Force engine
 * Scoring, next-best-action, objections, proposals, forecasts from real inputs only.
 */

export const DEFAULT_PIPELINE_STAGES = [
  { id: "new_lead", label: "New Lead", probability: 5 },
  { id: "contacted", label: "Contacted", probability: 10 },
  { id: "engaged", label: "Engaged", probability: 20 },
  { id: "qualified", label: "Qualified", probability: 30 },
  { id: "discovery", label: "Discovery", probability: 40 },
  { id: "solution_presented", label: "Solution Presented", probability: 50 },
  { id: "proposal_sent", label: "Proposal Sent", probability: 60 },
  { id: "negotiation", label: "Negotiation", probability: 70 },
  { id: "verbal_commitment", label: "Verbal Commitment", probability: 85 },
  { id: "closed_won", label: "Closed Won", probability: 100 },
  { id: "closed_lost", label: "Closed Lost", probability: 0 },
] as const;

export const DEFAULT_AGENTS = [
  { name: "Alex", slug: "alex", role: "director", personality: "Strategic, data-driven", specialization: "Revenue strategy & allocation" },
  { name: "Maya", slug: "maya", role: "manager", personality: "Operational, fair", specialization: "Lead assignment & coaching" },
  { name: "Nova", slug: "nova", role: "prospector", personality: "Curious, thorough", specialization: "ICP matching & list building" },
  { name: "Ryan", slug: "ryan", role: "sdr", personality: "Friendly, persistent", specialization: "Outbound & meeting booking" },
  { name: "Sophia", slug: "sophia", role: "qualification", personality: "Precise, skeptical", specialization: "BANT / MEDDIC qualification" },
  { name: "Daniel", slug: "daniel", role: "ae", personality: "Consultative", specialization: "Discovery & solution design" },
  { name: "Victoria", slug: "victoria", role: "proposal", personality: "Clear, structured", specialization: "Proposals & documentation" },
  { name: "Max", slug: "max", role: "negotiator", personality: "Firm within policy", specialization: "Commercial negotiation" },
  { name: "Leo", slug: "leo", role: "closer", personality: "Decisive, respectful", specialization: "Closing & commitment" },
  { name: "Emma", slug: "emma", role: "account_manager", personality: "Relationship-first", specialization: "Renewals & health" },
  { name: "Oliver", slug: "oliver", role: "upsell", personality: "Opportunity-minded", specialization: "Expansion & cross-sell" },
  { name: "Grace", slug: "grace", role: "reactivation", personality: "Patient, relevant", specialization: "Dormant recovery" },
  { name: "Ethan", slug: "ethan", role: "researcher", personality: "Analytical", specialization: "Pre-call intelligence" },
  { name: "Zoe", slug: "zoe", role: "analyst", personality: "Insightful", specialization: "Sales intelligence & forecasts" },
] as const;

export type LeadScoreInput = {
  industry?: string | null;
  companySize?: string | null;
  website?: string | null;
  source?: string | null;
  hasEmail?: boolean;
  engagementEvents?: number;
  pricingPageViews?: number;
  proposalViews?: number;
  replied?: boolean;
  requestedDemo?: boolean;
  estimatedValue?: number | null;
  daysSinceContact?: number | null;
};

export function scoreLead(input: LeadScoreInput) {
  let fit = 40;
  if (input.industry) fit += 15;
  if (input.companySize) fit += 10;
  if (input.website) fit += 10;
  if (input.hasEmail) fit += 10;
  fit = Math.min(100, fit);

  let engagement = 20;
  engagement += Math.min(40, (input.engagementEvents ?? 0) * 8);
  if (input.replied) engagement += 25;
  engagement = Math.min(100, engagement);

  let intent = 15;
  intent += Math.min(25, (input.pricingPageViews ?? 0) * 12);
  intent += Math.min(20, (input.proposalViews ?? 0) * 15);
  if (input.requestedDemo) intent += 30;
  if (input.replied) intent += 15;
  intent = Math.min(100, intent);

  let value = 30;
  if (input.estimatedValue != null) {
    if (input.estimatedValue >= 100000) value = 90;
    else if (input.estimatedValue >= 25000) value = 70;
    else if (input.estimatedValue >= 5000) value = 55;
    else value = 40;
  }

  let timing = 50;
  if (input.daysSinceContact != null) {
    if (input.daysSinceContact <= 2) timing = 80;
    else if (input.daysSinceContact <= 7) timing = 60;
    else if (input.daysSinceContact <= 21) timing = 40;
    else timing = 25;
  }

  // Configurable weights
  const priority = Math.round(fit * 0.25 + engagement * 0.2 + intent * 0.3 + value * 0.15 + timing * 0.1);

  let qualityLabel = "cold";
  if (priority >= 85) qualityLabel = "enterprise_opportunity";
  else if (priority >= 75) qualityLabel = "opportunity_ready";
  else if (priority >= 65) qualityLabel = "high_intent";
  else if (priority >= 55) qualityLabel = "sql";
  else if (priority >= 45) qualityLabel = "mql";
  else if (priority >= 35) qualityLabel = "warm";
  else if (priority >= 25) qualityLabel = "low_intent";

  return {
    fitScore: fit,
    engagementScore: engagement,
    intentScore: intent,
    valueScore: value,
    timingScore: timing,
    priorityScore: priority,
    qualityLabel,
    evidence: "CALCULATED",
    note: "Scores derived only from provided fields; missing signals stay low rather than invented.",
  };
}

export function nextBestAction(input: {
  stage: string;
  priorityScore?: number | null;
  optedOut?: boolean;
  lastContactAt?: string | null;
  hasConsentEmail?: boolean;
}): { action: string; reason: string; confidence: "low" | "medium" | "high" } {
  if (input.optedOut) {
    return { action: "stop_contacting", reason: "Lead opted out — suppress all outreach.", confidence: "high" };
  }
  const stage = input.stage;
  if (stage === "new_lead") {
    return { action: "research_then_score", reason: "New lead needs research brief and scoring before outreach.", confidence: "high" };
  }
  if (stage === "contacted" || stage === "engaged") {
    return { action: "follow_up_or_qualify", reason: "Continue discovery; score intent from replies.", confidence: "medium" };
  }
  if (stage === "qualified" || stage === "discovery") {
    return { action: "schedule_discovery", reason: "Qualified — book discovery or solution conversation.", confidence: "high" };
  }
  if (stage === "solution_presented") {
    return { action: "send_proposal", reason: "Solution discussed — formalize with proposal/quote.", confidence: "medium" };
  }
  if (stage === "proposal_sent") {
    return { action: "follow_up_proposal", reason: "Track opens and address objections.", confidence: "medium" };
  }
  if (stage === "negotiation") {
    return { action: "negotiate_within_limits", reason: "Stay inside approved discount/terms; escalate if exceeded.", confidence: "high" };
  }
  if (stage === "verbal_commitment") {
    return { action: "confirm_close", reason: "Confirm commitment and required paperwork only after real agreement.", confidence: "high" };
  }
  if ((input.priorityScore ?? 0) >= 70 && input.hasConsentEmail) {
    return { action: "contact_now", reason: "High priority with email consent.", confidence: "medium" };
  }
  return { action: "review_manually", reason: "Insufficient signals for autonomous action.", confidence: "low" };
}

export function handleObjection(objectionText: string) {
  const t = objectionText.toLowerCase();
  const map: Array<{ match: RegExp; classification: string; concern: string; response: string; cta: string }> = [
    { match: /expensive|price|cost|budget/, classification: "price", concern: "Perceived value vs cost", response: "Acknowledge budget pressure. Reframe on outcomes and total cost of ownership. Offer approved package tiers only — never invent discounts.", cta: "Which outcome matters most so we can map the right package?" },
    { match: /not interested|no thanks/, classification: "not_interested", concern: "Relevance or timing", response: "Respect the boundary. Ask one clarifying question about priority, then offer to pause contact.", cta: "Should we check back next quarter, or is this not a fit?" },
    { match: /think about it|later/, classification: "timing", concern: "Uncertainty or missing stakeholders", response: "Confirm what information is still missing and who else is involved.", cta: "What would make a decision clearer in the next two weeks?" },
    { match: /already have|competitor|using /, classification: "incumbent", concern: "Switching cost", response: "Respect the incumbent. Explore gaps without disparaging competitors.", cta: "Where does the current solution fall short today?" },
    { match: /approval|management|boss/, classification: "authority", concern: "Decision process", response: "Map the buying committee and offer materials for internal review.", cta: "Who else needs to evaluate this, and how can we support them?" },
    { match: /send (me )?info|email me/, classification: "information", concern: "Low commitment or gatekeeping", response: "Send a short, relevant brief and propose a specific next step.", cta: "I will send a one-page brief — does Thursday work for a 15-minute review?" },
  ];
  for (const row of map) {
    if (row.match.test(t)) {
      return {
        classification: row.classification,
        underlyingConcern: row.concern,
        recommendedResponse: row.response,
        followUpQuestion: row.cta,
        suggestedCta: row.cta,
        evidence: "INFERRED",
        confidence: "medium" as const,
      };
    }
  }
  return {
    classification: "other",
    underlyingConcern: "Unclassified — needs human review if high value",
    recommendedResponse: "Acknowledge the concern, clarify, and avoid pressure.",
    followUpQuestion: "Can you share a bit more about what is holding the decision?",
    suggestedCta: "Would a short call with a specialist help?",
    evidence: "INFERRED",
    confidence: "low" as const,
  };
}

export function buildResearchBrief(input: {
  companyName: string;
  website?: string | null;
  industry?: string | null;
  contactTitle?: string | null;
}) {
  return {
    who: input.companyName,
    whatTheyDo: input.industry ? `Operates in ${input.industry}` : "Industry not provided — UNKNOWN until researched",
    website: input.website || null,
    likelyNeeds: input.industry
      ? [`Operational efficiency in ${input.industry}`, "Revenue process visibility", "Customer retention systems"]
      : ["Needs remain UNKNOWN without industry or diagnostic data"],
    whyCintexa: "Map CINTEXA modules only after problems are evidenced (CRM, marketing, support, diagnostics).",
    suggestedOpening: `I noticed ${input.companyName}${input.industry ? ` in ${input.industry}` : ""} — curious how you currently manage sales and customer follow-up.`,
    discoveryQuestions: [
      "What is the biggest bottleneck in winning new customers today?",
      "How are leads tracked from first contact to close?",
      "Where does follow-up most often break down?",
    ],
    potentialObjections: ["Timing", "Budget", "Incumbent tools"],
    recommendedSolution: "Defer product pitch until qualification confirms need — then map to justified CINTEXA modules.",
    suggestedCta: "15-minute discovery to confirm fit",
    evidence: "INFERRED",
    note: "Brief uses only supplied fields. Enrich via configured research integrations; do not invent firmographics.",
  };
}

export function buildProposalDraft(input: {
  companyName: string;
  contactName?: string | null;
  problem?: string | null;
  solution?: string | null;
  amount?: number | null;
  currency?: string;
}) {
  return {
    title: `Proposal for ${input.companyName}`,
    executiveSummary: `This proposal outlines a practical path for ${input.companyName} to address ${input.problem || "the priorities discussed"}.`,
    customerProblem: input.problem || "To be confirmed in discovery",
    proposedSolution: input.solution || "Solution mapped after qualification — not assumed",
    scope: ["Discovery workshop", "Configuration of agreed modules", "Training & handover"],
    deliverables: ["Implementation plan", "Configured workspace", "Success metrics dashboard"],
    timeline: "To be confirmed after scope agreement",
    pricing: input.amount != null ? { amount: input.amount, currency: input.currency || "GHS", note: "Subject to approved price list" } : { amount: null, currency: input.currency || "GHS", note: "Pricing requires authorized quote data" },
    nextSteps: ["Review proposal", "Clarify questions", "Confirm commercial terms within policy"],
    evidence: "USER PROVIDED / TEMPLATE",
  };
}

export function forecastFromPipeline(opps: Array<{ amount: number | null; probability: number; stage: string }>) {
  let pipeline = 0;
  let weighted = 0;
  let best = 0;
  let worst = 0;
  for (const o of opps) {
    const amt = o.amount ?? 0;
    if (o.stage === "closed_lost") continue;
    if (o.stage === "closed_won") {
      // already closed — not forecast
      continue;
    }
    pipeline += amt;
    weighted += amt * (o.probability / 100);
    best += amt * Math.min(1, (o.probability + 15) / 100);
    worst += amt * Math.max(0, (o.probability - 20) / 100);
  }
  return {
    pipelineTotal: pipeline,
    weightedPipeline: Math.round(weighted),
    bestCase: Math.round(best),
    expectedCase: Math.round(weighted),
    worstCase: Math.round(worst),
    note: "Estimates from stage probabilities and recorded amounts only. Not guarantees.",
    evidence: "CALCULATED",
  };
}

export function dealRisk(input: {
  stage: string;
  daysSinceActivity?: number | null;
  hasDecisionMaker?: boolean;
  amount?: number | null;
}): { riskScore: number; reasons: string[]; actions: string[] } {
  let risk = 20;
  const reasons: string[] = [];
  const actions: string[] = [];
  if ((input.daysSinceActivity ?? 0) >= 14) {
    risk += 30;
    reasons.push("No recent activity ≥ 14 days");
    actions.push("Schedule reactivation or human review");
  } else if ((input.daysSinceActivity ?? 0) >= 7) {
    risk += 15;
    reasons.push("Quiet for 7+ days");
    actions.push("Send value follow-up if consented");
  }
  if (!input.hasDecisionMaker) {
    risk += 20;
    reasons.push("Decision-maker not identified");
    actions.push("Map buying committee");
  }
  if (["proposal_sent", "negotiation"].includes(input.stage) && (input.daysSinceActivity ?? 0) >= 5) {
    risk += 15;
    reasons.push("Late-stage stall");
    actions.push("Clarify next step and timeline");
  }
  risk = Math.min(100, risk);
  return { riskScore: risk, reasons, actions };
}

export function closeTheGap(input: {
  target: number;
  actual: number;
  avgDealSize: number;
  winRatePercent: number;
}) {
  const gap = Math.max(0, input.target - input.actual);
  const win = Math.max(1, input.winRatePercent) / 100;
  const avg = Math.max(1, input.avgDealSize);
  const dealsNeeded = Math.ceil(gap / (avg * win));
  const pipelineNeeded = Math.ceil(gap / win);
  return {
    target: input.target,
    actual: input.actual,
    gap,
    requiredPipeline: pipelineNeeded,
    requiredClosedDeals: dealsNeeded,
    assumptions: [
      `Average deal size ${avg}`,
      `Win rate ${input.winRatePercent}%`,
    ],
    note: "Planning math only — outcomes depend on real conversion.",
    evidence: "CALCULATED",
  };
}

export const FOLLOW_UP_SEQUENCE = [
  { day: 0, label: "Initial contact", theme: "relevance" },
  { day: 2, label: "Value follow-up", theme: "insight" },
  { day: 5, label: "Case / proof", theme: "social_proof" },
  { day: 9, label: "Objection-oriented", theme: "objection" },
  { day: 14, label: "Alternative offer", theme: "option" },
  { day: 21, label: "Break-up / re-engage", theme: "close_loop" },
];

export type PlaybookRule = {
  id?: string;
  if?: Record<string, unknown>;
  then?: Array<{ action: string; params?: Record<string, unknown> }>;
};

export function evaluatePlaybook(rules: PlaybookRule[], context: Record<string, unknown>) {
  const matched: Array<{ rule: PlaybookRule; actions: Array<{ action: string; params?: Record<string, unknown> }> }> = [];
  for (const rule of rules) {
    const cond = rule.if || {};
    let ok = true;
    for (const [k, v] of Object.entries(cond)) {
      const actual = context[k];
      if (typeof v === "object" && v && "gte" in (v as object)) {
        if (!(Number(actual) >= Number((v as any).gte))) ok = false;
      } else if (typeof v === "object" && v && "eq" in (v as object)) {
        if (actual !== (v as any).eq) ok = false;
      } else if (actual !== v) ok = false;
    }
    if (ok && rule.then?.length) matched.push({ rule, actions: rule.then });
  }
  return matched;
}

/** Map business diagnostic weaknesses to CINTEXA product opportunities */
export function mapDiagnosticToSales(input: {
  companyName: string;
  industry?: string | null;
  health?: number | null;
  weakestPillar?: string | null;
  pillarScores?: Record<string, number>;
  objective?: string | null;
}) {
  const scores = input.pillarScores || {};
  const recommendations: Array<{
    product: string;
    reason: string;
    pitch: string;
    confidence: "low" | "medium" | "high";
    suggestedAgentRole: string;
  }> = [];

  if ((scores.sales ?? 100) < 55 || input.weakestPillar === "Sales") {
    recommendations.push({
      product: "CINTEXA CRM + Sales Force",
      reason: "Sales pillar weak or identified as priority",
      pitch: "Structure pipeline stages, follow-up ownership, and AI SDR support so fewer leads go cold.",
      confidence: "high",
      suggestedAgentRole: "ae",
    });
  }
  if ((scores.marketing ?? 100) < 55 || input.weakestPillar === "Marketing") {
    recommendations.push({
      product: "CINTEXA Marketing Automation",
      reason: "Marketing measurement or acquisition under pressure",
      pitch: "Connect channels to qualified pipeline with clear CPL and handoff to sales.",
      confidence: "medium",
      suggestedAgentRole: "sdr",
    });
  }
  if ((scores.customer ?? 100) < 55 || input.weakestPillar === "Customer") {
    recommendations.push({
      product: "CINTEXA Customer Service",
      reason: "Retention / experience signals weak",
      pitch: "Reduce churn risk with faster response and account health visibility.",
      confidence: "medium",
      suggestedAgentRole: "account_manager",
    });
  }
  if ((scores.technology ?? 100) < 55 || (scores.automation ?? 100) < 55) {
    recommendations.push({
      product: "CINTEXA Integration Layer + AI Workforce",
      reason: "Systems or automation maturity lagging",
      pitch: "Remove spreadsheet silos and automate repetitive revenue ops tasks.",
      confidence: "medium",
      suggestedAgentRole: "ae",
    });
  }
  if ((input.health ?? 100) < 50 && recommendations.length === 0) {
    recommendations.push({
      product: "CINTEXA Business Diagnostic + CRM starter",
      reason: "Overall health below 50 without a single dominant pillar signal",
      pitch: "Start with a structured diagnostic and system of record for opportunities.",
      confidence: "low",
      suggestedAgentRole: "ae",
    });
  }

  return {
    companyName: input.companyName,
    industry: input.industry || null,
    objective: input.objective || null,
    recommendations,
    suggestedOpportunityName: `${input.companyName} — diagnostic-led opportunity`,
    nextStep: recommendations.length
      ? "Create opportunity, assign AE/SDR, and draft proposal only after discovery confirms scope."
      : "Insufficient diagnostic signal for product mapping — gather more evidence.",
    evidence: "CALCULATED",
  };
}

export function defaultEnterprisePlaybook(): PlaybookRule[] {
  return [
    {
      id: "high-priority-enterprise",
      if: { priorityScore: { gte: 80 }, companySize: { eq: "enterprise" } },
      then: [
        { action: "assign_role", params: { role: "ae" } },
        { action: "research" },
        { action: "prepare_outreach", params: { theme: "intro" } },
      ],
    },
    {
      id: "high-intent",
      if: { priorityScore: { gte: 65 } },
      then: [
        { action: "assign_role", params: { role: "sdr" } },
        { action: "prepare_outreach", params: { theme: "intro" } },
      ],
    },
    {
      id: "new-lead-research",
      if: { stage: { eq: "new_lead" } },
      then: [{ action: "research" }, { action: "score" }],
    },
  ];
}
