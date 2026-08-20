import { pgTable, serial, integer, text, boolean, jsonb, timestamp, numeric } from "drizzle-orm/pg-core";

/** AI Sales employees / agents */
export const salesAgentsTable = pgTable("sales_agents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  role: text("role").notNull(), // director | manager | prospector | sdr | qualification | ae | closer | account_manager | upsell | reactivation | researcher | copywriter | analyst | proposal | negotiator
  avatar: text("avatar"),
  personality: text("personality"),
  specialization: text("specialization"),
  status: text("status").notNull().default("active"), // active | paused | stopped | archived
  autonomyLevel: integer("autonomy_level").notNull().default(1), // 0-4
  territory: text("territory"),
  products: jsonb("products").notNull().default("[]"),
  permissions: jsonb("permissions").notNull().default("{}"),
  targets: jsonb("targets").notNull().default("{}"),
  performance: jsonb("performance").notNull().default("{}"),
  knowledgeVersion: text("knowledge_version").default("1"),
  config: jsonb("config").notNull().default("{}"),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const salesLeadsTable = pgTable("sales_leads", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactTitle: text("contact_title"),
  website: text("website"),
  industry: text("industry"),
  companySize: text("company_size"),
  location: text("location"),
  source: text("source").default("manual"),
  stage: text("stage").notNull().default("new_lead"),
  fitScore: integer("fit_score"),
  engagementScore: integer("engagement_score"),
  intentScore: integer("intent_score"),
  valueScore: integer("value_score"),
  timingScore: integer("timing_score"),
  priorityScore: integer("priority_score"),
  qualityLabel: text("quality_label"), // cold | low_intent | warm | mql | sql | high_intent | opportunity_ready | enterprise
  assignedAgentId: integer("assigned_agent_id"),
  ownerHuman: text("owner_human"),
  notes: text("notes"),
  researchBrief: jsonb("research_brief"),
  scoresDetail: jsonb("scores_detail"),
  tags: jsonb("tags").notNull().default("[]"),
  consentEmail: boolean("consent_email").notNull().default(false),
  consentSms: boolean("consent_sms").notNull().default(false),
  optedOut: boolean("opted_out").notNull().default(false),
  lastContactAt: timestamp("last_contact_at"),
  nextAction: text("next_action"),
  nextActionReason: text("next_action_reason"),
  metadata: jsonb("metadata").notNull().default("{}"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const salesOpportunitiesTable = pgTable("sales_opportunities", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id"),
  name: text("name").notNull(),
  companyName: text("company_name").notNull(),
  stage: text("stage").notNull().default("qualified"),
  amount: numeric("amount"),
  currency: text("currency").notNull().default("GHS"),
  probability: integer("probability").notNull().default(10),
  riskScore: integer("risk_score"),
  assignedAgentId: integer("assigned_agent_id"),
  ownerHuman: text("owner_human"),
  products: jsonb("products").notNull().default("[]"),
  expectedCloseDate: text("expected_close_date"),
  lostReason: text("lost_reason"),
  wonAt: timestamp("won_at"),
  lostAt: timestamp("lost_at"),
  notes: text("notes"),
  context: jsonb("context").notNull().default("{}"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const salesActivitiesTable = pgTable("sales_activities", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id"),
  opportunityId: integer("opportunity_id"),
  agentId: integer("agent_id"),
  actorType: text("actor_type").notNull().default("ai"), // ai | human | system
  actorName: text("actor_name"),
  action: text("action").notNull(),
  channel: text("channel"),
  summary: text("summary"),
  detail: jsonb("detail").notNull().default("{}"),
  confidence: text("confidence"), // low | medium | high
  result: text("result"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const salesCampaignsTable = pgTable("sales_campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  objective: text("objective"),
  status: text("status").notNull().default("draft"), // draft | active | paused | completed
  audience: jsonb("audience").notNull().default("{}"),
  channels: jsonb("channels").notNull().default("[]"),
  sequence: jsonb("sequence").notNull().default("[]"),
  product: text("product"),
  offer: text("offer"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  stats: jsonb("stats").notNull().default("{}"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const salesProposalsTable = pgTable("sales_proposals", {
  id: serial("id").primaryKey(),
  opportunityId: integer("opportunity_id"),
  leadId: integer("lead_id"),
  title: text("title").notNull(),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("draft"),
  body: jsonb("body").notNull().default("{}"),
  amount: numeric("amount"),
  currency: text("currency").default("GHS"),
  validUntil: text("valid_until"),
  createdByAgentId: integer("created_by_agent_id"),
  approvedBy: text("approved_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const salesQuotesTable = pgTable("sales_quotes", {
  id: serial("id").primaryKey(),
  opportunityId: integer("opportunity_id"),
  leadId: integer("lead_id"),
  lineItems: jsonb("line_items").notNull().default("[]"),
  subtotal: numeric("subtotal"),
  discount: numeric("discount"),
  tax: numeric("tax"),
  total: numeric("total"),
  currency: text("currency").default("GHS"),
  validUntil: text("valid_until"),
  status: text("status").notNull().default("draft"),
  createdByAgentId: integer("created_by_agent_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const salesAuditLogsTable = pgTable("sales_audit_logs", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id"),
  agentName: text("agent_name"),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  reason: text("reason"),
  dataUsed: jsonb("data_used").notNull().default("{}"),
  result: text("result"),
  revenueImpact: numeric("revenue_impact"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const salesPlaybooksTable = pgTable("sales_playbooks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  rules: jsonb("rules").notNull().default("[]"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const salesKnowledgeTable = pgTable("sales_knowledge", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull().default("general"),
  content: text("content"),
  sourceUrl: text("source_url"),
  version: integer("version").notNull().default(1),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const salesAgentMemoryTable = pgTable("sales_agent_memory", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull(),
  leadId: integer("lead_id"),
  opportunityId: integer("opportunity_id"),
  category: text("category").notNull(), // preference | objection | intent | product | promise | competitor
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type SalesAgent = typeof salesAgentsTable.$inferSelect;
export type SalesLead = typeof salesLeadsTable.$inferSelect;
export type SalesOpportunity = typeof salesOpportunitiesTable.$inferSelect;

/** Admin settings for sales force autonomy, limits, targets */
export const salesSettingsTable = pgTable("sales_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: jsonb("value").notNull().default("{}"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Meetings booked by AI or humans */
export const salesMeetingsTable = pgTable("sales_meetings", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id"),
  opportunityId: integer("opportunity_id"),
  title: text("title").notNull(),
  scheduledAt: text("scheduled_at"),
  durationMinutes: integer("duration_minutes").default(30),
  status: text("status").notNull().default("scheduled"), // scheduled | completed | cancelled | no_show
  attendees: jsonb("attendees").notNull().default("[]"),
  notes: text("notes"),
  createdByAgentId: integer("created_by_agent_id"),
  calendarSynced: boolean("calendar_synced").notNull().default(false),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type SalesMeeting = typeof salesMeetingsTable.$inferSelect;

/** §20 Buying Intent Detection — persisted signal log per lead/opportunity. */
export const buyingSignalsTable = pgTable("buying_signals", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id"),
  opportunityId: integer("opportunity_id"),
  signalType: text("signal_type").notNull(), // pricing_page_view | proposal_view | demo_request | reply | repeat_visit | quote_request | meeting_request | document_download | competitor_mention
  weight: integer("weight").notNull().default(0), // contribution to intent score at time of detection
  detail: text("detail"),
  source: text("source").notNull().default("system"), // system | agent | manual
  evidence: text("evidence").notNull().default("CALCULATED"), // VERIFIED | CALCULATED | INFERRED | USER PROVIDED
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
});
export type BuyingSignal = typeof buyingSignalsTable.$inferSelect;

/** §32 Sales Forecasting — periodic snapshots so forecasts can be compared over time, not just computed live. */
export const salesForecastsTable = pgTable("sales_forecasts", {
  id: serial("id").primaryKey(),
  period: text("period").notNull(), // e.g. "2026-W34", "2026-08", "2026-Q3", "2026"
  periodType: text("period_type").notNull(), // week | month | quarter | year
  pipelineTotal: numeric("pipeline_total").notNull().default("0"),
  weightedPipeline: numeric("weighted_pipeline").notNull().default("0"),
  bestCase: numeric("best_case").notNull().default("0"),
  expectedCase: numeric("expected_case").notNull().default("0"),
  worstCase: numeric("worst_case").notNull().default("0"),
  actualClosed: numeric("actual_closed"), // filled in after the period ends, for accuracy tracking
  note: text("note"),
  evidence: text("evidence").notNull().default("CALCULATED"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type SalesForecast = typeof salesForecastsTable.$inferSelect;

/** §41 Real-Time Sales Alerts / §33 Deal Risk — generated from real DB state, not fabricated. */
export const salesAlertsTable = pgTable("sales_alerts", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // high_value_lead | high_intent | new_qualified_opportunity | proposal_opened | price_requested | competitor_mentioned | deal_at_risk | deal_stalled | contract_requested | purchase_signal
  severity: text("severity").notNull().default("info"), // critical | warning | attention | opportunity | info
  title: text("title").notNull(),
  detail: text("detail"),
  entityType: text("entity_type"), // lead | opportunity | agent
  entityId: integer("entity_id"),
  evidence: text("evidence").notNull().default("CALCULATED"),
  status: text("status").notNull().default("open"), // open | acknowledged | dismissed
  createdAt: timestamp("created_at").notNull().defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at"),
});
export type SalesAlert = typeof salesAlertsTable.$inferSelect;

/** §36/§37 A/B Testing & Sales Experiment Engine. */
export const salesExperimentsTable = pgTable("sales_experiments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  hypothesis: text("hypothesis").notNull(),
  audience: text("audience"),
  variable: text("variable").notNull(), // what's being tested (subject_line | opening_message | cta | offer | follow_up_interval | script | proposal_format)
  variants: jsonb("variants").notNull().default("[]"), // [{ name, description }]
  successMetric: text("success_metric").notNull(), // open_rate | reply_rate | meeting_rate | qualification_rate | conversion | revenue
  sampleSize: integer("sample_size"),
  status: text("status").notNull().default("running"), // running | completed | abandoned
  startDate: timestamp("start_date").notNull().defaultNow(),
  endDate: timestamp("end_date"),
  results: jsonb("results"), // [{ variant, metricValue, sampleSize }] — entered from real observed outcomes
  winningVariant: text("winning_variant"),
  recommendation: text("recommendation"),
  createdByAgentId: integer("created_by_agent_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type SalesExperiment = typeof salesExperimentsTable.$inferSelect;

/** §38 Revenue Attribution — recorded at the moment a deal closes won. */
export const salesAttributionTable = pgTable("sales_attribution", {
  id: serial("id").primaryKey(),
  opportunityId: integer("opportunity_id").notNull(),
  revenueAmount: numeric("revenue_amount").notNull().default("0"),
  agentId: integer("agent_id"),
  campaignId: integer("campaign_id"),
  leadSource: text("lead_source"),
  channel: text("channel"), // email | chat | sms | whatsapp | social | phone | referral
  touchType: text("touch_type").notNull().default("last_touch"), // first_touch | last_touch | multi_touch | ai_influenced
  weight: numeric("weight").notNull().default("1"), // fraction of credit for multi-touch models, 0-1
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type SalesAttribution = typeof salesAttributionTable.$inferSelect;

/** §19 Autonomous Follow-Up Engine — first-class enrollment/state, not just recomputed from lastContactAt each call. */
export const salesSequencesTable = pgTable("sales_sequences", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull(),
  sequenceName: text("sequence_name").notNull().default("standard_outbound"),
  status: text("status").notNull().default("active"), // active | paused | completed | stopped_reply | stopped_optout
  currentStep: integer("current_step").notNull().default(0),
  totalSteps: integer("total_steps").notNull().default(6),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  lastStepAt: timestamp("last_step_at"),
  nextStepDueAt: timestamp("next_step_due_at"),
  stoppedReason: text("stopped_reason"), // replied | opted_out | manual | completed
  createdByAgentId: integer("created_by_agent_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type SalesSequence = typeof salesSequencesTable.$inferSelect;
