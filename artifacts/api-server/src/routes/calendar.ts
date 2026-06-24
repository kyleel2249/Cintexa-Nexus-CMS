import { Router } from "express";
import { db, pagesTable, postsTable, sitesTable } from "@workspace/db";
import { and, gte, lte, or, isNotNull, eq } from "drizzle-orm";

const router = Router();

// GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/", async (req, res) => {
  const { from, to } = req.query as { from?: string; to?: string };

  const fromDate = from ? new Date(from) : (() => { const d = new Date(); d.setDate(1); return d; })();
  const toDate = to ? new Date(to) : (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); d.setDate(0); return d; })();

  // Fetch sites for name lookup
  const sites = await db.select({ id: sitesTable.id, name: sitesTable.name }).from(sitesTable);
  const siteMap = new Map(sites.map(s => [s.id, s.name]));

  // Pages with scheduledAt or publishedAt in range
  const pages = await db.select().from(pagesTable).where(
    or(
      and(isNotNull(pagesTable.scheduledAt), gte(pagesTable.scheduledAt!, fromDate), lte(pagesTable.scheduledAt!, toDate)),
      and(isNotNull(pagesTable.publishedAt), gte(pagesTable.publishedAt!, fromDate), lte(pagesTable.publishedAt!, toDate))
    )
  );

  // Posts with scheduledAt or publishedAt in range
  const posts = await db.select().from(postsTable).where(
    or(
      and(isNotNull(postsTable.scheduledAt), gte(postsTable.scheduledAt!, fromDate), lte(postsTable.scheduledAt!, toDate)),
      and(isNotNull(postsTable.publishedAt), gte(postsTable.publishedAt!, fromDate), lte(postsTable.publishedAt!, toDate))
    )
  );

  const items = [
    ...pages.map(p => ({
      id: p.id,
      type: "page" as const,
      title: p.title,
      slug: p.slug,
      status: p.status,
      siteId: p.siteId ?? null,
      siteName: p.siteId ? (siteMap.get(p.siteId) ?? null) : null,
      scheduledAt: p.scheduledAt?.toISOString() ?? null,
      publishedAt: p.publishedAt?.toISOString() ?? null,
      date: (p.scheduledAt ?? p.publishedAt)!.toISOString(),
      dateType: p.scheduledAt ? "scheduled" : "published",
    })),
    ...posts.map(p => ({
      id: p.id,
      type: "post" as const,
      title: p.title,
      slug: p.slug,
      status: p.status,
      siteId: null,
      siteName: null,
      scheduledAt: p.scheduledAt?.toISOString() ?? null,
      publishedAt: p.publishedAt?.toISOString() ?? null,
      date: (p.scheduledAt ?? p.publishedAt)!.toISOString(),
      dateType: p.scheduledAt ? "scheduled" : "published",
    })),
  ];

  // Sort by date ascending
  items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  res.json(items);
});

export default router;
