import { Router } from "express";
import { db, socialBroadcastsTable, postsTable, pluginsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { SHARE_PLATFORMS, buildShareText } from "../lib/share-text";

const router = Router({ mergeParams: true });

async function isPluginEnabled(slug: string): Promise<boolean> {
  const [p] = await db.select({ enabled: pluginsTable.enabled }).from(pluginsTable).where(eq(pluginsTable.slug, slug));
  return p?.enabled ?? false;
}

/**
 * Prepares a share pack (one record per platform). Nothing is sent to any outside service: records are marked
 * "ready" and the editor shows the text to copy. Status never claims a post was published to a social network.
 */
export async function broadcastPost(postId: number): Promise<void> {
  if (!(await isPluginEnabled("social-broadcast"))) return;
  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, postId));
  if (!post) return;

  await db.delete(socialBroadcastsTable).where(eq(socialBroadcastsTable.postId, postId));
  for (const platform of SHARE_PLATFORMS) {
    await db.insert(socialBroadcastsTable).values({ postId, platform, status: "ready" });
  }
}

router.get("/", async (req, res) => {
  const postId = parseInt((req.params as Record<string, string>).id);
  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, postId));
  const rows = await db.select().from(socialBroadcastsTable).where(eq(socialBroadcastsTable.postId, postId)).orderBy(socialBroadcastsTable.createdAt);
  res.json(
    rows.map((r) => ({
      ...r,
      shareText: post && (SHARE_PLATFORMS as string[]).includes(r.platform) ? buildShareText(r.platform as any, post) : null,
      sentAt: r.sentAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

router.post("/", async (req, res) => {
  const postId = parseInt((req.params as Record<string, string>).id);
  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, postId));
  if (!post) return res.status(404).json({ error: "Post not found" });
  if (!(await isPluginEnabled("social-broadcast"))) return res.status(400).json({ error: "Enable the Social Share Pack plugin first." });
  await broadcastPost(postId);
  res.json({ message: "Share pack prepared" });
});

export default router;
