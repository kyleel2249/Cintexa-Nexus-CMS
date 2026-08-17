export type EvidenceClass = "VERIFIED" | "USER PROVIDED" | "CALCULATED" | "BENCHMARKED" | "INFERRED" | "UNKNOWN";
export type DiagnosticMode = "quick" | "standard" | "deep" | "executive" | "sales" | "marketing" | "competitive" | "digital";
export type Metric = { id: string; label: string; value: number | null; unit: string; benchmark?: number | null };
export type Competitor = { id: string; name: string; website?: string; positioning: string; score: number; pricing: string; strengths: string[]; weaknesses: string[] };
export type Goal = { id: string; title: string; level: "strategic" | "tactical" | "operational"; owner: string; baseline: number | null; target: number | null; unit: string; deadline: string; status: string; smart: { specific: boolean; measurable: boolean; achievable: boolean; relevant: boolean; timeBound: boolean } };

type DiagnosticQuestionType = "boolean" | "scale" | "select" | "text" | "number";
export type DiagnosticQuestion = {
  id: string;
  pillar: string;
  text: string;
  type: DiagnosticQuestionType;
  options?: readonly string[];
};

export const pillars = [
  { id: "strategy", label: "Strategy", weight: 12 },
  { id: "sales", label: "Sales", weight: 14 },
  { id: "marketing", label: "Marketing", weight: 10 },
  { id: "customer", label: "Customer", weight: 10 },
  { id: "operations", label: "Operations", weight: 10 },
  { id: "finance", label: "Finance", weight: 14 },
  { id: "technology", label: "Technology", weight: 10 },
  { id: "automation", label: "AI & Automation", weight: 8 },
  { id: "competitive", label: "Competitive Position", weight: 12 },
] as const;

export const initialMetrics: Metric[] = [
  { id: "monthlyRevenue", label: "Monthly revenue", value: null, unit: "GHS" },
  { id: "monthlyLeads", label: "Monthly leads", value: null, unit: "leads" },
  { id: "qualifiedLeads", label: "Qualified leads / month", value: null, unit: "leads" },
  { id: "customers", label: "New customers / month", value: null, unit: "customers" },
  { id: "conversion", label: "Lead-to-customer conversion", value: null, unit: "%" },
  { id: "aov", label: "Average transaction value", value: null, unit: "GHS" },
  { id: "cac", label: "Customer acquisition cost", value: null, unit: "GHS" },
  { id: "churn", label: "Monthly customer churn", value: null, unit: "%" },
  { id: "retention", label: "Customer retention", value: null, unit: "%" },
  { id: "grossMargin", label: "Gross margin", value: null, unit: "%" },
  { id: "netMargin", label: "Net margin", value: null, unit: "%" },
  { id: "salesCycle", label: "Average sales cycle", value: null, unit: "days" },
];

export const questionBank: DiagnosticQuestion[] = [
  // Strategy
  { id: "s1", pillar: "strategy", text: "Are your top three business priorities documented with owners and measurable outcomes?", type: "boolean" },
  { id: "s2", pillar: "strategy", text: "How clear is your market positioning versus direct competitors?", type: "scale" },
  { id: "s3", pillar: "strategy", text: "How well are resources (budget, people, time) aligned to those priorities?", type: "scale" },
  { id: "s4", pillar: "strategy", text: "What is the primary strategic objective for the next 12 months?", type: "text" },
  // Sales
  { id: "sales1", pillar: "sales", text: "Where is your sales funnel weakest today?", type: "select", options: ["Lead volume", "Lead quality", "Qualification", "Follow-up", "Proposal", "Closing", "Retention"] },
  { id: "sales2", pillar: "sales", text: "Are sales opportunities tracked in a CRM with defined stages?", type: "boolean" },
  { id: "sales3", pillar: "sales", text: "How effective is follow-up discipline after first contact?", type: "scale" },
  { id: "sales4", pillar: "sales", text: "What is your approximate win rate on qualified opportunities?", type: "number" },
  // Marketing
  { id: "marketing1", pillar: "marketing", text: "Which channel currently produces the highest-quality leads?", type: "select", options: ["Organic search", "Paid search", "Social organic", "Paid social", "Referrals", "Outbound", "Events", "Partnerships", "Unknown"] },
  { id: "marketing2", pillar: "marketing", text: "Do you measure cost per lead and marketing ROI by channel?", type: "boolean" },
  { id: "marketing3", pillar: "marketing", text: "How strong is website conversion (visitor → lead)?", type: "scale" },
  // Customer
  { id: "customer1", pillar: "customer", text: "Do you systematically track churn reasons?", type: "boolean" },
  { id: "customer2", pillar: "customer", text: "How strong is onboarding quality for new customers?", type: "scale" },
  { id: "customer3", pillar: "customer", text: "Average first-response time for support (hours)?", type: "number" },
  // Operations
  { id: "ops1", pillar: "operations", text: "Where is the biggest operational bottleneck?", type: "select", options: ["Fulfilment", "Service delivery", "Admin / paperwork", "Approvals", "Handoffs", "Quality rework", "Procurement", "Unknown"] },
  { id: "ops2", pillar: "operations", text: "How standardized are core delivery processes?", type: "scale" },
  // Finance
  { id: "fin1", pillar: "finance", text: "Do you know gross and net margin by product or service line?", type: "boolean" },
  { id: "fin2", pillar: "finance", text: "How healthy is cash-flow predictability?", type: "scale" },
  { id: "fin3", pillar: "finance", text: "Is pricing reviewed against costs and competitors at least annually?", type: "boolean" },
  // Technology
  { id: "technology1", pillar: "technology", text: "Is customer and sales data consolidated in one system of record?", type: "boolean" },
  { id: "technology2", pillar: "technology", text: "How much does the team rely on spreadsheets for core reporting?", type: "scale" },
  // AI & Automation
  { id: "auto1", pillar: "automation", text: "Which process would create the most value if automated first?", type: "select", options: ["Lead qualification", "Follow-up sequences", "Reporting", "Support replies", "Content production", "Forecasting", "None identified"] },
  { id: "auto2", pillar: "automation", text: "How ready is the organization to adopt AI assistants?", type: "scale" },
  // Competitive
  { id: "comp1", pillar: "competitive", text: "How often do you formally review competitor moves?", type: "select", options: ["Weekly", "Monthly", "Quarterly", "Annually", "Rarely", "Never"] },
  { id: "comp2", pillar: "competitive", text: "How clear is your differentiation versus the nearest rival?", type: "scale" },
];

