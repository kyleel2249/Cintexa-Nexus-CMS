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
  salesPlaybooksTable,
  salesQuotesTable,
  salesAgentMemoryTable,
  salesSettingsTable,
  salesMeetingsTable,
  buyingSignalsTable,
  salesForecastsTable,
  salesAlertsTable,
  salesExperimentsTable,
  salesAttributionTable,
  salesSequencesTable,
} from "@workspace/db";
import { desc, eq, and, gte, isNull, sql } from "drizzle-orm";
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
  mapDiagnosticToSales,
  evaluatePlaybook,
  defaultEnterprisePlaybook,
} from "../services/sales-force-engine";
import { buildOutreachCopy, sendSalesEmail, evaluateOutreachPermission } from "../services/sales-outreach";
import {
  planSequenceActions,
  scoreAgentPerformance,
  findReactivationCandidates,
  suggestUpsells,
  simpleAttribution,
  parseSalesCommand,
  DEFAULT_SALES_SETTINGS,
  trainingCoverage,
} from "../services/sales-force-ops";

import {
  qualifyBant,
  detectBuyingIntent,
  negotiate,
  buildHandoffBrief,
  buildQuote,
  analyzeLostDeal,
  dailySalesBrief,
  sequenceStepDue,
  nextBestOffer,
  DEFAULT_NEGOTIATION_POLICY,
} from "../services/sales-force-advanced";


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

/** §20 Buying Intent Detection — persist a signal row per real, observed input. Never fabricates events that weren't reported. */
async function recordBuyingSignals(leadId: number | null, opportunityId: number | null, input: Record<string, any>) {
  const rows: Array<{ signalType: string; weight: number; detail: string }> = [];
  const pricingViews = Number(input.pricingPageViews || 0);
  const proposalViews = Number(input.proposalViews || 0);
  if (pricingViews > 0) rows.push({ signalType: "pricing_page_view", weight: Math.min(25, pricingViews * 12), detail: `${pricingViews} pricing page view(s)` });
  if (proposalViews > 0) rows.push({ signalType: "proposal_view", weight: Math.min(20, proposalViews * 15), detail: `${proposalViews} proposal view(s)` });
  if (input.requestedDemo) rows.push({ signalType: "demo_request", weight: 30, detail: "Demo requested" });
  if (input.replied) rows.push({ signalType: "reply", weight: 15, detail: "Prospect replied" });
  if (input.quoteRequested) rows.push({ signalType: "quote_request", weight: 20, detail: "Quote requested" });
  if (input.meetingRequested) rows.push({ signalType: "meeting_request", weight: 20, detail: "Meeting requested" });
  if (input.competitorMentioned) rows.push({ signalType: "competitor_mention", weight: 10, detail: String(input.competitorMentioned) });
  if (!rows.length) return;
  try {
    await db.insert(buyingSignalsTable).values(
      rows.map((r) => ({ leadId, opportunityId, signalType: r.signalType, weight: r.weight, detail: r.detail, source: "system", evidence: "CALCULATED" })),
    );
  } catch {
    /* soft */
  }
}

/** §38 Revenue Attribution — recorded at the moment a deal closes won, using only fields that genuinely exist. campaignId stays null since no campaign↔lead linkage exists in the data model yet — not fabricated. */
async function recordAttribution(opp: { id: number; leadId: number | null; amount: string | number | null; assignedAgentId: number | null }) {
  try {
    let leadSource: string | null = null;
    if (opp.leadId) {
      const [lead] = await db.select().from(salesLeadsTable).where(eq(salesLeadsTable.id, opp.leadId)).limit(1);
      leadSource = lead?.source ?? null;
    }
    await db.insert(salesAttributionTable).values({
      opportunityId: opp.id,
      revenueAmount: String(opp.amount ?? 0),
      agentId: opp.assignedAgentId ?? null,
      campaignId: null,
      leadSource,
      channel: null,
      touchType: "last_touch",
      weight: "1",
    } as any);
  } catch {
    /* soft */
  }
}

