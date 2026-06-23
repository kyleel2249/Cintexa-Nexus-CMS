import { Router } from "express";
import { db } from "@workspace/db";
import { pagesTable, postsTable, mediaTable, usersTable, sitesTable, formsTable, activityTable } from "@workspace/db";
import { count, desc } from "drizzle-orm";

const router = Router();

router.get("/summary", async (req, res) => {
  const [[pages], [publishedPages], [draftPages], [posts], [publishedPosts], [media], [users], [sites], [forms]] =
    await Promise.all([
      db.select({ count: count() }).from(pagesTable),
      db.select({ count: count() }).from(pagesTable).where(db.$count !== undefined ? undefined : undefined).then(() =>
        db.execute<{ count: string }>("SELECT COUNT(*) FROM pages WHERE status = 'published'")
      ),
      db.execute<{ count: string }>("SELECT COUNT(*) FROM pages WHERE status = 'draft'"),
      db.select({ count: count() }).from(postsTable),
      db.execute<{ count: string }>("SELECT COUNT(*) FROM posts WHERE status = 'published'"),
      db.select({ count: count() }).from(mediaTable),
      db.select({ count: count() }).from(usersTable),
      db.select({ count: count() }).from(sitesTable),
      db.select({ count: count() }).from(formsTable),
    ]);

  const totalPages = Number(pages.count);
  const totalPosts = Number(posts.count);
  const totalMedia = Number(media.count);
  const totalUsers = Number(users.count);
  const totalSites = Number(sites.count);
  const totalForms = Number(forms.count);

  const pubPagesRows = await db.execute("SELECT COUNT(*) as count FROM pages WHERE status = 'published'");
  const draftPagesRows = await db.execute("SELECT COUNT(*) as count FROM pages WHERE status = 'draft'");
  const pubPostsRows = await db.execute("SELECT COUNT(*) as count FROM posts WHERE status = 'published'");

  res.json({
    totalPages,
    publishedPages: Number((pubPagesRows.rows[0] as any)?.count ?? 0),
    draftPages: Number((draftPagesRows.rows[0] as any)?.count ?? 0),
    totalPosts,
    publishedPosts: Number((pubPostsRows.rows[0] as any)?.count ?? 0),
    totalMedia,
    totalUsers,
    totalSites,
    totalForms,
    pageViews: Math.floor(Math.random() * 50000) + 10000,
    avgLoadTime: parseFloat((Math.random() * 0.8 + 0.4).toFixed(2)),
  });
});

router.get("/activity", async (req, res) => {
  const activities = await db
    .select()
    .from(activityTable)
    .orderBy(desc(activityTable.createdAt))
    .limit(20);

  res.json(
    activities.map((a) => ({
      id: a.id,
      type: a.type,
      entityType: a.entityType,
      entityTitle: a.entityTitle,
      userName: a.userName,
      action: a.action,
      createdAt: a.createdAt.toISOString(),
    }))
  );
});

router.get("/traffic", async (_req, res) => {
  const days = 30;
  const points = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    points.push({
      date: dateStr,
      views: Math.floor(Math.random() * 2000) + 500,
      visitors: Math.floor(Math.random() * 1200) + 300,
    });
  }
  res.json(points);
});

export default router;
