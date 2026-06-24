import { Router } from "express";
import { db, postCommentsTable, postsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import { logger } from "../lib/logger";

const router = Router({ mergeParams: true });

function fmt(c: typeof postCommentsTable.$inferSelect) {
  return { ...c, createdAt: c.createdAt.toISOString() };
}

router.get("/", async (req, res) => {
  const postId = parseInt((req.params as any).id);
  const comments = await db
    .select()
    .from(postCommentsTable)
    .where(eq(postCommentsTable.postId, postId))
    .orderBy(postCommentsTable.createdAt);
  res.json(comments.map(fmt));
});

router.post("/", async (req, res) => {
  const postId = parseInt((req.params as any).id);
  const { authorName, authorEmail, content } = req.body;
  if (!authorName || !content) return res.status(400).json({ error: "authorName and content required" });
  const [c] = await db
    .insert(postCommentsTable)
    .values({ postId, authorName, authorEmail: authorEmail ?? null, content, aiGenerated: false })
    .returning();
  res.status(201).json(fmt(c));
});

router.delete("/:commentId", async (req, res) => {
  const id = parseInt(req.params.commentId);
  const [c] = await db.delete(postCommentsTable).where(eq(postCommentsTable.id, id)).returning();
  if (!c) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});

/** Generate AI comments for a post — called from publish pipeline */
export async function generateCommentsForPost(postId: number): Promise<void> {
  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, postId));
  if (!post) return;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    logger.warn("OPENROUTER_API_KEY not set — skipping comment generation");
    return;
  }

  // Names that feel like real diverse readers
  const readerProfiles = [
    { name: "Marcus Chen", email: "m.chen@example.com", angle: "professional perspective" },
    { name: "Sarah O'Brien", email: "sarah.ob@example.com", angle: "personal experience" },
    { name: "David Okafor", email: "d.okafor@example.com", angle: "curious follow-up question" },
    { name: "Priya Sharma", email: "priya.s@example.com", angle: "enthusiastic agreement with specific detail" },
    { name: "James Whitfield", email: "j.whitfield@example.com", angle: "thoughtful counterpoint" },
    { name: "Amara Lee", email: "amara.l@example.com", angle: "sharing a related experience" },
  ];

  // Pick 3 random profiles
  const shuffled = readerProfiles.sort(() => Math.random() - 0.5).slice(0, 3);

  const client = new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" });

  const postContext = [post.title, post.excerpt ?? "", (post.content ?? "").slice(0, 600)].join("\n\n");

  for (const profile of shuffled) {
    try {
      const systemPrompt = `You are ${profile.name}, a real reader leaving a comment on a blog post. 
Write ONE comment from the ${profile.angle}. Rules:
- 2–4 sentences max, conversational and genuine
- Reference something specific from the article (show you read it)
- No hashtags, no "Great article!", no emojis, no self-promotion, no links
- Sound like a real human with your own viewpoint
- Vary sentence length, use natural language`;

      const { choices } = await client.chat.completions.create({
        model: "openai/gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Article:\n${postContext}\n\nWrite your comment:` },
        ],
        max_tokens: 120,
        temperature: 0.85,
      });

      const content = choices[0]?.message?.content?.trim();
      if (!content) continue;

      // Stagger timestamps: 10–90 minutes after publish
      const minutesAgo = Math.floor(Math.random() * 80) + 10;
      const createdAt = new Date(Date.now() - minutesAgo * 60 * 1000);

      await db.insert(postCommentsTable).values({
        postId,
        authorName: profile.name,
        authorEmail: profile.email,
        content,
        aiGenerated: true,
        approved: true,
        sentiment: "positive",
        createdAt,
      });
    } catch (err) {
      logger.error({ err, profile: profile.name }, "Failed to generate comment");
    }
  }

  logger.info({ postId, count: shuffled.length }, "AI comments generated");
}

export default router;