/** §33/§41 — generate alerts from real DB state only. Idempotent: skips creating a duplicate if an open alert for the same type+entity already exists. */
async function generateAlerts() {
  const existingOpen = await db.select({ type: salesAlertsTable.type, entityType: salesAlertsTable.entityType, entityId: salesAlertsTable.entityId })
    .from(salesAlertsTable).where(eq(salesAlertsTable.status, "open"));
  const exists = (type: string, entityType: string, entityId: number) =>
    existingOpen.some((a) => a.type === type && a.entityType === entityType && a.entityId === entityId);
  const toInsert: Array<typeof salesAlertsTable.$inferInsert> = [];

  const opps = await db.select().from(salesOpportunitiesTable).where(sql`stage NOT IN ('closed_won','closed_lost')`);
  for (const o of opps) {
    const daysSinceActivity = o.updatedAt ? Math.floor((Date.now() - new Date(o.updatedAt).getTime()) / 86400000) : 0;
    const risk = dealRisk({ stage: o.stage, daysSinceActivity, hasDecisionMaker: true, amount: o.amount != null ? Number(o.amount) : null });
    if (risk.riskScore >= 50 && !exists("deal_at_risk", "opportunity", o.id)) {
      toInsert.push({
        type: "deal_at_risk", severity: risk.riskScore >= 70 ? "critical" : "warning",
        title: `${o.name} at risk (score ${risk.riskScore})`, detail: risk.reasons.join("; "),
        entityType: "opportunity", entityId: o.id, evidence: "CALCULATED",
      } as any);
    }
  }

  const leads = await db.select().from(salesLeadsTable).where(eq(salesLeadsTable.optedOut, false));
  for (const l of leads) {
    if ((l.priorityScore ?? 0) >= 80 && !l.lastContactAt && !exists("high_value_lead", "lead", l.id)) {
      toInsert.push({
        type: "high_value_lead", severity: "opportunity",
        title: `${l.companyName} — high-priority lead not yet contacted`, detail: `Priority score ${l.priorityScore}`,
        entityType: "lead", entityId: l.id, evidence: "CALCULATED",
      } as any);
    }
    if ((l.intentScore ?? 0) >= 70 && !exists("high_intent", "lead", l.id)) {
      toInsert.push({
        type: "high_intent", severity: "opportunity",
        title: `${l.companyName} showing strong buying intent`, detail: `Intent score ${l.intentScore}`,
        entityType: "lead", entityId: l.id, evidence: "CALCULATED",
      } as any);
    }
  }

  const recentSignals = await db.select().from(buyingSignalsTable)
    .where(and(eq(buyingSignalsTable.signalType, "quote_request"), gte(buyingSignalsTable.detectedAt, new Date(Date.now() - 86400000))));
  for (const s of recentSignals) {
    if (s.leadId && !exists("price_requested", "lead", s.leadId)) {
      toInsert.push({
        type: "price_requested", severity: "attention", title: "Prospect requested pricing", detail: s.detail || undefined,
        entityType: "lead", entityId: s.leadId, evidence: s.evidence,
      } as any);
    }
  }

  if (toInsert.length) await db.insert(salesAlertsTable).values(toInsert);
  return toInsert.length;
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
    await recordBuyingSignals(id, null, body);
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
    if (stage === "closed_won") await recordAttribution(row);
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


// ——— Email outreach (consent + autonomy + SMTP) ———
router.post("/outreach/email", async (req, res) => {
  const body = req.body ?? {};
  const leadId = body.leadId != null ? Number(body.leadId) : null;
  let lead: any = null;
  try {
    if (leadId) {
      const rows = await db.select().from(salesLeadsTable).where(eq(salesLeadsTable.id, leadId)).limit(1);
      lead = rows[0];
    }
  } catch { /* soft */ }

  const contactEmail = body.to || lead?.contactEmail;
  const companyName = body.companyName || lead?.companyName || "Prospect";
  const consentEmail = body.consentEmail ?? lead?.consentEmail ?? false;
  const optedOut = body.optedOut ?? lead?.optedOut ?? false;
  const autonomy = body.autonomyLevel != null ? Number(body.autonomyLevel) : 1;
  const forceSend = Boolean(body.forceSend); // still requires consent; only bypasses autonomy if admin force

  const perm = evaluateOutreachPermission({
    optedOut,
    consentEmail,
    contactEmail,
    agentAutonomyLevel: forceSend ? 3 : autonomy,
    agentCanOutreach: body.canOutreach !== false,
  });

  const copy = buildOutreachCopy({
    companyName,
    contactName: body.contactName || lead?.contactName,
    industry: body.industry || lead?.industry,
    theme: body.theme || "intro",
    agentName: body.agentName || "Ryan",
  });

  if (!perm.allowed) {
    await logActivity({
      leadId,
      actorName: body.agentName || "Ryan",
      action: "outreach_blocked",
      summary: perm.reason,
      detail: { copy, channel: "email" },
      confidence: "high",
    });
    await audit(body.agentName || "Ryan", "outreach_blocked", { entityType: "lead", entityId: leadId, reason: perm.reason, result: "blocked" });
    return res.status(200).json({
      status: "blocked",
      reason: perm.reason,
      preparedMessage: copy,
      sent: false,
    });
  }

  const result = await sendSalesEmail({
    to: String(contactEmail),
    subject: body.subject || copy.subject,
    body: body.body || copy.body,
    leadId: leadId ?? undefined,
  });

  await logActivity({
    leadId,
    actorName: body.agentName || "Ryan",
    action: result.status === "sent" ? "email_sent" : `email_${result.status}`,
    summary: result.reason,
    detail: { result, subject: copy.subject },
    confidence: "high",
  });
  await audit(body.agentName || "Ryan", "outreach_email", {
    entityType: "lead",
    entityId: leadId,
    result: result.status,
    reason: result.reason,
  });

  if (result.status === "sent" && leadId) {
    try {
      await db.update(salesLeadsTable).set({
        stage: lead?.stage === "new_lead" ? "contacted" : lead?.stage,
        lastContactAt: new Date(),
        updatedAt: new Date(),
      } as any).where(eq(salesLeadsTable.id, leadId));
    } catch { /* soft */ }
  }

  return res.json({
    ...result,
    preparedMessage: copy,
    sent: result.status === "sent",
  });
});

router.post("/outreach/prepare", (req, res) => {
  const body = req.body ?? {};
  const copy = buildOutreachCopy({
    companyName: body.companyName || "Prospect",
    contactName: body.contactName,
    industry: body.industry,
    theme: body.theme || "intro",
    agentName: body.agentName || "Ryan",
  });
  res.json({ ...copy, note: "Prepared only — not sent." });
});

// ——— Diagnostic → sales map ———
router.post("/from-diagnostic", async (req, res) => {
  const body = req.body ?? {};
  const companyName = String(body.companyName || "").trim();
  if (!companyName) return res.status(400).json({ error: "companyName required" });

  const mapped = mapDiagnosticToSales({
    companyName,
    industry: body.industry,
    health: body.health != null ? Number(body.health) : null,
    weakestPillar: body.weakestPillar,
    pillarScores: body.pillarScores || {},
    objective: body.objective,
  });

  let lead: any = null;
  let opportunity: any = null;
  const createRecords = body.createRecords !== false;

  if (createRecords) {
    try {
      const scores = scoreLead({
        industry: body.industry,
        website: body.website,
        hasEmail: Boolean(body.contactEmail),
        estimatedValue: body.estimatedValue != null ? Number(body.estimatedValue) : null,
      });
      const [leadRow] = await db.insert(salesLeadsTable).values({
        companyName,
        contactName: body.contactName || null,
        contactEmail: body.contactEmail || null,
        website: body.website || null,
        industry: body.industry || null,
        source: "business_diagnostic",
        stage: "qualified",
        fitScore: scores.fitScore,
        engagementScore: scores.engagementScore,
        intentScore: Math.max(scores.intentScore, 50),
        valueScore: scores.valueScore,
        timingScore: scores.timingScore,
        priorityScore: Math.max(scores.priorityScore, 55),
        qualityLabel: scores.qualityLabel,
        consentEmail: Boolean(body.consentEmail),
        notes: `Imported from Business Diagnostic. Weakest: ${body.weakestPillar || "n/a"}. Health: ${body.health ?? "n/a"}`,
        metadata: { diagnostic: true, recommendations: mapped.recommendations },
        nextAction: "schedule_discovery",
        nextActionReason: mapped.nextStep,
      } as any).returning();
      lead = leadRow;

      const top = mapped.recommendations[0];
      const [oppRow] = await db.insert(salesOpportunitiesTable).values({
        leadId: leadRow.id,
        name: mapped.suggestedOpportunityName,
        companyName,
        stage: "qualified",
        amount: body.estimatedValue != null ? String(body.estimatedValue) : null,
        probability: 30,
        products: top ? [top.product] : [],
        context: { fromDiagnostic: true, map: mapped },
      } as any).returning();
      opportunity = oppRow;

      await logActivity({
        leadId: leadRow.id,
        opportunityId: oppRow.id,
        actorName: "Maya",
        action: "diagnostic_import",
        summary: `Diagnostic mapped to ${mapped.recommendations.length} product recommendation(s)`,
        detail: mapped,
      });
    } catch (err: any) {
      return res.json({ mapped, lead, opportunity, persisted: false, note: err?.message });
    }
  }

  return res.status(201).json({ mapped, lead, opportunity, persisted: Boolean(lead) });
});

// ——— Playbooks ———
router.get("/playbooks", async (_req, res) => {
  try {
    const rows = await db.select().from(salesPlaybooksTable).orderBy(desc(salesPlaybooksTable.updatedAt));
    if (!rows.length) {
      return res.json({
        items: [{ id: 0, name: "Default enterprise routing", rules: defaultEnterprisePlaybook(), active: true, source: "catalog" }],
      });
    }
    return res.json({ items: rows });
  } catch {
    return res.json({ items: [{ id: 0, name: "Default enterprise routing", rules: defaultEnterprisePlaybook(), active: true, source: "catalog" }] });
  }
});

router.post("/playbooks", async (req, res) => {
  const body = req.body ?? {};
  if (!body.name) return res.status(400).json({ error: "name required" });
  try {
    const [row] = await db.insert(salesPlaybooksTable).values({
      name: body.name,
      description: body.description || null,
      rules: body.rules || defaultEnterprisePlaybook(),
      active: body.active !== false,
    } as any).returning();
    return res.status(201).json(row);
  } catch (err: any) {
    return res.status(201).json({ id: null, name: body.name, rules: body.rules || defaultEnterprisePlaybook(), persisted: false, note: err?.message });
  }
});

router.post("/playbooks/evaluate", (req, res) => {
  const rules = (req.body?.rules as any[]) || defaultEnterprisePlaybook();
  const context = req.body?.context || {};
  const matched = evaluatePlaybook(rules, context);
  res.json({ matched, actions: matched.flatMap((m) => m.actions) });
});

// ——— Who should I sell (from inventory of leads/opps) ———
router.get("/what-to-sell", async (_req, res) => {
  try {
    const leads = await db.select().from(salesLeadsTable).orderBy(desc(salesLeadsTable.priorityScore)).limit(20);
    const items = leads.filter((l) => !l.optedOut).slice(0, 8).map((l) => ({
      product: "CINTEXA solution (confirm in discovery)",
      audience: l.companyName,
      reason: l.nextActionReason || `Priority ${l.priorityScore} · ${l.qualityLabel}`,
      estimatedOpportunity: null,
      recommendedPitch: l.researchBrief ? (l.researchBrief as any).suggestedOpening : null,
      recommendedAgentRole: (l.priorityScore ?? 0) >= 80 ? "ae" : "sdr",
      recommendedChannel: l.consentEmail ? "email" : "none — obtain consent",
      recommendedAction: l.nextAction,
      confidence: (l.priorityScore ?? 0) >= 70 ? "medium" : "low",
      leadId: l.id,
    }));
    return res.json({
      items,
      note: "Recommendations ranked from real lead scores only. Product fit must be confirmed in discovery — not invented.",
    });
  } catch {
    return res.json({ items: [], note: "No data" });
  }
});



// ——— Qualification BANT ———
router.post("/qualify/bant", (req, res) => {
  res.json(qualifyBant(req.body ?? {}));
});

router.post("/intent", (req, res) => {
  res.json(detectBuyingIntent(req.body ?? {}));
});

router.post("/negotiate", (req, res) => {
  const result = negotiate(req.body ?? {});
  res.json(result);
});

router.get("/negotiation-policy", (_req, res) => {
  res.json({ policy: DEFAULT_NEGOTIATION_POLICY, note: "Override per agent permissions in production admin." });
});

router.post("/handoff", (req, res) => {
  res.json(buildHandoffBrief(req.body ?? {}));
});

router.post("/quotes", async (req, res) => {
  const body = req.body ?? {};
  const lineItems = Array.isArray(body.lineItems) ? body.lineItems : [];
  if (!lineItems.length) return res.status(400).json({ error: "lineItems required" });
  const quote = buildQuote({
    lineItems: lineItems.map((i: any) => ({
      name: String(i.name || "Item"),
      quantity: Number(i.quantity || 1),
      unitPrice: Number(i.unitPrice || 0),
    })),
    discountPercent: body.discountPercent != null ? Number(body.discountPercent) : 0,
    taxPercent: body.taxPercent != null ? Number(body.taxPercent) : 0,
    currency: body.currency || "GHS",
    maxDiscountPercent: body.maxDiscountPercent != null ? Number(body.maxDiscountPercent) : 10,
  });
  try {
    const [row] = await db.insert(salesQuotesTable).values({
      opportunityId: body.opportunityId != null ? Number(body.opportunityId) : null,
      leadId: body.leadId != null ? Number(body.leadId) : null,
      lineItems: quote.lineItems,
      subtotal: String(quote.subtotal),
      discount: String(quote.discount),
      tax: String(quote.tax),
      total: String(quote.total),
      currency: quote.currency,
      status: "draft",
      createdByAgentId: body.agentId != null ? Number(body.agentId) : null,
    } as any).returning();
    await logActivity({
      leadId: body.leadId,
      opportunityId: body.opportunityId,
      actorName: "Max",
      action: "quote_created",
      summary: `Quote total ${quote.currency} ${quote.total}`,
      detail: quote,
    });
    await recordBuyingSignals(body.leadId ?? null, body.opportunityId ?? null, { quoteRequested: true });
    return res.status(201).json({ ...row, calculated: quote });
  } catch (err: any) {
    return res.status(201).json({ ...quote, persisted: false, note: err?.message });
  }
});

router.post("/opportunities/:id/lost", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body ?? {};
  const analysis = analyzeLostDeal({
    lostReason: body.lostReason,
    competitor: body.competitor,
    stage: body.stage,
    amount: body.amount != null ? Number(body.amount) : null,
  });
  try {
    const [row] = await db.update(salesOpportunitiesTable).set({
      stage: "closed_lost",
      lostAt: new Date(),
      lostReason: body.lostReason || null,
      updatedAt: new Date(),
      context: { lostAnalysis: analysis },
    } as any).where(eq(salesOpportunitiesTable.id, id)).returning();
    if (!row) return res.status(404).json({ error: "not found", analysis });
    await logActivity({ opportunityId: id, actorName: "Zoe", action: "lost_deal_analysis", summary: analysis.categories.join(", "), detail: analysis });
    return res.json({ opportunity: row, analysis });
  } catch (err: any) {
    return res.json({ analysis, persisted: false, note: err?.message });
  }
});

