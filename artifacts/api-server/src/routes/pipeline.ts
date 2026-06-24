import { Router } from "express";
import { db, postsTable, pagesTable } from "@workspace/db";
import { eq, or, isNotNull } from "drizzle-orm";

const router = Router();

// Returns all scheduled posts & pages (with a scheduledAt date) for the pipeline board
router.get("/", async (_req, res) => {
  const [posts, pages] = await Promise.all([
    db.select().from(postsTable).where(isNotNull(postsTable.scheduledAt)),
    db.select().from(pagesTable).where(isNotNull(pagesTable.scheduledAt)),
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

  // Sort by scheduledAt ascending
  items.sort((a, b) => {
    if (!a.scheduledAt) return 1;
    if (!b.scheduledAt) return -1;
    return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
  });

  res.json(items);
});

export default router;
