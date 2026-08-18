import { Router } from "express";
import { db, diagnosticProfilesTable, diagnosticSessionsTable, diagnosticCompetitorsTable, diagnosticGoalsTable, diagnosticTaskHistoryTable, diagnosticEvidenceTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { analyze, benchmarkGap, projectScenario, validateSmartGoal, buildFullReport, getBenchmarks, buildBenchmarkReport } from "../services/diagnostic-engine";
import { researchCompanyWeb, researchCompetitorSites } from "../services/company-research";

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

  const web = await researchCompanyWeb({
    companyName: company || "Company",
    website: companyWebsite || undefined,
    industry: industry || undefined,
  });

  const competitorInsights = await researchCompetitorSites(
    competitors.length
      ? competitors
      : [],
  );

  try {
    if (body.sessionId || body.profileId) {
      await db.insert(diagnosticTaskHistoryTable).values({
        sessionId: body.sessionId != null ? Number(body.sessionId) : null,
        profileId: body.profileId != null ? Number(body.profileId) : null,
        taskType: "research",
        title: "Live company & competitor web research",
        detail: `Researched ${company || "company"} ${companyWebsite || ""}`.trim(),
        status: "completed",
        actor: "ai",
        metadata: { company, companyWebsite, industry, competitorCount: competitorInsights.length },
      } as any);
    }
  } catch {
    /* history optional */
  }

  res.json({
    companyName: company || null,
    companyWebsite: web.website || companyWebsite || null,
    industry: industry || null,
    researchedAt: web.researchedAt,
    evidencePolicy:
      "Public page content retrieved at research time is labeled VERIFIED with source URL and date. User profile fields remain USER PROVIDED. Competitive claims without a fetched page stay UNKNOWN.",
    pageTitle: web.pageTitle,
    metaDescription: web.metaDescription,
    headings: web.headings,
    aboutSnippet: web.aboutSnippet,
    keywords: web.keywords,
    socialLinks: web.socialLinks,
    emails: web.emails,
    phones: web.phones,
    fetchError: web.fetchError || null,
    companyInsights: web.companyInsights,
    competitorInsights,
    strategyHints: web.strategyHints,
    assessmentHints: web.assessmentHints,
    profileEnhancements: {
      messagingReview: web.website ? `Review hero, value proposition and CTA on ${web.website}` : null,
      suggestedIndustrySignals: web.keywords,
      competitorWebsites: competitorInsights.filter((c) => c.website).map((c) => ({ name: c.name, website: c.website })),
    },
    benchmarks: getBenchmarks(industry || null),
  });
});

router.post("/documents", async (req, res) => {
  const body = req.body ?? {};
  const files = Array.isArray(body.files) ? body.files : [];
  const sessionId = body.sessionId != null ? Number(body.sessionId) : null;
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

  // Persist as evidence rows so uploaded documents actually feed later
  // analysis/reporting for this session, not just this response.
  if (sessionId && normalized.length) {
    await db.insert(diagnosticEvidenceTable).values(
      normalized.map((d: any) => ({
        sessionId,
        category: "document_upload",
        claim: d.extractedTextPreview
          ? `Uploaded document "${d.name}" provided as supporting context.`
          : `Uploaded document "${d.name}" (no extractable text).`,
        evidenceType: "USER PROVIDED",
        sourceName: d.name,
        sourceUrl: null,
        confidence: "medium",
        value: { mimeType: d.mimeType, size: d.size, extractedTextPreview: d.extractedTextPreview },
      })),
    );
  }

  res.status(201).json({
    accepted: normalized.length,
    persisted: Boolean(sessionId),
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

router.get("/sessions/:sessionId/evidence", async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  const rows = await db.select().from(diagnosticEvidenceTable)
    .where(eq(diagnosticEvidenceTable.sessionId, sessionId))
    .orderBy(desc(diagnosticEvidenceTable.createdAt));
  res.json(rows);
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


