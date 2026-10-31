import { Router, type IRouter, type Request, type Response } from "express";
import { handleFinanceRequest } from "../services/finance";

/** /api/finance/* - thin adapter; auth mapping, RBAC, validation, transactions and error mapping live in services/finance/core/router.ts. */
const router: IRouter = Router();

router.use(async (req: Request, res: Response) => {
  const a = req.auth;
  try {
    const out = await handleFinanceRequest({
      method: req.method, path: req.path, query: req.query as Record<string, string | string[] | undefined>, body: req.body,
      headers: req.headers as Record<string, string | string[] | undefined>, ip: req.ip,
      auth: a ? { sub: String(a.sub), email: a.email ?? "", platformRole: a.role, isApiKey: a.role === "api" } : undefined,
    });
    for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v);
    if (out.raw) {
      res.status(out.status).type(out.raw.contentType);
      if (out.raw.filename) res.setHeader("Content-Disposition", `attachment; filename="${out.raw.filename.replace(/[^\w.\-]/g, "_")}"`);
      res.send(out.raw.data); return;
    }
    if (out.status === 204 || out.body === undefined) { res.status(out.status).end(); return; }
    res.status(out.status).json(out.body);
  } catch { res.status(500).json({ error: "Internal server error", code: "internal_error" }); }
});

export default router;
