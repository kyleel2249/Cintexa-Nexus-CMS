import { Router } from "express";
import { db, postsTable, usersTable, categoriesTable, activityTable, pluginsTable } from "@workspace/db";
import { eq, and, gt, isNotNull } from "drizzle-orm";
import { runPublishPipeline } from "../lib/publish-pipeline";

const router = Router();

async function isPluginEnabled(slug: string): Promise<boolean> {
  try {
    const [p] = await db.select({ enabled: pluginsTable.enabled }).from(pluginsTable).where(eq(pluginsTable.slug, slug));
    return p?.enabled ?? false;
  } catch {
    return false;
  }
}

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
    citationLinks: post.citationLinks ? JSON.parse(post.citationLinks) : [],
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
  const { title, slug, excerpt, content, authorId, categoryId, featuredImage, metaTitle, metaDescription, keywords, citationLinks } = req.body;
  if (!title || !slug) return res.status(400).json({ error: "title and slug required" });

  const wordCount = content ? content.split(/\s+/).length : 0;
  const readingTime = Math.ceil(wordCount / 200);

  const [post] = await db.insert(postsTable).values({
    title, slug, excerpt, content, authorId, categoryId, featuredImage, metaTitle, metaDescription,
    keywords: keywords ?? null,
    citationLinks: citationLinks ? JSON.stringify(citationLinks) : null,
    readingTime,
  }).returning();
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
  const allowed = ["title", "slug", "status", "excerpt", "content", "authorId", "categoryId", "featuredImage", "metaTitle", "metaDescription", "keywords"];
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      const map: Record<string, string> = { authorId: "author_id", categoryId: "category_id", featuredImage: "featured_image", metaTitle: "meta_title", metaDescription: "meta_description" };
      updates[map[k] ?? k] = req.body[k];
    }
  }
  if (req.body.citationLinks !== undefined) {
    updates["citation_links"] = JSON.stringify(req.body.citationLinks);
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
  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, id));
  if (!post) return res.status(404).json({ error: "Not found" });

  // Citation validator enforcement
  if (await isPluginEnabled("citation-validator")) {
    const citations = post.citationLinks ? JSON.parse(post.citationLinks) : [];
    if (citations.length < 3) {
      return res.status(422).json({
        error: "Citation Validator requires at least 3 citation links before publishing.",
        citationCount: citations.length,
      });
    }
  }

  const [updated] = await db.update(postsTable)
    .set({ status: "published", publishedAt: new Date(), scheduledAt: null, updatedAt: new Date() })
    .where(eq(postsTable.id, id))
    .returning();

  await db.insert(activityTable).values({ type: "publish", entityType: "post", entityTitle: updated.title, userName: "Admin", action: "published post" });

  const enriched = await enrichPost(updated);
  res.json(enriched);

  // Run publish pipeline asynchronously (images, email, social)
  runPublishPipeline(id).catch(() => {});
});

// ── Validate citations ────────────────────────────────────────────────────────
router.post("/:id/validate-citations", async (req, res) => {
  const id = parseInt(req.params.id);
  const { citations } = req.body as { citations: Array<{ url: string; label: string; claimText: string }> };
  if (!Array.isArray(citations)) return res.status(400).json({ error: "citations array required" });

  const results = await Promise.all(
    citations.map(async (c) => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const resp = await fetch(c.url, { method: "HEAD", signal: ctrl.signal, redirect: "follow" });
        clearTimeout(timer);
        const ct = resp.headers.get("content-type") ?? "";
        const isArticle = ct.includes("text/html") || ct.includes("application/xhtml");
        return { url: c.url, valid: resp.ok && isArticle, status: resp.status };
      } catch {
        return { url: c.url, valid: false, status: 0 };
      }
    })
  );

  res.json({ results, validCount: results.filter((r) => r.valid).length });
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

  const [post] = await db.update(postsTable).set({ status: "scheduled", scheduledAt: date, updatedAt: new Date() }).where(eq(postsTable.id, id)).returning();
  if (!post) return res.status(404).json({ error: "Not found" });
  const savedBy = (req.headers["x-user-name"] as string) || "Admin";
  await db.insert(activityTable).values({ type: "update", entityType: "post", entityTitle: post.title, userName: savedBy, action: `scheduled post to publish on ${date.toISOString()}` });
  res.json(await enrichPost(post));
});

// ── Duplicate post ────────────────────────────────────────────────────────────
router.post("/:id/duplicate", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const [source] = await db.select().from(postsTable).where(eq(postsTable.id, id));
  if (!source) return res.status(404).json({ error: "Not found" });

  const baseSlug = `${source.slug}-copy`;
  const existing = await db.select({ slug: postsTable.slug }).from(postsTable);
  const slugSet = new Set(existing.map((r) => r.slug));
  let slug = baseSlug;
  if (slugSet.has(slug)) slug = `${baseSlug}-${Date.now()}`;

  const [copy] = await db.insert(postsTable).values({
    title: `Copy of ${source.title}`, slug, excerpt: source.excerpt, content: source.content,
    authorId: source.authorId, categoryId: source.categoryId, featuredImage: source.featuredImage,
    metaTitle: source.metaTitle, metaDescription: source.metaDescription, readingTime: source.readingTime,
    keywords: source.keywords, citationLinks: source.citationLinks, status: "draft", sourceId: id,
  }).returning();
  await db.insert(activityTable).values({ type: "create", entityType: "post", entityTitle: copy.title, userName: "Admin", action: `duplicated post from "${source.title}"` });
  res.status(201).json(await enrichPost(copy));
});

