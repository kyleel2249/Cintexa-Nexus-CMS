/**
 * Advanced sales-force capabilities: qualification frameworks, intent, negotiation,
 * handoff, sequences, quotes, daily brief, lost-deal analysis.
 */

export type BantInput = {
  budget?: string | null;
  authority?: string | null;
  need?: string | null;
  timeline?: string | null;
};

export function qualifyBant(input: BantInput) {
  const parts = {
    budget: Boolean(input.budget && !/unknown|none|n\/a/i.test(input.budget)),
    authority: Boolean(input.authority && !/unknown|none/i.test(input.authority)),
    need: Boolean(input.need && input.need.length > 8),
    timeline: Boolean(input.timeline && !/unknown|none/i.test(input.timeline)),
  };
  const score = Math.round(
    (Number(parts.budget) + Number(parts.authority) + Number(parts.need) + Number(parts.timeline)) * 25,
  );
  let label = "cold";
  if (score >= 100) label = "sql";
  else if (score >= 75) label = "mql";
  else if (score >= 50) label = "warm";
  else if (score >= 25) label = "low_intent";
  return {
    framework: "BANT",
    parts,
    score,
    label,
    missing: (Object.keys(parts) as Array<keyof typeof parts>).filter((k) => !parts[k]),
    evidence: "USER PROVIDED",
    confidence: score >= 75 ? "high" : score >= 50 ? "medium" : "low",
  };
}

export function detectBuyingIntent(signals: {
  pricingRequest?: boolean;
  proposalRequest?: boolean;
  contractRequest?: boolean;
  implementationQuestion?: boolean;
  timelineQuestion?: boolean;
  competitorComparison?: boolean;
  howSoon?: boolean;
  nextStep?: boolean;
  agreementRequest?: boolean;
  replyCount?: number;
  pricingPageViews?: number;
}) {
  let score = 10;
  const hits: string[] = [];
  const flags: Array<[keyof typeof signals, number, string]> = [
    ["pricingRequest", 18, "Pricing request"],
    ["proposalRequest", 16, "Proposal request"],
    ["contractRequest", 20, "Contract request"],
    ["implementationQuestion", 12, "Implementation question"],
    ["timelineQuestion", 12, "Timeline question"],
    ["competitorComparison", 10, "Competitor comparison"],
    ["howSoon", 15, "How soon can you start"],
    ["nextStep", 12, "What is the next step"],
    ["agreementRequest", 18, "Agreement request"],
  ];
  for (const [k, w, label] of flags) {
    if (signals[k]) {
      score += w;
      hits.push(label);
    }
  }
  score += Math.min(15, (signals.replyCount ?? 0) * 5);
  score += Math.min(12, (signals.pricingPageViews ?? 0) * 6);
  score = Math.min(100, score);

  let classification = "passive";
  if (score >= 85) classification = "purchase_ready";
  else if (score >= 70) classification = "high_intent";
  else if (score >= 55) classification = "evaluating";
  else if (score >= 40) classification = "interested";
  else if (score >= 25) classification = "curious";

  return {
    intentScore: score,
    classification,
    signals: hits,
    evidence: "CALCULATED",
    note: "Based only on provided signals — not inferred browsing without data.",
  };
}

export type NegotiationPolicy = {
  minPrice: number;
  maxDiscountPercent: number;
  approvedPackages: string[];
  paymentTerms: string[];
  maxContractMonths: number;
  escalationThresholdPercent: number;
};

export const DEFAULT_NEGOTIATION_POLICY: NegotiationPolicy = {
  minPrice: 0,
  maxDiscountPercent: 10,
  approvedPackages: ["Starter", "Growth", "Enterprise"],
  paymentTerms: ["Net 15", "Net 30", "50% upfront"],
  maxContractMonths: 24,
  escalationThresholdPercent: 10,
};

