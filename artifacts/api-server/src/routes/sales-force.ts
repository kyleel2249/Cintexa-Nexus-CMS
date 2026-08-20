import { Router } from "express";
import {
  db,
  salesAgentsTable,
  salesLeadsTable,
  salesOpportunitiesTable,
  salesActivitiesTable,
  salesCampaignsTable,
  salesProposalsTable,
  salesAuditLogsTable,
  salesKnowledgeTable,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  DEFAULT_AGENTS,
  DEFAULT_PIPELINE_STAGES,
  scoreLead,
  nextBestAction,
  handleObjection,
  buildResearchBrief,
  buildProposalDraft,
  forecastFromPipeline,
  dealRisk,
  closeTheGap,
  FOLLOW_UP_SEQUENCE,
} from "../services/sales-force-engine";

const router = Router();

async function audit(agentName: string, action: string, extra: Record<string, unknown> = {}) {
  try {
    await db.insert(salesAuditLogsTable).values({
      agentName,
      action,
      entityType: (extra.entityType as string) || null,
      entityId: extra.entityId != null ? Number(extra.entityId) : null,
      reason: (extra.reason as string) || null,
      dataUsed: extra.dataUsed || {},
      result: (extra.result as string) || null,
    } as any);
  } catch {
    /* soft */
  }
}

async function logActivity(row: {
  leadId?: number | null;
  opportunityId?: number | null;
  agentId?: number | null;
  actorName?: string;
  action: string;
  summary?: string;
  detail?: Record<string, unknown>;
  confidence?: string;
}) {
  try {
    await db.insert(salesActivitiesTable).values({
      leadId: row.leadId ?? null,
      opportunityId: row.opportunityId ?? null,
      agentId: row.agentId ?? null,
      actorType: "ai",
      actorName: row.actorName || "system",
      action: row.action,
      summary: row.summary || null,
      detail: row.detail || {},
      confidence: row.confidence || null,
    } as any);
  } catch {
    /* soft */
  }
}

// ——— Bootstrap default agents ———
router.post("/bootstrap", async (_req, res) => {
  try {
    const existing = await db.select().from(salesAgentsTable).limit(1);
    if (existing.length) return res.json({ ok: true, message: "Agents already present", seeded: false });
    for (const a of DEFAULT_AGENTS) {
      await db.insert(salesAgentsTable).values({
        name: a.name,
        slug: a.slug,
        role: a.role,
        personality: a.personality,
        specialization: a.specialization,
        status: "active",
        autonomyLevel: a.role === "director" || a.role === "manager" ? 2 : 1,
        isSystem: true,
        performance: {},
        targets: {},
        products: [],
        permissions: { canOutreach: a.role === "sdr" || a.role === "ae", canNegotiate: a.role === "negotiator", maxDiscountPercent: a.role === "negotiator" ? 10 : 0 },
      } as any);
    }
    await audit("system", "bootstrap_agents", { result: "seeded" });
    return res.status(201).json({ ok: true, seeded: true, count: DEFAULT_AGENTS.length });
  } catch (err: any) {
    // In-memory fallback list when DB missing
    return res.status(201).json({
      ok: true,
      seeded: false,
      persisted: false,
      agents: DEFAULT_AGENTS,
      note: err?.message || "DB unavailable — returning catalog only",
    });
  }
});

router.get("/agents", async (_req, res) => {
  try {
    const rows = await db.select().from(salesAgentsTable).orderBy(salesAgentsTable.id);
    if (!rows.length) {
      return res.json({ items: DEFAULT_AGENTS.map((a, i) => ({ id: -(i + 1), ...a, status: "active", autonomyLevel: 1, isSystem: true })), source: "catalog" });
    }
    return res.json({ items: rows, source: "db" });
  } catch {
    return res.json({ items: DEFAULT_AGENTS.map((a, i) => ({ id: -(i + 1), ...a, status: "active", autonomyLevel: 1 })), source: "catalog" });
  }
});

