import { Router } from "express";
import { db, postCommentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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

export default router;
