import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const formsTable = pgTable("forms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  fields: text("fields").notNull().default("[]"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const formSubmissionsTable = pgTable("form_submissions", {
  id: serial("id").primaryKey(),
  formId: integer("form_id").notNull(),
  data: text("data").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const intakeShareLinksTable = pgTable("intake_share_links", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  label: text("label").notNull().default("Diagnostic Intake"),
  active: boolean("active").notNull().default(true),
  expiresAt: timestamp("expires_at"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const intakePublicSubmissionsTable = pgTable("intake_public_submissions", {
  id: serial("id").primaryKey(),
  shareLinkId: integer("share_link_id").notNull(),
  token: text("token").notNull(),
  payload: text("payload").notNull(),
  companyName: text("company_name"),
  status: text("status").notNull().default("received"),
  profileId: integer("profile_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFormSchema = createInsertSchema(formsTable).omit({ id: true, createdAt: true });
export type InsertForm = z.infer<typeof insertFormSchema>;
export type Form = typeof formsTable.$inferSelect;
export type FormSubmission = typeof formSubmissionsTable.$inferSelect;
export type IntakeShareLink = typeof intakeShareLinksTable.$inferSelect;
export type IntakePublicSubmission = typeof intakePublicSubmissionsTable.$inferSelect;
