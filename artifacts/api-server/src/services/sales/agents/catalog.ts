/**
 * The 24 agents. Definitions live in code (so tools and permissions can never be edited at runtime by an agent or
 * through the API); only operational settings (status, level, model, schedule, thresholds) are stored per deployment.
 */
import type { AgentDef } from "./types";
import { salesOps, leadEnrichment, leadQualification, contactRelationship, activitiesFollowup } from "./analyzers/ops";
import { accountIntel, opportunityPipeline, targetsQuotas, productPricebook, quotationProposal, salesOrder, forecasting, commissions } from "./analyzers/revenue";
import { performanceCoaching, territoryTeam, retentionExpansion, campaignIntel, competitorIntel, reportingAnalytics, automationWorkflow, playbackTraining, documentIntel, adminGovernance } from "./analyzers/intelligence";

import { ORCHESTRATOR_KEY } from "./keys";
import { orchestratorAnalyze } from "./analyzers/synthesis";
export { ORCHESTRATOR_KEY };

export const AGENTS: AgentDef[] = [
  { key: ORCHESTRATOR_KEY, name: "Chief Sales Intelligence Orchestrator", group: "orchestration", version: "1.0.0", defaultLevel: 2, maxLevel: 2, tier: "reasoning", scheduleMinutes: 60,
    purpose: "Coordinates every other agent: delegates runs in dependency order, de-duplicates and prioritises findings, resolves conflicting proposals, escalates critical risks and builds the executive briefing.",
    tools: ["read:crm", "read:analytics", "propose:action", "write:internal_notification"], reads: ["agent findings", "approvals", "events"], thresholds: { criticalNotifyLimit: 5 }, analyze: orchestratorAnalyze },
  { key: "sales_operations", name: "Sales Operations Manager", group: "operations", version: "1.0.0", defaultLevel: 2, maxLevel: 3, tier: "economy", scheduleMinutes: 60,
    purpose: "Watches the whole sales operation for stalled deals, unassigned leads, duplicate accounts, slow quotations, blocked orders and overdue backlogs.",
    tools: ["read:crm", "propose:action", "write:internal_notification", "write:lead_assignment"], reads: ["opportunities", "leads", "accounts", "quotations", "orders", "activities"], thresholds: { stalledDays: 21, unassignedLeadHours: 24, draftQuoteDays: 7, pendingOrderDays: 3, overdueBacklog: 5 }, events: ["lead.created", "opportunity.stage_changed", "opportunity.created"], analyze: salesOps },
  { key: "lead_enrichment", name: "Lead Generation & Enrichment", group: "revenue", version: "1.0.0", defaultLevel: 1, maxLevel: 2, tier: "economy", scheduleMinutes: 120,
    purpose: "Finds missing or invalid lead data, marks unknown fields as unknown (never guesses), detects duplicates and likely account matches with provenance.",
    tools: ["read:crm"], reads: ["leads", "accounts"], thresholds: {}, events: ["lead.created"], limitations: "No external data-enrichment provider is connected, so fields are never filled automatically; it only reports what is missing or inconsistent.", analyze: leadEnrichment },
  { key: "lead_qualification", name: "Lead Qualification & Conversion", group: "revenue", version: "1.0.0", defaultLevel: 2, maxLevel: 2, tier: "standard", scheduleMinutes: 120,
    purpose: "Explains lead scores with BANT-style criteria from recorded fields and recommends qualification or conversion; never converts silently.",
    tools: ["read:crm", "propose:action"], reads: ["leads", "touches", "accounts"], thresholds: { qualifyScore: 70, nurtureStaleDays: 45 }, events: ["lead.created", "lead.status_changed", "lead.contacted"], analyze: leadQualification },
  { key: "account_intelligence", name: "Account & Customer Intelligence", group: "customer", version: "1.0.0", defaultLevel: 1, maxLevel: 2, tier: "standard", scheduleMinutes: 240,
    purpose: "Builds the customer picture: revenue concentration, account health, cross-sell evidence from same-industry peers and unresolved complaints.",
    tools: ["read:crm", "read:finance"], reads: ["accounts", "orders", "order lines", "feedback"], thresholds: { concentrationPercent: 25, crossSellMinPeers: 3 }, analyze: accountIntel },
  { key: "contact_relationship", name: "Contact & Relationship Intelligence", group: "customer", version: "1.0.0", defaultLevel: 1, maxLevel: 1, tier: "economy", scheduleMinutes: 240,
    purpose: "Finds relationship gaps on open deals (no contact, single point of contact, unreachable contacts), consent gaps and duplicate contacts. Never treats a job title as proof of authority.",
    tools: ["read:crm"], reads: ["contacts", "opportunities"], thresholds: {}, analyze: contactRelationship },
  { key: "opportunity_pipeline", name: "Opportunity & Pipeline Intelligence", group: "revenue", version: "1.0.0", defaultLevel: 2, maxLevel: 2, tier: "standard", scheduleMinutes: 60,
    purpose: "Scores deal health with a transparent deduction list, flags unusual stage moves, and measures pipeline coverage against the approved target.",
    tools: ["read:crm", "read:analytics", "propose:action"], reads: ["opportunities", "stages", "targets", "activities"], thresholds: { healthThreshold: 60, minCoverage: 3 }, events: ["opportunity.created", "opportunity.stage_changed", "opportunity.amount_changed"], analyze: opportunityPipeline },
  { key: "activities_followup", name: "Activities & Follow-up", group: "operations", version: "1.0.0", defaultLevel: 3, maxLevel: 3, tier: "economy", scheduleMinutes: 60,
    purpose: "Keeps the day's work moving: overdue activities, deals and leads with no next step, with internal follow-up tasks created for owners.",
    tools: ["read:crm", "propose:action", "write:internal_task"], reads: ["activities", "opportunities", "leads"], thresholds: {}, events: ["opportunity.created", "lead.created", "activity.completed"], analyze: activitiesFollowup },
  { key: "targets_quotas", name: "Sales Targets & Quotas", group: "revenue", version: "1.0.0", defaultLevel: 1, maxLevel: 2, tier: "standard", scheduleMinutes: 240,
    purpose: "Tracks booked revenue against approved targets, sizes the gap with the historical average deal, and flags quota allocation anomalies. Booked, invoiced and collected are kept separate.",
    tools: ["read:crm", "read:finance", "read:analytics"], reads: ["targets", "orders", "opportunities"], thresholds: {}, analyze: targetsQuotas },
  { key: "product_pricebook", name: "Product & Price Book Intelligence", group: "revenue", version: "1.0.0", defaultLevel: 1, maxLevel: 1, tier: "economy", scheduleMinutes: 480,
    purpose: "Audits products and price books: unpriced products, expired books, discounts beyond policy, sub-minimum margins and outdated list prices. Never invents or changes prices.",
    tools: ["read:crm"], reads: ["products", "price books", "quotations"], thresholds: {}, analyze: productPricebook },
  { key: "quotation_proposal", name: "Quotation & Proposal", group: "revenue", version: "1.0.0", defaultLevel: 2, maxLevel: 2, tier: "standard", scheduleMinutes: 120,
    purpose: "Verifies quotation totals with deterministic code, chases expiring quotations with consent-checked draft reminders that need approval, and reports quotation outcomes.",
    tools: ["read:crm", "read:finance", "propose:action", "queue:customer_message"], reads: ["quotations", "quotation lines", "contacts"], thresholds: {}, events: ["quotation.created", "quotation.sent", "quotation.approved"], analyze: quotationProposal },
  { key: "sales_order", name: "Sales Order & Commercial Execution", group: "revenue", version: "1.0.0", defaultLevel: 1, maxLevel: 2, tier: "economy", scheduleMinutes: 120,
    purpose: "Finds order exceptions: late delivery, blocked stock, overdue payment, totals that do not reconcile and duplicate orders. Never claims stock, payment or delivery that is not recorded.",
    tools: ["read:crm", "read:finance"], reads: ["orders", "order lines"], thresholds: {}, events: ["order.created", "order.confirmed", "order.paid", "order.fulfilled"], analyze: salesOrder },
  { key: "sales_forecasting", name: "Sales Forecasting", group: "intelligence", version: "1.0.0", defaultLevel: 1, maxLevel: 2, tier: "reasoning", scheduleMinutes: 240,
    purpose: "Produces worst/expected/best forecasts for the quarter with stated assumptions, win-rate confidence intervals only when data allows, and measures forecast accuracy from past snapshots.",
    tools: ["read:crm", "read:analytics"], reads: ["opportunities", "forecast snapshots", "targets"], thresholds: {}, analyze: forecasting },
  { key: "performance_coaching", name: "Sales Performance & Coaching", group: "intelligence", version: "1.0.0", defaultLevel: 1, maxLevel: 1, tier: "standard", scheduleMinutes: 1440,
    purpose: "Compares reps fairly (minimum sample, peer median) and suggests coaching conversations without causal claims.",
    tools: ["read:crm", "read:analytics"], reads: ["opportunities", "activities", "members"], thresholds: { minClosedDeals: 5 }, analyze: performanceCoaching },
  { key: "territory_team", name: "Territory & Team Optimisation", group: "operations", version: "1.0.0", defaultLevel: 1, maxLevel: 1, tier: "economy", scheduleMinutes: 1440,
    purpose: "Detects uneven workloads, records without territories and records owned by inactive members. Strategic accounts are never reassigned by an agent.",
    tools: ["read:crm"], reads: ["members", "territories", "leads", "opportunities", "accounts"], thresholds: {}, analyze: territoryTeam },
  { key: "commissions_incentives", name: "Commissions & Incentives", group: "governance", version: "1.0.0", defaultLevel: 1, maxLevel: 1, tier: "economy", scheduleMinutes: 1440,
    purpose: "Audits commission data: missing entries, anomalous amounts and approval backlogs. Cannot calculate, approve or release commissions.",
    tools: ["read:finance"], reads: ["commission plans", "commission entries", "orders"], thresholds: {}, analyze: commissions },
  { key: "retention_expansion", name: "Customer Retention & Expansion", group: "customer", version: "1.0.0", defaultLevel: 3, maxLevel: 3, tier: "standard", scheduleMinutes: 240,
    purpose: "Tracks renewals, overdue reorders, silent customers and growing accounts, separating risk indicators from confirmed customer intent, and alerts account owners.",
    tools: ["read:crm", "read:finance", "propose:action", "write:internal_notification"], reads: ["renewals", "accounts", "orders", "activities"], thresholds: {}, analyze: retentionExpansion },
  { key: "campaign_intelligence", name: "Sales Campaign Intelligence", group: "intelligence", version: "1.0.0", defaultLevel: 1, maxLevel: 1, tier: "standard", scheduleMinutes: 1440,
    purpose: "Measures campaign lead quality, cost per lead and return where spend exists, and flags contact fatigue. Cannot send or publish campaigns.",
    tools: ["read:crm", "read:analytics"], reads: ["campaigns", "leads", "touches", "opportunities"], thresholds: { fatigueTouches: 5 }, analyze: campaignIntel },
  { key: "competitor_intelligence", name: "Competitor Intelligence", group: "intelligence", version: "1.0.0", defaultLevel: 1, maxLevel: 1, tier: "standard", scheduleMinutes: 1440,
    purpose: "Analyses competitor evidence already recorded by your team: frequency in lost deals, unverified or outdated observations and competitors with no sourced evidence.",
    tools: ["read:crm"], reads: ["competitors", "competitor intel", "opportunity competitors"], thresholds: {}, limitations: "Public-web competitor discovery is not connected (no research provider is installed), so no competitor, price or claim is ever fetched or invented. Findings use only records your team entered, with their sources.", analyze: competitorIntel },
  { key: "reporting_analytics", name: "Sales Reporting & Analytics", group: "intelligence", version: "1.0.0", defaultLevel: 1, maxLevel: 1, tier: "economy", scheduleMinutes: 360,
    purpose: "Publishes headline metrics with their definition, period, source and aggregation, and flags statistically unusual swings.",
    tools: ["read:crm", "read:analytics"], reads: ["orders", "leads", "opportunities"], thresholds: { anomalyPercent: 40 }, analyze: reportingAnalytics },
  { key: "automation_workflow", name: "Sales Automation & Workflow", group: "governance", version: "1.0.0", defaultLevel: 1, maxLevel: 1, tier: "economy", scheduleMinutes: 30,
    purpose: "Monitors automation health: failing rules, failed outbox items, dead-lettered events and stuck approvals. Cannot create or recurse workflows.",
    tools: ["read:analytics"], reads: ["automation runs", "outbox", "events", "approvals", "agent executions"], thresholds: {}, analyze: automationWorkflow },
  { key: "playback_training", name: "Sales Playback & Training", group: "intelligence", version: "1.0.0", defaultLevel: 1, maxLevel: 1, tier: "standard", scheduleMinutes: 1440,
    purpose: "Reviews available coaching evidence: meeting-note coverage, loss reasons without playbook guidance and incomplete training.",
    tools: ["read:crm", "read:documents"], reads: ["activities", "playbook", "training completions"], thresholds: {}, limitations: "No call recordings or transcripts are stored by this system, so none are analysed; it works from written meeting notes and recorded outcomes only.", analyze: playbackTraining },
  { key: "document_intelligence", name: "Sales Document Intelligence", group: "governance", version: "1.0.0", defaultLevel: 1, maxLevel: 1, tier: "economy", scheduleMinutes: 1440,
    purpose: "Audits document metadata: multiple active versions, unlinked documents and accepted quotations that were never converted. Document text is treated as untrusted and is never read or executed.",
    tools: ["read:documents"], reads: ["documents (metadata)", "quotations"], thresholds: {}, limitations: "AI extraction of document text is not implemented; documents are reviewed from metadata only.", analyze: documentIntel },
  { key: "admin_governance", name: "Sales Administration & Governance", group: "governance", version: "1.0.0", defaultLevel: 1, maxLevel: 1, tier: "economy", scheduleMinutes: 720,
    purpose: "Checks configuration health: administrators, enabled-but-missing integrations, stage probabilities, discount limits, autonomy levels and approval backlogs. Recommends only; cannot change permissions or settings.",
    tools: ["read:crm"], reads: ["settings", "members", "agents", "approvals"], thresholds: {}, analyze: adminGovernance },
];

export const AGENT_BY_KEY = new Map(AGENTS.map((a) => [a.key, a]));

/** Execution order for an orchestration cycle: data-quality producers first, synthesis/analytics last. */
export const ORCHESTRATION_ORDER: string[][] = [
  ["sales_operations", "lead_enrichment", "contact_relationship", "territory_team", "automation_workflow", "admin_governance", "document_intelligence"],
  ["lead_qualification", "account_intelligence", "activities_followup", "sales_order", "product_pricebook", "quotation_proposal", "competitor_intelligence"],
  ["opportunity_pipeline", "targets_quotas", "retention_expansion", "commissions_incentives", "campaign_intelligence", "playback_training"],
  ["sales_forecasting", "performance_coaching", "reporting_analytics"],
];