router.patch("/agents/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body ?? {};
  const allowed = ["status", "autonomyLevel", "territory", "personality", "targets", "permissions", "config", "name"];
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of allowed) if (body[k] !== undefined) updates[k] = body[k];
  try {
    const [row] = await db.update(salesAgentsTable).set(updates as any).where(eq(salesAgentsTable.id, id)).returning();
    if (!row) return res.status(404).json({ error: "not found" });
    await audit(row.name, "agent_updated", { entityType: "agent", entityId: id, dataUsed: updates });
    return res.json(row);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "update failed" });
  }
});

router.get("/pipeline/stages", (_req, res) => {
  res.json({ items: DEFAULT_PIPELINE_STAGES });
});

// ——— Leads ———
router.get("/leads", async (req, res) => {
  const stage = req.query.stage ? String(req.query.stage) : null;
  try {
    let rows = await db.select().from(salesLeadsTable).orderBy(desc(salesLeadsTable.priorityScore), desc(salesLeadsTable.createdAt)).limit(200);
    if (stage) rows = rows.filter((r) => r.stage === stage);
    return res.json({ items: rows, count: rows.length });
  } catch {
    return res.json({ items: [], count: 0, note: "Leads table unavailable until migration" });
  }
});

router.post("/leads", async (req, res) => {
  const body = req.body ?? {};
  const companyName = String(body.companyName || "").trim();
  if (!companyName) return res.status(400).json({ error: "companyName required" });
  const scores = scoreLead({
    industry: body.industry,
    companySize: body.companySize,
    website: body.website,
    source: body.source,
    hasEmail: Boolean(body.contactEmail),
    engagementEvents: Number(body.engagementEvents || 0),
    pricingPageViews: Number(body.pricingPageViews || 0),
    proposalViews: Number(body.proposalViews || 0),
    replied: Boolean(body.replied),
    requestedDemo: Boolean(body.requestedDemo),
    estimatedValue: body.estimatedValue != null ? Number(body.estimatedValue) : null,
  });
  const nba = nextBestAction({
    stage: body.stage || "new_lead",
    priorityScore: scores.priorityScore,
    optedOut: Boolean(body.optedOut),
    hasConsentEmail: Boolean(body.consentEmail),
  });
  const brief = buildResearchBrief({
    companyName,
    website: body.website,
    industry: body.industry,
    contactTitle: body.contactTitle,
  });
  try {
    const [row] = await db.insert(salesLeadsTable).values({
      companyName,
      contactName: body.contactName || null,
      contactEmail: body.contactEmail || null,
      contactTitle: body.contactTitle || null,
      website: body.website || null,
      industry: body.industry || null,
      companySize: body.companySize || null,
      location: body.location || null,
      source: body.source || "manual",
      stage: body.stage || "new_lead",
      fitScore: scores.fitScore,
      engagementScore: scores.engagementScore,
      intentScore: scores.intentScore,
      valueScore: scores.valueScore,
      timingScore: scores.timingScore,
      priorityScore: scores.priorityScore,
      qualityLabel: scores.qualityLabel,
      researchBrief: brief,
      scoresDetail: scores,
      consentEmail: Boolean(body.consentEmail),
      consentSms: Boolean(body.consentSms),
      optedOut: Boolean(body.optedOut),
      nextAction: nba.action,
      nextActionReason: nba.reason,
      isDemo: Boolean(body.isDemo),
      notes: body.notes || null,
      metadata: body.metadata || {},
    } as any).returning();
    await logActivity({ leadId: row.id, actorName: "Sophia", action: "lead_scored", summary: `Priority ${scores.priorityScore} (${scores.qualityLabel})`, detail: scores, confidence: "medium" });
    await logActivity({ leadId: row.id, actorName: "Ethan", action: "research_brief", summary: "Pre-call brief generated from provided fields", detail: brief, confidence: "low" });
    await audit("Sophia", "score_lead", { entityType: "lead", entityId: row.id, result: scores.qualityLabel });
    return res.status(201).json(row);
  } catch (err: any) {
    return res.status(201).json({
      id: null,
      companyName,
      ...scores,
      nextAction: nba.action,
      nextActionReason: nba.reason,
      researchBrief: brief,
      persisted: false,
      note: err?.message,
    });
  }
});