export function scoreSeverity(score: number) {
  if (score <= 20) return "Critical";
  if (score <= 40) return "Weak";
  if (score <= 60) return "Needs Attention";
  if (score <= 80) return "Healthy";
  return "High Performing";
}

export function calculateBusinessHealth(scores: Record<string, number>) {
  const totalWeight = pillars.reduce((sum, p) => sum + p.weight, 0);
  return Math.round(pillars.reduce((sum, p) => sum + (scores[p.id] ?? 0) * p.weight, 0) / totalWeight);
}

export function calculateSalesMetrics(metrics: Metric[]) {
  const get = (id: string) => metrics.find(m => m.id === id)?.value ?? null;
  const leads = get("monthlyLeads");
  const customers = get("customers");
  const qualified = get("qualifiedLeads");
  const aov = get("aov");
  const cac = get("cac");
  const conversion = leads !== null && leads > 0 && customers !== null ? (customers / leads) * 100 : null;
  const qualification = leads !== null && leads > 0 && qualified !== null ? (qualified / leads) * 100 : null;
  const revenue = customers !== null && aov !== null ? customers * aov : null;
  return { conversion, qualification, revenue, cac, salesVelocity: revenue !== null && cac !== null && cac > 0 ? revenue / cac : null };
}

export function buildAdaptiveQuestions(answers: Record<string, string | number | boolean>): DiagnosticQuestion[] {
  const questions: DiagnosticQuestion[] = [...questionBank];
  const weakest = answers.sales1;
  if (weakest === "Follow-up") {
    questions.push({ id: "sales-followup", pillar: "sales", text: "How quickly are qualified leads contacted after they enter the pipeline?", type: "text" });
    questions.push({ id: "sales-followup-2", pillar: "sales", text: "What percentage of leads receive a second touch within 48 hours?", type: "number" });
  }
  if (weakest === "Closing") {
    questions.push({ id: "sales-closing", pillar: "sales", text: "What are the three most common reasons qualified deals are lost?", type: "text" });
    questions.push({ id: "sales-closing-2", pillar: "sales", text: "When did win rate start declining (or is it stable)?", type: "text" });
  }
  if (weakest === "Lead volume") {
    questions.push({ id: "sales-volume", pillar: "sales", text: "Has inbound traffic, outbound activity, or both declined?", type: "select", options: ["Inbound", "Outbound", "Both", "Neither — quality issue", "Unknown"] });
  }
  if (weakest === "Lead quality") {
    questions.push({ id: "sales-quality", pillar: "sales", text: "Which source produces the lowest-quality leads?", type: "text" });
  }
  if (answers.technology1 === false) {
    questions.push({ id: "tech-silos", pillar: "technology", text: "Which two systems create the most duplicate data entry?", type: "text" });
  }
  if (answers.marketing2 === false) {
    questions.push({ id: "mkt-attribution", pillar: "marketing", text: "How do you currently decide marketing budget allocation without channel ROI?", type: "text" });
  }
  if (answers.customer1 === false) {
    questions.push({ id: "churn-reasons", pillar: "customer", text: "What are the top suspected reasons customers leave?", type: "text" });
  }
  if (answers.fin1 === false) {
    questions.push({ id: "fin-margin", pillar: "finance", text: "Which product or service do you suspect is least profitable?", type: "text" });
  }
  if (answers.comp1 === "Rarely" || answers.comp1 === "Never") {
    questions.push({ id: "comp-gap", pillar: "competitive", text: "Name the competitor that wins deals you most often lose, and why.", type: "text" });
  }
  return questions;
}

