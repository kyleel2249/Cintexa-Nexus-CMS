import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const diagnosticProfilesTable = pgTable("diagnostic_profiles", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull(),
  industry: text("industry"),
  subIndustry: text("sub_industry"),
  businessModel: text("business_model"),
  customerType: text("customer_type"),
  geographicMarkets: text("geographic_markets"),
  targetCustomers: text("target_customers"),
  companySize: text("company_size"),
  employeeCount: integer("employee_count"),
  revenueRange: text("revenue_range"),
  annualGrowth: text("annual_growth"),
  monthlyRevenue: integer("monthly_revenue"),
  grossMargin: integer("gross_margin"),
  netMargin: integer("net_margin"),
  avgTransactionValue: integer("avg_transaction_value"),
  customerLifetimeValue: integer("customer_lifetime_value"),
  customerAcquisitionCost: integer("customer_acquisition_cost"),
  monthlyLeads: integer("monthly_leads"),
  monthlyQualifiedLeads: integer("monthly_qualified_leads"),
  monthlyCustomers: integer("monthly_customers"),
  conversionRate: integer("conversion_rate"),
  customerChurn: integer("customer_churn"),
  retentionRate: integer("retention_rate"),
  salesCycleDays: integer("sales_cycle_days"),
  mainProducts: text("main_products"),
  mainServices: text("main_services"),
  mainRevenueSources: text("main_revenue_sources"),
  mainCompetitors: text("main_competitors"),
  technologyStack: text("technology_stack"),
  crmSystem: text("crm_system"),
  accountingSystem: text("accounting_system"),
  marketingPlatforms: text("marketing_platforms"),
  ecommercePlatform: text("ecommerce_platform"),
  communicationSystems: text("communication_systems"),
  existingAutomation: text("existing_automation"),
  strategicObjectives: text("strategic_objectives"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const diagnosticSessionsTable = pgTable("diagnostic_sessions", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").references(() => diagnosticProfilesTable.id, { onDelete: "cascade" }),
  mode: text("mode").notNull().default("standard"),
  status: text("status").notNull().default("in_progress"),
  currentStep: integer("current_step").notNull().default(0),
  totalSteps: integer("total_steps").notNull().default(10),
  answers: jsonb("answers").notNull().default("{}"),
  pillarScores: jsonb("pillar_scores").notNull().default("{}"),
  overallScore: integer("overall_score"),
  aiAnalysis: jsonb("ai_analysis"),
  recommendations: jsonb("recommendations"),
  smartGoals: jsonb("smart_goals"),
  executionRoadmap: jsonb("execution_roadmap"),
  swotAnalysis: jsonb("swot_analysis"),
  competitiveAnalysis: jsonb("competitive_analysis"),
  benchmarkComparison: jsonb("benchmark_comparison"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const diagnosticCompetitorsTable = pgTable("diagnostic_competitors", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").references(() => diagnosticProfilesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  website: text("website"),
  positioning: text("positioning"),
  strengths: text("strengths"),
  weaknesses: text("weaknesses"),
  pricing: text("pricing"),
  targetCustomers: text("target_customers"),
  marketShare: text("market_share"),
  scorecard: jsonb("scorecard").notNull().default("{}"),
  strategyAnalysis: jsonb("strategy_analysis"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const diagnosticGoalsTable = pgTable("diagnostic_goals", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => diagnosticSessionsTable.id, { onDelete: "cascade" }),
  goalType: text("goal_type").notNull().default("strategic"),
  title: text("title").notNull(),
  description: text("description"),
  owner: text("owner"),
  department: text("department"),
  deadline: text("deadline"),
  kpi: text("kpi"),
  baseline: text("baseline"),
  target: text("target"),
  currentValue: text("current_value"),
  progress: integer("progress").notNull().default(0),
  status: text("status").notNull().default("not_started"),
  priority: text("priority").notNull().default("medium"),
  parentGoalId: integer("parent_goal_id"),
  smartScore: integer("smart_score"),
  dependencies: text("dependencies"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertDiagnosticProfileSchema = createInsertSchema(diagnosticProfilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDiagnosticProfile = z.infer<typeof insertDiagnosticProfileSchema>;
export type DiagnosticProfile = typeof diagnosticProfilesTable.$inferSelect;

export const insertDiagnosticSessionSchema = createInsertSchema(diagnosticSessionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDiagnosticSession = z.infer<typeof insertDiagnosticSessionSchema>;
export type DiagnosticSession = typeof diagnosticSessionsTable.$inferSelect;

export const insertDiagnosticCompetitorSchema = createInsertSchema(diagnosticCompetitorsTable).omit({ id: true, createdAt: true });
export type InsertDiagnosticCompetitor = z.infer<typeof insertDiagnosticCompetitorSchema>;
export type DiagnosticCompetitor = typeof diagnosticCompetitorsTable.$inferSelect;

export const insertDiagnosticGoalSchema = createInsertSchema(diagnosticGoalsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDiagnosticGoal = z.infer<typeof insertDiagnosticGoalSchema>;
export type DiagnosticGoal = typeof diagnosticGoalsTable.$inferSelect;
