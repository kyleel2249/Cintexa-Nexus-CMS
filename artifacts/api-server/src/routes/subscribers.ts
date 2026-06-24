import { Router } from "express";
import { db, subscribersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";

const router = Router();

function makeToken() {
  return randomBytes(24).toString("hex");
}

function serialize(s: typeof subscribersTable.$inferSelect) {
  return { ...s, createdAt: s.createdAt.toISOString() };
}

router.get("/", async (_req, res) => {
  const rows = await db.select().from(subscribersTable).orderBy(subscribersTable.createdAt);
  res.json(rows.map(serialize));
});

router.post("/", async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: "email required" });
  const existing = await db.select({ id: subscribersTable.id }).from(subscribersTable).where(eq(subscribersTable.email, email));
  if (existing.length > 0) return res.status(409).json({ error: "Email already subscribed" });
  const [row] = await db.insert(subscribersTable).values({ email, name: name || null, status: "active", unsubscribeToken: makeToken() }).returning();
  res.status(201).json(serialize(row));
});

router.post("/import", async (req, res) => {
  const { subscribers } = req.body;
  if (!Array.isArray(subscribers)) return res.status(400).json({ error: "subscribers array required" });
  let added = 0;
  let skipped = 0;
  for (const s of subscribers) {
    if (!s.email) { skipped++; continue; }
    const existing = await db.select({ id: subscribersTable.id }).from(subscribersTable).where(eq(subscribersTable.email, s.email));
    if (existing.length > 0) { skipped++; continue; }
    await db.insert(subscribersTable).values({ email: s.email, name: s.name || null, status: "active", unsubscribeToken: makeToken() });
    added++;
  }
  res.json({ added, skipped });
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, status } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (status !== undefined) updates.status = status;
  const [row] = await db.update(subscribersTable).set(updates as any).where(eq(subscribersTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(serialize(row));
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db.delete(subscribersTable).where(eq(subscribersTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});

router.get("/unsubscribe", async (req, res) => {
  const token = req.query.token as string;
  if (!token) return res.status(400).send("Invalid link");
  const [sub] = await db.select().from(subscribersTable).where(eq(subscribersTable.unsubscribeToken, token));
  if (!sub) return res.status(404).send("Subscription not found");
  await db.update(subscribersTable).set({ status: "unsubscribed" } as any).where(eq(subscribersTable.id, sub.id));
  res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>You've been unsubscribed</h2><p>You will no longer receive emails from this site.</p></body></html>`);
});

export default router;
