import { pgTable, serial, integer, text, numeric, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";

export const diagnosticEvidenceTable = pgTable("diagnostic_evidence", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  category: text("category").notNull(),
  claim: text("claim").notNull(),
  evidenceType: text("evidence_type").notNull(),
  sourceName: text("source_name"),
  sourceUrl: text("source_url"),
  sourceDate: timestamp("source_date"),
  confidence: text("confidence").notNull().default("medium"),
  value: jsonb("value"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const diagnosticBenchmarksTable = pgTable("diagnostic_benchmarks", {
  id: serial("id").primaryKey(),
  industry: text("industry").notNull(),
  metric: text("metric").notNull(),
  segment: text("segment"),
  value: numeric("value", { precision: 14, scale: 4 }).notNull(),
  unit: text("unit"),
  sourceName: text("source_name"),
  sourceUrl: text("source_url"),
  sourceDate: timestamp("source_date"),
  verified: boolean("verified").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const diagnosticRecommendationsTable = pgTable("diagnostic_recommendations", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  title: text("title").notNull(),
  problem: text("problem"),
  rootCause: text("root_cause"),
  evidence: jsonb("evidence"),
  action: text("action").notNull(),
  alternative: text("alternative"),
  priority: text("priority").notNull().default("medium"),
  owner: text("owner"),
  budget: numeric("budget", { precision: 14, scale: 2 }),
  timeline: text("timeline"),
  kpi: text("kpi"),
  expectedResult: text("expected_result"),
  roiModel: jsonb("roi_model"),
  risks: jsonb("risks"),
  dependencies: jsonb("dependencies"),
  smartScore: integer("smart_score"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const diagnosticInitiativesTable = pgTable("diagnostic_initiatives", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  recommendationId: integer("recommendation_id"),
  title: text("title").notNull(),
  level: text("level").notNull(),
  owner: text("owner"),
  department: text("department"),
  startDate: timestamp("start_date"),
  deadline: timestamp("deadline"),
  budget: numeric("budget", { precision: 14, scale: 2 }),
  baseline: numeric("baseline", { precision: 14, scale: 4 }),
  target: numeric("target", { precision: 14, scale: 4 }),
  currentValue: numeric("current_value", { precision: 14, scale: 4 }),
  kpi: text("kpi"),
  status: text("status").notNull().default("not_started"),
  risk: text("risk"),
  dependencies: jsonb("dependencies"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const diagnosticScenariosTable = pgTable("diagnostic_scenarios", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  name: text("name").notNull(),
  assumptions: jsonb("assumptions").notNull().default("{}"),
  outputs: jsonb("outputs").notNull().default("{}"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const diagnosticReviewsTable = pgTable("diagnostic_reviews", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  period: text("period").notNull(),
  score: integer("score"),
  achievedGoals: integer("achieved_goals").notNull().default(0),
  missedGoals: integer("missed_goals").notNull().default(0),
  observations: text("observations"),
  decisions: jsonb("decisions"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type DiagnosticEvidence = typeof diagnosticEvidenceTable.$inferSelect;
export type DiagnosticBenchmark = typeof diagnosticBenchmarksTable.$inferSelect;
export type DiagnosticRecommendation = typeof diagnosticRecommendationsTable.$inferSelect;
export type DiagnosticInitiative = typeof diagnosticInitiativesTable.$inferSelect;
export type DiagnosticScenario = typeof diagnosticScenariosTable.$inferSelect;
export type DiagnosticReview = typeof diagnosticReviewsTable.$inferSelect;
