/**
 * Auth routes — direct-access Nexus (no user login required).
 * AUTH_MODE defaults to "open". Login/register return 410 Gone.
 * Legacy /me and logout remain for clients that still call them.
 */
import { Router } from "express";
import jwt from "jsonwebtoken";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET ?? "cintexa-dev-secret-change-in-production";
const COOKIE_NAME = "cintexa_token";

const DISABLED = {
  error: "Authentication is disabled. Nexus runs in direct-access mode (AUTH_MODE=open). No login or registration is required.",
};

router.post("/register", (_req, res) => {
  res.status(410).json(DISABLED);
});

router.post("/login", (_req, res) => {
  res.status(410).json(DISABLED);
});

router.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true, mode: "open" });
});

/** Optional identity probe — returns open-access actor when unauthenticated */
router.get("/me", async (req, res) => {
  try {
    const raw =
      (req.cookies && req.cookies[COOKIE_NAME]) ||
      (typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : null);
    if (raw) {
      try {
        const payload = jwt.verify(raw, JWT_SECRET) as { sub: number };
        const [user] = await db.select().from(usersTable).where(eq(usersTable.id, Number(payload.sub)));
        if (user) {
          const { passwordHash: _ph, ...rest } = user as any;
          return res.json({
            user: {
              ...rest,
              createdAt: user.createdAt.toISOString(),
              lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
            },
            mode: "open",
          });
        }
      } catch {
        /* fall through to open actor */
      }
    }
  } catch {
    /* ignore */
  }
  res.json({
    user: {
      id: 0,
      email: process.env.OPEN_ACCESS_EMAIL ?? "open-access@cintexa.local",
      name: "Open Access",
      role: "admin",
      openAccess: true,
    },
    mode: "open",
  });
});

export default router;