/** Social platforms tracked separately for paid ad boosts. */
export type SocialAdPlatformId =
  | "meta"
  | "instagram"
  | "facebook"
  | "tiktok"
  | "youtube"
  | "google"
  | "linkedin"
  | "twitter"
  | "snapchat"
  | "pinterest"
  | "other";

export type SocialAdPlatform = {
  id: SocialAdPlatformId;
  label: string;
  channel: string;
  enabled: boolean;
  monthlySpend: number | null;
  impressions: number | null;
  clicks: number | null;
  leads: number | null;
  conversions: number | null;
  roas: number | null;
  cpc: number | null;
  cpl: number | null;
  notes: string;
};

export const SOCIAL_AD_PLATFORMS: Array<{ id: SocialAdPlatformId; label: string; channel: string }> = [
  { id: "meta", label: "Meta Ads (combined)", channel: "Meta" },
  { id: "facebook", label: "Facebook Ads", channel: "Meta" },
  { id: "instagram", label: "Instagram Ads", channel: "Meta" },
  { id: "tiktok", label: "TikTok Ads", channel: "TikTok" },
  { id: "youtube", label: "YouTube Ads", channel: "Google" },
  { id: "google", label: "Google Ads (Search/Display)", channel: "Google" },
  { id: "linkedin", label: "LinkedIn Ads", channel: "LinkedIn" },
  { id: "twitter", label: "X (Twitter) Ads", channel: "X" },
  { id: "snapchat", label: "Snapchat Ads", channel: "Snapchat" },
  { id: "pinterest", label: "Pinterest Ads", channel: "Pinterest" },
  { id: "other", label: "Other paid social", channel: "Other" },
];

export function initialSocialPlatforms(): SocialAdPlatform[] {
  return SOCIAL_AD_PLATFORMS.map((p) => ({
    id: p.id,
    label: p.label,
    channel: p.channel,
    enabled: false,
    monthlySpend: null,
    impressions: null,
    clicks: null,
    leads: null,
    conversions: null,
    roas: null,
    cpc: null,
    cpl: null,
    notes: "",
  }));
}

export type SocialPlatformInsight = {
  platformId: SocialAdPlatformId;
  label: string;
  healthScore: number;
  severity: string;
  metrics: { cpc: number | null; cpl: number | null; ctr: number | null; roas: number | null; spend: number | null };
  evidence: EvidenceClass;
  findings: string[];
  recommendations: string[];
  strategy: string;
};

