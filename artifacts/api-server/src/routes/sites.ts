import { Router } from "express";
import { db, sitesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { activityTable } from "@workspace/db";

const router = Router();

router.get("/", async (_req, res) => {
  const sites = await db.select().from(sitesTable).orderBy(sitesTable.createdAt);
  res.json(
    sites.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }))
  );
});

router.post("/", async (req, res) => {
  const { name, domain, description, favicon, logo, primaryColor, language, timezone } = req.body;
  if (!name || !domain) return res.status(400).json({ error: "name and domain required" });

  const [site] = await db
    .insert(sitesTable)
    .values({ name, domain, description, favicon, logo, primaryColor, language: language ?? "en", timezone: timezone ?? "UTC" })
    .returning();

  await db.insert(activityTable).values({ type: "create", entityType: "site", entityTitle: name, userName: "Admin", action: "created site" });

  res.status(201).json({ ...site, createdAt: site.createdAt.toISOString(), updatedAt: site.updatedAt.toISOString() });
});

router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, id));
  if (!site) return res.status(404).json({ error: "Not found" });
  res.json({ ...site, createdAt: site.createdAt.toISOString(), updatedAt: site.updatedAt.toISOString() });
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const updates: Record<string, unknown> = {};
  const allowed = ["name", "domain", "description", "favicon", "logo", "status", "primaryColor", "language", "timezone"];
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      const dbKey = k === "primaryColor" ? "primary_color" : k;
      updates[dbKey] = req.body[k];
    }
  }
  updates["updated_at"] = new Date();

  const [site] = await db.update(sitesTable).set(updates as any).where(eq(sitesTable.id, id)).returning();
  if (!site) return res.status(404).json({ error: "Not found" });
  await db.insert(activityTable).values({ type: "update", entityType: "site", entityTitle: site.name, userName: "Admin", action: "updated site" });
  res.json({ ...site, createdAt: site.createdAt.toISOString(), updatedAt: site.updatedAt.toISOString() });
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [site] = await db.delete(sitesTable).where(eq(sitesTable.id, id)).returning();
  if (!site) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});

export default router;
