import { Router } from "express";
import { db, pluginsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const BUILT_IN_PLUGINS = [
  {
    slug: "seo-auto-update",
    name: "SEO Auto-Update",
    description: "Automatically regenerates sitemap.xml and per-post SEO meta tags every time a post or page is published.",
    category: "seo",
    enabled: true,
  },
  {
    slug: "image-generator",
    name: "AI Image Generator",
    description: "Generates 3 article images plus a thumbnail using DALL-E via OpenRouter every time a post is published.",
    category: "media",
    enabled: true,
  },
  {
    slug: "subscriber-alerts",
    name: "Subscriber Email Alerts",
    description: "Sends an email notification to all active subscribers whenever a post is published.",
    category: "email",
    enabled: false,
  },
  {
    slug: "social-broadcast",
    name: "Social Broadcasting",
    description: "Automatically posts published articles to Twitter/X, Facebook, and LinkedIn.",
    category: "social",
    enabled: false,
  },
  {
    slug: "citation-validator",
    name: "Citation Validator",
    description: "Enforces at least 3 verified citation links per post before publishing. Each link is validated to confirm it points to a real article.",
    category: "content",
    enabled: true,
  },
];

export async function seedPlugins() {
  for (const plugin of BUILT_IN_PLUGINS) {
    const existing = await db.select({ id: pluginsTable.id }).from(pluginsTable).where(eq(pluginsTable.slug, plugin.slug));
    if (existing.length === 0) {
      await db.insert(pluginsTable).values({ ...plugin, config: "{}" });
    }
  }
}

router.get("/", async (_req, res) => {
  const plugins = await db.select().from(pluginsTable).orderBy(pluginsTable.createdAt);
  res.json(plugins.map((p) => ({
    ...p,
    config: JSON.parse(p.config || "{}"),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  })));
});

router.patch("/:slug", async (req, res) => {
  const { slug } = req.params;
  const { enabled, config } = req.body;
  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (enabled !== undefined) updates.enabled = enabled;
  if (config !== undefined) updates.config = JSON.stringify(config);
  const [plugin] = await db.update(pluginsTable).set(updates as any).where(eq(pluginsTable.slug, slug)).returning();
  if (!plugin) return res.status(404).json({ error: "Plugin not found" });
  res.json({ ...plugin, config: JSON.parse(plugin.config || "{}"), createdAt: plugin.createdAt.toISOString(), updatedAt: plugin.updatedAt.toISOString() });
});

export default router;