// ── Recurring schedule ────────────────────────────────────────────────────────
router.post("/:id/recurring", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const { scheduledDates } = req.body;
  if (!Array.isArray(scheduledDates) || scheduledDates.length === 0) return res.status(400).json({ error: "scheduledDates array is required" });
  const [source] = await db.select().from(postsTable).where(eq(postsTable.id, id));
  if (!source) return res.status(404).json({ error: "Not found" });

  const existing = await db.select({ slug: postsTable.slug }).from(postsTable);
  const slugSet = new Set(existing.map((r) => r.slug));
  const created: (typeof postsTable.$inferSelect)[] = [];

  for (const rawDate of scheduledDates) {
    const scheduledAt = new Date(rawDate);
    if (isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) continue;
    const baseSlug = `${source.slug}-copy`;
    let slug = baseSlug;
    let attempt = 0;
    while (slugSet.has(slug)) { attempt++; slug = `${baseSlug}-${Date.now()}-${attempt}`; }
    slugSet.add(slug);
    const [copy] = await db.insert(postsTable).values({
      title: `Copy of ${source.title}`, slug, excerpt: source.excerpt, content: source.content,
      authorId: source.authorId, categoryId: source.categoryId, featuredImage: source.featuredImage,
      metaTitle: source.metaTitle, metaDescription: source.metaDescription, readingTime: source.readingTime,
      keywords: source.keywords, citationLinks: source.citationLinks, status: "scheduled", scheduledAt, sourceId: id,
    }).returning();
    created.push(copy);
  }

  await db.insert(activityTable).values({ type: "create", entityType: "post", entityTitle: source.title, userName: "Admin", action: `created recurring schedule with ${created.length} copies` });
  res.status(201).json({ created: created.length, ids: created.map((c) => c.id) });
});

// ── Pause/Resume series ───────────────────────────────────────────────────────
router.post("/:sourceId/series/pause", async (req, res) => {
  const sourceId = parseInt(req.params.sourceId);
  if (isNaN(sourceId)) return res.status(400).json({ error: "Invalid sourceId" });
  const now = new Date();
  const updated = await db.update(postsTable).set({ status: "draft", updatedAt: now }).where(and(eq(postsTable.sourceId, sourceId), eq(postsTable.status, "scheduled"), gt(postsTable.scheduledAt!, now))).returning({ id: postsTable.id });
  const savedBy = (req.headers["x-user-name"] as string) || "Admin";
  if (updated.length > 0) await db.insert(activityTable).values({ type: "update", entityType: "post", entityTitle: `Series #${sourceId}`, userName: savedBy, action: `paused recurring series — ${updated.length} entr${updated.length === 1 ? "y" : "ies"} suspended` });
  res.json({ paused: updated.length });
});

router.post("/:sourceId/series/resume", async (req, res) => {
  const sourceId = parseInt(req.params.sourceId);
  if (isNaN(sourceId)) return res.status(400).json({ error: "Invalid sourceId" });
  const now = new Date();
  const updated = await db.update(postsTable).set({ status: "scheduled", updatedAt: now }).where(and(eq(postsTable.sourceId, sourceId), eq(postsTable.status, "draft"), isNotNull(postsTable.scheduledAt), gt(postsTable.scheduledAt!, now))).returning({ id: postsTable.id });
  const savedBy = (req.headers["x-user-name"] as string) || "Admin";
  if (updated.length > 0) await db.insert(activityTable).values({ type: "update", entityType: "post", entityTitle: `Series #${sourceId}`, userName: savedBy, action: `resumed recurring series — ${updated.length} entr${updated.length === 1 ? "y" : "ies"} reactivated` });
  res.json({ resumed: updated.length });
});

// ── Schedule history ──────────────────────────────────────────────────────────
router.get("/:id/schedule-history", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const copies = await db.select().from(postsTable).where(eq(postsTable.sourceId, id)).orderBy(postsTable.scheduledAt);
  const enriched = await Promise.all(copies.map(enrichPost));
  res.json(enriched);
});

// ── Unschedule post ───────────────────────────────────────────────────────────
router.delete("/:id/schedule", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const [post] = await db.update(postsTable).set({ status: "draft", scheduledAt: null, updatedAt: new Date() }).where(eq(postsTable.id, id)).returning();
  if (!post) return res.status(404).json({ error: "Not found" });
  res.json(await enrichPost(post));
});

export default router;
