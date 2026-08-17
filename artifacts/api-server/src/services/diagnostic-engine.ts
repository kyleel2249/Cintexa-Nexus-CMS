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

/** Industry benchmarks (public research summaries — labeled BENCHMARKED when applied). */
export const INDUSTRY_BENCHMARKS: Record<string, Record<string, { value: number; unit: string; source: string }>> = {
  "B2B SaaS": {
    winRate: { value: 21, unit: "%", source: "Salesforce State of Sales 2025" },
    mqlToSql: { value: 13, unit: "%", source: "Creative Foundry RevOps Benchmarks 2025" },
    pipelineCoverage: { value: 3.5, unit: "x", source: "Forrester B2B Revenue Waterfall 2025" },
    salesCycleDays: { value: 84, unit: "days", source: "HubSpot Sales Trends 2025" },
    forecastAccuracy: { value: 78, unit: "%", source: "Gartner Sales Ops Survey 2025" },
    cacPaybackMonths: { value: 15, unit: "months", source: "OpenView SaaS Benchmarks 2025" },
    netRevenueRetention: { value: 105, unit: "%", source: "KeyBanc SaaS Survey 2025" },
    leadToCustomer: { value: 2, unit: "%", source: "First Page Sage Funnel Benchmarks 2026" },
  },
  Manufacturing: {
    winRate: { value: 22, unit: "%", source: "Pipeline Health Benchmark 2025" },
    salesCycleDays: { value: 65, unit: "days", source: "Pipeline Health Benchmark 2025" },
    leadToCustomer: { value: 3.5, unit: "%", source: "Prospeo Sales Metrics 2026" },
  },
  "Professional Services": {
    winRate: { value: 26, unit: "%", source: "Pipeline Health Benchmark 2025" },
    salesCycleDays: { value: 44, unit: "days", source: "Pipeline Health Benchmark 2025" },
    leadToCustomer: { value: 5, unit: "%", source: "Prospeo Sales Metrics 2026" },
  },
  Ecommerce: {
    winRate: { value: 31, unit: "%", source: "Pipeline Health Benchmark 2025" },
    salesCycleDays: { value: 25, unit: "days", source: "Pipeline Health Benchmark 2025" },
    websiteConversion: { value: 2.8, unit: "%", source: "Lucky Orange Website Metrics 2025" },
  },
  default: {
    winRate: { value: 24.5, unit: "%", source: "Pipeline Health Benchmark aggregate 2025" },
    salesCycleDays: { value: 58, unit: "days", source: "Pipeline Health Benchmark aggregate 2025" },
    leadToCustomer: { value: 2, unit: "%", source: "Industry composite" },
    pipelineCoverage: { value: 3.5, unit: "x", source: "Forrester composite" },
  },
};

export function getBenchmarks(industry?: string | null) {
  const key = !industry
    ? "default"
    : (Object.keys(INDUSTRY_BENCHMARKS).find((k) => industry.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(industry.toLowerCase())) ?? "default");
  const series = INDUSTRY_BENCHMARKS[key] ?? INDUSTRY_BENCHMARKS.default;
  // Wrap with dated metadata — values remain illustrative until admin-sourced series exist
  return {
    meta: {
      industryKey: key,
      asOf: "2026-01-01",
      source: "CINTEXA illustrative industry bands",
      evidence: "INFERRED" as EvidenceType,
      note: "Benchmark values are intentionally provisional until a reliable public series or administrator-entered benchmark exists.",
    },
    metrics: series,
  };
}

export function buildBenchmarkReport(metrics: MetricInput, industry?: string | null) {
  const pack = getBenchmarks(industry);
  const bench = (pack as any).metrics ?? pack;
  const sales = salesMetrics(metrics);
  const rows: Array<{ metric: string; actual: number | null; benchmark: number; unit: string; gap: number | null; source: string; evidence: EvidenceType }> = [];
  const push = (metric: string, actual: number | null, key: string) => {
    const b = bench[key];
    if (!b) return;
    const gapInfo = benchmarkGap(actual, b.value);
    rows.push({ metric, actual, benchmark: b.value, unit: b.unit, gap: gapInfo.gap, source: b.source, evidence: gapInfo.available ? "BENCHMARKED" : "UNKNOWN" });
  };
  push("Lead-to-customer conversion", sales.conversion, "leadToCustomer");
  push("Sales cycle (days)", sales.salesCycle, "salesCycleDays");
  return {
    industry: industry ?? "General",
    meta: (pack as any).meta ?? null,
    rows,
    generatedAt: new Date().toISOString(),
  };
}