router.post("/leads/:id/score", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body ?? {};
  try {
    const rows = await db.select().from(salesLeadsTable).where(eq(salesLeadsTable.id, id)).limit(1);
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: "not found" });
    const scores = scoreLead({
      industry: body.industry ?? lead.industry,
      companySize: body.companySize ?? lead.companySize,
      website: body.website ?? lead.website,
      source: lead.source,
      hasEmail: Boolean(lead.contactEmail),
      engagementEvents: Number(body.engagementEvents || 0),
      pricingPageViews: Number(body.pricingPageViews || 0),
      proposalViews: Number(body.proposalViews || 0),
      replied: Boolean(body.replied),
      requestedDemo: Boolean(body.requestedDemo),
      estimatedValue: body.estimatedValue != null ? Number(body.estimatedValue) : null,
    });
    const nba = nextBestAction({ stage: lead.stage, priorityScore: scores.priorityScore, optedOut: lead.optedOut, hasConsentEmail: lead.consentEmail });
    const [updated] = await db.update(salesLeadsTable).set({
      fitScore: scores.fitScore,
      engagementScore: scores.engagementScore,
      intentScore: scores.intentScore,
      valueScore: scores.valueScore,
      timingScore: scores.timingScore,
      priorityScore: scores.priorityScore,
      qualityLabel: scores.qualityLabel,
      scoresDetail: scores,
      nextAction: nba.action,
      nextActionReason: nba.reason,
      updatedAt: new Date(),
    } as any).where(eq(salesLeadsTable.id, id)).returning();
    await logActivity({ leadId: id, actorName: "Sophia", action: "lead_rescored", summary: `Priority ${scores.priorityScore}`, detail: scores });
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

