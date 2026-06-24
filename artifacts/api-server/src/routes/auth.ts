import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET ?? "cintexa-dev-secret-change-in-production";
const TOKEN_TTL = "7d";
const COOKIE_NAME = "cintexa_token";

function signToken(user: { id: number; email: string; role: string }) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function safeUser(u: typeof usersTable.$inferSelect) {
  const { passwordHash: _ph, ...rest } = u as any;
  return { ...rest, createdAt: u.createdAt.toISOString(), lastLoginAt: u.lastLoginAt?.toISOString() ?? null };
}

function setTokenCookie(res: any, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

/** POST /api/auth/register */
router.post("/register", async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "name, email, and password are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email));
  if (existing.length > 0) {
    return res.status(409).json({ error: "An account with that email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const assignedRole = role === "admin" ? "admin" : "editor";

  const [user] = await db
    .insert(usersTable)
    .values({ name, email, role: assignedRole, passwordHash, status: "active" })
    .returning();

  const token = signToken(user);
  setTokenCookie(res, token);
  res.status(201).json({ token, user: safeUser(user) });
});

/** POST /api/auth/login */
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  if (user.status === "inactive") {
    return res.status(403).json({ error: "Your account has been deactivated. Contact an administrator." });
  }
  if (!user.passwordHash) {
    return res.status(401).json({ error: "This account has no password set. Use the admin panel to set one." });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  await db.update(usersTable).set({ lastLoginAt: new Date() } as any).where(eq(usersTable.id, user.id));

  const token = signToken(user);
  setTokenCookie(res, token);
  res.json({ token, user: safeUser(user) });
});

/** POST /api/auth/logout */
router.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

/** GET /api/auth/me */
router.get("/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  const cookieToken = (req as any).cookies?.[COOKIE_NAME];
  const raw = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : cookieToken;

  if (!raw) return res.status(401).json({ error: "Not authenticated" });

  try {
    const payload = jwt.verify(raw, JWT_SECRET) as { sub: number };
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.sub));
    if (!user) return res.status(401).json({ error: "User not found" });
    res.json({ user: safeUser(user) });
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
});

/** POST /api/auth/change-password */
router.post("/change-password", async (req, res) => {
  const authHeader = req.headers.authorization;
  const cookieToken = (req as any).cookies?.[COOKIE_NAME];
  const raw = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : cookieToken;
  if (!raw) return res.status(401).json({ error: "Not authenticated" });

  let payload: { sub: number };
  try {
    payload = jwt.verify(raw, JWT_SECRET) as { sub: number };
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: "currentPassword and newPassword required" });
  if (newPassword.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters" });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.sub));
  if (!user) return res.status(404).json({ error: "User not found" });

  if (user.passwordHash) {
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Current password is incorrect" });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.update(usersTable).set({ passwordHash } as any).where(eq(usersTable.id, user.id));
  res.json({ ok: true });
});

export default router;