export function buildSwot(findings: DiagnosticFinding[], scores: Record<string, number | null | undefined>) {
  const strengths = Object.entries(scores).filter(([, v]) => n(v) != null && n(v)! >= 70).map(([p, v]) => ({
    item: `${p} performance is relatively strong`, evidence: "CALCULATED" as EvidenceType, implication: `${p} scored ${v}/100.`, action: `Protect and productize strengths in ${p}.`,
  }));
  const weaknesses = findings.filter((f) => f.impact === "critical" || f.impact === "high").slice(0, 5).map((f) => ({
    item: f.problem, evidence: f.evidence, implication: f.rationale, action: f.recommendedAction,
  }));
  return {
    strengths: strengths.length ? strengths : [{ item: "Insufficient data for strengths", evidence: "UNKNOWN" as EvidenceType, implication: "Provide more metrics.", action: "Complete metric profile." }],
    weaknesses: weaknesses.length ? weaknesses : [{ item: "No high-impact weaknesses identified yet", evidence: "INFERRED" as EvidenceType, implication: "Continue monitoring.", action: "Re-run deep diagnostic after 30 days." }],
    opportunities: [
      { item: "Improve conversion toward industry benchmark", evidence: "BENCHMARKED" as EvidenceType, implication: "Closing the conversion gap multiplies existing lead volume.", action: "Run a 90-day conversion improvement program." },
      { item: "Automate high-frequency manual workflows", evidence: "INFERRED" as EvidenceType, implication: "Automation reduces cycle time and error rate.", action: "Rank top 5 workflows by impact × effort." },
    ],
    threats: [
      { item: "Competitor activity in primary segment", evidence: "UNKNOWN" as EvidenceType, implication: "Without a dated competitor scorecard, threat level is uncertain.", action: "Build a monthly competitor intelligence cadence." },
    ],
  };
}

export function buildExecutionRoadmap(findings: DiagnosticFinding[]) {
  const top = prioritizeFindings(findings).slice(0, 6);
  return {
    days7: top.slice(0, 2).map((f, i) => ({ day: `Day ${(i + 1) * 3}`, action: f.recommendedAction, owner: "Department lead", kpi: "Baseline established", status: "Not Started" })),
    days30: top.slice(0, 3).map((f) => ({ window: "Days 1–30", action: f.recommendedAction, owner: "Functional owner", kpi: "Leading indicator defined", status: "Not Started" })),
    days90: top.map((f) => ({ window: "Days 31–90", action: `Execute intervention for: ${f.problem}`, owner: "Cross-functional owner", kpi: "Outcome KPI improved", status: "Not Started" })),
    months4to6: [{ window: "Months 4–6", action: "Scale proven interventions and lock process ownership", owner: "Executive sponsor", kpi: "Sustained KPI movement", status: "Not Started" }],
    months7to12: [{ window: "Months 7–12", action: "Institutionalize reviews and expand highest-ROI initiatives", owner: "CEO / Leadership team", kpi: "Business health score improvement", status: "Not Started" }],
  };
}

export function buildSmartGoalsFromFindings(findings: DiagnosticFinding[]) {
  return prioritizeFindings(findings).slice(0, 5).map((f, idx) => {
    const level = idx === 0 ? "strategic" : idx < 3 ? "tactical" : "operational";
    const title = level === "strategic"
      ? `Resolve ${f.problem} and lift related business health score within 12 months`
      : level === "tactical"
        ? `Improve ${f.pillar} performance against baseline within 90 days`
        : `Execute weekly operating rhythm for ${f.pillar} with measurable leading indicators`;
    const body = {
      title,
      description: f.recommendedAction,
      owner: level === "strategic" ? "CEO / Founder" : level === "tactical" ? "Department Lead" : "Team Lead",
      department: f.pillar,
      deadline: level === "strategic" ? "2027-08-15" : level === "tactical" ? "2026-11-15" : "2026-09-30",
      kpi: `${f.pillar} health score / leading indicator`,
      baseline: "Current diagnostic baseline",
      target: "Documented improvement vs baseline",
      goalType: level,
    };
    return { ...body, smartValidation: validateSmartGoal(body) };
  });
}

