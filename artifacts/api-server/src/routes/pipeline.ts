import { Router } from "express";
import { db, postsTable, pagesTable } from "@workspace/db";
import { or, isNotNull, eq } from "drizzle-orm";

const router = Router();

/**
 * Content pipeline board.
 *
 * Returns everything that is scheduled AND (by default) every unscheduled draft, so the
 * board's backlog can be dragged onto a week to schedule it. Pass `?drafts=0` to only get
 * scheduled items.
 */
router.get("/", async (req, res) => {
  const includeDrafts = String(req.query.drafts ?? "1") !== "0";

  const [posts, pages] = await Promise.all([
    db
      .select()
      .from(postsTable)
      .where(includeDrafts ? or(isNotNull(postsTable.scheduledAt), eq(postsTable.status, "draft")) : isNotNull(postsTable.scheduledAt)),
    db
      .select()
      .from(pagesTable)
      .where(includeDrafts ? or(isNotNull(pagesTable.scheduledAt), eq(pagesTable.status, "draft")) : isNotNull(pagesTable.scheduledAt)),
  ]);

  const items = [
    ...posts.map((p) => ({
      id: `post-${p.id}`,
      entityId: p.id,
      type: "post" as const,
      title: p.title,
      slug: p.slug,
      status: p.status,
      scheduledAt: p.scheduledAt ? p.scheduledAt.toISOString() : null,
      sourceId: p.sourceId,
    })),
    ...pages.map((p) => ({
      id: `page-${p.id}`,
      entityId: p.id,
      type: "page" as const,
      title: p.title,
      slug: p.slug,
      status: p.status,
      scheduledAt: p.scheduledAt ? p.scheduledAt.toISOString() : null,
      sourceId: p.sourceId,
    })),
  ];

  // Scheduled first (soonest on top), then unscheduled drafts
  items.sort((a, b) => {
    if (!a.scheduledAt && !b.scheduledAt) return a.title.localeCompare(b.title);
    if (!a.scheduledAt) return 1;
    if (!b.scheduledAt) return -1;
    return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
  });

  res.json(items);
});

export default router;
