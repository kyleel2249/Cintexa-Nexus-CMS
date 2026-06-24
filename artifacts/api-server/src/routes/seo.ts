import { Router } from "express";
import { db, seoSettingsTable, redirectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateSitemap } from "../lib/publish-pipeline";

const router = Router();

router.get("/settings", async (_req, res) => {
  let [settings] = await db.select().from(seoSettingsTable);
  if (!settings) {
    [settings] = await db.insert(seoSettingsTable).values({ siteTitle: "My Website", siteDescription: "", robots: "index, follow" }).returning();
  }
  res.json({ ...settings, updatedAt: settings.updatedAt.toISOString() });
});

router.patch("/settings", async (req, res) => {
  let [settings] = await db.select().from(seoSettingsTable);
  const updates: Record<string, unknown> = { updated_at: new Date() };
  const map: Record<string, string> = {
    siteTitle: "site_title", siteDescription: "site_description", robots: "robots",
    googleAnalyticsId: "google_analytics_id", googleSearchConsoleId: "google_search_console_id",
    ogImage: "og_image", twitterHandle: "twitter_handle",
  };
  for (const [k, v] of Object.entries(map)) {
    if (req.body[k] !== undefined) updates[v] = req.body[k];
  }
  if (!settings) {
    [settings] = await db.insert(seoSettingsTable).values({ siteTitle: "My Website", siteDescription: "", robots: "index, follow" }).returning();
  }
  const [updated] = await db.update(seoSettingsTable).set(updates as any).where(eq(seoSettingsTable.id, settings.id)).returning();
  res.json({ ...updated, updatedAt: updated.updatedAt.toISOString() });
});

router.get("/sitemap.xml", async (_req, res) => {
  const xml = await generateSitemap();
  res.setHeader("Content-Type", "application/xml");
  res.send(xml);
});

router.get("/robots.txt", async (_req, res) => {
  const [settings] = await db.select().from(seoSettingsTable);
  const robotsMeta = settings?.robots ?? "index, follow";
  const baseUrl = process.env.SITE_BASE_URL ?? "https://cintexa.replit.app";

  const isNoindex = robotsMeta.includes("noindex");
  const isNofollow = robotsMeta.includes("nofollow");

  const lines = [
    "User-agent: *",
    isNoindex ? "Disallow: /" : "Allow: /",
    "",
    `Sitemap: ${baseUrl}/api/seo/sitemap.xml`,
  ];
  res.setHeader("Content-Type", "text/plain");
  res.send(lines.join("\n"));
});

router.get("/redirects", async (_req, res) => {
  const redirects = await db.select().from(redirectsTable).orderBy(redirectsTable.createdAt);
  res.json(redirects.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.post("/redirects", async (req, res) => {
  const { from, to, type } = req.body;
  if (!from || !to) return res.status(400).json({ error: "from and to required" });
  const [redirect] = await db.insert(redirectsTable).values({ from, to, type: type ?? 301 }).returning();
  res.status(201).json({ ...redirect, createdAt: redirect.createdAt.toISOString() });
});

router.delete("/redirects/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [redirect] = await db.delete(redirectsTable).where(eq(redirectsTable.id, id)).returning();
  if (!redirect) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});

export default router;
