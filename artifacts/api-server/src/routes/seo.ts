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
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const allowed = ["siteTitle", "siteDescription", "robots", "googleAnalyticsId", "googleSearchConsoleId", "ogImage", "twitterHandle"];
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  if (!settings) {
    [settings] = await db.insert(seoSettingsTable).values({ siteTitle: "My Website", siteDescription: "", robots: "index, follow" }).returning();
  }
  const [updated] = await db.update(seoSettingsTable).set(updates as any).where(eq(seoSettingsTable.id, settings.id)).returning();
  res.json({ ...updated, updatedAt: updated.updatedAt.toISOString() });
});

router.get("/sitemap.xml", async (req, res) => {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0];
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  const xml = await generateSitemap(process.env.SITE_BASE_URL ? undefined : host ? `${proto}://${host}` : undefined);
  res.setHeader("Content-Type", "application/xml");
  res.send(xml);
});

router.get("/robots.txt", async (req, res) => {
  const [settings] = await db.select().from(seoSettingsTable);
  const robots = (settings?.robots ?? "index, follow").trim();
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0];
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  const baseUrl = (process.env.SITE_BASE_URL || (host ? `${proto}://${host}` : "")).replace(/\/$/, "");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");

  // The SEO screen lets people paste a full robots.txt. Serve it verbatim when it looks like one.
  if (/user-agent\s*:/i.test(robots)) {
    const hasSitemap = /^sitemap\s*:/im.test(robots);
    return res.send(hasSitemap || !baseUrl ? robots : `${robots}\n\nSitemap: ${baseUrl}/api/seo/sitemap.xml`);
  }

  const isNoindex = robots.includes("noindex");
  const lines = ["User-agent: *", isNoindex ? "Disallow: /" : "Allow: /", ""];
  if (baseUrl) lines.push(`Sitemap: ${baseUrl}/api/seo/sitemap.xml`);
  res.send(lines.join("\n"));
});

router.get("/redirects", async (_req, res) => {
  const redirects = await db.select().from(redirectsTable).orderBy(redirectsTable.createdAt);
  res.json(redirects.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.post("/redirects", async (req, res) => {
  const from = String(req.body?.from ?? "").trim();
  const to = String(req.body?.to ?? "").trim();
  const type = [301, 302, 307, 308].includes(Number(req.body?.type)) ? Number(req.body.type) : 301;
  if (!from || !to) return res.status(400).json({ error: "from and to required" });
  if (!from.startsWith("/")) return res.status(400).json({ error: "The 'from' path must start with /" });
  if (from === to) return res.status(400).json({ error: "A redirect cannot point to itself" });
  const existing = await db.select().from(redirectsTable).where(eq(redirectsTable.from, from));
  if (existing.length) return res.status(409).json({ error: `A redirect from ${from} already exists` });
  const [redirect] = await db.insert(redirectsTable).values({ from, to, type }).returning();
  res.status(201).json({ ...redirect, createdAt: redirect.createdAt.toISOString() });
});

router.delete("/redirects/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [redirect] = await db.delete(redirectsTable).where(eq(redirectsTable.id, id)).returning();
  if (!redirect) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});

export default router;