router.get("/daily-brief", async (req, res) => {
  const target = req.query.target != null ? Number(req.query.target) : null;
  try {
    const leads = await db.select().from(salesLeadsTable);
    const opps = await db.select().from(salesOpportunitiesTable);
    const won = opps.filter((o) => o.stage === "closed_won");
    const open = opps.filter((o) => !["closed_won", "closed_lost"].includes(o.stage));
    const revenueClosed = won.reduce((s, o) => s + (o.amount != null ? Number(o.amount) : 0), 0);
    const pipelineValue = open.reduce((s, o) => s + (o.amount != null ? Number(o.amount) : 0), 0);
    const brief = dailySalesBrief({
      target,
      revenueClosed,
      pipelineValue,
      leadsTotal: leads.length,
      highIntent: leads.filter((l) => (l.priorityScore ?? 0) >= 65).length,
      uncontacted: leads.filter((l) => l.stage === "new_lead" && !l.optedOut).length,
      openOpps: open.length,
      atRisk: open
        .filter((o) => (o.riskScore ?? 0) >= 50)
        .map((o) => ({ name: o.name, riskScore: o.riskScore ?? undefined })),
      topOpps: open
        .slice()
        .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
        .slice(0, 10)
        .map((o) => ({ name: o.name, amount: o.amount != null ? Number(o.amount) : null })),
    });
    return res.json(brief);
  } catch {
    return res.json(dailySalesBrief({ target }));
  }
});

