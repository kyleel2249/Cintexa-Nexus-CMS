import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const socialBroadcastsTable = pgTable("social_broadcasts", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull(),
  platform: text("platform").notNull(),
  status: text("status").notNull().default("pending"),
  externalId: text("external_id"),
  error: text("error"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSocialBroadcastSchema = createInsertSchema(socialBroadcastsTable).omit({ id: true, createdAt: true });
export type InsertSocialBroadcast = z.infer<typeof insertSocialBroadcastSchema>;
export type SocialBroadcast = typeof socialBroadcastsTable.$inferSelect;
