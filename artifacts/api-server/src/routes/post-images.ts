import { Router } from "express";
import { db, postImagesTable, postsTable, pluginsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { COVER_SPECS, coverDataUri } from "../lib/cover-art";

const router = Router({ mergeParams: true });

async function isPluginEnabled(slug: string): Promise<boolean> {
  const [p] = await db.select({ enabled: pluginsTable.enabled }).from(pluginsTable).where(eq(pluginsTable.slug, slug));
  return p?.enabled ?? false;
}

export async function generateImagesForPost(postId: number): Promise<void> {
  if (!(await isPluginEnabled("image-generator"))) return;

  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, postId));
  if (!post) return;

  await db.delete(postImagesTable).where(eq(postImagesTable.postId, postId));

  const salt = String(Date.now());
  for (let i = 0; i < COVER_SPECS.length; i++) {
    const spec = COVER_SPECS[i]!;
    await db.insert(postImagesTable).values({
      postId,
      url: coverDataUri(post.title, spec, i === 0 ? "" : salt),
      altText: `${post.title} - ${spec.label.toLowerCase()}`,
      prompt: `Generated locally: ${spec.label} (${spec.width}x${spec.height})`,
      isPrimary: i === 0,
      isThumbnail: spec.kind === "thumbnail",
    });
  }
}

router.get("/", async (req, res) => {
  const postId = parseInt((req.params as Record<string, string>).id);
  const images = await db.select().from(postImagesTable).where(eq(postImagesTable.postId, postId)).orderBy(postImagesTable.createdAt);
  res.json(images.map((img) => ({ ...img, createdAt: img.createdAt.toISOString() })));
});

router.post("/generate", async (req, res) => {
  const postId = parseInt((req.params as Record<string, string>).id);
  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, postId));
  if (!post) return res.status(404).json({ error: "Post not found" });

  res.json({ message: "Image generation started" });
  generateImagesForPost(postId).catch(() => {});
});

router.patch("/:imgId", async (req, res) => {
  const postId = parseInt((req.params as Record<string, string>).id);
  const imgId = parseInt((req.params as Record<string, string>).imgId);
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
  const imgId = parseInt((req.params as Record<string, string>).imgId);
  await db.delete(postImagesTable).where(eq(postImagesTable.id, imgId));
  res.status(204).send();
});

export default router;
