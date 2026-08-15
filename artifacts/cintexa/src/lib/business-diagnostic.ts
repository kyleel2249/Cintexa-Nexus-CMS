export type EvidenceClass = "VERIFIED" | "USER PROVIDED" | "CALCULATED" | "BENCHMARKED" | "INFERRED" | "UNKNOWN";
export type DiagnosticMode = "quick" | "standard" | "deep" | "executive" | "sales" | "marketing" | "competitive" | "digital";
export type Metric = { id: string; label: string; value: number | null; unit: string; benchmark?: number | null };
export type Competitor = { id: string; name: string; positioning: string; score: number; pricing: string; strengths: string[]; weaknesses: string[] };
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