export function buildFullReport(input: {
  companyName?: string;
  industry?: string | null;
  metrics?: MetricInput;
  pillarScores?: Record<string, number | null | undefined>;
  competitors?: Array<{ name: string; positioning?: string; strengths?: string; weaknesses?: string }>;
  socialPlatforms?: Array<Record<string, unknown>>;
}) {
  const metrics = input.metrics ?? {};
  const scores = input.pillarScores ?? {};
  const analysis = analyze(metrics, scores);
  const benchmarks = buildBenchmarkReport(metrics, input.industry);
  const swot = buildSwot(analysis.findings, scores);
  const roadmap = buildExecutionRoadmap(analysis.findings);
  const smartGoals = buildSmartGoalsFromFindings(analysis.findings);
  return {
    meta: {
      title: "CINTEXA Nexus Business Diagnostic Report",
      companyName: input.companyName ?? "Company",
      industry: input.industry ?? "Not specified",
      generatedAt: new Date().toISOString(),
      evidencePolicy: "Facts, calculations, benchmarks and inferences are labeled. Missing external facts remain UNKNOWN.",
    },
    executiveSummary: {
      overallScore: analysis.health,
      condition: analysis.condition,
      topProblems: analysis.findings.slice(0, 5).map((f) => f.problem),
      topPriority: analysis.topPriority,
      biggestOpportunity: "Close conversion and cycle-time gaps against documented benchmarks where data exists.",
    },
    sales: analysis.sales,
    health: analysis.health,
    condition: analysis.condition,
    findings: analysis.findings,
    benchmarks,
    swot,
    roadmap,
    smartGoals,
    competitors: (input.competitors ?? []).map((c) => ({
      ...c,
      evidence: "USER PROVIDED" as EvidenceType,
      note: "External research claims require source and date before they are treated as VERIFIED.",
    })),
    socialAds: {
      platforms: (input.socialPlatforms ?? []).filter((p: any) => p && p.enabled),
      note: "Each enabled ad platform is diagnosed separately. Recommendations are platform-specific.",
    },
    kpis: [
      { name: "Lead-to-customer conversion", baseline: analysis.sales.conversion, target: "Industry benchmark or +3pp", owner: "Sales + Marketing" },
      { name: "Sales cycle days", baseline: analysis.sales.salesCycle, target: "Reduce toward industry median", owner: "Sales" },
      { name: "Business health score", baseline: analysis.health, target: Math.min(100, analysis.health + 10), owner: "Executive team" },
      { name: "Qualified pipeline coverage", baseline: null, target: "3–4x quota", owner: "Sales Ops" },
      { name: "Paid social ROAS (by platform)", baseline: null, target: "≥ 3x on scaled platforms", owner: "Marketing" },
      { name: "Blended CPL across ad platforms", baseline: null, target: "Below target CAC threshold", owner: "Marketing" },
      { name: "Customer churn (monthly)", baseline: null, target: "Reduce 15–25% within 2 quarters", owner: "Customer Success" },
      { name: "Gross margin", baseline: null, target: "Protect or +2pp via mix/pricing", owner: "Finance" },
    ],
    porterFiveForces: buildPorterFiveForces(input.industry, analysis.findings),
    pestle: buildPestle(input.industry),
    rootCauses: buildRootCauseChains(analysis.findings),
    detailedRecommendations: buildDetailedRecommendations(analysis.findings),
  };
}

export function buildPorterFiveForces(industry?: string | null, findings: DiagnosticFinding[] = []) {
  const rivalryBoost = findings.some(f => f.pillar === "competitive" || /competitor/i.test(f.problem)) ? 10 : 0;
  const forces = [
    { force: "Competitive rivalry", score: Math.min(100, 62 + rivalryBoost), evidence: "INFERRED" as EvidenceType, implication: "Intensity of rivalry shapes pricing and differentiation pressure.", opportunity: "Differentiate on service speed, specialization or evidence-backed outcomes.", response: "Publish a clear competitive scorecard and defend 2–3 non-price advantages." },
    { force: "Threat of new entrants", score: 48, evidence: "INFERRED" as EvidenceType, implication: "Lower switching costs or digital channels can invite entrants.", opportunity: "Raise switching costs via integrations, data and contracts.", response: "Strengthen retention and product depth before price wars." },
    { force: "Threat of substitutes", score: 55, evidence: "INFERRED" as EvidenceType, implication: "Customers may solve the job with adjacent tools or in-house approaches.", opportunity: "Own the full job-to-be-done, not a single feature.", response: "Map substitute journeys and close gaps in convenience or total cost." },
    { force: "Buyer bargaining power", score: 58, evidence: "INFERRED" as EvidenceType, implication: "Concentrated buyers or low differentiation increases discount pressure.", opportunity: "Segment buyers and package value by segment.", response: "Tighten discount policy; train sales on value quantification." },
    { force: "Supplier bargaining power", score: 42, evidence: "INFERRED" as EvidenceType, implication: "Key vendors or platforms can constrain cost and capability.", opportunity: "Dual-source critical dependencies where practical.", response: "Document supplier risk and exit options quarterly." },
  ];
  return {
    industry: industry ?? "General",
    forces,
    note: "Force scores are INFERRED from diagnostic signals, not measured market structure data. Replace with industry research when available.",
    evidence: "INFERRED" as EvidenceType,
  };
}

