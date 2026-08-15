import { Router } from "express";
import { db, diagnosticProfilesTable, diagnosticSessionsTable, diagnosticCompetitorsTable, diagnosticGoalsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { analyze, validateSmartGoal } from "../services/diagnostic-engine";

const router = Router();
const json = (value: unknown) => value ?? {};

router.get("/profiles", async (_req, res) => {
  const rows = await db.select().from(diagnosticProfilesTable).orderBy(desc(diagnosticProfilesTable.updatedAt));
  res.json(rows);
});

router.post("/profiles", async (req, res) => {
  const body = req.body ?? {};
  if (!body.companyName?.trim()) return res.status(400).json({ error: "companyName is required" });
  const numeric = ["employeeCount","monthlyRevenue","grossMargin","netMargin","avgTransactionValue","customerLifetimeValue","customerAcquisitionCost","monthlyLeads","monthlyQualifiedLeads","monthlyCustomers","conversionRate","customerChurn","retentionRate","salesCycleDays"];
  const values: Record<string, unknown> = {
    companyName: body.companyName.trim(), industry: body.industry ?? null, subIndustry: body.subIndustry ?? null,
    businessModel: body.businessModel ?? null, customerType: body.customerType ?? null, geographicMarkets: body.geographicMarkets ?? null,
    targetCustomers: body.targetCustomers ?? null, companySize: body.companySize ?? null, revenueRange: body.revenueRange ?? null,
    annualGrowth: body.annualGrowth ?? null, mainProducts: body.mainProducts ?? null, mainServices: body.mainServices ?? null,
    mainRevenueSources: body.mainRevenueSources ?? null, mainCompetitors: body.mainCompetitors ?? null, technologyStack: body.technologyStack ?? null,
    crmSystem: body.crmSystem ?? null, accountingSystem: body.accountingSystem ?? null, marketingPlatforms: body.marketingPlatforms ?? null,
    ecommercePlatform: body.ecommercePlatform ?? null, communicationSystems: body.communicationSystems ?? null, existingAutomation: body.existingAutomation ?? null,
    strategicObjectives: body.strategicObjectives ?? null,
  };
  for (const key of numeric) values[key] = body[key] == null || body[key] === "" ? null : Number(body[key]);
  const [profile] = await db.insert(diagnosticProfilesTable).values(values as any).returning();
  res.status(201).json(profile);
});

router.get("/profiles/:profileId/sessions", async (req, res) => {
  const rows = await db.select().from(diagnosticSessionsTable).where(eq(diagnosticSessionsTable.profileId, Number(req.params.profileId))).orderBy(desc(diagnosticSessionsTable.updatedAt));
  res.json(rows);
});

router.post("/sessions", async (req, res) => {
  const body = req.body ?? {};
  if (!body.profileId) return res.status(400).json({ error: "profileId is required" });
  const [session] = await db.insert(diagnosticSessionsTable).values({ profileId: Number(body.profileId), mode: body.mode ?? "standard", status: body.status ?? "in_progress", currentStep: Number(body.currentStep ?? 0), totalSteps: Number(body.totalSteps ?? 10), answers: json(body.answers), pillarScores: json(body.pillarScores), overallScore: body.overallScore == null ? null : Number(body.overallScore), aiAnalysis: json(body.aiAnalysis), recommendations: json(body.recommendations), smartGoals: json(body.smartGoals), executionRoadmap: json(body.executionRoadmap), swotAnalysis: json(body.swotAnalysis), competitiveAnalysis: json(body.competitiveAnalysis), benchmarkComparison: json(body.benchmarkComparison) }).returning();
  res.status(201).json(session);
});

router.patch("/sessions/:id", async (req, res) => {
  const id = Number(req.params.id); const body = req.body ?? {}; const updates: Record<string, unknown> = {};
  const fields = ["mode","status","currentStep","totalSteps","answers","pillarScores","overallScore","aiAnalysis","recommendations","smartGoals","executionRoadmap","swotAnalysis","competitiveAnalysis","benchmarkComparison","completedAt"];
  for (const field of fields) if (body[field] !== undefined) updates[field] = body[field];
  updates.updatedAt = new Date();
  const [session] = await db.update(diagnosticSessionsTable).set(updates as any).where(eq(diagnosticSessionsTable.id, id)).returning();
  if (!session) return res.status(404).json({ error: "Diagnostic session not found" });
  res.json(session);
});

router.post("/analyze", async (req, res) => {
  const body = req.body ?? {};
  const result = analyze(body.metrics ?? {}, body.pillarScores ?? {});
  res.json({ ...result, generatedAt: new Date().toISOString(), evidencePolicy: "Conclusions are calculated from supplied values; missing benchmarks and external facts remain UNKNOWN." });
});

router.post("/smart/validate", async (req, res) => {
  res.json(validateSmartGoal(req.body ?? {}));
});

router.get("/sessions/:sessionId/competitors", async (req, res) => {
  const [session] = await db.select().from(diagnosticSessionsTable).where(eq(diagnosticSessionsTable.id, Number(req.params.sessionId)));
  if (!session?.profileId) return res.status(404).json({ error: "Diagnostic session not found" });
  res.json(await db.select().from(diagnosticCompetitorsTable).where(eq(diagnosticCompetitorsTable.profileId, session.profileId)));
});

router.post("/competitors", async (req, res) => {
  const body = req.body ?? {};
  if (!body.profileId || !body.name?.trim()) return res.status(400).json({ error: "profileId and name are required" });
  const [competitor] = await db.insert(diagnosticCompetitorsTable).values({ profileId: Number(body.profileId), name: body.name.trim(), website: body.website ?? null, positioning: body.positioning ?? null, strengths: body.strengths ?? null, weaknesses: body.weaknesses ?? null, pricing: body.pricing ?? null, targetCustomers: body.targetCustomers ?? null, marketShare: body.marketShare ?? null, scorecard: json(body.scorecard), strategyAnalysis: json(body.strategyAnalysis) }).returning();
  res.status(201).json(competitor);
});

router.get("/sessions/:sessionId/goals", async (req, res) => {
  res.json(await db.select().from(diagnosticGoalsTable).where(eq(diagnosticGoalsTable.sessionId, Number(req.params.sessionId))).orderBy(desc(diagnosticGoalsTable.updatedAt)));
});

router.post("/goals", async (req, res) => {
  const body = req.body ?? {};
  if (!body.sessionId || !body.title?.trim()) return res.status(400).json({ error: "sessionId and title are required" });
  const smart = validateSmartGoal(body);
  const [goal] = await db.insert(diagnosticGoalsTable).values({ sessionId: Number(body.sessionId), goalType: body.goalType ?? "strategic", title: body.title.trim(), description: body.description ?? null, owner: body.owner ?? null, department: body.department ?? null, deadline: body.deadline ?? null, kpi: body.kpi ?? null, baseline: body.baseline ?? null, target: body.target ?? null, currentValue: body.currentValue ?? null, progress: Number(body.progress ?? 0), status: body.status ?? "not_started", priority: body.priority ?? "medium", parentGoalId: body.parentGoalId == null ? null : Number(body.parentGoalId), smartScore: smart.score, dependencies: body.dependencies ?? null }).returning();
  res.status(201).json({ ...goal, smartValidation: smart });
});

export default router;
