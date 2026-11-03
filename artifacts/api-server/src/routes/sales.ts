import { Router, type IRouter, type Request, type Response } from "express";
import { handleSalesRequest } from "../services/sales";
import type { AuthIdentity } from "../services/sales/core/types";

/**
 * /api/sales/* - thin adapter. All authentication mapping, authorisation, validation, transactions, idempotency and
 * error mapping live in services/sales/core/router.ts so they can be tested without Express.
 * There is no authentication: apiGuard attaches the built-in operator identity.
 */
const router: IRouter = Router();

router.use(async (req: Request, res: Response) => {
  const a = req.auth;
  const auth: AuthIdentity | undefined = a ? { sub: String(a.sub), email: a.email ?? "", platformRole: a.role, displayName: undefined } : undefined;
  try {
    const out = await handleSalesRequest({
      method: req.method, path: req.path, query: req.query as Record<string, string | string[] | undefined>,
      body: req.body, headers: req.headers as Record<string, string | string[] | undefined>, auth, ip: req.ip,
    });
    res.setHeader("Cache-Control", "no-store");
    for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v);
    if (out.raw) {
      res.status(out.status).type(out.raw.contentType);
      if (out.raw.filename) res.setHeader("Content-Disposition", `attachment; filename="${out.raw.filename.replace(/[^\w.\-]/g, "_")}"`);
      res.send(out.raw.data);
      return;
    }
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
