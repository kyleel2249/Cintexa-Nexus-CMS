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
import { persistFinanceAnalysis, loadFinanceAnalysesFromDb } from "../services/nexus-tool-store";
import { enforceModuleAuth, tenantMatch } from "../lib/permissions";

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
  organizationId?: string | null;
  userId?: string | null;
};

const analyses = new Map<string, AnalysisRecord>();

router.get("/health", (_req, res) => {
  res.json({ ok: true, enabled: featureEnabled() });
});

router.get("/analyses", enforceModuleAuth("finance.view", { optional: true }), async (req, res) => {
  if (!featureEnabled()) return res.status(403).json({ error: "Nexus Finance disabled" });
  const mem = [...analyses.values()].filter((a) => tenantMatch(a.organizationId, req.organizationId));
  const dbRows = await loadFinanceAnalysesFromDb(req.organizationId);
  const byId = new Map<string, any>();
  for (const r of dbRows) {
    byId.set(r.id, {
      id: r.id,
      companyName: r.companyName,
      periodLabel: r.periodLabel,
      currency: r.currency,
      input: r.input,
      health: r.health,
      distress: r.distress,
      survival: r.survival,
      createdAt: r.createdAt?.toISOString?.() || r.createdAt,
      organizationId: r.organizationId,
    });
  }
  for (const a of mem) byId.set(a.id, a);
  res.json({ items: [...byId.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) });
});

router.get("/analyses/:id", enforceModuleAuth("finance.view", { optional: true }), async (req, res) => {
  let a = analyses.get(String(req.params.id));
  if (!a) {
    const rows = await loadFinanceAnalysesFromDb(req.organizationId, 200);
    const row = rows.find((r) => r.id === String(req.params.id));
    if (row) {
      a = {
        id: row.id,
        companyName: row.companyName,
        periodLabel: row.periodLabel || undefined,
        currency: row.currency || undefined,
        input: row.input as any,
        health: row.health as any,
        distress: row.distress as any,
        survival: row.survival as any,
        createdAt: row.createdAt?.toISOString?.() || String(row.createdAt),
        organizationId: row.organizationId,
      };
    }
  }
  if (!a) return res.status(404).json({ error: "Not found" });
  if (!tenantMatch(a.organizationId, req.organizationId)) {
    return res.status(403).json({ error: "Tenant mismatch" });
  }
  res.json(a);
});

router.post("/analyze", enforceModuleAuth("finance.analyze", { optional: true }), async (req, res) => {
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
    organizationId: req.organizationId,
    userId: req.auth?.sub != null ? String(req.auth.sub) : null,
  };
  analyses.set(id, record);
  await persistFinanceAnalysis(record);
  res.status(201).json(record);
});

router.post("/ratios", enforceModuleAuth("finance.view", { optional: true }), (req, res) => {
  res.json({ ratios: calculateRatios(req.body ?? {}) });
});

router.post("/scenarios", enforceModuleAuth("finance.analyze", { optional: true }), (req, res) => {
  const base = req.body?.base ?? req.body ?? {};
  const changes = req.body?.changes ?? {};
  res.json(scenarioSimulate(base, changes));
});

router.post("/cfo-chat", enforceModuleAuth("finance.view", { optional: true }), (req, res) => {
  const q = String(req.body?.question || "").toLowerCase();
  const analysisId = req.body?.analysisId ? String(req.body.analysisId) : null;
  const analysis = analysisId
    ? analyses.get(analysisId)
    : [...analyses.values()].filter((a) => tenantMatch(a.organizationId, req.organizationId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!analysis) {
    return res.json({
      answer: "No analysis is loaded. Run a financial analysis with statement inputs first.",
      confidence: "low",
      evidence: "UNKNOWN",
    });
  }
  if (!tenantMatch(analysis.organizationId, req.organizationId)) {
    return res.status(403).json({ error: "Tenant mismatch" });
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
