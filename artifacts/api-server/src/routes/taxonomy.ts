import { Router } from "express";
import { db, categoriesTable, tagsTable, postsTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";

const router = Router();

// Categories
router.get("/categories", async (_req, res) => {
  const cats = await db.select().from(categoriesTable).orderBy(categoriesTable.name);
  const enriched = await Promise.all(
    cats.map(async (c) => {
      const [{ cnt }] = await db.select({ cnt: count() }).from(postsTable).where(eq(postsTable.categoryId, c.id));
      return { ...c, postCount: Number(cnt), createdAt: c.createdAt.toISOString() };
    })
  );
  res.json(enriched);
});

router.post("/categories", async (req, res) => {
  const { name, slug, description } = req.body;
  if (!name || !slug) return res.status(400).json({ error: "name and slug required" });
  const [cat] = await db.insert(categoriesTable).values({ name, slug, description }).returning();
  res.status(201).json({ ...cat, postCount: 0, createdAt: cat.createdAt.toISOString() });
});

router.patch("/categories/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const updates: Record<string, unknown> = {};
  for (const k of ["name", "slug", "description"]) if (req.body[k] !== undefined) updates[k] = req.body[k];
  const [cat] = await db.update(categoriesTable).set(updates as any).where(eq(categoriesTable.id, id)).returning();
  if (!cat) return res.status(404).json({ error: "Not found" });
  const [{ cnt }] = await db.select({ cnt: count() }).from(postsTable).where(eq(postsTable.categoryId, cat.id));
  res.json({ ...cat, postCount: Number(cnt), createdAt: cat.createdAt.toISOString() });
});

router.delete("/categories/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [cat] = await db.delete(categoriesTable).where(eq(categoriesTable.id, id)).returning();
  if (!cat) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});

// Tags
router.get("/tags", async (_req, res) => {
  const tags = await db.select().from(tagsTable).orderBy(tagsTable.name);
  res.json(tags.map((t) => ({ ...t, postCount: 0, createdAt: t.createdAt.toISOString() })));
});

router.post("/tags", async (req, res) => {
  const { name, slug } = req.body;
  if (!name || !slug) return res.status(400).json({ error: "name and slug required" });
  const [tag] = await db.insert(tagsTable).values({ name, slug }).returning();
  res.status(201).json({ ...tag, postCount: 0, createdAt: tag.createdAt.toISOString() });
});

router.delete("/tags/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [tag] = await db.delete(tagsTable).where(eq(tagsTable.id, id)).returning();
  if (!tag) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});

export default router;
