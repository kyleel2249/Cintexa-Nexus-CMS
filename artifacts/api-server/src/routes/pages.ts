import { Router } from "express";
import { db, pagesTable, activityTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

router.get("/", async (req, res) => {
  const { siteId, status } = req.query;
  let query = db.select().from(pagesTable).$dynamic();
  const conditions = [];
  if (siteId) conditions.push(eq(pagesTable.siteId, parseInt(siteId as string)));
  if (status) conditions.push(eq(pagesTable.status, status as string));
  if (conditions.length > 0) query = query.where(and(...conditions));

  const pages = await query.orderBy(pagesTable.updatedAt);
  res.json(
    pages.map((p) => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      publishedAt: p.publishedAt?.toISOString() ?? null,
    }))
  );
});

router.post("/", async (req, res) => {
  const { siteId, title, slug, template, content, metaTitle, metaDescription, featuredImage } = req.body;
  if (!title || !slug) return res.status(400).json({ error: "title and slug required" });

  const [page] = await db.insert(pagesTable).values({ siteId, title, slug, template, content, metaTitle, metaDescription, featuredImage }).returning();
  await db.insert(activityTable).values({ type: "create", entityType: "page", entityTitle: title, userName: "Admin", action: "created page" });
  res.status(201).json({ ...page, createdAt: page.createdAt.toISOString(), updatedAt: page.updatedAt.toISOString(), publishedAt: page.publishedAt?.toISOString() ?? null });
});

router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [page] = await db.select().from(pagesTable).where(eq(pagesTable.id, id));
  if (!page) return res.status(404).json({ error: "Not found" });
  res.json({ ...page, createdAt: page.createdAt.toISOString(), updatedAt: page.updatedAt.toISOString(), publishedAt: page.publishedAt?.toISOString() ?? null });
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const updates: Record<string, unknown> = { updated_at: new Date() };
  const allowed = ["title", "slug", "status", "template", "content", "metaTitle", "metaDescription", "featuredImage"];
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      const dbKey = k === "metaTitle" ? "meta_title" : k === "metaDescription" ? "meta_description" : k === "featuredImage" ? "featured_image" : k;
      updates[dbKey] = req.body[k];
    }
  }
  const [page] = await db.update(pagesTable).set(updates as any).where(eq(pagesTable.id, id)).returning();
  if (!page) return res.status(404).json({ error: "Not found" });
  await db.insert(activityTable).values({ type: "update", entityType: "page", entityTitle: page.title, userName: "Admin", action: "updated page" });
  res.json({ ...page, createdAt: page.createdAt.toISOString(), updatedAt: page.updatedAt.toISOString(), publishedAt: page.publishedAt?.toISOString() ?? null });
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [page] = await db.delete(pagesTable).where(eq(pagesTable.id, id)).returning();
  if (!page) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});

router.post("/:id/publish", async (req, res) => {
  const id = parseInt(req.params.id);
  const [page] = await db
    .update(pagesTable)
    .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(pagesTable.id, id))
    .returning();
  if (!page) return res.status(404).json({ error: "Not found" });
  await db.insert(activityTable).values({ type: "publish", entityType: "page", entityTitle: page.title, userName: "Admin", action: "published page" });
  res.json({ ...page, createdAt: page.createdAt.toISOString(), updatedAt: page.updatedAt.toISOString(), publishedAt: page.publishedAt?.toISOString() ?? null });
});

export default router;
