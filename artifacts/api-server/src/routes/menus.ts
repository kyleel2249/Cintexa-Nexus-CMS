import { Router } from "express";
import { db, menusTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const fmt = (m: typeof menusTable.$inferSelect) => ({ ...m, createdAt: m.createdAt.toISOString() });

router.get("/", async (_req, res) => {
  const menus = await db.select().from(menusTable).orderBy(menusTable.name);
  res.json(menus.map(fmt));
});

router.post("/", async (req, res) => {
  const { name, location, items } = req.body;
  if (!name || !location) return res.status(400).json({ error: "name and location required" });
  const [menu] = await db.insert(menusTable).values({ name, location, items: items ?? "[]" }).returning();
  res.status(201).json(fmt(menu));
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const updates: Record<string, unknown> = {};
  for (const k of ["name", "location", "items"]) if (req.body[k] !== undefined) updates[k] = req.body[k];
  const [menu] = await db.update(menusTable).set(updates as any).where(eq(menusTable.id, id)).returning();
  if (!menu) return res.status(404).json({ error: "Not found" });
  res.json(fmt(menu));
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [menu] = await db.delete(menusTable).where(eq(menusTable.id, id)).returning();
  if (!menu) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});

export default router;