export function analyzeSocialPlatforms(platforms: SocialAdPlatform[]): {
  active: SocialAdPlatform[];
  totalSpend: number;
  insights: SocialPlatformInsight[];
  topPerformer: SocialPlatformInsight | null;
  weakest: SocialPlatformInsight | null;
  portfolioRecommendations: string[];
} {
  const active = platforms.filter((p) => p.enabled);
  const totalSpend = active.reduce((s, p) => s + (p.monthlySpend ?? 0), 0);
  const insights: SocialPlatformInsight[] = active.map((p) => {
    const ctr = p.impressions && p.impressions > 0 && p.clicks != null ? (p.clicks / p.impressions) * 100 : null;
    const cpc = p.cpc ?? (p.clicks && p.clicks > 0 && p.monthlySpend != null ? p.monthlySpend / p.clicks : null);
    const cpl = p.cpl ?? (p.leads && p.leads > 0 && p.monthlySpend != null ? p.monthlySpend / p.leads : null);
    const roas = p.roas;
    let health = 55;
    const findings: string[] = [];
    const recommendations: string[] = [];
    if (roas != null) {
      if (roas >= 3) { health += 20; findings.push(`ROAS ${roas.toFixed(1)}x is strong relative to a 3x working threshold.`); }
      else if (roas >= 1.5) { health += 5; findings.push(`ROAS ${roas.toFixed(1)}x is acceptable but below a 3x stretch target.`); recommendations.push(`Tighten creative and audience exclusion on ${p.label} to lift ROAS toward 3x.`); }
      else { health -= 20; findings.push(`ROAS ${roas.toFixed(1)}x is below payback comfort.`); recommendations.push(`Pause lowest-ROAS ad sets on ${p.label} and reallocate to proven creatives.`); }
    }
    if (ctr != null) {
      if (ctr < 0.8) { health -= 10; findings.push(`CTR ${ctr.toFixed(2)}% is weak for paid social.`); recommendations.push(`Refresh hooks and first 3 seconds of creative on ${p.label}.`); }
      else if (ctr >= 1.5) { health += 8; findings.push(`CTR ${ctr.toFixed(2)}% indicates creative resonance.`); }
    }
    if (cpl != null && p.monthlySpend && p.monthlySpend > 0) {
      findings.push(`Cost per lead approximately ${cpl.toFixed(2)}.`);
      recommendations.push(`Benchmark CPL for ${p.label} against your blended CAC before scaling spend.`); }
    if (!findings.length) {
      findings.push("Limited platform metrics supplied — scores are provisional.");
      recommendations.push(`Connect ${p.label} ad account metrics (spend, CTR, CPL, ROAS) for evidence-led scaling.`);
    }
    const strategyByPlatform: Record<string, string> = {
      meta: "Use Meta Advantage+ for proven offers; isolate prospecting vs retargeting budgets.",
      facebook: "Prioritize conversion campaigns with strong social proof; exclude recent converters.",
      instagram: "Lead with short-form creative and UGC-style assets; test Reels placements separately.",
      tiktok: "Optimize for thumb-stop creative in 1–3s; use Spark Ads with creator content when available.",
      youtube: "Use in-feed and Shorts for mid-funnel education; protect brand search separately on Google.",
      google: "Separate brand, non-brand and competitor search; protect ROAS with strict query intent.",
      linkedin: "Keep audiences tight (title + industry); favor conversation/lead gen forms for B2B.",
      twitter: "Use X for timely offers and consideration; keep frequency caps low.",
      snapchat: "Focus on younger cohorts and vertical creative; measure assisted conversions carefully.",
      pinterest: "Align creatives to high-intent search terms and seasonal demand.",
      other: "Document the channel’s role in the funnel before increasing budget.",
    };
    health = Math.max(0, Math.min(100, Math.round(health)));
    return {
      platformId: p.id,
      label: p.label,
      healthScore: health,
      severity: scoreSeverity(health),
      metrics: { cpc, cpl, ctr, roas, spend: p.monthlySpend },
      evidence: (roas != null || ctr != null || cpl != null ? "CALCULATED" : "USER PROVIDED") as EvidenceClass,
      findings,
      recommendations,
      strategy: strategyByPlatform[p.id] ?? strategyByPlatform.other,
    };
  });

  const sorted = [...insights].sort((a, b) => b.healthScore - a.healthScore);
  const topPerformer = sorted[0] ?? null;
  const weakest = sorted.length ? sorted[sorted.length - 1] : null;
  const portfolioRecommendations: string[] = [];
  if (topPerformer && weakest && topPerformer.platformId !== weakest.platformId) {
    portfolioRecommendations.push(
      `Shift incremental test budget from ${weakest.label} toward ${topPerformer.label} while holding a controlled experiment on ${weakest.label}.`,
    );
  }
  if (totalSpend > 0 && active.length >= 2) {
    portfolioRecommendations.push("Review platform mix monthly: spend share vs lead share vs revenue share.");
  }
  if (!active.length) {
    portfolioRecommendations.push("Enable at least one paid social platform with spend and outcome metrics to unlock platform-level diagnosis.");
  }
  portfolioRecommendations.push("Keep creative fatigue checks weekly on every active ad platform.");
  return { active, totalSpend, insights, topPerformer, weakest, portfolioRecommendations };
}

/** Niche-based industry benchmark seeds (administrator-style defaults until live sources attach). */
export const INDUSTRY_BENCHMARKS: Record<string, Record<string, number>> = {
  default: { strategy: 72, sales: 65, marketing: 68, customer: 70, operations: 66, finance: 74, technology: 62, automation: 55, competitive: 64 },
  saas: { strategy: 78, sales: 70, marketing: 72, customer: 80, operations: 74, finance: 76, technology: 82, automation: 78, competitive: 70 },
  ecommerce: { strategy: 70, sales: 68, marketing: 76, customer: 72, operations: 70, finance: 72, technology: 68, automation: 64, competitive: 68 },
  agency: { strategy: 74, sales: 72, marketing: 78, customer: 75, operations: 68, finance: 70, technology: 66, automation: 60, competitive: 72 },
  retail: { strategy: 68, sales: 66, marketing: 70, customer: 68, operations: 72, finance: 70, technology: 58, automation: 52, competitive: 66 },
  b2b: { strategy: 76, sales: 72, marketing: 68, customer: 74, operations: 70, finance: 75, technology: 70, automation: 62, competitive: 70 },
  healthcare: { strategy: 74, sales: 60, marketing: 62, customer: 78, operations: 76, finance: 72, technology: 64, automation: 58, competitive: 62 },
  fintech: { strategy: 80, sales: 72, marketing: 70, customer: 76, operations: 78, finance: 82, technology: 85, automation: 80, competitive: 74 },
};


