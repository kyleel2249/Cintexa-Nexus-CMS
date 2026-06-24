import { Router } from "express";
import { db, pagesTable, pageRevisionsTable, activityTable } from "@workspace/db";
import { eq, and, desc, gt, isNotNull } from "drizzle-orm";

const router = Router();

function serializePage(p: typeof pagesTable.$inferSelect) {
  return {
    ...p,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    publishedAt: p.publishedAt?.toISOString() ?? null,
    scheduledAt: p.scheduledAt?.toISOString() ?? null,
  };
}

function serializeRevision(r: typeof pageRevisionsTable.$inferSelect) {
  return { ...r, createdAt: r.createdAt.toISOString() };
}

async function snapshotPage(
  pageId: number,
  page: typeof pagesTable.$inferSelect,
  savedBy: string,
  label?: string
) {
  await db.insert(pageRevisionsTable).values({
    pageId,
    title: page.title,
    slug: page.slug,
    status: page.status,
    template: page.template ?? null,
    content: page.content ?? null,
    metaTitle: page.metaTitle ?? null,
    metaDescription: page.metaDescription ?? null,
    featuredImage: page.featuredImage ?? null,
    savedBy,
    label: label ?? null,
  });
}

// ── List pages ───────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const { siteId, status } = req.query;
  let query = db.select().from(pagesTable).$dynamic();
  const conditions = [];
  if (siteId) conditions.push(eq(pagesTable.siteId, parseInt(siteId as string)));
  if (status) conditions.push(eq(pagesTable.status, status as string));
  if (conditions.length > 0) query = query.where(and(...conditions));
  const pages = await query.orderBy(pagesTable.updatedAt);
  res.json(pages.map(serializePage));
});

// ── Create page ──────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const { siteId, title, slug, template, content, metaTitle, metaDescription, featuredImage } = req.body;
  if (!title || !slug) return res.status(400).json({ error: "title and slug required" });
  const [page] = await db
    .insert(pagesTable)
    .values({ siteId, title, slug, template, content, metaTitle, metaDescription, featuredImage })
    .returning();
  await Promise.all([
    snapshotPage(page.id, page, "Admin", "Initial version"),
    db.insert(activityTable).values({ type: "create", entityType: "page", entityTitle: title, userName: "Admin", action: "created page" }),
  ]);
  res.status(201).json(serializePage(page));
});

// ── Get page ─────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const [page] = await db.select().from(pagesTable).where(eq(pagesTable.id, id));
  if (!page) return res.status(404).json({ error: "Not found" });
  res.json(serializePage(page));
});

// ── Update page (auto-snapshots every save) ───────────────────────────────────
router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const [current] = await db.select().from(pagesTable).where(eq(pagesTable.id, id));
  if (!current) return res.status(404).json({ error: "Not found" });

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const fieldMap: Record<string, string> = {
    metaTitle: "metaTitle",
    metaDescription: "metaDescription",
    featuredImage: "featuredImage",
  };
  const allowed = ["title", "slug", "status", "template", "content", "metaTitle", "metaDescription", "featuredImage"];
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[fieldMap[k] ?? k] = req.body[k];
  }

  const [page] = await db.update(pagesTable).set(updates as any).where(eq(pagesTable.id, id)).returning();

  const savedBy = (req.headers["x-user-name"] as string) || "Admin";
  const label = req.body.status === "published" ? "Published" : undefined;
  await Promise.all([
    snapshotPage(id, page, savedBy, label),
    db.insert(activityTable).values({ type: "update", entityType: "page", entityTitle: page.title, userName: savedBy, action: "updated page" }),
  ]);

  res.json(serializePage(page));
});

// ── Delete page ───────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [page] = await db.delete(pagesTable).where(eq(pagesTable.id, id)).returning();
  if (!page) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});

// ── Publish page ──────────────────────────────────────────────────────────────
router.post("/:id/publish", async (req, res) => {
  const id = parseInt(req.params.id);
  const [page] = await db
    .update(pagesTable)
    .set({ status: "published", publishedAt: new Date(), scheduledAt: null, updatedAt: new Date() })
    .where(eq(pagesTable.id, id))
    .returning();
  if (!page) return res.status(404).json({ error: "Not found" });
  const savedBy = (req.headers["x-user-name"] as string) || "Admin";
  await Promise.all([
    snapshotPage(id, page, savedBy, "Published"),
    db.insert(activityTable).values({ type: "publish", entityType: "page", entityTitle: page.title, userName: savedBy, action: "published page" }),
  ]);
  res.json(serializePage(page));
});

