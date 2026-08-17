/**
 * CINTEXA Nexus — extended diagnostic frameworks
 * Competitive matrix, positioning, ROI, alerts, goal cascade, barriers, history compare.
 */

export type EvidenceClass = "VERIFIED" | "USER PROVIDED" | "CALCULATED" | "BENCHMARKED" | "INFERRED" | "UNKNOWN";

export const COMPETITIVE_DIMENSIONS = [
  "Brand", "Pricing", "Product", "Service", "Website", "SEO", "Content", "Social media",
  "Advertising", "Customer experience", "Technology", "Automation", "Sales", "Distribution",
  "Retention", "Innovation", "Market reach", "Customer reviews", "Differentiation",
] as const;

export type CompetitiveMatrixRow = {
  dimension: string;
  company: number | null;
  competitors: Array<{ name: string; score: number | null }>;
  industryBenchmark: number | null;
  evidence: EvidenceClass;
};

/** Build a competitive scorecard. Scores are USER PROVIDED or INFERRED — never fabricated as measured. */
export function buildCompetitiveMatrix(input: {
  companyName: string;
  companyScores?: Partial<Record<string, number>>;
  competitors: Array<{ name: string; score?: number; strengths?: string[]; weaknesses?: string[] }>;
}): { rows: CompetitiveMatrixRow[]; note: string } {
  const rows: CompetitiveMatrixRow[] = COMPETITIVE_DIMENSIONS.map((dimension) => {
    const company = input.companyScores?.[dimension] ?? null;
    const competitors = input.competitors.map((c) => {
      // Infer only soft hints from free text; leave null if unknown
      let score: number | null = c.score != null ? Math.min(100, Math.max(0, c.score)) : null;
      if (score == null && c.strengths?.some((s) => s.toLowerCase().includes(dimension.toLowerCase()))) score = 68;
      if (score == null && c.weaknesses?.some((w) => w.toLowerCase().includes(dimension.toLowerCase()))) score = 42;
      return { name: c.name, score };
    });
    return {
      dimension,
      company,
      competitors,
      industryBenchmark: null, // explicit: no invented benchmarks
      evidence: company != null || competitors.some((x) => x.score != null) ? "INFERRED" : "UNKNOWN",
    };
  });
  return {
    rows,
    note: "Matrix cells are USER PROVIDED or INFERRED from stated strengths/weaknesses. Industry benchmark remains UNKNOWN until admin-sourced series exist. Never treat blanks as measured data.",
  };
}

export type PositioningAxis = { id: string; low: string; high: string };

export const POSITIONING_AXES: PositioningAxis[] = [
  { id: "price_value", low: "Price-led", high: "Value-led" },
  { id: "premium_mass", low: "Mass market", high: "Premium" },
  { id: "traditional_innovative", low: "Traditional", high: "Innovative" },
  { id: "manual_automated", low: "Manual", high: "Automated" },
  { id: "local_global", low: "Local", high: "Global" },
  { id: "basic_comprehensive", low: "Basic", high: "Comprehensive" },
];

export function recommendPositioning(input: {
  industry?: string;
  objective?: string;
  automationScore?: number;
  competitiveScore?: number;
}): { axes: Array<{ axis: PositioningAxis; companyHint: number; recommendation: string }>; summary: string; evidence: EvidenceClass } {
  const auto = input.automationScore ?? 50;
  const comp = input.competitiveScore ?? 50;
  const axes = POSITIONING_AXES.map((axis) => {
    let companyHint = 50;
    if (axis.id === "manual_automated") companyHint = auto;
    if (axis.id === "traditional_innovative") companyHint = Math.round((auto + comp) / 2);
    if (axis.id === "price_value") companyHint = comp >= 60 ? 65 : 45;
    return {
      axis,
      companyHint,
      recommendation: `Move toward “${companyHint >= 55 ? axis.high : axis.low}” only if evidence supports demand and margin.`,
    };
  });
  return {
    axes,
    summary: `Recommended emphasis: differentiate on ${comp >= 55 ? "value and specialization" : "clarity of offer and execution speed"}; automate high-frequency work (automation readiness ${auto}/100). Objective context: ${input.objective || "not set"}.`,
    evidence: "INFERRED",
  };
}

export type RoiModel = {
  available: boolean;
  reason?: string;
  currentCost: number | null;
  implementationCost: number | null;
  expectedSavings: number | null;
  expectedAdditionalRevenue: number | null;
  expectedProfitImprovement: number | null;
  paybackMonths: number | null;
  roiPercent: number | null;
  assumptions: string[];
  evidence: EvidenceClass;
};