/** Map assessment answers to pillar scores (0–100) with transparent deltas. */
export function derivePillarScoresFromAnswers(
  answers: Record<string, string | number | boolean>,
  base: Record<string, number> = Object.fromEntries(pillars.map(p => [p.id, 55])),
): Record<string, number> {
  const scores: Record<string, number> = { ...base };
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

  for (const [qid, raw] of Object.entries(answers)) {
    const q = questionBank.find(x => x.id === qid) || (qid.includes("follow") || qid.includes("closing") || qid.includes("silos")
      ? { id: qid, pillar: qid.startsWith("sales") ? "sales" : qid.startsWith("tech") ? "technology" : "strategy", type: "text" as const, text: "" }
      : null);
    if (!q) continue;
    const pillar = q.pillar;
    let delta = 0;
    if (typeof raw === "boolean") {
      delta = raw ? 8 : -10;
    } else if (typeof raw === "number") {
      // 1–5 scale → centered on 3
      delta = (raw - 3) * 6;
    } else if (typeof raw === "string") {
      const t = raw.trim();
      if (!t) delta = -4;
      else if (t.length < 12) delta = 2;
      else if (t.length < 40) delta = 5;
      else delta = 7;
      // penalize vague “no / none / n/a”
      if (/^(no|none|n\/a|na|unknown|not sure)\b/i.test(t)) delta = -6;
    }
    scores[pillar] = clamp((scores[pillar] ?? 55) + delta);
  }

  // Soft regularization: unanswered pillars drift toward neutral 50
  for (const p of pillars) {
    const answered = questionBank.some(q => q.pillar === p.id && answers[q.id] !== undefined);
    if (!answered) scores[p.id] = clamp((scores[p.id] ?? 55) * 0.85 + 50 * 0.15);
  }
  return scores;
}

/** Benchmark metadata — values are illustrative bands until admin-sourced series exist. */
export type BenchmarkSeries = {
  industryKey: string;
  asOf: string;
  source: string;
  evidence: EvidenceClass;
  pillars: Record<string, number>;
};

export function getDatedIndustryBenchmarks(industry: string): BenchmarkSeries {
  const key = resolveIndustryKey(industry);
  const pillarsMap = INDUSTRY_BENCHMARKS[key] || INDUSTRY_BENCHMARKS.default;
  return {
    industryKey: key,
    asOf: "2026-01-01",
    source: "CINTEXA internal illustrative bands (replace with admin-verified series)",
    evidence: "INFERRED",
    pillars: { ...pillarsMap },
  };
}

/** Build a portable diagnostic snapshot for API / local persistence. */
export function buildDiagnosticSnapshot(input: {
  company: Record<string, string>;
  mode: DiagnosticMode;
  answers: Record<string, string | number | boolean>;
  scores: Record<string, number>;
  metrics: Metric[];
  goals: Goal[];
  competitors: Competitor[];
  socialPlatforms?: SocialAdPlatform[];
  webResearch?: Record<string, unknown> | null;
  health: number;
}) {
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    company: input.company,
    mode: input.mode,
    answers: input.answers,
    scores: input.scores,
    health: input.health,
    severity: scoreSeverity(input.health),
    metrics: input.metrics,
    goals: input.goals,
    competitors: input.competitors,
    socialPlatforms: (input.socialPlatforms || []).filter(p => p.enabled),
    webResearch: input.webResearch || null,
    evidencePolicy: "Snapshot mixes USER PROVIDED answers, CALCULATED scores, and optional VERIFIED web research.",
  };
}

export function resolveIndustryKey(industry: string): string {
  const s = industry.toLowerCase();
  if (/saas|software|cloud/.test(s)) return "saas";
  if (/e-?commerce|shop|store/.test(s)) return "ecommerce";
  if (/agency|marketing|creative/.test(s)) return "agency";
  if (/retail|fashion|consumer/.test(s)) return "retail";
  if (/health|clinic|pharma|med/.test(s)) return "healthcare";
  if (/fintech|bank|finance|insur/.test(s)) return "fintech";
  if (/b2b|enterprise|industrial/.test(s)) return "b2b";
  return "default";
}

export type AiEmployeeId = "scout" | "rival" | "benchmark" | "case" | "copy";

export type AiEmployee = {
  id: AiEmployeeId;
  name: string;
  role: string;
  status: "idle" | "working" | "done";
  lastAction: string;
};

export const AI_EMPLOYEES: AiEmployee[] = [
  { id: "scout", name: "Nexus Scout", role: "Company & niche researcher", status: "idle", lastAction: "Waiting for profile" },
  { id: "rival", name: "Rival Analyst", role: "Competitor intelligence", status: "idle", lastAction: "Waiting for niche" },
  { id: "benchmark", name: "Benchmark Curator", role: "Industry benchmark librarian", status: "idle", lastAction: "No benchmarks loaded" },
  { id: "case", name: "Case Librarian", role: "Case study & source matcher", status: "idle", lastAction: "No cases matched" },
  { id: "copy", name: "Growth Copywriter", role: "SEO & paid social content", status: "idle", lastAction: "Waiting for report" },
];

