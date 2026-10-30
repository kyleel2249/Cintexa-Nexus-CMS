import { pool, createSalesDb } from "@workspace/db";
import { buildRouter } from "./modules";
// Server-only: web research uses Node networking (DNS/TCP, SSRF guard) and must never be bundled into the on-device (browser) Sales runtime.
import { researchRoutes } from "./research/routes";
import { dispatch, type Deps } from "./core/router";
import { handleEvents } from "./modules/automation";
import { runSalesJobs } from "./jobs";
import { recordEvents } from "./agents/events";
import { createOpenRouterProvider } from "./agents/llm";
import { resolveOpenRouterApiKey, getOpenRouterSettings } from "../../lib/openrouter";
import type { Integrations } from "./integrations/providers";
import type { SalesRequest, SalesResponse } from "./core/types";
import { logger } from "../../lib/logger";

/**
 * Provider registry. Sales reports inventory, invoicing, e-mail, WhatsApp and AI as "not connected" until an adapter
 * is registered here AND switched on in Sales Settings -> Integrations. No adapter ships in this release because none
 * could be verified against a live service; add one by assigning to this object at start-up, e.g.
 *   import { integrations } from "./services/sales"; integrations.email = myEmailAdapter;
 */
export const integrations: Integrations = {
  // OpenRouter adapter for agent narration and the contextual assistant. It is inert until an administrator turns on
  // Sales Settings -> Integrations -> AI AND allows an external provider; the API key is read from the platform OpenRouter
  // settings or OPENROUTER_API_KEY at call time and is never stored in code. If it is missing, agents stay deterministic.
  ai: createOpenRouterProvider({
    resolveKey: () => resolveOpenRouterApiKey(),
    defaultModel: async () => { try { return (await getOpenRouterSettings()).model; } catch { return "openai/gpt-4o-mini"; } },
  }),
};

const router = buildRouter();
router.add(...researchRoutes);
const db = createSalesDb(pool);
const deps: Deps = {
  now: () => new Date(),
  integrations,
  log: { info: (o, m) => logger.info(o as object, m), warn: (o, m) => logger.warn(o as object, m), error: (o, m) => logger.error(o as object, m) },
  onCommitted: async (events, ctx) => { await recordEvents(events, ctx); await handleEvents(events, ctx); },
};

export function handleSalesRequest(req: SalesRequest): Promise<SalesResponse> {
  return dispatch(router, db, deps, req);
}

let timer: NodeJS.Timeout | undefined;
export function startSalesJobs(intervalMs = 60_000): void {
  if (timer || process.env.SALES_JOBS === "off") return;
  const pass = () => runSalesJobs(db, deps).then((r) => logger.debug({ r }, "Sales jobs pass")).catch((err) => logger.error({ err }, "Sales jobs failed"));
  setTimeout(pass, 5_000).unref?.();
  timer = setInterval(pass, intervalMs);
  timer.unref?.();
  logger.info("Sales background jobs started");
}