export function calculateInitiativeRoi(input: {
  currentMonthlyCost?: number | null;
  implementationCost?: number | null;
  monthlySavings?: number | null;
  monthlyAdditionalRevenue?: number | null;
  marginPercent?: number | null;
}): RoiModel {
  const cur = input.currentMonthlyCost ?? null;
  const impl = input.implementationCost ?? null;
  const save = input.monthlySavings ?? null;
  const rev = input.monthlyAdditionalRevenue ?? null;
  const margin = input.marginPercent ?? 30;
  if (impl == null || (save == null && rev == null)) {
    return {
      available: false,
      reason: "Enter implementation cost and at least one of monthly savings or additional revenue.",
      currentCost: cur,
      implementationCost: impl,
      expectedSavings: save,
      expectedAdditionalRevenue: rev,
      expectedProfitImprovement: null,
      paybackMonths: null,
      roiPercent: null,
      assumptions: ["User must supply assumptions; CINTEXA does not invent financials."],
      evidence: "UNKNOWN",
    };
  }
  const monthlyProfitLift = (save ?? 0) + ((rev ?? 0) * (margin / 100));
  const annualLift = monthlyProfitLift * 12;
  const paybackMonths = monthlyProfitLift > 0 ? impl / monthlyProfitLift : null;
  const roiPercent = impl > 0 ? ((annualLift - impl) / impl) * 100 : null;
  return {
    available: true,
    currentCost: cur,
    implementationCost: impl,
    expectedSavings: save,
    expectedAdditionalRevenue: rev,
    expectedProfitImprovement: annualLift,
    paybackMonths,
    roiPercent,
    assumptions: [
      `Gross margin on incremental revenue assumed at ${margin}% (editable).`,
      "Figures are CALCULATED from user assumptions, not guarantees.",
    ],
    evidence: "CALCULATED",
  };
}

export type ExecutiveAlert = {
  id: string;
  severity: "critical" | "warning" | "attention" | "opportunity" | "strategic";
  title: string;
  detail: string;
  evidence: EvidenceClass;
};

export function buildExecutiveAlerts(input: {
  health: number;
  scores: Record<string, number>;
  conversion?: number | null;
  churn?: number | null;
  competitorsCount: number;
}): ExecutiveAlert[] {
  const alerts: ExecutiveAlert[] = [];
  if (input.health <= 40) {
    alerts.push({ id: "health-critical", severity: "critical", title: "Business health is weak or critical", detail: `Overall score ${input.health}/100 requires executive intervention priorities.`, evidence: "CALCULATED" });
  }
  if ((input.scores.sales ?? 100) < 45) {
    alerts.push({ id: "sales-warn", severity: "warning", title: "Sales pillar under pressure", detail: "Sales score below 45 — validate funnel leakage before scaling spend.", evidence: "CALCULATED" });
  }
  if (input.conversion != null && input.conversion < 5) {
    alerts.push({ id: "conv-attention", severity: "attention", title: "Conversion appears low", detail: `Lead-to-customer conversion ~${input.conversion.toFixed(1)}%. Confirm data quality, then fix qualification and follow-up.`, evidence: "CALCULATED" });
  }
  if (input.churn != null && input.churn > 5) {
    alerts.push({ id: "churn-warn", severity: "warning", title: "Churn elevated", detail: `Monthly churn ~${input.churn}%. Investigate onboarding and support SLAs.`, evidence: "USER PROVIDED" });
  }
  if (input.competitorsCount === 0) {
    alerts.push({ id: "comp-attention", severity: "attention", title: "No competitors on file", detail: "Competitive threat level is UNKNOWN until competitors and sources are added.", evidence: "UNKNOWN" });
  }
  if ((input.scores.automation ?? 0) >= 60 && (input.scores.operations ?? 100) < 55) {
    alerts.push({ id: "auto-opp", severity: "opportunity", title: "Automation readiness exceeds process maturity", detail: "Prioritize process standardization before aggressive AI rollout.", evidence: "INFERRED" });
  }
  if ((input.scores.competitive ?? 100) < 50) {
    alerts.push({ id: "comp-strategic", severity: "strategic", title: "Competitive position needs attention", detail: "Schedule a formal competitor review with dated sources.", evidence: "CALCULATED" });
  }
  return alerts;
}

export type GoalCascadeNode = {
  id: string;
  level: "strategic" | "tactical" | "operational" | "kpi";
  title: string;
  owner: string;
  children?: GoalCascadeNode[];
};

export function buildGoalCascade(input: {
  objective?: string;
  weakestPillar: string;
  strongestPillar: string;
}): GoalCascadeNode {
  const obj = input.objective || `Improve ${input.weakestPillar} outcomes within 12 months`;
  return {
    id: "root",
    level: "strategic",
    title: obj,
    owner: "CEO / Founder",
    children: [
      {
        id: "tac-1",
        level: "tactical",
        title: `Lift ${input.weakestPillar} performance with owned KPIs`,
        owner: "Department lead",
        children: [
          { id: "ops-1", level: "operational", title: "Weekly pipeline / process review on priority metric", owner: "Team lead", children: [
            { id: "kpi-1", level: "kpi", title: "Priority pillar leading indicator (baseline → target)", owner: "Ops", children: [] },
          ]},
          { id: "ops-2", level: "operational", title: "Ship one experiment per week on the constraint", owner: "Squad owner" },
        ],
      },
      {
        id: "tac-2",
        level: "tactical",
        title: `Protect and productize strength in ${input.strongestPillar}`,
        owner: "Functional owner",
        children: [
          { id: "ops-3", level: "operational", title: "Document playbook for strongest pillar", owner: "Team lead" },
        ],
      },
    ],
  };
}

