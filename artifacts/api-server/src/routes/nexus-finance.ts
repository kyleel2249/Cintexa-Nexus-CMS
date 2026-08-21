import { Router } from "express";
import {
  calculateRatios,
  healthScore,
  distressSignals,
  survivalEstimate,
  scenarioSimulate,
  featureEnabled,
  type StatementInput,
} from "../services/nexus-finance-engine";
import { randomUUID } from "crypto";

const router = Router();

type AnalysisRecord = {
  id: string;
  companyName: string;
  periodLabel?: string;
  currency?: string;
  input: StatementInput;
  health: ReturnType<typeof healthScore>;
  distress: ReturnType<typeof distressSignals>;
  survival: ReturnType<typeof survivalEstimate>;
  createdAt: string;
};

const analyses = new Map<string, AnalysisRecord>();

router.get("/health", (_req, res) => {
  res.json({ ok: true, enabled: featureEnabled() });
});

router.get("/analyses", (_req, res) => {
  if (!featureEnabled()) return res.status(403).json({ error: "Nexus Finance disabled" });
  const items = [...analyses.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ items });
});

router.get("/analyses/:id", (req, res) => {
  const a = analyses.get(req.params.id);
  if (!a) return res.status(404).json({ error: "Not found" });
  res.json(a);
});

router.post("/analyze", (req, res) => {
  if (!featureEnabled()) return res.status(403).json({ error: "Nexus Finance disabled" });
  const body = req.body ?? {};
  const companyName = String(body.companyName || "Company").trim();
  const input: StatementInput = {
    revenue: body.revenue != null ? Number(body.revenue) : null,
    cogs: body.cogs != null ? Number(body.cogs) : null,
    operatingExpenses: body.operatingExpenses != null ? Number(body.operatingExpenses) : null,
    ebit: body.ebit != null ? Number(body.ebit) : null,
    ebitda: body.ebitda != null ? Number(body.ebitda) : null,
    interestExpense: body.interestExpense != null ? Number(body.interestExpense) : null,
    netIncome: body.netIncome != null ? Number(body.netIncome) : null,
    currentAssets: body.currentAssets != null ? Number(body.currentAssets) : null,
    cash: body.cash != null ? Number(body.cash) : null,
    inventory: body.inventory != null ? Number(body.inventory) : null,
    receivables: body.receivables != null ? Number(body.receivables) : null,
    totalAssets: body.totalAssets != null ? Number(body.totalAssets) : null,
    currentLiabilities: body.currentLiabilities != null ? Number(body.currentLiabilities) : null,
    totalLiabilities: body.totalLiabilities != null ? Number(body.totalLiabilities) : null,
    totalEquity: body.totalEquity != null ? Number(body.totalEquity) : null,
    totalDebt: body.totalDebt != null ? Number(body.totalDebt) : null,
    operatingCashFlow: body.operatingCashFlow != null ? Number(body.operatingCashFlow) : null,
    freeCashFlow: body.freeCashFlow != null ? Number(body.freeCashFlow) : null,
    monthlyBurn: body.monthlyBurn != null ? Number(body.monthlyBurn) : null,
    currency: body.currency || "GHS",
    periodLabel: body.periodLabel || undefined,
  };

  const health = healthScore(input);
  const distress = distressSignals(input);
  const survival = survivalEstimate(input);
  const id = randomUUID();
  const record: AnalysisRecord = {
    id,
    companyName,
    periodLabel: input.periodLabel,
    currency: input.currency,
    input,
    health,
    distress,
    survival,
    createdAt: new Date().toISOString(),
  };
  analyses.set(id, record);
  res.status(201).json(record);
});

router.post("/ratios", (req, res) => {
  res.json({ ratios: calculateRatios(req.body ?? {}) });
});

router.post("/scenarios", (req, res) => {
  const base = req.body?.base ?? req.body ?? {};
  const changes = req.body?.changes ?? {};
  res.json(scenarioSimulate(base, changes));
});

router.post("/cfo-chat", (req, res) => {
  const q = String(req.body?.question || "").toLowerCase();
  const analysisId = req.body?.analysisId ? String(req.body.analysisId) : null;
  const analysis = analysisId ? analyses.get(analysisId) : [...analyses.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!analysis) {
    return res.json({
      answer: "No analysis is loaded. Run a financial analysis with statement inputs first.",
      confidence: "low",
      evidence: "UNKNOWN",
    });
  }
  const h = analysis.health;
  let answer = `Based on the analysis for ${analysis.companyName}, overall health is ${h.overall}/100 (${h.rating}).`;
  if (/profit|margin/.test(q)) answer += ` Primary profitability signal: net margin dimension score ${h.dimensions.profitability}/100. Weakness focus: ${h.primaryWeakness}.`;
  else if (/cash|runway|surviv/.test(q)) answer += ` Survival note: ${analysis.survival.note} Estimated runway months: ${analysis.survival.estimatedRunwayMonths ?? "n/a"}.`;
  else if (/debt|solvency|liabilit/.test(q)) answer += ` Solvency dimension: ${h.dimensions.solvency}/100. Review debt service and equity coverage in the ratio table.`;
  else if (/risk|distress|altman/.test(q)) answer += ` Distress model: ${analysis.distress.interpretation} (score ${analysis.distress.score ?? "n/a"}). ${analysis.distress.limitations}`;
  else answer += ` Strength: ${h.primaryStrength}. Weakness: ${h.primaryWeakness}. ${h.disclaimer}`;
  res.json({
    answer,
    confidence: h.confidence >= 0.7 ? "high" : h.confidence >= 0.45 ? "medium" : "low",
    evidence: "CALCULATED",
    analysisId: analysis.id,
    disclaimer: h.disclaimer,
  });
});

export default router;
