import { Router } from "express";
import { db, sitesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { activityTable } from "@workspace/db";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const sites = await db.select().from(sitesTable).orderBy(sitesTable.createdAt);
    res.json(
      (sites || []).map((s) => ({
        ...s,
        status: s.status ? String(s.status) : "active",
        createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
        updatedAt: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : s.updatedAt,
      })),
    );
  } catch (err: any) {
    console.error("[sites] list failed", err);
    // Always return an array so the UI never crashes on .map
    res.status(200).json([]);
  }
});

router.post("/", async (req, res) => {
  try {
  const { name, domain, description, favicon, logo, primaryColor, language, timezone } = req.body ?? {};
  if (!name || !domain) return res.status(400).json({ error: "name and domain required" });
  const cleanDomain = String(domain).trim().replace(/\/+$/, "");

  const [site] = await db
    .insert(sitesTable)
    .values({ name: String(name).trim(), domain: cleanDomain, description, favicon, logo, primaryColor, language: language ?? "en", timezone: timezone ?? "UTC" })
    .returning();

  await db.insert(activityTable).values({ type: "create", entityType: "site", entityTitle: String(name).trim(), userName: "Admin", action: "created site" });

  res.status(201).json({ ...site, createdAt: site.createdAt.toISOString(), updatedAt: site.updatedAt.toISOString() });
  } catch (err: any) {
    console.error("[sites] create failed", err);
    res.status(500).json({ error: err?.message || "Failed to create site" });
  }
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
      updates[k] = req.body[k];
    }
  }
  updates.updatedAt = new Date();

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
