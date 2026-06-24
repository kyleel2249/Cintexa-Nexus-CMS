import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const fmt = (u: typeof usersTable.$inferSelect) => {
  const { passwordHash: _ph, ...rest } = u as any;
  return { ...rest, createdAt: u.createdAt.toISOString(), lastLoginAt: u.lastLoginAt?.toISOString() ?? null };
};

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

/** POST /api/users/:id/set-password — admin sets any user's password */
router.post("/:id/set-password", async (req, res) => {
  const id = parseInt(req.params.id);
  const { password } = req.body;
  if (!password || typeof password !== "string") return res.status(400).json({ error: "password required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, id));
  if (!user) return res.status(404).json({ error: "User not found" });

  const passwordHash = await bcrypt.hash(password, 12);
  await db.update(usersTable).set({ passwordHash } as any).where(eq(usersTable.id, id));
  res.json({ ok: true });
});

export default router;
