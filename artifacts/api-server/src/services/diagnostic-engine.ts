export type EvidenceType = "VERIFIED" | "USER PROVIDED" | "CALCULATED" | "BENCHMARKED" | "INFERRED" | "UNKNOWN";

export type MetricInput = Record<string, number | null | undefined>;

export interface DiagnosticFinding {
  pillar: string;
  problem: string;
  evidence: EvidenceType;
  confidence: "high" | "medium" | "low";
  impact: "critical" | "high" | "medium" | "low";
  rationale: string;
  recommendedAction: string;
}

export interface SmartValidation {
  score: number;
  specific: boolean;
  measurable: boolean;
  achievable: boolean;
  relevant: boolean;
  timeBound: boolean;
  missing: string[];
}

const n = (value: number | null | undefined) => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

export function salesMetrics(metrics: MetricInput) {
  const leads = n(metrics.monthlyLeads);
  const qualified = n(metrics.monthlyQualifiedLeads);
  const customers = n(metrics.monthlyCustomers);
  const aov = n(metrics.avgTransactionValue);
  const salesCycle = n(metrics.salesCycleDays);
  const conversion = leads && customers != null ? (customers / leads) * 100 : null;
  const qualification = leads && qualified != null ? (qualified / leads) * 100 : null;
  const qualifiedConversion = qualified && customers != null ? (customers / qualified) * 100 : null;
  const monthlyRevenue = customers != null && aov != null ? customers * aov : null;
  return { conversion, qualification, qualifiedConversion, monthlyRevenue, salesCycle };
}

export function businessHealth(scores: Record<string, number | null | undefined>) {
  const weights: Record<string, number> = {
    strategy: 12, sales: 14, marketing: 10, customer: 10, operations: 10,
    finance: 14, technology: 8, automation: 7, competitive: 8, execution: 7,
  };
  let weighted = 0;
  let totalWeight = 0;
  for (const [pillar, weight] of Object.entries(weights)) {
    const score = n(scores[pillar]);
    if (score == null) continue;
    weighted += clamp(score) * weight;
    totalWeight += weight;
  }
  return totalWeight ? Math.round(weighted / totalWeight) : 0;
}

export function severity(score: number) {
  if (score <= 20) return "Critical";
  if (score <= 40) return "Weak";
  if (score <= 60) return "Needs Attention";
  if (score <= 80) return "Healthy";
  return "High Performing";
}

export function validateSmartGoal(input: {
  title?: string;
  target?: number | string | null;
  baseline?: number | string | null;
  deadline?: string | null;
  owner?: string | null;
  kpi?: string | null;
  relevance?: string | null;
}) : SmartValidation {
  const title = input.title?.trim() ?? "";
  const specific = title.length >= 25 && /\b(increase|decrease|reduce|grow|reach|achieve|improve|enter|launch|retain)\b/i.test(title);
  const measurable = input.target != null && input.baseline != null && String(input.kpi ?? "").trim().length > 0;
  const achievable = input.owner?.trim().length ? true : false;
  const relevant = (input.relevance?.trim().length ?? 0) >= 10;
  const timeBound = !!input.deadline && !Number.isNaN(Date.parse(input.deadline));
  const checks = [specific, measurable, achievable, relevant, timeBound];
  const missing = ["Specific", "Measurable", "Achievable", "Relevant", "Time-bound"].filter((_, i) => !checks[i]);
  return { score: Math.round((checks.filter(Boolean).length / checks.length) * 100), specific, measurable, achievable, relevant, timeBound, missing };
}

export function analyze(metrics: MetricInput, scores: Record<string, number | null | undefined>) {
  const sales = salesMetrics(metrics);
  const findings: DiagnosticFinding[] = [];
  if (sales.conversion != null && sales.conversion < 5) {
    findings.push({ pillar: "sales", problem: "Low lead-to-customer conversion", evidence: "CALCULATED", confidence: "high", impact: "high", rationale: `Current conversion is ${sales.conversion.toFixed(1)}%.`, recommendedAction: "Audit qualification, stage conversion, follow-up speed, objection handling and lost-deal reasons." });
  }
  if (sales.qualification != null && sales.qualification < 30) {
    findings.push({ pillar: "sales", problem: "Low lead qualification rate", evidence: "CALCULATED", confidence: "medium", impact: "high", rationale: `Only ${sales.qualification.toFixed(1)}% of leads are marked qualified.`, recommendedAction: "Define an ICP and qualification criteria, then measure lead-source quality by channel." });
  }
  if (sales.salesCycle != null && sales.salesCycle > 60) {
    findings.push({ pillar: "sales", problem: "Long sales cycle", evidence: "USER PROVIDED", confidence: "high", impact: "medium", rationale: `Reported sales cycle is ${sales.salesCycle} days.`, recommendedAction: "Map stage aging and automate next-step reminders, proposal follow-up and stalled-deal alerts." });
  }
  for (const [pillar, score] of Object.entries(scores)) {
    const value = n(score);
    if (value != null && value < 45) findings.push({ pillar, problem: `${pillar} performance requires attention`, evidence: "CALCULATED", confidence: "medium", impact: value < 30 ? "critical" : "high", rationale: `${pillar} score is ${value}/100.`, recommendedAction: `Create a 30-day intervention for ${pillar}, assign an owner and attach a baseline KPI before implementation.` });
  }
  return { sales, health: businessHealth(scores), condition: severity(businessHealth(scores)), findings };
}
