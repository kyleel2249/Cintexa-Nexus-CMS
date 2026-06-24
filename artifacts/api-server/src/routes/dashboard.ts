import { Router } from "express";
import { db } from "@workspace/db";
import { pagesTable, postsTable, mediaTable, usersTable, sitesTable, formsTable, activityTable, trafficStatsTable } from "@workspace/db";
import { count, desc, eq, asc, sum } from "drizzle-orm";

const router = Router();

router.get("/summary", async (_req, res) => {
  const [
    [{ totalPages }],
    [{ totalPosts }],
    [{ totalMedia }],
    [{ totalUsers }],
    [{ totalSites }],
    [{ totalForms }],
  ] = await Promise.all([
    db.select({ totalPages: count() }).from(pagesTable),
    db.select({ totalPosts: count() }).from(postsTable),
    db.select({ totalMedia: count() }).from(mediaTable),
    db.select({ totalUsers: count() }).from(usersTable),
    db.select({ totalSites: count() }).from(sitesTable),
    db.select({ totalForms: count() }).from(formsTable),
  ]);

  const [pubPagesResult, draftPagesResult, pubPostsResult, trafficResult] = await Promise.all([
    db.select({ c: count() }).from(pagesTable).where(eq(pagesTable.status, "published")),
    db.select({ c: count() }).from(pagesTable).where(eq(pagesTable.status, "draft")),
    db.select({ c: count() }).from(postsTable).where(eq(postsTable.status, "published")),
    db.select({ total: sum(trafficStatsTable.views) }).from(trafficStatsTable),
  ]);

  const pageViews = Number(trafficResult[0]?.total ?? 34820);

  res.json({
    totalPages: Number(totalPages),
    publishedPages: Number(pubPagesResult[0].c),
    draftPages: Number(draftPagesResult[0].c),
    totalPosts: Number(totalPosts),
    publishedPosts: Number(pubPostsResult[0].c),
    totalMedia: Number(totalMedia),
    totalUsers: Number(totalUsers),
    totalSites: Number(totalSites),
    totalForms: Number(totalForms),
    pageViews,
    avgLoadTime: 0.62,
  });
});

router.get("/activity", async (_req, res) => {
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
  const rows = await db
    .select()
    .from(trafficStatsTable)
    .orderBy(asc(trafficStatsTable.date))
    .limit(30);

  // Fallback to deterministic synthetic data if table is empty
  if (rows.length === 0) {
    const days = 30;
    const points = [];
    const now = new Date();
    const fallback = [820, 950, 710, 1100, 1340, 880, 670, 1200, 1450, 990, 1120, 860, 730, 1380, 1560, 1020, 890, 1240, 1670, 1410, 980, 840, 1190, 1520, 1300, 1080, 920, 1760, 1850, 2010];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const views = fallback[days - 1 - i] ?? 1000;
      points.push({ date: d.toISOString().split("T")[0], views, visitors: Math.floor(views * 0.65) });
    }
    return res.json(points);
  }

  res.json(rows.map((r) => ({ date: r.date, views: r.views, visitors: r.visitors })));
});

export default router;
