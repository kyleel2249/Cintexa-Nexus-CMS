import { Router, type IRouter, type Request, type Response } from "express";
import { createSalesDb, pool } from "@workspace/db";
import { handleSentinelRequest } from "../services/sentinel/router";
import type { Db } from "../services/sentinel/types";
import { logger } from "../lib/logger";

/**
 * /api/sentinel/* - thin adapter. Authentication is the platform's apiGuard (Firebase token or legacy JWT; API keys are
 * refused by the Sentinel layer). Every query is scoped to the authenticated owner; see services/sentinel.
 * Responses are never cached: they contain (encrypted) credential material.
 */
const router: IRouter = Router();
let db: Db | undefined;
const getDb = (): Db => (db ??= createSalesDb(pool) as unknown as Db);

router.use(async (req: Request, res: Response) => {
  const a = req.auth;
  const out = await handleSentinelRequest(
    getDb(),
    {
      method: req.method, path: req.path, query: req.query as Record<string, string | string[] | undefined>, body: req.body,
      identity: a ? { ownerId: `${a.firebase ? "fb" : "jwt"}:${String(a.sub)}` } : undefined, isApiKey: a?.role === "api",
    },
    (msg, meta) => logger.error({ meta }, msg),
  );
  res.setHeader("Cache-Control", "no-store");
  res.status(out.status);
  if (out.body === undefined) res.end(); else res.json(out.body);
});

export default router;
