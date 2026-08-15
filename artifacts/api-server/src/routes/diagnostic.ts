import { Router } from "express";
import { db, diagnosticProfilesTable, diagnosticSessionsTable, diagnosticCompetitorsTable, diagnosticGoalsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const router = Router();

router.get("/profiles", async (_req, res) => {
  const profiles = await db.select().from(diagnosticProfilesTable).orderBy(desc(diagnosticProfilesTable.updatedAt));
  res.json(profiles);
});

router.post("/profiles", async (req, res) => {
  if (!req.body?.companyName) return res.status(400).json({ error: "companyName required" });
  const [profile] = await db.insert(diagnosticProfilesTable).values(req.body).returning();
  res.status(201).json(profile);
});

router.patch("/profiles/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [profile] = await db.update(diagnosticProfilesTable).set({ ...req.body, updatedAt: new Date() }).where(eq(diagnosticProfilesTable.id, id)).returning();
  if (!profile) return res.status(404).json({ error: "Profile not found" });
  res.json(profile);
});

router.get("/profiles/:profileId/sessions", async (req, res) => {
  const profileId = Number(req.params.profileId);
  const sessions = await db.select().from(diagnosticSessionsTable).where(eq(diagnosticSessionsTable.profileId, profileId)).orderBy(desc(diagnosticSessionsTable.updatedAt));
  res.json(sessions);
});

router.post("/sessions", async (req, res) => {
  const [session] = await db.insert(diagnosticSessionsTable).values({
    profileId: req.body.profileId ?? null,
    mode: req.body.mode ?? "standard",
    status: "in_progress",
    currentStep: req.body.currentStep ?? 0,
    totalSteps: req.body.totalSteps ?? 10,
    answers: req.body.answers ?? {},
    pillarScores: req.body.pillarScores ?? {},
  }).returning();
  res.status(201).json(session);
});

router.patch("/sessions/:id", async (req, res) => {
  const id = Number(req.params.id);
  const allowed = ["status", "currentStep", "totalSteps", "answers", "pillarScores", "overallScore", "aiAnalysis", "recommendations", "smartGoals", "executionRoadmap", "swotAnalysis", "competitiveAnalysis", "benchmarkComparison", "completedAt"];
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of allowed) if (req.body?.[key] !== undefined) updates[key] = req.body[key];
  const [session] = await db.update(diagnosticSessionsTable).set(updates as any).where(eq(diagnosticSessionsTable.id, id)).returning();
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

router.get("/sessions/:sessionId/goals", async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  res.json(await db.select().from(diagnosticGoalsTable).where(eq(diagnosticGoalsTable.sessionId, sessionId)).orderBy(diagnosticGoalsTable.id));
});

router.post("/sessions/:sessionId/goals", async (req, res) => {
  const [goal] = await db.insert(diagnosticGoalsTable).values({ ...req.body, sessionId: Number(req.params.sessionId) }).returning();
  res.status(201).json(goal);
});

router.patch("/goals/:id", async (req, res) => {
  const [goal] = await db.update(diagnosticGoalsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(diagnosticGoalsTable.id, Number(req.params.id))).returning();
  if (!goal) return res.status(404).json({ error: "Goal not found" });
  res.json(goal);
});

router.get("/profiles/:profileId/competitors", async (req, res) => {
  res.json(await db.select().from(diagnosticCompetitorsTable).where(eq(diagnosticCompetitorsTable.profileId, Number(req.params.profileId))).orderBy(diagnosticCompetitorsTable.name));
});

router.post("/profiles/:profileId/competitors", async (req, res) => {
  if (!req.body?.name) return res.status(400).json({ error: "name required" });
  const [competitor] = await db.insert(diagnosticCompetitorsTable).values({ ...req.body, profileId: Number(req.params.profileId) }).returning();
  res.status(201).json(competitor);
});

export default router;
