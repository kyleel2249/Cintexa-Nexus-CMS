import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { ModelRouter, actorFromPlatform, createIntelligence, handleIntelligence } from "@workspace/intelligence";
import type { Provider, RouteConfig } from "@workspace/intelligence";
import { getOpenRouterClient, getOpenRouterModel } from "../lib/openrouter";

/**
 * /api/intelligence/* - thin Express adapter over the shared handler in lib/intelligence (the same code runs on-device).
 * apiGuard (mounted before this router) has already authenticated the caller. API keys are refused: Intelligence can
 * propose and, with approval, perform business actions, so it needs an accountable human identity.
 * Deployment == organisation: one CMS deployment is one business, so orgId is "default".
 */
const router: IRouter = Router();
const ROUTE: RouteConfig = { model: "openai/gpt-4o-mini", maxTokens: 700, timeoutMs: 20_000, retries: 1, maxCostUsd: 0.05 };

async function buildLlm(): Promise<ModelRouter | null> {
  const client = await getOpenRouterClient().catch(() => null);
  if (!client) return null;
  const model = await getOpenRouterModel().catch(() => ROUTE.model);
  const provider: Provider = async (r) => {
    const res = await client.chat.completions.create({ model: r.model || model, max_tokens: r.maxTokens, response_format: { type: "json_object" }, messages: [{ role: "system", content: r.system }, { role: "user", content: r.user }] }, { signal: r.signal });
    return { text: res.choices[0]?.message?.content ?? "", usage: { promptTokens: res.usage?.prompt_tokens ?? 0, completionTokens: res.usage?.completion_tokens ?? 0, costUsd: 0 } };
  };
  return new ModelRouter(provider, { executive_summary: { ...ROUTE, model } }, { ...ROUTE, model });
}

router.use(async (req: Request, res: Response) => {
  const a = req.auth;
  if (a?.role === "api") { res.status(403).json({ error: "API keys cannot use Intelligence", code: "forbidden" }); return; }
  try {
    const i = createIntelligence({ db: pool as never, llm: await buildLlm(), websiteTools: true });
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