router.post("/sequence/check", (req, res) => {
  res.json(sequenceStepDue(req.body ?? {}));
});

router.post("/next-offer", (req, res) => {
  res.json(nextBestOffer(req.body ?? {}));
});

// ——— Campaigns ———
router.get("/campaigns", async (_req, res) => {
  try {
    const rows = await db.select().from(salesCampaignsTable).orderBy(desc(salesCampaignsTable.updatedAt));
    return res.json({ items: rows });
  } catch {
    return res.json({ items: [] });
  }
});

router.post("/campaigns", async (req, res) => {
  const body = req.body ?? {};
  if (!body.name) return res.status(400).json({ error: "name required" });
  try {
    const [row] = await db.insert(salesCampaignsTable).values({
      name: body.name,
      objective: body.objective || null,
      status: body.status || "draft",
      audience: body.audience || {},
      channels: body.channels || ["email"],
      sequence: body.sequence || [],
      product: body.product || null,
      offer: body.offer || null,
      startDate: body.startDate || null,
      endDate: body.endDate || null,
    } as any).returning();
    await audit("Maya", "campaign_created", { entityType: "campaign", entityId: row.id, result: row.name });
    return res.status(201).json(row);
  } catch (err: any) {
    return res.status(201).json({ id: null, ...body, persisted: false, note: err?.message });
  }
});

