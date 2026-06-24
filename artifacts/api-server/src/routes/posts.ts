import { Router } from "express";
import { db, postsTable, usersTable, categoriesTable, activityTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

async function enrichPost(post: typeof postsTable.$inferSelect) {
  let authorName: string | null = null;
  let categoryName: string | null = null;

  if (post.authorId) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, post.authorId));
    authorName = u?.name ?? null;
  }
  if (post.categoryId) {
    const [c] = await db.select({ name: categoriesTable.name }).from(categoriesTable).where(eq(categoriesTable.id, post.categoryId));
    categoryName = c?.name ?? null;
  }
  return {
    ...post,
    authorName,
    categoryName,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    publishedAt: post.publishedAt?.toISOString() ?? null,
    scheduledAt: post.scheduledAt?.toISOString() ?? null,
  };
}

router.get("/", async (req, res) => {
  const { status, categoryId } = req.query;
  let query = db.select().from(postsTable).$dynamic();
  const conditions = [];
  if (status) conditions.push(eq(postsTable.status, status as string));
  if (categoryId) conditions.push(eq(postsTable.categoryId, parseInt(categoryId as string)));
  if (conditions.length > 0) query = query.where(and(...conditions));

  const posts = await query.orderBy(postsTable.updatedAt);
  const enriched = await Promise.all(posts.map(enrichPost));
  res.json(enriched);
});

router.post("/", async (req, res) => {
  const { title, slug, excerpt, content, authorId, categoryId, featuredImage, metaTitle, metaDescription } = req.body;
  if (!title || !slug) return res.status(400).json({ error: "title and slug required" });

  const wordCount = content ? content.split(/\s+/).length : 0;
  const readingTime = Math.ceil(wordCount / 200);

  const [post] = await db.insert(postsTable).values({ title, slug, excerpt, content, authorId, categoryId, featuredImage, metaTitle, metaDescription, readingTime }).returning();
  await db.insert(activityTable).values({ type: "create", entityType: "post", entityTitle: title, userName: "Admin", action: "created post" });
  res.status(201).json(await enrichPost(post));
});

router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, id));
  if (!post) return res.status(404).json({ error: "Not found" });
  res.json(await enrichPost(post));
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const updates: Record<string, unknown> = { updated_at: new Date() };
  const allowed = ["title", "slug", "status", "excerpt", "content", "authorId", "categoryId", "featuredImage", "metaTitle", "metaDescription"];
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      const map: Record<string, string> = { authorId: "author_id", categoryId: "category_id", featuredImage: "featured_image", metaTitle: "meta_title", metaDescription: "meta_description" };
      updates[map[k] ?? k] = req.body[k];
    }
  }
  if (req.body.content) {
    const wc = req.body.content.split(/\s+/).length;
    updates["reading_time"] = Math.ceil(wc / 200);
  }
  const [post] = await db.update(postsTable).set(updates as any).where(eq(postsTable.id, id)).returning();
  if (!post) return res.status(404).json({ error: "Not found" });
  await db.insert(activityTable).values({ type: "update", entityType: "post", entityTitle: post.title, userName: "Admin", action: "updated post" });
  res.json(await enrichPost(post));
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [post] = await db.delete(postsTable).where(eq(postsTable.id, id)).returning();
  if (!post) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});

router.post("/:id/publish", async (req, res) => {
  const id = parseInt(req.params.id);
  const [post] = await db.update(postsTable).set({ status: "published", publishedAt: new Date(), scheduledAt: null, updatedAt: new Date() }).where(eq(postsTable.id, id)).returning();
  if (!post) return res.status(404).json({ error: "Not found" });
  await db.insert(activityTable).values({ type: "publish", entityType: "post", entityTitle: post.title, userName: "Admin", action: "published post" });
  res.json(await enrichPost(post));
});

// ── Schedule post ─────────────────────────────────────────────────────────────
router.post("/:id/schedule", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const { scheduledAt } = req.body;
  if (!scheduledAt) return res.status(400).json({ error: "scheduledAt is required" });
  const date = new Date(scheduledAt);
  if (isNaN(date.getTime())) return res.status(400).json({ error: "Invalid scheduledAt date" });
  if (date <= new Date()) return res.status(400).json({ error: "scheduledAt must be in the future" });

  const [post] = await db
    .update(postsTable)
    .set({ status: "scheduled", scheduledAt: date, updatedAt: new Date() })
    .where(eq(postsTable.id, id))
    .returning();
  if (!post) return res.status(404).json({ error: "Not found" });
  const savedBy = (req.headers["x-user-name"] as string) || "Admin";
  await db.insert(activityTable).values({
    type: "update",
    entityType: "post",
    entityTitle: post.title,
    userName: savedBy,
    action: `scheduled post to publish on ${date.toISOString()}`,
  });
  res.json(await enrichPost(post));
});