export function negotiate(input: {
  listPrice: number;
  requestedPrice?: number | null;
  requestedDiscountPercent?: number | null;
  packageName?: string | null;
  paymentTerms?: string | null;
  contractMonths?: number | null;
  policy?: Partial<NegotiationPolicy>;
}) {
  const policy = { ...DEFAULT_NEGOTIATION_POLICY, ...input.policy };
  const list = Math.max(0, input.listPrice);
  let requestedDiscount =
    input.requestedDiscountPercent != null
      ? Number(input.requestedDiscountPercent)
      : input.requestedPrice != null && list > 0
        ? ((list - Number(input.requestedPrice)) / list) * 100
        : 0;
  requestedDiscount = Math.max(0, requestedDiscount);

  const withinDiscount = requestedDiscount <= policy.maxDiscountPercent;
  const packageOk = !input.packageName || policy.approvedPackages.includes(input.packageName);
  const termsOk = !input.paymentTerms || policy.paymentTerms.includes(input.paymentTerms);
  const monthsOk = input.contractMonths == null || input.contractMonths <= policy.maxContractMonths;
  const finalPrice =
    input.requestedPrice != null
      ? Number(input.requestedPrice)
      : list * (1 - Math.min(requestedDiscount, policy.maxDiscountPercent) / 100);
  const aboveMin = finalPrice >= policy.minPrice;

  if (withinDiscount && packageOk && termsOk && monthsOk && aboveMin) {
    return {
      decision: "approve" as const,
      finalPrice: Math.round(finalPrice * 100) / 100,
      discountPercent: Math.round(requestedDiscount * 100) / 100,
      reason: "Within approved negotiation policy.",
      escalate: false,
      policy,
      evidence: "CALCULATED",
    };
  }

  return {
    decision: "escalate" as const,
    finalPrice: null,
    discountPercent: requestedDiscount,
    reason: [
      !withinDiscount ? `Discount ${requestedDiscount.toFixed(1)}% exceeds max ${policy.maxDiscountPercent}%` : null,
      !packageOk ? "Package not in approved list" : null,
      !termsOk ? "Payment terms not approved" : null,
      !monthsOk ? "Contract duration exceeds policy" : null,
      !aboveMin ? "Price below minimum" : null,
    ]
      .filter(Boolean)
      .join("; "),
    escalate: true,
    policy,
    evidence: "CALCULATED",
  };
}

export function buildHandoffBrief(input: {
  companyName: string;
  contactName?: string | null;
  stage?: string | null;
  need?: string | null;
  painPoints?: string[];
  objections?: string[];
  productsDiscussed?: string[];
  pricingDiscussed?: string | null;
  intentScore?: number | null;
  priorityScore?: number | null;
  nextStep?: string | null;
  outstandingQuestions?: string[];
  conversationSummary?: string | null;
}) {
  return {
    title: `Handoff brief — ${input.companyName}`,
    customer: { companyName: input.companyName, contactName: input.contactName || null },
    stage: input.stage || null,
    need: input.need || "UNKNOWN — confirm in discovery",
    painPoints: input.painPoints || [],
    objections: input.objections || [],
    productsDiscussed: input.productsDiscussed || [],
    pricingDiscussed: input.pricingDiscussed || null,
    buyingIntent: input.intentScore ?? null,
    leadScore: input.priorityScore ?? null,
    recommendedNextStep: input.nextStep || "Human discovery call",
    outstandingQuestions: input.outstandingQuestions || [],
    conversationSummary: input.conversationSummary || null,
    generatedAt: new Date().toISOString(),
    evidence: "USER PROVIDED / CALCULATED",
  };
}