export type CompetitorSeed = { name: string; website: string; positioning: string; strengths: string[]; weaknesses: string[] };

/** Niche → typical competitor seeds (USER PROVIDED / BENCHMARKED style seeds, not live web facts). */
export function seedCompetitorsForNiche(industry: string, companyName: string): CompetitorSeed[] {
  const key = resolveIndustryKey(industry);
  const pools: Record<string, CompetitorSeed[]> = {
    saas: [
      { name: "Category Leader SaaS", website: "https://www.salesforce.com", positioning: "Enterprise platform breadth", strengths: ["Brand", "Integrations"], weaknesses: ["Price", "Complexity"] },
      { name: "Mid-market Challenger", website: "https://www.hubspot.com", positioning: "SMB growth suite", strengths: ["Ease of use", "Inbound"], weaknesses: ["Deep enterprise"] },
      { name: "Specialist Niche Tool", website: "https://www.notion.so", positioning: "Focused workflow product", strengths: ["UX", "Speed"], weaknesses: ["Breadth"] },
    ],
    ecommerce: [
      { name: "Marketplace Giant", website: "https://www.amazon.com", positioning: "Selection + logistics", strengths: ["Reach", "Fulfillment"], weaknesses: ["Fees"] },
      { name: "DTC Brand Rival", website: "https://www.shopify.com", positioning: "Owned-channel commerce", strengths: ["Brand control"], weaknesses: ["Traffic cost"] },
      { name: "Regional Online Retailer", website: "https://www.jumia.com", positioning: "Local marketplace", strengths: ["Local trust"], weaknesses: ["Catalog depth"] },
    ],
    agency: [
      { name: "Full-service Network", website: "https://www.ogilvy.com", positioning: "Global creative + media", strengths: ["Talent", "Reach"], weaknesses: ["Cost"] },
      { name: "Performance Specialist", website: "https://www.tinuiti.com", positioning: "Paid media excellence", strengths: ["ROAS focus"], weaknesses: ["Brand work"] },
      { name: "Local Boutique Agency", website: "https://www.agency.com", positioning: "Relationship-led delivery", strengths: ["Agility"], weaknesses: ["Scale"] },
    ],
    default: [
      { name: "National Category Leader", website: "https://www.example.com", positioning: "Broad market coverage", strengths: ["Brand awareness"], weaknesses: ["Speed to innovate"] },
      { name: "Regional Challenger", website: "https://www.example.org", positioning: "Local relevance", strengths: ["Proximity"], weaknesses: ["Resources"] },
      { name: "Digital-native Disruptor", website: "https://www.example.net", positioning: "Low-cost online model", strengths: ["Efficiency"], weaknesses: ["Trust"] },
    ],
  };
  const list = pools[key] ?? pools.default;
  return list.map((c, i) => ({
    ...c,
    name: c.name.includes("example") ? `${industry || "Market"} Competitor ${i + 1}` : c.name,
    positioning: `${c.positioning} (niche: ${industry || "general"} vs ${companyName || "your company"})`,
  }));
}

export type CaseStudySeed = {
  title: string;
  niche: string;
  lesson: string;
  source: string;
  sourceUrl: string;
  evidence: EvidenceClass;
};

export function seedCaseStudies(industry: string, weakestPillar: string): CaseStudySeed[] {
  const key = resolveIndustryKey(industry);
  const pillarLesson: Record<string, string> = {
    sales: "Tighten qualification, shorten follow-up SLA, and instrument stage conversion weekly.",
    marketing: "Consolidate channels around measurable CAC and creative testing cadence.",
    technology: "Integrate core systems so management information is trusted and timely.",
    operations: "Standardize the top 3 revenue processes before adding headcount.",
    finance: "Publish unit economics (CAC, LTV, contribution margin) to every growth decision.",
    automation: "Automate handoffs between marketing, sales and success before buying new tools.",
    competitive: "Run a monthly competitor scorecard with dated public sources on each claim.",
    strategy: "Limit to 3 company priorities with owners, KPIs and quarterly review.",
    customer: "Close the loop from support tickets to product and sales enablement.",
  };
  const sources = [
    { title: "HBR — Competing on Analytics", source: "Harvard Business Review", sourceUrl: "https://hbr.org", lesson: pillarLesson[weakestPillar] || pillarLesson.strategy },
    { title: "McKinsey — Growth practices overview", source: "McKinsey & Company", sourceUrl: "https://www.mckinsey.com", lesson: "Sequence growth bets: fix conversion before scaling spend." },
    { title: `${key.toUpperCase()} operator playbook pattern`, source: "Industry pattern library (seed)", sourceUrl: "https://www.cintexa.com", lesson: `Apply ${key} peer patterns to ${weakestPillar} with local evidence first.` },
  ];
  return sources.map((s) => ({
    title: s.title,
    niche: industry || key,
    lesson: s.lesson,
    source: s.source,
    sourceUrl: s.sourceUrl,
    evidence: "BENCHMARKED" as EvidenceClass,
  }));
}

