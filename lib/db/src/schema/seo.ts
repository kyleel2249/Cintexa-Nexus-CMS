import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const seoSettingsTable = pgTable("seo_settings", {
  id: serial("id").primaryKey(),
  siteTitle: text("site_title").notNull().default("My Website"),
  siteDescription: text("site_description").notNull().default(""),
  robots: text("robots").notNull().default("index, follow"),
  googleAnalyticsId: text("google_analytics_id"),
  googleSearchConsoleId: text("google_search_console_id"),
  ogImage: text("og_image"),
  twitterHandle: text("twitter_handle"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const redirectsTable = pgTable("redirects", {
  id: serial("id").primaryKey(),
  from: text("from").notNull(),
  to: text("to").notNull(),
  type: integer("type").notNull().default(301),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSeoSettingsSchema = createInsertSchema(seoSettingsTable).omit({ id: true, updatedAt: true });
export type InsertSeoSettings = z.infer<typeof insertSeoSettingsSchema>;
export type SeoSettings = typeof seoSettingsTable.$inferSelect;

export const insertRedirectSchema = createInsertSchema(redirectsTable).omit({ id: true, createdAt: true });
export type InsertRedirect = z.infer<typeof insertRedirectSchema>;
export type Redirect = typeof redirectsTable.$inferSelect;