// ── Duplicate post ────────────────────────────────────────────────────────────
router.post("/:id/duplicate", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const [source] = await db.select().from(postsTable).where(eq(postsTable.id, id));
  if (!source) return res.status(404).json({ error: "Not found" });

  const baseSlug = `${source.slug}-copy`;
  // Make slug unique by appending a timestamp suffix if needed
  const existing = await db.select({ slug: postsTable.slug }).from(postsTable);
  const slugSet = new Set(existing.map((r) => r.slug));
  let slug = baseSlug;
  if (slugSet.has(slug)) slug = `${baseSlug}-${Date.now()}`;

  const [copy] = await db
    .insert(postsTable)
    .values({
      title: `Copy of ${source.title}`,
      slug,
      excerpt: source.excerpt,
      content: source.content,
      authorId: source.authorId,
      categoryId: source.categoryId,
      featuredImage: source.featuredImage,
      metaTitle: source.metaTitle,
      metaDescription: source.metaDescription,
      readingTime: source.readingTime,
      status: "draft",
      sourceId: id,
    })
    .returning();
  await db.insert(activityTable).values({
    type: "create",
    entityType: "post",
    entityTitle: copy.title,
    userName: "Admin",
    action: `duplicated post from "${source.title}"`,
  });
  res.status(201).json(await enrichPost(copy));
});

// ── Recurring schedule ────────────────────────────────────────────────────────
router.post("/:id/recurring", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const { scheduledDates } = req.body;
  if (!Array.isArray(scheduledDates) || scheduledDates.length === 0) {
    return res.status(400).json({ error: "scheduledDates array is required" });
  }
  const [source] = await db.select().from(postsTable).where(eq(postsTable.id, id));
  if (!source) return res.status(404).json({ error: "Not found" });

  const existing = await db.select({ slug: postsTable.slug }).from(postsTable);
  const slugSet = new Set(existing.map((r) => r.slug));

  const created: (typeof postsTable.$inferSelect)[] = [];
  for (const rawDate of scheduledDates) {
    const scheduledAt = new Date(rawDate);
    if (isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) continue;

    // Build unique slug
    const baseSlug = `${source.slug}-copy`;
    let slug = baseSlug;
    let attempt = 0;
    while (slugSet.has(slug)) {
      attempt++;
      slug = `${baseSlug}-${Date.now()}-${attempt}`;
    }
    slugSet.add(slug);

    const [copy] = await db
      .insert(postsTable)
      .values({
        title: `Copy of ${source.title}`,
        slug,
        excerpt: source.excerpt,
        content: source.content,
        authorId: source.authorId,
        categoryId: source.categoryId,
        featuredImage: source.featuredImage,
        metaTitle: source.metaTitle,
        metaDescription: source.metaDescription,
        readingTime: source.readingTime,
        status: "scheduled",
        scheduledAt,
        sourceId: id,
      })
      .returning();
    created.push(copy);
  }

  await db.insert(activityTable).values({
    type: "create",
    entityType: "post",
    entityTitle: source.title,
    userName: "Admin",
    action: `created recurring schedule with ${created.length} copies`,
  });

  res.status(201).json({ created: created.length, ids: created.map((c) => c.id) });
});

// ── Schedule history ──────────────────────────────────────────────────────────
router.get("/:id/schedule-history", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const copies = await db
    .select()
    .from(postsTable)
    .where(eq(postsTable.sourceId, id))
    .orderBy(postsTable.scheduledAt);
  const enriched = await Promise.all(copies.map(enrichPost));
  res.json(enriched);
});

// ── Unschedule post ───────────────────────────────────────────────────────────
router.delete("/:id/schedule", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const [post] = await db
    .update(postsTable)
    .set({ status: "draft", scheduledAt: null, updatedAt: new Date() })
    .where(eq(postsTable.id, id))
    .returning();
  if (!post) return res.status(404).json({ error: "Not found" });
  res.json(await enrichPost(post));
});

export default router;
