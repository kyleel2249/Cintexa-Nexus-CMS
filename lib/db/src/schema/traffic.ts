import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const trafficStatsTable = pgTable("traffic_stats", {
  id: serial("id").primaryKey(),
  date: text("date").notNull().unique(),
  views: integer("views").notNull().default(0),
  visitors: integer("visitors").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTrafficStatsSchema = createInsertSchema(trafficStatsTable).omit({ id: true, createdAt: true });
export type InsertTrafficStats = z.infer<typeof insertTrafficStatsSchema>;
export type TrafficStats = typeof trafficStatsTable.$inferSelect;