// ——— Create custom agent ———
router.post("/agents", async (req, res) => {
  const body = req.body ?? {};
  if (!body.name || !body.role) return res.status(400).json({ error: "name and role required" });
  const slug = String(body.slug || body.name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  try {
    const [row] = await db.insert(salesAgentsTable).values({
      name: body.name,
      slug,
      role: body.role,
      personality: body.personality || null,
      specialization: body.specialization || null,
      status: "active",
      autonomyLevel: body.autonomyLevel != null ? Number(body.autonomyLevel) : 1,
      territory: body.territory || null,
      products: body.products || [],
      permissions: body.permissions || {},
      targets: body.targets || {},
      isSystem: false,
      config: body.config || {},
    } as any).returning();
    await audit("system", "agent_created", { entityType: "agent", entityId: row.id, result: row.name });
    return res.status(201).json(row);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

// ——— Agent memory ———
router.get("/memory", async (req, res) => {
  const leadId = req.query.leadId ? Number(req.query.leadId) : null;
  const agentId = req.query.agentId ? Number(req.query.agentId) : null;
  try {
    let rows = await db.select().from(salesAgentMemoryTable).orderBy(desc(salesAgentMemoryTable.createdAt)).limit(100);
    if (leadId) rows = rows.filter((r) => r.leadId === leadId);
    if (agentId) rows = rows.filter((r) => r.agentId === agentId);
    return res.json({ items: rows });
  } catch {
    return res.json({ items: [] });
  }
});

router.post("/memory", async (req, res) => {
  const body = req.body ?? {};
  if (!body.agentId || !body.category || !body.content) {
    return res.status(400).json({ error: "agentId, category, content required" });
  }
  try {
    const [row] = await db.insert(salesAgentMemoryTable).values({
      agentId: Number(body.agentId),
      leadId: body.leadId != null ? Number(body.leadId) : null,
      opportunityId: body.opportunityId != null ? Number(body.opportunityId) : null,
      category: body.category,
      content: body.content,
    } as any).returning();
    return res.status(201).json(row);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

// ——— Demo seed (clearly marked) ———
router.post("/demo/seed", async (_req, res) => {
  try {
    await db.insert(salesLeadsTable).values({
      companyName: "Demo Retail Co",
      contactName: "Ama Mensah",
      contactEmail: "demo@example.com",
      industry: "Retail",
      companySize: "50-200",
      source: "demo",
      stage: "new_lead",
      priorityScore: 62,
      qualityLabel: "mql",
      consentEmail: true,
      isDemo: true,
      notes: "DEMO DATA — not a real customer",
      nextAction: "research_then_score",
      nextActionReason: "Demo seed",
    } as any);
    await db.insert(salesOpportunitiesTable).values({
      name: "Demo Retail Co — CRM evaluation",
      companyName: "Demo Retail Co",
      stage: "discovery",
      amount: "15000",
      currency: "GHS",
      probability: 40,
      riskScore: 35,
      isDemo: true,
      notes: "DEMO DATA",
    } as any);
    return res.status(201).json({ ok: true, note: "Demo lead and opportunity created (isDemo=true)" });
  } catch (err: any) {
    return res.status(201).json({
      ok: true,
      persisted: false,
      note: err?.message || "DB unavailable",
      demo: {
        companyName: "Demo Retail Co",
        isDemo: true,
      },
    });
  }
});



// ——— Sequence planner (prepare only unless execute+SMTP) ———
router.get("/sequences/due", async (_req, res) => {
  try {
    const leads = await db.select().from(salesLeadsTable);
    const plan = planSequenceActions(leads as any);
    return res.json(plan);
  } catch {
    return res.json({ planned: [], note: "No leads available" });
  }
});

router.post("/sequences/run", async (req, res) => {
  const execute = Boolean(req.body?.execute);
  const autonomyLevel = req.body?.autonomyLevel != null ? Number(req.body.autonomyLevel) : 1;
  try {
    const leads = await db.select().from(salesLeadsTable);
    const plan = planSequenceActions(leads as any);
    const results: any[] = [];
    for (const step of plan.planned.slice(0, 20)) {
      const lead = leads.find((l) => l.id === step.leadId);
      if (!lead) continue;
      if (!execute || autonomyLevel < 3) {
        results.push({ ...step, status: "prepared" });
        await logActivity({
          leadId: step.leadId,
          actorName: "Ryan",
          action: "sequence_prepared",
          summary: `${step.label} (day ${step.sequenceDay})`,
          detail: step,
        });
        continue;
      }
      // attempt send with full guardrails
      const permOk = lead.consentEmail && !lead.optedOut && lead.contactEmail;
      if (!permOk) {
        results.push({ leadId: step.leadId, status: "blocked", reason: "consent/email" });
        continue;
      }
      const send = await sendSalesEmail({
        to: String(lead.contactEmail),
        subject: step.prepared?.subject || "Follow-up",
        body: step.prepared?.body || "",
        leadId: lead.id,
      });
      results.push({ leadId: step.leadId, status: send.status, reason: send.reason });
      await logActivity({
        leadId: lead.id,
        actorName: "Ryan",
        action: send.status === "sent" ? "sequence_email_sent" : `sequence_${send.status}`,
        summary: send.reason,
      });
      if (send.status === "sent") {
        await db.update(salesLeadsTable).set({ lastContactAt: new Date(), stage: lead.stage === "new_lead" ? "contacted" : lead.stage, updatedAt: new Date() } as any).where(eq(salesLeadsTable.id, lead.id));
      }
    }
    return res.json({
      execute,
      autonomyLevel,
      processed: results.length,
      results,
      note: execute
        ? "Execute attempted under consent + SMTP rules."
        : "Prepared only. Pass execute:true and autonomyLevel≥3 to send where configured.",
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

router.get("/performance", async (_req, res) => {
  try {
    const agents = await db.select().from(salesAgentsTable);
    const activities = await db.select().from(salesActivitiesTable);
    const opps = await db.select().from(salesOpportunitiesTable);
    const items = (agents.length ? agents : []).map((a) =>
      scoreAgentPerformance({
        agentId: a.id,
        agentName: a.name,
        activities: activities as any,
        opportunities: opps as any,
      }),
    );
    return res.json({ items, note: "From recorded data only." });
  } catch {
    return res.json({ items: [] });
  }
});

router.get("/reactivation", async (_req, res) => {
  try {
    const leads = await db.select().from(salesLeadsTable);
    const opps = await db.select().from(salesOpportunitiesTable);
    return res.json(findReactivationCandidates(leads as any, opps as any));
  } catch {
    return res.json({ dormantLeads: [], lostOpportunities: [], abandonedProposals: [] });
  }
});

router.post("/upsell", (req, res) => {
  res.json(suggestUpsells(req.body ?? {}));
});

router.get("/attribution", async (_req, res) => {
  try {
    const opps = await db.select().from(salesOpportunitiesTable);
    const activities = await db.select().from(salesActivitiesTable);
    const live = simpleAttribution(opps as any, activities as any);

    // §38 — persisted, auditable attribution records (survive later edits to the opportunity itself).
    const rows = await db.select().from(salesAttributionTable).orderBy(desc(salesAttributionTable.createdAt)).limit(500);
    const byAgent: Record<string, number> = {};
    const byLeadSource: Record<string, number> = {};
    let totalAttributedRevenue = 0;
    for (const r of rows) {
      const amt = Number(r.revenueAmount || 0);
      totalAttributedRevenue += amt;
      const agentKey = r.agentId != null ? String(r.agentId) : "unassigned";
      byAgent[agentKey] = (byAgent[agentKey] || 0) + amt;
      const sourceKey = r.leadSource || "unknown";
      byLeadSource[sourceKey] = (byLeadSource[sourceKey] || 0) + amt;
    }

    return res.json({ ...live, items: rows, totalAttributedRevenue, byAgent, byLeadSource });
  } catch {
    return res.json(simpleAttribution([], []));
  }
});

router.post("/command", async (req, res) => {
  const command = String(req.body?.command || "");
  try {
    const leads = await db.select().from(salesLeadsTable);
    const opps = await db.select().from(salesOpportunitiesTable);
    const parsed = parseSalesCommand(command, { leads: leads as any, opps: opps as any });
    await audit("Alex", "command", { reason: command, result: parsed.intent });
    return res.json(parsed);
  } catch (err: any) {
    return res.json({ intent: "error", result: null, message: err?.message || "Command failed" });
  }
});



// ——— Admin settings ———
router.get("/settings", async (_req, res) => {
  try {
    const rows = await db.select().from(salesSettingsTable);
    const map: Record<string, unknown> = { ...DEFAULT_SALES_SETTINGS };
    for (const r of rows) {
      map[r.key] = r.value;
    }
    // flatten if stored as single blob
    const global = rows.find((r) => r.key === "global");
    if (global && typeof global.value === "object") Object.assign(map, global.value);
    return res.json({ settings: map, source: rows.length ? "db" : "defaults" });
  } catch {
    return res.json({ settings: DEFAULT_SALES_SETTINGS, source: "defaults" });
  }
});

router.put("/settings", async (req, res) => {
  const body = req.body ?? {};
  const settings = { ...DEFAULT_SALES_SETTINGS, ...body };
  try {
    const existing = await db.select().from(salesSettingsTable).where(eq(salesSettingsTable.key, "global")).limit(1);
    if (existing[0]) {
      await db.update(salesSettingsTable).set({ value: settings, updatedAt: new Date() } as any).where(eq(salesSettingsTable.key, "global"));
    } else {
      await db.insert(salesSettingsTable).values({ key: "global", value: settings } as any);
    }
    await audit("system", "settings_updated", { dataUsed: settings, result: "ok" });
    return res.json({ settings, persisted: true });
  } catch (err: any) {
    return res.json({ settings, persisted: false, note: err?.message });
  }
});

// ——— Meetings ———
router.get("/meetings", async (_req, res) => {
  try {
    const rows = await db.select().from(salesMeetingsTable).orderBy(desc(salesMeetingsTable.createdAt)).limit(100);
    return res.json({ items: rows });
  } catch {
    return res.json({ items: [] });
  }
});

router.post("/meetings", async (req, res) => {
  const body = req.body ?? {};
  const title = String(body.title || "").trim();
  if (!title) return res.status(400).json({ error: "title required" });
  try {
    const [row] = await db.insert(salesMeetingsTable).values({
      leadId: body.leadId != null ? Number(body.leadId) : null,
      opportunityId: body.opportunityId != null ? Number(body.opportunityId) : null,
      title,
      scheduledAt: body.scheduledAt || null,
      durationMinutes: body.durationMinutes != null ? Number(body.durationMinutes) : 30,
      status: body.status || "scheduled",
      attendees: body.attendees || [],
      notes: body.notes || null,
      createdByAgentId: body.agentId != null ? Number(body.agentId) : null,
      calendarSynced: false,
      isDemo: Boolean(body.isDemo),
    } as any).returning();
    await logActivity({
      leadId: body.leadId,
      opportunityId: body.opportunityId,
      actorName: body.agentName || "Ryan",
      action: "meeting_booked",
      summary: title,
      detail: { scheduledAt: body.scheduledAt, calendarSynced: false },
    });
    return res.status(201).json({
      ...row,
      note: "Meeting recorded in CRM. Calendar sync requires a configured calendar integration.",
    });
  } catch (err: any) {
    return res.status(201).json({
      id: null,
      title,
      scheduledAt: body.scheduledAt || null,
      calendarSynced: false,
      persisted: false,
      note: err?.message || "DB unavailable",
    });
  }
});

// ——— Training coverage ———
router.get("/training", async (_req, res) => {
  try {
    const knowledge = await db.select().from(salesKnowledgeTable);
    const memory = await db.select().from(salesAgentMemoryTable);
    const playbooks = await db.select().from(salesPlaybooksTable);
    const coverage = trainingCoverage({
      knowledgeCount: knowledge.length,
      memoryCount: memory.length,
      playbookCount: playbooks.length,
    });
    return res.json({
      ...coverage,
      knowledgeItems: knowledge.slice(0, 50),
      playbookCount: playbooks.length,
      memoryCount: memory.length,
    });
  } catch {
    return res.json(trainingCoverage({ knowledgeCount: 0, memoryCount: 0, playbookCount: 0 }));
  }
});

router.post("/handoff/create", async (req, res) => {
  const body = req.body ?? {};
  const brief = buildHandoffBrief(body);
  try {
    if (body.leadId) {
      await logActivity({
        leadId: Number(body.leadId),
        opportunityId: body.opportunityId != null ? Number(body.opportunityId) : null,
        actorName: "Maya",
        action: "human_handoff",
        summary: brief.title,
        detail: brief,
        confidence: "high",
      });
      await audit("Maya", "handoff", { entityType: "lead", entityId: body.leadId, result: "escalated" });
    }
    return res.json({ brief, escalated: true });
  } catch {
    return res.json({ brief, escalated: true, persisted: false });
  }
});


// ——— §41/§33 Alerts (generated from real DB state, deduped) ———
router.get("/alerts", async (_req, res) => {
  try {
    await generateAlerts();
    const rows = await db.select().from(salesAlertsTable).where(eq(salesAlertsTable.status, "open")).orderBy(desc(salesAlertsTable.createdAt)).limit(100);
    return res.json({ items: rows });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

router.patch("/alerts/:id", async (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || "acknowledged");
  if (!["acknowledged", "dismissed", "open"].includes(status)) return res.status(400).json({ error: "invalid status" });
  try {
    const [row] = await db.update(salesAlertsTable)
      .set({ status, acknowledgedAt: status === "acknowledged" ? new Date() : null } as any)
      .where(eq(salesAlertsTable.id, id)).returning();
    if (!row) return res.status(404).json({ error: "not found" });
    return res.json(row);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

// ——— §32 Forecast snapshots (history, not just live compute) ———
router.post("/forecast/snapshot", async (req, res) => {
  const periodType = String(req.body?.periodType || "month");
  const period = String(req.body?.period || new Date().toISOString().slice(0, 7));
  try {
    const opps = await db.select().from(salesOpportunitiesTable);
    const mapped = opps.map((o) => ({ amount: o.amount != null ? Number(o.amount) : 0, probability: o.probability, stage: o.stage }));
    const fc = forecastFromPipeline(mapped);
    const [row] = await db.insert(salesForecastsTable).values({
      period, periodType,
      pipelineTotal: String(fc.pipelineTotal), weightedPipeline: String(fc.weightedPipeline),
      bestCase: String(fc.bestCase), expectedCase: String(fc.expectedCase), worstCase: String(fc.worstCase),
      note: fc.note, evidence: fc.evidence,
    } as any).returning();
    return res.status(201).json(row);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

router.get("/forecast/history", async (req, res) => {
  const periodType = req.query.periodType ? String(req.query.periodType) : null;
  try {
    const rows = periodType
      ? await db.select().from(salesForecastsTable).where(eq(salesForecastsTable.periodType, periodType)).orderBy(desc(salesForecastsTable.createdAt)).limit(24)
      : await db.select().from(salesForecastsTable).orderBy(desc(salesForecastsTable.createdAt)).limit(24);
    return res.json({ items: rows });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

// ——— §36/§37 Experiments (A/B testing) ———
router.get("/experiments", async (_req, res) => {
  try {
    const rows = await db.select().from(salesExperimentsTable).orderBy(desc(salesExperimentsTable.createdAt));
    return res.json({ items: rows });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

router.post("/experiments", async (req, res) => {
  const body = req.body ?? {};
  if (!body.name || !body.hypothesis || !body.variable || !body.successMetric) {
    return res.status(400).json({ error: "name, hypothesis, variable and successMetric are required" });
  }
  try {
    const [row] = await db.insert(salesExperimentsTable).values({
      name: body.name, hypothesis: body.hypothesis, audience: body.audience || null,
      variable: body.variable, variants: Array.isArray(body.variants) ? body.variants : [],
      successMetric: body.successMetric, sampleSize: body.sampleSize != null ? Number(body.sampleSize) : null,
      createdByAgentId: body.agentId != null ? Number(body.agentId) : null,
    } as any).returning();
    return res.status(201).json(row);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

router.patch("/experiments/:id", async (req, res) => {
  // Records real observed results the user/agent enters — never auto-fabricates outcomes.
  const id = Number(req.params.id);
  const body = req.body ?? {};
  const allowed = ["status", "results", "winningVariant", "recommendation", "endDate"];
  const updates: Record<string, unknown> = {};
  for (const k of allowed) if (body[k] !== undefined) updates[k] = body[k];
  try {
    const [row] = await db.update(salesExperimentsTable).set(updates as any).where(eq(salesExperimentsTable.id, id)).returning();
    if (!row) return res.status(404).json({ error: "not found" });
    return res.json(row);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

// ——— §19 Sequences (first-class enrollment/state) ———
router.get("/sequences", async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  try {
    const rows = status
      ? await db.select().from(salesSequencesTable).where(eq(salesSequencesTable.status, status)).orderBy(desc(salesSequencesTable.startedAt))
      : await db.select().from(salesSequencesTable).orderBy(desc(salesSequencesTable.startedAt));
    return res.json({ items: rows });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

router.post("/sequences/enroll", async (req, res) => {
  const leadId = Number(req.body?.leadId);
  if (!leadId) return res.status(400).json({ error: "leadId required" });
  try {
    const existing = await db.select().from(salesSequencesTable)
      .where(and(eq(salesSequencesTable.leadId, leadId), eq(salesSequencesTable.status, "active"))).limit(1);
    if (existing.length) return res.status(409).json({ error: "lead already has an active sequence", sequence: existing[0] });
    const [row] = await db.insert(salesSequencesTable).values({
      leadId, sequenceName: req.body?.sequenceName || "standard_outbound",
      totalSteps: FOLLOW_UP_SEQUENCE.length,
      nextStepDueAt: new Date(),
      createdByAgentId: req.body?.agentId != null ? Number(req.body.agentId) : null,
    } as any).returning();
    await logActivity({ leadId, actorName: "Ryan", action: "sequence_enrolled", summary: row.sequenceName });
    return res.status(201).json(row);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

router.post("/sequences/:id/stop", async (req, res) => {
  const id = Number(req.params.id);
  const reason = String(req.body?.reason || "manual"); // replied | opted_out | manual | completed
  try {
    const [row] = await db.update(salesSequencesTable)
      .set({ status: reason === "replied" ? "stopped_reply" : reason === "opted_out" ? "stopped_optout" : "paused", stoppedReason: reason, updatedAt: new Date() } as any)
      .where(eq(salesSequencesTable.id, id)).returning();
    if (!row) return res.status(404).json({ error: "not found" });
    return res.json(row);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

// ——— §20 Buying signals (raw log, for drill-down behind lead/opportunity intent scores) ———
router.get("/buying-signals", async (req, res) => {
  const leadId = req.query.leadId ? Number(req.query.leadId) : null;
  try {
    const rows = leadId
      ? await db.select().from(buyingSignalsTable).where(eq(buyingSignalsTable.leadId, leadId)).orderBy(desc(buyingSignalsTable.detectedAt))
      : await db.select().from(buyingSignalsTable).orderBy(desc(buyingSignalsTable.detectedAt)).limit(200);
    return res.json({ items: rows });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

export default router;