// ── Schedule page ─────────────────────────────────────────────────────────────
router.post("/:id/schedule", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const { scheduledAt } = req.body;
  if (!scheduledAt) return res.status(400).json({ error: "scheduledAt is required" });
  const date = new Date(scheduledAt);
  if (isNaN(date.getTime())) return res.status(400).json({ error: "Invalid scheduledAt date" });
  if (date <= new Date()) return res.status(400).json({ error: "scheduledAt must be in the future" });

  const [page] = await db
    .update(pagesTable)
    .set({ status: "scheduled", scheduledAt: date, updatedAt: new Date() })
    .where(eq(pagesTable.id, id))
    .returning();
  if (!page) return res.status(404).json({ error: "Not found" });
  const savedBy = (req.headers["x-user-name"] as string) || "Admin";
  await db.insert(activityTable).values({
    type: "update",
    entityType: "page",
    entityTitle: page.title,
    userName: savedBy,
    action: `scheduled page to publish on ${date.toISOString()}`,
  });
  res.json(serializePage(page));
});

// ── Duplicate page ────────────────────────────────────────────────────────────
router.post("/:id/duplicate", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const [source] = await db.select().from(pagesTable).where(eq(pagesTable.id, id));
  if (!source) return res.status(404).json({ error: "Not found" });

  const baseSlug = `${source.slug}-copy`;
  const existing = await db.select({ slug: pagesTable.slug }).from(pagesTable);
  const slugSet = new Set(existing.map((r) => r.slug));
  let slug = baseSlug;
  if (slugSet.has(slug)) slug = `${baseSlug}-${Date.now()}`;

  const [copy] = await db
    .insert(pagesTable)
    .values({
      siteId: source.siteId,
      title: `Copy of ${source.title}`,
      slug,
      template: source.template,
      content: source.content,
      metaTitle: source.metaTitle,
      metaDescription: source.metaDescription,
      featuredImage: source.featuredImage,
      status: "draft",
      sourceId: id,
    })
    .returning();

  const savedBy = (req.headers["x-user-name"] as string) || "Admin";
  await Promise.all([
    snapshotPage(copy.id, copy, savedBy, "Initial version (duplicated)"),
    db.insert(activityTable).values({
      type: "create",
      entityType: "page",
      entityTitle: copy.title,
      userName: savedBy,
      action: `duplicated page from "${source.title}"`,
    }),
  ]);
  res.status(201).json(serializePage(copy));
});

// ── Recurring schedule ────────────────────────────────────────────────────────
router.post("/:id/recurring", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const { scheduledDates } = req.body;
  if (!Array.isArray(scheduledDates) || scheduledDates.length === 0) {
    return res.status(400).json({ error: "scheduledDates array is required" });
  }
  const [source] = await db.select().from(pagesTable).where(eq(pagesTable.id, id));
  if (!source) return res.status(404).json({ error: "Not found" });

  const existing = await db.select({ slug: pagesTable.slug }).from(pagesTable);
  const slugSet = new Set(existing.map((r) => r.slug));
  const savedBy = (req.headers["x-user-name"] as string) || "Admin";

  const created: (typeof pagesTable.$inferSelect)[] = [];
  for (const rawDate of scheduledDates) {
    const scheduledAt = new Date(rawDate);
    if (isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) continue;

    const baseSlug = `${source.slug}-copy`;
    let slug = baseSlug;
    let attempt = 0;
    while (slugSet.has(slug)) {
      attempt++;
      slug = `${baseSlug}-${Date.now()}-${attempt}`;
    }
    slugSet.add(slug);

    const [copy] = await db
      .insert(pagesTable)
      .values({
        siteId: source.siteId,
        title: `Copy of ${source.title}`,
        slug,
        template: source.template,
        content: source.content,
        metaTitle: source.metaTitle,
        metaDescription: source.metaDescription,
        featuredImage: source.featuredImage,
        status: "scheduled",
        scheduledAt,
        sourceId: id,
      })
      .returning();

    await snapshotPage(copy.id, copy, savedBy, "Initial version (recurring schedule)");
    created.push(copy);
  }

  await db.insert(activityTable).values({
    type: "create",
    entityType: "page",
    entityTitle: source.title,
    userName: savedBy,
    action: `created recurring schedule with ${created.length} copies`,
  });

  res.status(201).json({ created: created.length, ids: created.map((c) => c.id) });
});

// ── Pause series ──────────────────────────────────────────────────────────────
router.post("/:sourceId/series/pause", async (req, res) => {
  const sourceId = parseInt(req.params.sourceId);
  if (isNaN(sourceId)) return res.status(400).json({ error: "Invalid sourceId" });
  const now = new Date();
  const updated = await db
    .update(pagesTable)
    .set({ status: "draft", updatedAt: now })
    .where(
      and(
        eq(pagesTable.sourceId, sourceId),
        eq(pagesTable.status, "scheduled"),
        gt(pagesTable.scheduledAt!, now)
      )
    )
    .returning({ id: pagesTable.id });
  const savedBy = (req.headers["x-user-name"] as string) || "Admin";
  if (updated.length > 0) {
    await db.insert(activityTable).values({
      type: "update",
      entityType: "page",
      entityTitle: `Series #${sourceId}`,
      userName: savedBy,
      action: `paused recurring series — ${updated.length} entr${updated.length === 1 ? "y" : "ies"} suspended`,
    });
  }
  res.json({ paused: updated.length });
});

