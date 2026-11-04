import { Router, type IRouter, type Request, type Response } from "express";
import { handleMarketingRequest } from "../services/marketing";
import type { AuthIdentity } from "../services/marketing";

/**
 * /api/marketing/* — Marketing Management.
 * Thin adapter; domain logic lives in services/marketing.
 */
const router: IRouter = Router();

router.use(async (req: Request, res: Response) => {
  const a = (req as any).auth;
  const auth: AuthIdentity | undefined = a
    ? { sub: String(a.sub), email: a.email ?? "", platformRole: a.role, displayName: undefined }
    : undefined;
  try {
    const out = await handleMarketingRequest({
      method: req.method,
      path: req.path,
      query: req.query as Record<string, string | string[] | undefined>,
      body: req.body,
      headers: req.headers as Record<string, string | string[] | undefined>,
      auth,
      ip: req.ip,
    });
    res.setHeader("Cache-Control", "no-store");
    for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v);
    if (out.status === 204 || out.body === undefined) {
      res.status(out.status).end();
      return;
    }
    res.status(out.status).json(out.body);
  } catch {
    res.status(500).json({ error: "Internal server error", code: "internal_error" });
  }
});

export default router;
