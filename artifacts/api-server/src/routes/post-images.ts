import { Router } from "express";
import { db, postImagesTable, postsTable, pluginsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import OpenAI from "openai";

const router = Router({ mergeParams: true });

function getClient() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
    defaultHeaders: {
      "HTTP-Referer": "https://cintexa.replit.app",
      "X-Title": "CINTEXA CMS",
    },
  });
}

async function isPluginEnabled(slug: string): Promise<boolean> {
  const [p] = await db.select({ enabled: pluginsTable.enabled }).from(pluginsTable).where(eq(pluginsTable.slug, slug));
  return p?.enabled ?? false;
}

export async function generateImagesForPost(postId: number): Promise<void> {
  if (!(await isPluginEnabled("image-generator"))) return;

  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, postId));
  if (!post) return;

  const client = getClient();
  if (!client) return;

  const basePrompt = `High quality blog article illustration for: "${post.title}". ${post.excerpt ? `Context: ${post.excerpt}` : ""}`;

  const prompts = [
    `${basePrompt} Hero banner, wide landscape, vibrant, professional editorial photography style`,
    `${basePrompt} Concept infographic style illustration, clean modern design`,
    `${basePrompt} Abstract visual metaphor, artistic, award-winning digital art`,
    `${basePrompt} Square thumbnail image, eye-catching, social media optimized`,
  ];

  await db.delete(postImagesTable).where(eq(postImagesTable.postId, postId));

  for (let i = 0; i < prompts.length; i++) {
    try {
      const response = await client.images.generate({
        model: "openai/dall-e-3",
        prompt: prompts[i],
        n: 1,
        size: i === 3 ? "1024x1024" : "1792x1024",
        quality: "standard",
      } as any);
      const url = (response as any).data?.[0]?.url;
      if (!url) continue;
      await db.insert(postImagesTable).values({
        postId,
        url,
        altText: `${post.title} - image ${i + 1}`,
        prompt: prompts[i],
        isPrimary: i === 0,
        isThumbnail: i === 3,
      });
    } catch {
      // continue generating remaining images
    }
  }
}

router.get("/", async (req, res) => {
  const postId = parseInt(req.params.id);
  const images = await db.select().from(postImagesTable).where(eq(postImagesTable.postId, postId)).orderBy(postImagesTable.createdAt);
  res.json(images.map((img) => ({ ...img, createdAt: img.createdAt.toISOString() })));
});

router.post("/generate", async (req, res) => {
  const postId = parseInt(req.params.id);
  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, postId));
  if (!post) return res.status(404).json({ error: "Post not found" });

  const client = getClient();
  if (!client) return res.status(400).json({ error: "OPENROUTER_API_KEY not configured" });

  res.json({ message: "Image generation started" });
  generateImagesForPost(postId).catch(() => {});
});

router.patch("/:imgId", async (req, res) => {
  const postId = parseInt(req.params.id);
  const imgId = parseInt(req.params.imgId);
  const { isPrimary, isThumbnail, altText } = req.body;

  if (isPrimary) {
    await db.update(postImagesTable).set({ isPrimary: false } as any).where(eq(postImagesTable.postId, postId));
  }
  if (isThumbnail) {
    await db.update(postImagesTable).set({ isThumbnail: false } as any).where(eq(postImagesTable.postId, postId));
  }

  const updates: Record<string, unknown> = {};
  if (isPrimary !== undefined) updates.is_primary = isPrimary;
  if (isThumbnail !== undefined) updates.is_thumbnail = isThumbnail;
  if (altText !== undefined) updates.alt_text = altText;

  const [img] = await db.update(postImagesTable).set(updates as any).where(eq(postImagesTable.id, imgId)).returning();
  if (!img) return res.status(404).json({ error: "Not found" });
  res.json({ ...img, createdAt: img.createdAt.toISOString() });
});

router.delete("/:imgId", async (req, res) => {
  const imgId = parseInt(req.params.imgId);
  await db.delete(postImagesTable).where(eq(postImagesTable.id, imgId));
  res.status(204).send();
});

export default router;
