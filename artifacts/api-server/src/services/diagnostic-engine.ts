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
  impactScore?: number;
  effortScore?: number;
  priorityScore?: number;
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
  const cac = n(metrics.customerAcquisitionCost);
  const salesCycle = n(metrics.salesCycleDays);
  const conversion = leads && customers != null ? (customers / leads) * 100 : null;
  const qualification = leads && qualified != null ? (qualified / leads) * 100 : null;
  const qualifiedConversion = qualified && customers != null ? (customers / qualified) * 100 : null;
  const monthlyRevenue = customers != null && aov != null ? customers * aov : null;
  const acquisitionSpend = customers != null && cac != null ? customers * cac : null;
  const salesVelocity = monthlyRevenue != null && salesCycle && salesCycle > 0 ? monthlyRevenue / salesCycle : null;
  return { conversion, qualification, qualifiedConversion, monthlyRevenue, acquisitionSpend, salesVelocity, salesCycle };
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

export function benchmarkGap(actual: number | null | undefined, benchmark: number | null | undefined) {
  const a = n(actual); const b = n(benchmark);
  if (a == null || b == null) return { available: false, gap: null, gapPercent: null, evidence: "UNKNOWN" as EvidenceType };
  const gap = a - b;
  const gapPercent = b === 0 ? null : (gap / Math.abs(b)) * 100;
  return { available: true, gap, gapPercent, evidence: "BENCHMARKED" as EvidenceType };
}

export function projectScenario(input: {
  monthlyLeads?: number | null;
  conversionRate?: number | null;
  averageTransactionValue?: number | null;
  conversionChangePercent?: number | null;
  aovChangePercent?: number | null;
}) {
  const leads = n(input.monthlyLeads);
  const baseConversion = n(input.conversionRate);
  const baseAov = n(input.averageTransactionValue);
  if (leads == null || baseConversion == null || baseAov == null) {
    return { available: false, reason: "Monthly leads, conversion rate and average transaction value are required." };
  }
  const conversion = clamp(baseConversion * (1 + (n(input.conversionChangePercent) ?? 0) / 100));
  const aov = Math.max(0, baseAov * (1 + (n(input.aovChangePercent) ?? 0) / 100));
  const baselineCustomers = leads * baseConversion / 100;
  const projectedCustomers = leads * conversion / 100;
  const baselineRevenue = baselineCustomers * baseAov;
  const projectedRevenue = projectedCustomers * aov;
  return {
    available: true,
    baselineCustomers,
    projectedCustomers,
    baselineRevenue,
    projectedRevenue,
    incrementalCustomers: projectedCustomers - baselineCustomers,
    incrementalRevenue: projectedRevenue - baselineRevenue,
    assumptions: { leads, baseConversion, baseAov, conversion, aov },
    evidence: "CALCULATED" as EvidenceType,
  };
}

export function prioritizeFindings(findings: DiagnosticFinding[]) {
  const impactMap = { critical: 100, high: 80, medium: 55, low: 30 } as const;
  return [...findings]
    .map((finding) => {
      const impactScore = impactMap[finding.impact];
      const confidenceScore = finding.confidence === "high" ? 100 : finding.confidence === "medium" ? 70 : 40;
      const effortScore = finding.impact === "critical" ? 45 : finding.impact === "high" ? 55 : 65;
      const priorityScore = Math.round((impactScore * 0.55) + (confidenceScore * 0.25) + ((100 - effortScore) * 0.20));
      return { ...finding, impactScore, effortScore, priorityScore };
    })
    .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
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
  if (sales.acquisitionSpend != null && sales.monthlyRevenue != null && sales.monthlyRevenue > 0 && sales.acquisitionSpend > sales.monthlyRevenue * 0.5) {
    findings.push({ pillar: "finance", problem: "High customer acquisition spend relative to monthly revenue", evidence: "CALCULATED", confidence: "medium", impact: "high", rationale: `Reported acquisition spend is ${sales.acquisitionSpend.toFixed(0)} against ${sales.monthlyRevenue.toFixed(0)} monthly revenue.`, recommendedAction: "Segment CAC by channel and customer cohort before increasing acquisition spend." });
  }
  for (const [pillar, score] of Object.entries(scores)) {
    const value = n(score);
    if (value != null && value < 45) findings.push({ pillar, problem: `${pillar} performance requires attention`, evidence: "CALCULATED", confidence: "medium", impact: value < 30 ? "critical" : "high", rationale: `${pillar} score is ${value}/100.`, recommendedAction: `Create a 30-day intervention for ${pillar}, assign an owner and attach a baseline KPI before implementation.` });
  }
  const prioritized = prioritizeFindings(findings);
  return { sales, health: businessHealth(scores), condition: severity(businessHealth(scores)), findings: prioritized, topPriority: prioritized[0] ?? null };
}
