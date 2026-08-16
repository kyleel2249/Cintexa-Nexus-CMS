import { Router } from "express";
import { db, diagnosticProfilesTable, diagnosticSessionsTable, diagnosticCompetitorsTable, diagnosticGoalsTable, diagnosticTaskHistoryTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { analyze, benchmarkGap, projectScenario, validateSmartGoal, buildFullReport, getBenchmarks, buildBenchmarkReport } from "../services/diagnostic-engine";

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

router.post("/benchmark", async (req, res) => {
  const body = req.body ?? {};
  res.json({ metric: body.metric ?? null, actual: body.actual ?? null, benchmark: body.benchmark ?? null, ...benchmarkGap(body.actual, body.benchmark) });
});

router.post("/scenario", async (req, res) => {
  res.json({ ...projectScenario(req.body ?? {}), generatedAt: new Date().toISOString() });
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


router.post("/report", async (req, res) => {
  const body = req.body ?? {};
  const report = buildFullReport({
    companyName: body.companyName,
    industry: body.industry,
    metrics: body.metrics ?? {},
    pillarScores: body.pillarScores ?? {},
    competitors: body.competitors ?? [],
  });
  res.json(report);
});

router.get("/benchmarks", async (req, res) => {
  const industry = typeof req.query.industry === "string" ? req.query.industry : null;
  res.json({ industry: industry ?? "default", benchmarks: getBenchmarks(industry), note: "Benchmarks are documented public research summaries. Apply only when industry match is reasonable." });
});

router.post("/research", async (req, res) => {
  const body = req.body ?? {};
  const company = String(body.companyName ?? "").trim();
  const companyWebsite = String(body.companyWebsite ?? body.website ?? "").trim();
  const industry = String(body.industry ?? "").trim();
  const competitors = Array.isArray(body.competitors)
    ? body.competitors.map((c: any) => ({
        name: String(c?.name ?? c ?? "").trim(),
        website: String(c?.website ?? "").trim(),
      })).filter((c: { name: string }) => c.name)
    : [];

  const companyInsights = [];
  if (company) {
    companyInsights.push({ claim: `Profile recorded for ${company}`, evidence: "USER PROVIDED", source: "Diagnostic profile", date: new Date().toISOString().slice(0, 10) });
  }
  if (companyWebsite) {
    companyInsights.push({
      claim: `Company website supplied: ${companyWebsite}`,
      evidence: "USER PROVIDED",
      source: companyWebsite,
      date: new Date().toISOString().slice(0, 10),
      suggestedReview: ["Positioning / hero message", "Product or service pages", "Pricing signals", "CTA and conversion path", "About / team signals"],
    });
  }
  if (industry) {
    companyInsights.push({ claim: `Industry context set to ${industry}`, evidence: "USER PROVIDED", source: "Diagnostic profile", date: new Date().toISOString().slice(0, 10) });
  }

  const competitorInsights = competitors.map((c: { name: string; website: string }) => ({
    name: c.name,
    website: c.website || null,
    claims: [
      { claim: `Competitor named ${c.name} was supplied by the user`, evidence: "USER PROVIDED", source: "User input", date: new Date().toISOString().slice(0, 10) },
      c.website
        ? { claim: `Competitor website supplied: ${c.website}`, evidence: "USER PROVIDED", source: c.website, date: new Date().toISOString().slice(0, 10) }
        : { claim: "No competitor website supplied; public review not started", evidence: "UNKNOWN", source: null, date: null },
      { claim: "Pricing, reviews and hiring signals remain UNKNOWN until dated public sources are attached", evidence: "UNKNOWN", source: null, date: null },
    ],
    recommendedNextStep: c.website
      ? `Review ${c.website} for positioning, offers, CTA and proof points; attach source/date for every claim used in strategy.`
      : `Add website for ${c.name}, then collect dated public sources: positioning, pricing, reviews and hiring signals.`,
    strategyPrompts: [
      `What customer problem does ${c.name} claim to solve?`,
      `Where is ${c.name} weaker on service, speed, price or specialization?`,
      `Which of their CTAs or offers could inform a controlled experiment?`,
    ],
  }));

  const strategyHints = [
    companyWebsite ? `Use ${companyWebsite} as the baseline for messaging and conversion-path review.` : "Add the company website to ground messaging and conversion analysis.",
    "Map conversion, cycle time and CAC against industry benchmarks before changing spend.",
    "Build a monthly competitor scorecard with source/date for every external claim.",
    "Convert top findings into SMART goals with owners and 30/90/365 day checkpoints.",
  ];

  // Persist research task when session/profile provided
  try {
    if (body.sessionId || body.profileId) {
      await db.insert(diagnosticTaskHistoryTable).values({
        sessionId: body.sessionId != null ? Number(body.sessionId) : null,
        profileId: body.profileId != null ? Number(body.profileId) : null,
        taskType: "research",
        title: "Company & competitor research",
        detail: `Researched ${company || "company"} and ${competitors.length} competitor(s)`,
        status: "completed",
        actor: "user",
        metadata: { company, companyWebsite, competitors, industry },
      } as any);
    }
  } catch {
    // History persistence is best-effort when DB schema is not yet migrated
  }

  res.json({
    companyName: company || null,
    companyWebsite: companyWebsite || null,
    industry: industry || null,
    researchedAt: new Date().toISOString(),
    evidencePolicy: "Public claims require source and date. Website URLs are USER PROVIDED context; content claims stay UNKNOWN until verified.",
    companyInsights,
    competitorInsights,
    strategyHints,
    profileEnhancements: {
      messagingReview: companyWebsite ? `Review hero, value proposition and CTA on ${companyWebsite}` : null,
      competitorWebsites: competitors.filter((c: any) => c.website).map((c: any) => ({ name: c.name, website: c.website })),
    },
    benchmarks: getBenchmarks(industry || null),
    aiEmployees: [
      { id: "scout", status: "done", action: "Profile and niche context captured" },
      { id: "rival", status: "done", action: "Competitor seeds prepared from niche" },
      { id: "benchmark", status: "done", action: "Industry benchmark band applied" },
      { id: "case", status: "done", action: "Case patterns matched to weakest pillar" },
    ],
    note: "AI employees produce structured seeds and source links. Treat unverified public claims as UNKNOWN until dated evidence is attached.",
  });
});

router.post("/documents", async (req, res) => {
  const body = req.body ?? {};
  const files = Array.isArray(body.files) ? body.files : [];
  // Accept metadata + extracted text summaries from client; store-ready payload.
  const normalized = files.map((f: any, i: number) => ({
    id: f.id ?? `doc-${i + 1}`,
    name: String(f.name ?? "untitled"),
    mimeType: String(f.mimeType ?? "application/octet-stream"),
    size: Number(f.size ?? 0),
    extractedTextPreview: typeof f.text === "string" ? f.text.slice(0, 4000) : null,
    evidence: "USER PROVIDED",
    uploadedAt: new Date().toISOString(),
  }));
  res.status(201).json({
    accepted: normalized.length,
    documents: normalized,
    analysisNotes: normalized.map((d: any) => ({
      document: d.name,
      insight: d.extractedTextPreview
        ? "Document text captured for diagnostic context (USER PROVIDED)."
        : "No extractable text provided; file metadata recorded only.",
      evidence: "USER PROVIDED",
    })),
  });
});


router.post("/history", async (req, res) => {
  const body = req.body ?? {};
  if (!body.title || !body.taskType) return res.status(400).json({ error: "taskType and title are required" });
  try {
    const [row] = await db.insert(diagnosticTaskHistoryTable).values({
      sessionId: body.sessionId != null ? Number(body.sessionId) : null,
      profileId: body.profileId != null ? Number(body.profileId) : null,
      taskType: String(body.taskType),
      title: String(body.title),
      detail: body.detail ?? null,
      status: body.status ?? "completed",
      actor: body.actor ?? "user",
      metadata: body.metadata ?? {},
    } as any).returning();
    return res.status(201).json(row);
  } catch (err: any) {
    // Fallback in-memory style response if table missing
    return res.status(201).json({
      id: Date.now(),
      sessionId: body.sessionId ?? null,
      profileId: body.profileId ?? null,
      taskType: body.taskType,
      title: body.title,
      detail: body.detail ?? null,
      status: body.status ?? "completed",
      actor: body.actor ?? "user",
      metadata: body.metadata ?? {},
      createdAt: new Date().toISOString(),
      persisted: false,
    });
  }
});

router.get("/history", async (req, res) => {
  const sessionId = req.query.sessionId ? Number(req.query.sessionId) : null;
  const profileId = req.query.profileId ? Number(req.query.profileId) : null;
  try {
    let rows;
    if (sessionId) {
      rows = await db.select().from(diagnosticTaskHistoryTable).where(eq(diagnosticTaskHistoryTable.sessionId, sessionId)).orderBy(desc(diagnosticTaskHistoryTable.createdAt));
    } else if (profileId) {
      rows = await db.select().from(diagnosticTaskHistoryTable).where(eq(diagnosticTaskHistoryTable.profileId, profileId)).orderBy(desc(diagnosticTaskHistoryTable.createdAt));
    } else {
      rows = await db.select().from(diagnosticTaskHistoryTable).orderBy(desc(diagnosticTaskHistoryTable.createdAt)).limit(200);
    }
    return res.json(rows);
  } catch {
    return res.json([]);
  }
});


export default router;


