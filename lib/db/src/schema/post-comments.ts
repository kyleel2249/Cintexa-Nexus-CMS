import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const postCommentsTable = pgTable("post_comments", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull(),
  authorName: text("author_name").notNull(),
  authorEmail: text("author_email"),
  content: text("content").notNull(),
  sentiment: text("sentiment").notNull().default("positive"),
  aiGenerated: boolean("ai_generated").notNull().default(false),
  approved: boolean("approved").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PostComment = typeof postCommentsTable.$inferSelect;