export type ContentPackItem = {
  id: string;
  channel: "seo_blog" | "linkedin" | "instagram" | "facebook" | "tiktok" | "google_ad" | "meta_ad" | "email";
  title: string;
  body: string;
  cta: string;
  seoKeywords: string[];
  goalLink: string;
  day: number;
};

export function generateDailyContentPack(input: {
  companyName: string;
  industry: string;
  website?: string;
  weakestPillar: string;
  strongestPillar: string;
  objective?: string;
  goals?: string[];
}): ContentPackItem[] {
  const brand = input.companyName || "Your brand";
  const niche = input.industry || "your industry";
  const weak = input.weakestPillar || "growth";
  const strong = input.strongestPillar || "delivery";
  const objective = input.objective || `improve ${weak}`;
  const site = input.website || "your website";
  const kw = [niche, brand, `${niche} solutions`, `best ${niche} in 2026`, objective.toLowerCase()];
  const pack: ContentPackItem[] = [];
  for (let day = 1; day <= 7; day++) {
    pack.push({
      id: `seo-${day}`,
      channel: "seo_blog",
      title: `Day ${day}: ${brand} guide — ${kw[day % kw.length]} for better ${weak}`,
      body: `Discover how ${brand} helps ${niche} teams improve ${weak} without guesswork. This SEO-optimized article covers practical steps, benchmarks and a clear CTA to ${site}. Focus keyword: ${kw[day % kw.length]}.`,
      cta: `Learn how ${brand} improves ${weak} →`,
      seoKeywords: kw,
      goalLink: objective,
      day,
    });
    pack.push({
      id: `li-${day}`,
      channel: "linkedin",
      title: `LinkedIn post — Day ${day}`,
      body: `Most ${niche} leaders underinvest in ${weak}.\n\nAt ${brand}, we lean on our strength in ${strong} while systematically closing gaps in ${weak}.\n\nToday's action: audit one metric, assign one owner, set one deadline.\n\n#${niche.replace(/\s+/g, "")} #Growth #${weak.replace(/\s+/g, "")}`,
      cta: "Comment “PLAYBOOK” for the checklist",
      seoKeywords: kw,
      goalLink: objective,
      day,
    });
    pack.push({
      id: `ig-${day}`,
      channel: "instagram",
      title: `Instagram carousel concept — Day ${day}`,
      body: `Slide 1: The ${weak} problem in ${niche}.\nSlide 2: Why ${brand} wins on ${strong}.\nSlide 3: 3 steps to improve this week.\nSlide 4: Social proof / result placeholder.\nSlide 5: CTA — visit ${site}`,
      cta: "Save this post & share with your team",
      seoKeywords: kw,
      goalLink: objective,
      day,
    });
    pack.push({
      id: `ad-${day}`,
      channel: day % 2 === 0 ? "meta_ad" : "google_ad",
      title: `Paid ad — Day ${day}`,
      body: day % 2 === 0
        ? `Hook: Still struggling with ${weak} in ${niche}?\nPrimary text: ${brand} helps you move from reactive firefighting to a clear ${objective} plan.\nCTA button: Learn more\nLanding: ${site}`
        : `Headline: ${brand} | ${niche} ${weak} improvement\nDescription: SEO-aligned offer for teams serious about ${objective}. Book a diagnostic.\nPath: ${site}`,
      cta: "Book diagnostic",
      seoKeywords: kw,
      goalLink: objective,
      day,
    });
  }
  pack.push({
    id: "email-1",
    channel: "email",
    title: "Weekly nurture email",
    body: `Subject: Your ${niche} ${weak} plan for this week\n\nHi {{first_name}},\n\nBased on your diagnostic priorities, focus on ${weak} while protecting ${strong}.\n\n1) Measure baseline\n2) Run one experiment\n3) Review Friday\n\n— ${brand}`,
    cta: `Open your plan on ${site}`,
    seoKeywords: kw,
    goalLink: objective,
    day: 1,
  });
  return pack;
}

export function autofillDemoProfile(industry = "SaaS B2B") {
  return {
    company: {
      name: "Cintexa Demo Co",
      website: "https://cintexa.com",
      industry,
      subIndustry: resolveIndustryKey(industry),
      model: "B2B",
      market: "Ghana, West Africa, Remote",
      employees: "25-50",
      revenue: "GHS 50k–150k / mo",
      objective: "Increase qualified revenue and conversion efficiency",
    },
    metrics: {
      monthlyRevenue: 90000,
      monthlyLeads: 400,
      qualifiedLeads: 120,
      customers: 24,
      conversion: 6,
      aov: 3750,
      cac: 450,
      churn: 3,
      retention: 92,
      grossMargin: 62,
      netMargin: 14,
      salesCycle: 21,
    } as Record<string, number>,
  };
}

