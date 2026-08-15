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
  { id: "s1", pillar: "strategy", text: "Are your top three business priorities documented with owners and measurable outcomes?", type: "boolean" },
  { id: "s2", pillar: "strategy", text: "How clear is your market positioning?", type: "scale" },
  { id: "sales1", pillar: "sales", text: "Where is your sales funnel weakest today?", type: "select", options: ["Lead volume", "Lead quality", "Qualification", "Follow-up", "Proposal", "Closing", "Retention"] },
  { id: "sales2", pillar: "sales", text: "Are sales opportunities tracked in a CRM with defined stages?", type: "boolean" },
  { id: "marketing1", pillar: "marketing", text: "Which channel currently produces the highest-quality customers?", type: "text" },
  { id: "marketing2", pillar: "marketing", text: "Can you attribute revenue to your marketing channels?", type: "boolean" },
  { id: "customer1", pillar: "customer", text: "Do you track churn and retention by customer segment?", type: "boolean" },
  { id: "operations1", pillar: "operations", text: "How many core processes still depend on manual spreadsheets or repeated data entry?", type: "number" },
  { id: "finance1", pillar: "finance", text: "Do you know profitability by product, service or customer segment?", type: "boolean" },
  { id: "technology1", pillar: "technology", text: "Are CRM, finance, commerce, support and analytics systems connected?", type: "boolean" },
  { id: "automation1", pillar: "automation", text: "How many recurring workflows could be automated within 90 days?", type: "number" },
  { id: "competitive1", pillar: "competitive", text: "Do you maintain a documented competitor scorecard with dated evidence?", type: "boolean" },
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
  if (weakest === "Follow-up") questions.push({ id: "sales-followup", pillar: "sales", text: "How quickly are qualified leads contacted after they enter the pipeline?", type: "text" });
  if (weakest === "Closing") questions.push({ id: "sales-closing", pillar: "sales", text: "What are the three most common reasons qualified deals are lost?", type: "text" });
  if (answers.technology1 === false) questions.push({ id: "tech-silos", pillar: "technology", text: "Which two systems create the most duplicate data entry?", type: "text" });
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
