import { pgTable, text, boolean, jsonb, timestamp, bigint, integer, numeric } from "drizzle-orm/pg-core";

export const cdOptimizerJobsTable = pgTable("cd_optimizer_jobs", {
  id: text("id").primaryKey(),
  status: text("status").notNull().default("queued"),
  mode: text("mode").notNull().default("balanced"),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type"),
  originalSize: bigint("original_size", { mode: "number" }).notNull().default(0),
  optimizedSize: bigint("optimized_size", { mode: "number" }),
  bytesSaved: bigint("bytes_saved", { mode: "number" }),
  percentSaved: numeric("percent_saved"),
  ratio: numeric("ratio"),
  algorithm: text("algorithm"),
  pipeline: text("pipeline"),
  qualityScore: numeric("quality_score"),
  integrityOk: boolean("integrity_ok"),
  sha256Original: text("sha256_original"),
  sha256Optimized: text("sha256_optimized"),
  processingMs: integer("processing_ms"),
  error: text("error"),
  organizationId: text("organization_id"),
  userId: text("user_id"),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const nexusFinanceAnalysesTable = pgTable("nexus_finance_analyses", {
  id: text("id").primaryKey(),
  companyName: text("company_name").notNull(),
  periodLabel: text("period_label"),
  currency: text("currency").default("GHS"),
  input: jsonb("input").notNull().default({}),
  health: jsonb("health").notNull().default({}),
  distress: jsonb("distress").notNull().default({}),
  survival: jsonb("survival").notNull().default({}),
  organizationId: text("organization_id"),
  userId: text("user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CdOptimizerJobRow = typeof cdOptimizerJobsTable.$inferSelect;
export type NexusFinanceAnalysisRow = typeof nexusFinanceAnalysesTable.$inferSelect;