export function buildPestle(industry?: string | null) {
  const factors = [
    { factor: "Political", condition: "Regulatory and policy stability varies by market", impact: "medium", probability: "medium", severity: "medium", horizon: "12–24 months", response: "Track licensing, data and advertising rules in operating markets." },
    { factor: "Economic", condition: "Demand and buyer budgets fluctuate with macro cycles", impact: "high", probability: "medium", severity: "high", horizon: "6–18 months", response: "Scenario-plan revenue under conservative conversion and longer cycles." },
    { factor: "Social", condition: "Buyer expectations for speed, transparency and digital experience are rising", impact: "high", probability: "high", severity: "medium", horizon: "ongoing", response: "Align UX, support SLAs and proof assets to social expectations." },
    { factor: "Technological", condition: "AI and automation raise productivity baselines", impact: "high", probability: "high", severity: "medium", horizon: "12 months", response: "Prioritize high-ROI automation on lead handling, reporting and support." },
    { factor: "Legal", condition: "Privacy, consumer and employment rules constrain data and outreach", impact: "medium", probability: "medium", severity: "high", horizon: "ongoing", response: "Maintain consent, retention and disclosure hygiene on customer data." },
    { factor: "Environmental", condition: "Sustainability expectations affect brand and supply chains in some sectors", impact: "low", probability: "medium", severity: "low", horizon: "24+ months", response: "Document material environmental claims only with evidence." },
  ];
  return { industry: industry ?? "General", factors, evidence: "INFERRED" as EvidenceType, note: "PESTLE items are structured prompts for leadership review, not verified jurisdiction-specific legal advice." };
}

export function buildRootCauseChains(findings: DiagnosticFinding[]) {
  return prioritizeFindings(findings).slice(0, 5).map((f) => ({
    observedProblem: f.problem,
    evidence: f.evidence,
    evidenceDetail: f.rationale,
    possibleCauses: [
      "Process design gap",
      "Capability or skill gap",
      "Incentive misalignment",
      "Data / system fragmentation",
      "Offer or positioning mismatch",
    ],
    rootCauseHypothesis: f.rationale,
    confidence: f.confidence,
    businessImpact: f.impact,
    recommendedIntervention: f.recommendedAction,
  }));
}

export function buildDetailedRecommendations(findings: DiagnosticFinding[]) {
  return prioritizeFindings(findings).slice(0, 6).map((f, idx) => ({
    recommendation: f.recommendedAction,
    problem: f.problem,
    evidence: f.evidence,
    rootCause: f.rationale,
    businessImpact: f.impact,
    priority: idx < 2 ? "Fix Immediately" : idx < 4 ? "High Priority" : "Medium Priority",
    owner: f.pillar === "sales" || f.pillar === "marketing" ? "Revenue leadership" : f.pillar === "finance" ? "Finance lead" : "Functional owner",
    timeline: idx < 2 ? "7–30 days" : idx < 4 ? "30–90 days" : "90–180 days",
    kpi: "Baseline → target defined in SMART goal",
    expectedResult: "Measurable movement on the pillar score and linked commercial KPI",
    risk: "Execution stalls without owner, baseline and weekly review",
    dependencies: "Data quality, capacity, and leadership alignment",
    alternative: "Pilot on a single segment or channel before full rollout",
    smartGoalSeed: `Improve ${f.pillar} performance linked to “${f.problem}” with a quantified baseline, target and deadline within the stated timeline.`,
  }));
}