export function buildQuote(input: {
  lineItems: Array<{ name: string; quantity: number; unitPrice: number }>;
  discountPercent?: number;
  taxPercent?: number;
  currency?: string;
  maxDiscountPercent?: number;
}) {
  const maxDisc = input.maxDiscountPercent ?? 10;
  const disc = Math.min(Math.max(0, input.discountPercent ?? 0), maxDisc);
  const subtotal = input.lineItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const discountAmt = subtotal * (disc / 100);
  const taxable = subtotal - discountAmt;
  const tax = taxable * ((input.taxPercent ?? 0) / 100);
  const total = taxable + tax;
  return {
    lineItems: input.lineItems,
    subtotal: round2(subtotal),
    discountPercent: disc,
    discount: round2(discountAmt),
    taxPercent: input.taxPercent ?? 0,
    tax: round2(tax),
    total: round2(total),
    currency: input.currency || "GHS",
    note:
      (input.discountPercent ?? 0) > maxDisc
        ? `Requested discount capped at policy max ${maxDisc}%`
        : "Calculated from authorized line items",
    evidence: "CALCULATED",
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function analyzeLostDeal(input: {
  lostReason?: string | null;
  competitor?: string | null;
  stage?: string | null;
  amount?: number | null;
}) {
  const reason = (input.lostReason || "").toLowerCase();
  const categories: string[] = [];
  if (/price|cost|budget|expensive/.test(reason)) categories.push("price");
  if (/competitor|chose other|went with/.test(reason)) categories.push("competitor");
  if (/timing|later|not now|postpone/.test(reason)) categories.push("timing");
  if (/feature|product|missing|capability/.test(reason)) categories.push("product");
  if (/service|support|implementation/.test(reason)) categories.push("service");
  if (/decision|stakeholder|authority/.test(reason)) categories.push("decision_process");
  if (!categories.length) categories.push("unspecified");

  return {
    categories,
    competitor: input.competitor || null,
    stageAtLoss: input.stage || null,
    amount: input.amount ?? null,
    lessons: categories.map((c) => {
      if (c === "price") return "Review packaging and value proof; do not invent discounts.";
      if (c === "competitor") return "Capture competitor name and differentiators for knowledge base.";
      if (c === "timing") return "Schedule reactivation sequence; do not spam.";
      if (c === "product") return "Feed gap to product roadmap; avoid overselling features.";
      if (c === "service") return "Strengthen implementation narrative and references.";
      if (c === "decision_process") return "Map buying committee earlier in discovery.";
      return "Request a clearer loss reason next time.";
    }),
    evidence: input.lostReason ? "USER PROVIDED" : "UNKNOWN",
  };
}

export function dailySalesBrief(input: {
  target?: number | null;
  revenueClosed?: number;
  pipelineValue?: number;
  leadsTotal?: number;
  highIntent?: number;
  uncontacted?: number;
  openOpps?: number;
  atRisk?: Array<{ name: string; riskScore?: number }>;
  topOpps?: Array<{ name: string; amount?: number | null }>;
}) {
  const gap =
    input.target != null ? Math.max(0, Number(input.target) - Number(input.revenueClosed || 0)) : null;
  return {
    title: "Today's Sales Command Brief",
    generatedAt: new Date().toISOString(),
    revenueTarget: input.target ?? null,
    revenueClosed: input.revenueClosed ?? 0,
    revenueGap: gap,
    pipelineStatus: {
      value: input.pipelineValue ?? 0,
      openOpportunities: input.openOpps ?? 0,
    },
    leadsRequiringContact: input.uncontacted ?? 0,
    highIntentProspects: input.highIntent ?? 0,
    topOpportunities: input.topOpps || [],
    atRiskDeals: input.atRisk || [],
    recommendedActions: [
      input.uncontacted ? `Contact or research ${input.uncontacted} uncontacted lead(s) with consent` : "No uncontacted backlog",
      input.highIntent ? `Prioritize ${input.highIntent} high-intent prospect(s)` : "No high-intent queue",
      (input.atRisk || []).length ? `Review ${input.atRisk!.length} at-risk deal(s)` : "No at-risk list",
      gap && gap > 0 ? `Close gap of ${gap} via pipeline coverage and conversion` : "On or above target (or no target set)",
    ],
    evidence: "CALCULATED",
    note: "Built only from provided metrics — zeros mean empty data, not simulated activity.",
  };
}

export function sequenceStepDue(input: {
  sequenceDay: number;
  lastContactAt?: string | null;
  replied?: boolean;
  optedOut?: boolean;
}) {
  if (input.optedOut) return { due: false, action: "stop", reason: "Opted out" };
  if (input.replied) return { due: false, action: "conversational_mode", reason: "Prospect replied — stop automation" };
  const last = input.lastContactAt ? new Date(input.lastContactAt).getTime() : 0;
  const daysSince = last ? (Date.now() - last) / (86400000) : 999;
  const due = daysSince >= input.sequenceDay || !last;
  return {
    due,
    action: due ? "send_sequence_step" : "wait",
    daysSince: Math.floor(daysSince),
    reason: due ? `Sequence day ${input.sequenceDay} reached` : "Not yet due",
  };
}

export function nextBestOffer(input: {
  industry?: string | null;
  companySize?: string | null;
  weakestPillar?: string | null;
  existingProducts?: string[];
}) {
  const existing = new Set((input.existingProducts || []).map((p) => p.toLowerCase()));
  const offers: Array<{ product: string; why: string; pitch: string; confidence: string }> = [];
  if (!existing.has("crm") && (input.weakestPillar === "Sales" || !input.weakestPillar)) {
    offers.push({
      product: "CINTEXA CRM",
      why: "No CRM noted; sales process needs a system of record",
      pitch: "Centralize pipeline stages, owners, and follow-ups.",
      confidence: "medium",
    });
  }
  if (input.weakestPillar === "Marketing") {
    offers.push({
      product: "CINTEXA Marketing Automation",
      why: "Marketing pillar priority from diagnostic or profile",
      pitch: "Connect acquisition channels to qualified handoff.",
      confidence: "medium",
    });
  }
  if (input.weakestPillar === "Customer") {
    offers.push({
      product: "CINTEXA Customer Service",
      why: "Retention/experience pressure",
      pitch: "Faster response and account health visibility.",
      confidence: "medium",
    });
  }
  if (!offers.length) {
    offers.push({
      product: "CINTEXA Business Diagnostic",
      why: "Insufficient product signals — start with evidence",
      pitch: "Run a structured diagnostic before recommending modules.",
      confidence: "low",
    });
  }
  return { offers, evidence: "INFERRED", note: "Confirm fit in discovery; do not treat as guaranteed purchase." };
}
