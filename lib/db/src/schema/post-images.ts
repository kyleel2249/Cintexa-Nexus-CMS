import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const postImagesTable = pgTable("post_images", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull(),
  url: text("url").notNull(),
  altText: text("alt_text"),
  prompt: text("prompt"),
  isPrimary: boolean("is_primary").notNull().default(false),
  isThumbnail: boolean("is_thumbnail").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPostImageSchema = createInsertSchema(postImagesTable).omit({ id: true, createdAt: true });
export type InsertPostImage = z.infer<typeof insertPostImageSchema>;
export type PostImage = typeof postImagesTable.$inferSelect;
