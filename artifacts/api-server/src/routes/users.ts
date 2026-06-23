import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const fmt = (u: typeof usersTable.$inferSelect) => ({ ...u, createdAt: u.createdAt.toISOString() });

router.get("/", async (_req, res) => {
  const users = await db.select().from(usersTable).orderBy(usersTable.name);
  res.json(users.map(fmt));
});

router.post("/", async (req, res) => {
  const { name, email, role, avatar, bio } = req.body;
  if (!name || !email || !role) return res.status(400).json({ error: "name, email, role required" });
  const [user] = await db.insert(usersTable).values({ name, email, role, avatar, bio }).returning();
  res.status(201).json(fmt(user));
});

router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json(fmt(user));
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const updates: Record<string, unknown> = {};
  for (const k of ["name", "email", "role", "avatar", "bio", "status"]) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  const [user] = await db.update(usersTable).set(updates as any).where(eq(usersTable.id, id)).returning();
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json(fmt(user));
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [user] = await db.delete(usersTable).where(eq(usersTable.id, id)).returning();
  if (!user) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});

export default router;
