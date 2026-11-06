import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { actorFromPlatform, createIntelligence, handleIntelligence } from "@workspace/intelligence";

/**
 * /api/intelligence/* - thin Express adapter over the shared handler in lib/intelligence (the same code runs on-device).
 * apiGuard (mounted before this router) attaches the built-in operator identity.
 * No external model is used: every answer comes from the built-in deterministic engine.
 * Deployment == organisation: one CMS deployment is one business, so orgId is "default".
 */
const router: IRouter = Router();

router.use(async (req: Request, res: Response) => {
  const a = req.auth;
  try {
    const i = createIntelligence({ db: pool as never, llm: null, websiteTools: true });
    const out = await handleIntelligence(i, {
      method: req.method, path: req.path, query: req.query as Record<string, string | string[] | undefined>, body: req.body,
      headers: req.headers as Record<string, string | string[] | undefined>,
      actor: a ? actorFromPlatform(String(a.sub), a.role) : null,
    });
    res.setHeader("Cache-Control", "no-store");
    res.status(out.status).json(out.body ?? {});
  } catch {
    res.status(500).json({ error: "Internal server error", code: "internal_error" });
  }
});

export default router;