router.post("/leads/:id/assign", async (req, res) => {
  const id = Number(req.params.id);
  const agentId = req.body?.agentId != null ? Number(req.body.agentId) : null;
  try {
    const [updated] = await db.update(salesLeadsTable).set({ assignedAgentId: agentId, updatedAt: new Date() } as any).where(eq(salesLeadsTable.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "not found" });
    await logActivity({ leadId: id, agentId, actorName: "Maya", action: "lead_assigned", summary: `Assigned agent ${agentId}` });
    await audit("Maya", "assign_lead", { entityType: "lead", entityId: id, result: String(agentId) });
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

router.post("/leads/:id/stage", async (req, res) => {
  const id = Number(req.params.id);
  const stage = String(req.body?.stage || "");
  if (!DEFAULT_PIPELINE_STAGES.some((s) => s.id === stage)) {
    return res.status(400).json({ error: "invalid stage", allowed: DEFAULT_PIPELINE_STAGES.map((s) => s.id) });
  }
  try {
    const nba = nextBestAction({ stage, priorityScore: req.body?.priorityScore, optedOut: Boolean(req.body?.optedOut) });
    const [updated] = await db.update(salesLeadsTable).set({
      stage,
      nextAction: nba.action,
      nextActionReason: nba.reason,
      updatedAt: new Date(),
    } as any).where(eq(salesLeadsTable.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "not found" });
    await logActivity({ leadId: id, actorName: "system", action: "stage_change", summary: `Stage → ${stage}` });
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

router.post("/objection", (req, res) => {
  const text = String(req.body?.text || "");
  if (!text.trim()) return res.status(400).json({ error: "text required" });
  res.json(handleObjection(text));
});

router.post("/next-action", (req, res) => {
  res.json(nextBestAction(req.body ?? {}));
});

// ——— Opportunities ———
router.get("/opportunities", async (_req, res) => {
  try {
    const rows = await db.select().from(salesOpportunitiesTable).orderBy(desc(salesOpportunitiesTable.updatedAt)).limit(200);
    return res.json({ items: rows });
  } catch {
    return res.json({ items: [] });
  }
});

router.post("/opportunities", async (req, res) => {
  const body = req.body ?? {};
  const companyName = String(body.companyName || "").trim();
  const name = String(body.name || `${companyName} opportunity`).trim();
  if (!companyName) return res.status(400).json({ error: "companyName required" });
  const amount = body.amount != null ? Number(body.amount) : null;
  const stage = body.stage || "qualified";
  const prob = DEFAULT_PIPELINE_STAGES.find((s) => s.id === stage)?.probability ?? 30;
  const risk = dealRisk({ stage, daysSinceActivity: 0, hasDecisionMaker: Boolean(body.hasDecisionMaker), amount });
  try {
    const [row] = await db.insert(salesOpportunitiesTable).values({
      leadId: body.leadId != null ? Number(body.leadId) : null,
      name,
      companyName,
      stage,
      amount: amount != null ? String(amount) : null,
      currency: body.currency || "GHS",
      probability: body.probability != null ? Number(body.probability) : prob,
      riskScore: risk.riskScore,
      assignedAgentId: body.assignedAgentId != null ? Number(body.assignedAgentId) : null,
      products: body.products || [],
      context: { risk, ...((body.context as object) || {}) },
      isDemo: Boolean(body.isDemo),
    } as any).returning();
    await logActivity({ opportunityId: row.id, leadId: row.leadId, actorName: "Daniel", action: "opportunity_created", summary: name });
    if (body.leadId) {
      await db.update(salesLeadsTable).set({ stage: "qualified", updatedAt: new Date() } as any).where(eq(salesLeadsTable.id, Number(body.leadId)));
    }
    return res.status(201).json(row);
  } catch (err: any) {
    return res.status(201).json({ id: null, name, companyName, stage, amount, risk, persisted: false, note: err?.message });
  }
});

router.post("/opportunities/:id/stage", async (req, res) => {
  const id = Number(req.params.id);
  const stage = String(req.body?.stage || "");
  if (!DEFAULT_PIPELINE_STAGES.some((s) => s.id === stage)) return res.status(400).json({ error: "invalid stage" });
  const prob = DEFAULT_PIPELINE_STAGES.find((s) => s.id === stage)?.probability ?? 10;
  try {
    const patch: Record<string, unknown> = { stage, probability: prob, updatedAt: new Date() };
    if (stage === "closed_won") patch.wonAt = new Date();
    if (stage === "closed_lost") {
      patch.lostAt = new Date();
      patch.lostReason = req.body?.lostReason || null;
    }
    const [row] = await db.update(salesOpportunitiesTable).set(patch as any).where(eq(salesOpportunitiesTable.id, id)).returning();
    if (!row) return res.status(404).json({ error: "not found" });
    await logActivity({ opportunityId: id, actorName: "system", action: "opp_stage", summary: `→ ${stage}` });
    if (stage === "closed_won") await audit("Leo", "closed_won", { entityType: "opportunity", entityId: id, result: "won", note: "Marked won only after explicit stage change" });
    return res.json(row);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

// ——— Proposals ———
router.post("/proposals", async (req, res) => {
  const body = req.body ?? {};
  const companyName = String(body.companyName || "Customer");
  const draft = buildProposalDraft({
    companyName,
    contactName: body.contactName,
    problem: body.problem,
    solution: body.solution,
    amount: body.amount != null ? Number(body.amount) : null,
    currency: body.currency,
  });
  try {
    const [row] = await db.insert(salesProposalsTable).values({
      opportunityId: body.opportunityId != null ? Number(body.opportunityId) : null,
      leadId: body.leadId != null ? Number(body.leadId) : null,
      title: draft.title,
      body: draft,
      amount: body.amount != null ? String(body.amount) : null,
      currency: body.currency || "GHS",
      status: "draft",
      createdByAgentId: body.agentId != null ? Number(body.agentId) : null,
    } as any).returning();
    await logActivity({ opportunityId: row.opportunityId, leadId: row.leadId, actorName: "Victoria", action: "proposal_drafted", summary: draft.title });
    return res.status(201).json(row);
  } catch (err: any) {
    return res.status(201).json({ ...draft, persisted: false, note: err?.message });
  }
});

router.get("/proposals", async (_req, res) => {
  try {
    const rows = await db.select().from(salesProposalsTable).orderBy(desc(salesProposalsTable.createdAt)).limit(100);
    return res.json({ items: rows });
  } catch {
    return res.json({ items: [] });
  }
});

// ——— Forecast & gap ———
router.get("/forecast", async (_req, res) => {
  try {
    const rows = await db.select().from(salesOpportunitiesTable);
    const mapped = rows.map((r) => ({
      amount: r.amount != null ? Number(r.amount) : null,
      probability: r.probability ?? 10,
      stage: r.stage,
    }));
    return res.json(forecastFromPipeline(mapped));
  } catch {
    return res.json(forecastFromPipeline([]));
  }
});

router.post("/close-the-gap", (req, res) => {
  const body = req.body ?? {};
  res.json(
    closeTheGap({
      target: Number(body.target || 0),
      actual: Number(body.actual || 0),
      avgDealSize: Number(body.avgDealSize || 5000),
      winRatePercent: Number(body.winRatePercent || 20),
    }),
  );
});

// ——— Command center metrics (real counts only) ———
router.get("/command-center", async (_req, res) => {
  try {
    const leads = await db.select().from(salesLeadsTable);
    const opps = await db.select().from(salesOpportunitiesTable);
    const agents = await db.select().from(salesAgentsTable);
    const activities = await db.select().from(salesActivitiesTable).orderBy(desc(salesActivitiesTable.createdAt)).limit(30);
    const won = opps.filter((o) => o.stage === "closed_won");
    const revenueClosed = won.reduce((s, o) => s + (o.amount != null ? Number(o.amount) : 0), 0);
    const openOpps = opps.filter((o) => !["closed_won", "closed_lost"].includes(o.stage));
    const pipeline = openOpps.reduce((s, o) => s + (o.amount != null ? Number(o.amount) : 0), 0);
    const forecast = forecastFromPipeline(
      opps.map((o) => ({ amount: o.amount != null ? Number(o.amount) : null, probability: o.probability ?? 10, stage: o.stage })),
    );
    return res.json({
      leadsTotal: leads.length,
      leadsHighIntent: leads.filter((l) => (l.priorityScore ?? 0) >= 65).length,
      opportunitiesOpen: openOpps.length,
      pipelineValue: pipeline,
      revenueClosed,
      agentsActive: agents.filter((a) => a.status === "active").length || DEFAULT_AGENTS.length,
      forecast,
      recentActivity: activities,
      note: "All figures from database records only — zero when empty.",
    });
  } catch {
    return res.json({
      leadsTotal: 0,
      leadsHighIntent: 0,
      opportunitiesOpen: 0,
      pipelineValue: 0,
      revenueClosed: 0,
      agentsActive: DEFAULT_AGENTS.length,
      forecast: forecastFromPipeline([]),
      recentActivity: [],
      note: "DB unavailable — zeros returned",
    });
  }
});

// ——— Generate Sales session (real analysis, no fabricated sends) ———
router.post("/generate-sales", async (req, res) => {
  const target = Number(req.body?.target || 0);
  try {
    const leads = await db.select().from(salesLeadsTable);
    const opps = await db.select().from(salesOpportunitiesTable);
    const highIntent = leads.filter((l) => (l.priorityScore ?? 0) >= 65 && !l.optedOut);
    const uncontacted = leads.filter((l) => l.stage === "new_lead" && !l.optedOut);
    const abandoned = opps.filter((o) => ["proposal_sent", "negotiation"].includes(o.stage));
    const actions: Array<{ type: string; leadId?: number; opportunityId?: number; action: string; reason: string }> = [];
    for (const l of highIntent.slice(0, 25)) {
      actions.push({
        type: "lead",
        leadId: l.id,
        action: l.nextAction || "contact_now",
        reason: l.nextActionReason || `Priority ${l.priorityScore}`,
      });
    }
    for (const o of abandoned.slice(0, 10)) {
      actions.push({
        type: "opportunity",
        opportunityId: o.id,
        action: "follow_up_proposal",
        reason: "Late-stage opportunity needs attention",
      });
    }
    await audit("Maya", "generate_sales", {
      reason: `Target ${target}`,
      result: `${actions.length} prioritized actions`,
      dataUsed: { leadsAnalyzed: leads.length, highIntent: highIntent.length },
    });
    return res.json({
      target: target || null,
      leadsAnalyzed: leads.length,
      highIntentProspects: highIntent.length,
      uncontacted: uncontacted.length,
      abandonedOpportunities: abandoned.length,
      prioritizedActions: actions,
      note: "Session prioritizes real records only. Outreach is NOT sent automatically unless a configured channel integration and autonomy level allow it.",
      executedSends: 0,
      meetingsBooked: 0,
      proposalsGenerated: 0,
      pipelineCreated: 0,
      revenueClosed: 0,
    });
  } catch (err: any) {
    return res.json({
      target: target || null,
      leadsAnalyzed: 0,
      highIntentProspects: 0,
      prioritizedActions: [],
      executedSends: 0,
      note: err?.message || "Unable to analyze — no fabricated activity",
    });
  }
});

router.post("/who-to-contact", async (_req, res) => {
  try {
    const leads = await db.select().from(salesLeadsTable).orderBy(desc(salesLeadsTable.priorityScore)).limit(50);
    const list = leads
      .filter((l) => !l.optedOut)
      .map((l) => ({
        id: l.id,
        companyName: l.companyName,
        contactName: l.contactName,
        priorityScore: l.priorityScore,
        qualityLabel: l.qualityLabel,
        nextAction: l.nextAction,
        consentEmail: l.consentEmail,
        canContact: l.consentEmail && !l.optedOut,
      }));
    return res.json({ items: list, note: "Contact only where consent and channel integration allow." });
  } catch {
    return res.json({ items: [] });
  }
});

router.get("/activities", async (req, res) => {
  const leadId = req.query.leadId ? Number(req.query.leadId) : null;
  try {
    let rows = await db.select().from(salesActivitiesTable).orderBy(desc(salesActivitiesTable.createdAt)).limit(100);
    if (leadId) rows = rows.filter((r) => r.leadId === leadId);
    return res.json({ items: rows });
  } catch {
    return res.json({ items: [] });
  }
});

router.get("/audit", async (_req, res) => {
  try {
    const rows = await db.select().from(salesAuditLogsTable).orderBy(desc(salesAuditLogsTable.createdAt)).limit(100);
    return res.json({ items: rows });
  } catch {
    return res.json({ items: [] });
  }
});

router.get("/follow-up-sequence", (_req, res) => {
  res.json({ items: FOLLOW_UP_SEQUENCE, note: "Stop sequence immediately on any prospect reply." });
});

router.get("/knowledge", async (_req, res) => {
  try {
    const rows = await db.select().from(salesKnowledgeTable).orderBy(desc(salesKnowledgeTable.updatedAt));
    return res.json({ items: rows });
  } catch {
    return res.json({ items: [] });
  }
});

router.post("/knowledge", async (req, res) => {
  const body = req.body ?? {};
  if (!body.title) return res.status(400).json({ error: "title required" });
  try {
    const [row] = await db.insert(salesKnowledgeTable).values({
      title: body.title,
      category: body.category || "general",
      content: body.content || null,
      sourceUrl: body.sourceUrl || null,
    } as any).returning();
    return res.status(201).json(row);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

export default router;