export type PlanningBarrier = {
  barrier: string;
  solution: string;
  evidence: EvidenceClass;
};

export function detectPlanningBarriers(input: {
  hasCrm?: boolean;
  goalCount: number;
  health: number;
  objective?: string;
}): PlanningBarrier[] {
  const out: PlanningBarrier[] = [];
  if (!input.objective) out.push({ barrier: "Unclear objectives", solution: "Convert the primary objective into a SMART goal with baseline, target and deadline.", evidence: "USER PROVIDED" });
  if (input.goalCount === 0) out.push({ barrier: "Strategy-execution gap", solution: "Create at least one strategic, tactical and operational goal with owners.", evidence: "CALCULATED" });
  if (input.goalCount > 12) out.push({ barrier: "Too many priorities", solution: "Limit active company priorities to three; park the rest.", evidence: "INFERRED" });
  if (input.hasCrm === false) out.push({ barrier: "Technology limitations", solution: "Establish a single system of record for opportunities and follow-ups.", evidence: "USER PROVIDED" });
  if (input.health < 50) out.push({ barrier: "Poor data / weak baselines", solution: "Instrument conversion, cycle time and churn before large spend increases.", evidence: "CALCULATED" });
  out.push({ barrier: "Lack of accountability", solution: "Every initiative needs owner, deadline, KPI and weekly status.", evidence: "INFERRED" });
  return out;
}

export type ModuleRecommendation = {
  module: string;
  reason: string;
  justifiedBy: string;
};

export function recommendCintexaModules(scores: Record<string, number>): ModuleRecommendation[] {
  const recs: ModuleRecommendation[] = [];
  if ((scores.sales ?? 100) < 55) recs.push({ module: "CINTEXA CRM", reason: "Sales pipeline discipline and stage visibility are weak.", justifiedBy: "sales score" });
  if ((scores.marketing ?? 100) < 55) recs.push({ module: "CINTEXA Marketing Automation", reason: "Acquisition measurement and nurturing need structure.", justifiedBy: "marketing score" });
  if ((scores.customer ?? 100) < 55) recs.push({ module: "CINTEXA Customer Service", reason: "Retention and response quality need operational support.", justifiedBy: "customer score" });
  if ((scores.finance ?? 100) < 55) recs.push({ module: "CINTEXA Finance", reason: "Margin and cash visibility require tighter financial ops.", justifiedBy: "finance score" });
  if ((scores.technology ?? 100) < 55 || (scores.automation ?? 100) < 55) recs.push({ module: "CINTEXA Integration Layer + AI Workforce", reason: "Silos and manual work limit scale.", justifiedBy: "technology/automation scores" });
  if ((scores.operations ?? 100) < 55) recs.push({ module: "CINTEXA Workflow Automation", reason: "Process bottlenecks and handoffs need orchestration.", justifiedBy: "operations score" });
  if (!recs.length) recs.push({ module: "CINTEXA Business Intelligence", reason: "Maintain diagnostic cadence and KPI instrumentation.", justifiedBy: "overall health" });
  return recs;
}

export type SnapshotSummary = {
  capturedAt: string;
  health: number;
  companyName?: string;
  scores?: Record<string, number>;
};

export function compareSnapshots(a: SnapshotSummary, b: SnapshotSummary): {
  healthDelta: number;
  pillarDeltas: Array<{ pillar: string; from: number; to: number; delta: number }>;
  summary: string;
} {
  const healthDelta = b.health - a.health;
  const pillars = new Set([...Object.keys(a.scores || {}), ...Object.keys(b.scores || {})]);
  const pillarDeltas = [...pillars].map((pillar) => {
    const from = a.scores?.[pillar] ?? 0;
    const to = b.scores?.[pillar] ?? 0;
    return { pillar, from, to, delta: to - from };
  }).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const summary = healthDelta === 0
    ? "Overall health unchanged between snapshots."
    : healthDelta > 0
      ? `Business health improved by ${healthDelta} points since ${a.capturedAt.slice(0, 10)}.`
      : `Business health declined by ${Math.abs(healthDelta)} points since ${a.capturedAt.slice(0, 10)}.`;
  return { healthDelta, pillarDeltas, summary };
}

export function buildCeoBrief(input: {
  companyName: string;
  health: number;
  severity: string;
  strongest: string;
  weakest: string;
  alerts: ExecutiveAlert[];
  topActions: string[];
}): string[] {
  return [
    `${input.companyName}: Business Health ${input.health}/100 (${input.severity}).`,
    `Protect: ${input.strongest}. Fund: ${input.weakest}.`,
    `Alerts: ${input.alerts.slice(0, 3).map((a) => a.title).join("; ") || "None critical"}.`,
    ...input.topActions.slice(0, 5).map((a, i) => `Decision ${i + 1}: ${a}`),
  ];
}
