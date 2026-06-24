import { db, pagesTable, postsTable, activityTable } from "@workspace/db";
import { eq, and, lte } from "drizzle-orm";
import { logger } from "./logger";
import { runPublishPipeline } from "./publish-pipeline";
import { seedPlugins } from "../routes/plugins";

async function publishDueContent() {
  const now = new Date();

  const duePagesResult = await db
    .update(pagesTable)
    .set({ status: "published", publishedAt: now, scheduledAt: null, updatedAt: now })
    .where(and(eq(pagesTable.status, "scheduled"), lte(pagesTable.scheduledAt!, now)))
    .returning({ id: pagesTable.id, title: pagesTable.title });

  for (const page of duePagesResult) {
    logger.info({ pageId: page.id }, `Scheduler: auto-published page "${page.title}"`);
    await db.insert(activityTable).values({ type: "publish", entityType: "page", entityTitle: page.title, userName: "Scheduler", action: "auto-published scheduled page" });
  }

  const duePostsResult = await db
    .update(postsTable)
    .set({ status: "published", publishedAt: now, scheduledAt: null, updatedAt: now })
    .where(and(eq(postsTable.status, "scheduled"), lte(postsTable.scheduledAt!, now)))
    .returning({ id: postsTable.id, title: postsTable.title });

  for (const post of duePostsResult) {
    logger.info({ postId: post.id }, `Scheduler: auto-published post "${post.title}"`);
    await db.insert(activityTable).values({ type: "publish", entityType: "post", entityTitle: post.title, userName: "Scheduler", action: "auto-published scheduled post" });
    runPublishPipeline(post.id).catch((err) => logger.error(err, "Publish pipeline error"));
  }
}

export async function startScheduler() {
  await seedPlugins();
  logger.info("Content scheduler started (60s interval)");
  publishDueContent().catch((err) => logger.error(err, "Scheduler error"));
  return setInterval(() => {
    publishDueContent().catch((err) => logger.error(err, "Scheduler error"));
  }, 60_000);
}
