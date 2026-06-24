import { Router } from "express";
import { db, socialBroadcastsTable, postsTable, pluginsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router({ mergeParams: true });

async function isPluginEnabled(slug: string): Promise<boolean> {
  const [p] = await db.select({ enabled: pluginsTable.enabled }).from(pluginsTable).where(eq(pluginsTable.slug, slug));
  return p?.enabled ?? false;
}

async function broadcastToTwitter(post: typeof postsTable.$inferSelect): Promise<{ id?: string; error?: string }> {
  const bearer = process.env.TWITTER_BEARER_TOKEN;
  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    return { error: "Twitter credentials not configured" };
  }

  try {
    const { TwitterApi } = await import("twitter-api-v2");
    const client = new TwitterApi({ appKey: apiKey, appSecret: apiSecret, accessToken, accessSecret });
    const text = `${post.title}\n\n${post.excerpt ?? ""}\n\n#cms #content`.slice(0, 280);
    const { data } = await client.v2.tweet(text);
    return { id: data.id };
  } catch (err: any) {
    return { error: err?.message ?? "Unknown error" };
  }
}

async function broadcastToFacebook(post: typeof postsTable.$inferSelect): Promise<{ id?: string; error?: string }> {
  const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const pageId = process.env.FACEBOOK_PAGE_ID;
  if (!pageToken || !pageId) return { error: "Facebook credentials not configured" };

  try {
    const resp = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `${post.title}\n\n${post.excerpt ?? ""}`,
        access_token: pageToken,
      }),
    });
    const json = (await resp.json()) as any;
    if (json.error) return { error: json.error.message };
    return { id: json.id };
  } catch (err: any) {
    return { error: err?.message ?? "Unknown error" };
  }
}

async function broadcastToLinkedIn(post: typeof postsTable.$inferSelect): Promise<{ id?: string; error?: string }> {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const orgId = process.env.LINKEDIN_ORG_ID;
  if (!token) return { error: "LinkedIn credentials not configured" };

  try {
    const author = orgId ? `urn:li:organization:${orgId}` : undefined;
    if (!author) return { error: "LINKEDIN_ORG_ID not configured" };

    const resp = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        author,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text: `${post.title}\n\n${post.excerpt ?? ""}` },
            shareMediaCategory: "NONE",
          },
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
      }),
    });
    const json = (await resp.json()) as any;
    if (json.status && json.status !== 201) return { error: json.message ?? "LinkedIn error" };
    return { id: json.id };
  } catch (err: any) {
    return { error: err?.message ?? "Unknown error" };
  }
}

export async function broadcastPost(postId: number): Promise<void> {
  if (!(await isPluginEnabled("social-broadcast"))) return;

  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, postId));
  if (!post) return;

  const platforms: Array<{ name: string; fn: () => Promise<{ id?: string; error?: string }> }> = [
    { name: "twitter", fn: () => broadcastToTwitter(post) },
    { name: "facebook", fn: () => broadcastToFacebook(post) },
    { name: "linkedin", fn: () => broadcastToLinkedIn(post) },
  ];

  for (const { name, fn } of platforms) {
    const [existing] = await db.insert(socialBroadcastsTable).values({
      postId,
      platform: name,
      status: "pending",
    }).returning();

    const result = await fn();
    await db.update(socialBroadcastsTable).set({
      status: result.error ? "failed" : "sent",
      externalId: result.id ?? null,
      error: result.error ?? null,
      sentAt: result.error ? null : new Date(),
    } as any).where(eq(socialBroadcastsTable.id, existing.id));
  }
}

router.get("/", async (req, res) => {
  const postId = parseInt(req.params.id);
  const rows = await db.select().from(socialBroadcastsTable).where(eq(socialBroadcastsTable.postId, postId)).orderBy(socialBroadcastsTable.createdAt);
  res.json(rows.map((r) => ({
    ...r,
    sentAt: r.sentAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  })));
});

router.post("/", async (req, res) => {
  const postId = parseInt(req.params.id);
  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, postId));
  if (!post) return res.status(404).json({ error: "Post not found" });
  res.json({ message: "Broadcast started" });
  broadcastPost(postId).catch(() => {});
});

export default router;