export const INDUSTRY_OPTIONS = [
  "SaaS / Software",
  "E-commerce / Retail",
  "Digital Agency / Marketing",
  "Professional Services",
  "Healthcare",
  "Fintech / Financial Services",
  "Education / EdTech",
  "Manufacturing",
  "Hospitality / Travel",
  "Real Estate / PropTech",
  "Logistics / Supply Chain",
  "Media / Entertainment",
  "Non-profit / NGO",
  "Other / General",
] as const;

export const SUB_INDUSTRY_BY_INDUSTRY: Record<string, string[]> = {
  "SaaS / Software": ["B2B SaaS", "B2C Apps", "Developer Tools", "Vertical SaaS", "Infrastructure"],
  "E-commerce / Retail": ["DTC Brand", "Marketplace", "Fashion", "Electronics", "Grocery"],
  "Digital Agency / Marketing": ["Performance Media", "Creative", "SEO/Content", "Full-service", "Social"],
  "Professional Services": ["Consulting", "Legal", "Accounting", "HR / Recruiting", "IT Services"],
  "Healthcare": ["Clinics", "Telehealth", "Pharma", "Healthtech", "Wellness"],
  "Fintech / Financial Services": ["Payments", "Lending", "Insurance", "Wealth", "Banking"],
  "Education / EdTech": ["K-12", "Higher Ed", "Corporate Training", "Consumer Learning"],
  "Manufacturing": ["Industrial", "Consumer Goods", "Automotive", "Food Processing"],
  "Hospitality / Travel": ["Hotels", "Restaurants", "Travel Tech", "Events"],
  "Real Estate / PropTech": ["Residential", "Commercial", "Property Management", "Construction"],
  "Logistics / Supply Chain": ["Freight", "Last-mile", "Warehousing", "Fleet"],
  "Media / Entertainment": ["Publishing", "Streaming", "Gaming", "Creator Economy"],
  "Non-profit / NGO": ["Advocacy", "Community", "International Development"],
  "Other / General": ["General Business", "Local Services", "Hybrid"],
};

export const MARKET_OPTIONS = [
  "Ghana",
  "Nigeria",
  "Kenya",
  "South Africa",
  "West Africa",
  "East Africa",
  "Africa (pan-regional)",
  "United Kingdom",
  "Europe",
  "United States",
  "North America",
  "Middle East",
  "Asia-Pacific",
  "Global / Remote",
  "Local city / regional only",
] as const;

export const OBJECTIVE_OPTIONS = [
  "Increase qualified revenue and conversion efficiency",
  "Reduce customer acquisition cost (CAC)",
  "Improve retention and reduce churn",
  "Launch or scale a new product line",
  "Enter a new geographic market",
  "Strengthen competitive differentiation",
  "Improve operational efficiency and margins",
  "Build a predictable sales pipeline",
  "Scale paid social and digital acquisition profitably",
  "Digitize core processes with AI and automation",
  "Raise brand awareness in the category",
  "Improve customer experience and NPS",
] as const;

/** Infer industry / market hints from company name + website host. */
export function inferProfileFromIdentity(name: string, website: string): {
  industry?: string;
  subIndustry?: string;
  market?: string;
  objective?: string;
} {
  const blob = `${name} ${website}`.toLowerCase();
  let industry: string | undefined;
  let subIndustry: string | undefined;
  if (/saas|software|app|cloud|tech|platform|cms|nexus/.test(blob)) {
    industry = "SaaS / Software";
    subIndustry = "B2B SaaS";
  } else if (/shop|store|commerce|retail|fashion/.test(blob)) {
    industry = "E-commerce / Retail";
    subIndustry = "DTC Brand";
  } else if (/agency|marketing|media|ads/.test(blob)) {
    industry = "Digital Agency / Marketing";
    subIndustry = "Performance Media";
  } else if (/bank|fin|pay|insur|lend/.test(blob)) {
    industry = "Fintech / Financial Services";
  } else if (/health|clinic|med|pharma/.test(blob)) {
    industry = "Healthcare";
  } else if (/school|edu|learn|course/.test(blob)) {
    industry = "Education / EdTech";
  }

  let market: string | undefined;
  if (/ghana|\.gh\b/.test(blob)) market = "Ghana";
  else if (/nigeria|\.ng\b/.test(blob)) market = "Nigeria";
  else if (/kenya|\.ke\b/.test(blob)) market = "Kenya";
  else if (/africa/.test(blob)) market = "Africa (pan-regional)";
  else if (/\.uk\b|london|britain/.test(blob)) market = "United Kingdom";
  else if (/\.com\b|global|worldwide/.test(blob)) market = "Global / Remote";

  const objective = industry
    ? OBJECTIVE_OPTIONS.find((o) => /revenue|conversion|pipeline|acquisition/i.test(o)) || OBJECTIVE_OPTIONS[0]
    : OBJECTIVE_OPTIONS[0];

  return { industry, subIndustry, market, objective };
}