// ── Resume series ─────────────────────────────────────────────────────────────
router.post("/:sourceId/series/resume", async (req, res) => {
  const sourceId = parseInt(req.params.sourceId);
  if (isNaN(sourceId)) return res.status(400).json({ error: "Invalid sourceId" });
  const now = new Date();
  const updated = await db
    .update(pagesTable)
    .set({ status: "scheduled", updatedAt: now })
    .where(
      and(
        eq(pagesTable.sourceId, sourceId),
        eq(pagesTable.status, "draft"),
        isNotNull(pagesTable.scheduledAt),
        gt(pagesTable.scheduledAt!, now)
      )
    )
    .returning({ id: pagesTable.id });
  const savedBy = (req.headers["x-user-name"] as string) || "Admin";
  if (updated.length > 0) {
    await db.insert(activityTable).values({
      type: "update",
      entityType: "page",
      entityTitle: `Series #${sourceId}`,
      userName: savedBy,
      action: `resumed recurring series — ${updated.length} entr${updated.length === 1 ? "y" : "ies"} reactivated`,
    });
  }
  res.json({ resumed: updated.length });
});

// ── Schedule history ──────────────────────────────────────────────────────────
router.get("/:id/schedule-history", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const copies = await db
    .select()
    .from(pagesTable)
    .where(eq(pagesTable.sourceId, id))
    .orderBy(pagesTable.scheduledAt);
  res.json(copies.map(serializePage));
});

// ── Unschedule page ───────────────────────────────────────────────────────────
router.delete("/:id/schedule", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const [page] = await db
    .update(pagesTable)
    .set({ status: "draft", scheduledAt: null, updatedAt: new Date() })
    .where(eq(pagesTable.id, id))
    .returning();
  if (!page) return res.status(404).json({ error: "Not found" });
  res.json(serializePage(page));
});

// ── List revisions ────────────────────────────────────────────────────────────
router.get("/:id/revisions", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const revisions = await db
    .select()
    .from(pageRevisionsTable)
    .where(eq(pageRevisionsTable.pageId, id))
    .orderBy(desc(pageRevisionsTable.createdAt));
  res.json(revisions.map(serializeRevision));
});

// ── Get single revision ───────────────────────────────────────────────────────
router.get("/:id/revisions/:revisionId", async (req, res) => {
  const id = parseInt(req.params.id);
  const revisionId = parseInt(req.params.revisionId);
  const [revision] = await db
    .select()
    .from(pageRevisionsTable)
    .where(and(eq(pageRevisionsTable.id, revisionId), eq(pageRevisionsTable.pageId, id)));
  if (!revision) return res.status(404).json({ error: "Revision not found" });
  res.json(serializeRevision(revision));
});

// ── Restore revision ──────────────────────────────────────────────────────────
router.post("/:id/revisions/:revisionId/restore", async (req, res) => {
  const id = parseInt(req.params.id);
  const revisionId = parseInt(req.params.revisionId);

  const [revision] = await db
    .select()
    .from(pageRevisionsTable)
    .where(and(eq(pageRevisionsTable.id, revisionId), eq(pageRevisionsTable.pageId, id)));
  if (!revision) return res.status(404).json({ error: "Revision not found" });

  const [current] = await db.select().from(pagesTable).where(eq(pagesTable.id, id));
  if (current) {
    const savedBy = (req.headers["x-user-name"] as string) || "Admin";
    await snapshotPage(id, current, savedBy, "Auto-saved before restore");
  }

  const [restored] = await db
    .update(pagesTable)
    .set({
      title: revision.title,
      slug: revision.slug,
      status: revision.status,
      template: revision.template,
      content: revision.content,
      metaTitle: revision.metaTitle,
      metaDescription: revision.metaDescription,
      featuredImage: revision.featuredImage,
      updatedAt: new Date(),
    })
    .where(eq(pagesTable.id, id))
    .returning();

  const savedBy = (req.headers["x-user-name"] as string) || "Admin";
  await Promise.all([
    snapshotPage(id, restored, savedBy, `Restored from revision #${revisionId}`),
    db.insert(activityTable).values({
      type: "update",
      entityType: "page",
      entityTitle: restored.title,
      userName: savedBy,
      action: `restored page to revision from ${revision.createdAt.toISOString()}`,
    }),
  ]);

  res.json(serializePage(restored));
});

export default router;
