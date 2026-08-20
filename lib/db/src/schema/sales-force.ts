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
