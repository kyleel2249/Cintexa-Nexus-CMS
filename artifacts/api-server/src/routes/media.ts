import { Router } from "express";
import { db, mediaTable } from "@workspace/db";
import { eq, ilike, and, desc } from "drizzle-orm";
import { dispatchWebhook } from "../lib/webhooks";

const router = Router();

router.get("/", async (req, res) => {
  const { type, search } = req.query;
  let query = db.select().from(mediaTable).$dynamic();
  const conditions = [];
  if (type && type !== "all") conditions.push(ilike(mediaTable.mimeType, `${type}%`));
  if (search) conditions.push(ilike(mediaTable.originalName, `%${search}%`));
  if (conditions.length > 0) query = query.where(and(...conditions));

  const items = await query.orderBy(desc(mediaTable.createdAt));
  res.json(items.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })));
});

router.post("/", async (req, res) => {
  const { filename, originalName, mimeType, size, url, altText, caption, width, height } = req.body;
  if (!filename || !originalName || !mimeType || !size || !url) {
    return res.status(400).json({ error: "filename, originalName, mimeType, size, url required" });
  }
  const [item] = await db.insert(mediaTable).values({ filename, originalName, mimeType, size, url, altText, caption, width, height }).returning();
  dispatchWebhook("media.uploaded", { id: item.id, name: item.originalName, mimeType: item.mimeType, size: item.size });
  res.status(201).json({ ...item, createdAt: item.createdAt.toISOString() });
});

router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [item] = await db.select().from(mediaTable).where(eq(mediaTable.id, id));
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json({ ...item, createdAt: item.createdAt.toISOString() });
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const updates: Record<string, unknown> = {};
  if (req.body.altText !== undefined) updates.altText = req.body.altText;
  if (req.body.caption !== undefined) updates.caption = req.body.caption;
  if (Object.keys(updates).length === 0) {
    const [current] = await db.select().from(mediaTable).where(eq(mediaTable.id, id));
    if (!current) return res.status(404).json({ error: "Not found" });
    return res.json({ ...current, createdAt: current.createdAt.toISOString() });
  }
  const [item] = await db.update(mediaTable).set(updates as any).where(eq(mediaTable.id, id)).returning();
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json({ ...item, createdAt: item.createdAt.toISOString() });
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [item] = await db.delete(mediaTable).where(eq(mediaTable.id, id)).returning();
  if (!item) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});

export default router;
