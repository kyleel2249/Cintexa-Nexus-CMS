import { pool, createSalesDb } from "@workspace/db";
import { buildRouter } from "./modules";
// Server-only: web research uses Node networking (DNS/TCP, SSRF guard) and must never be bundled into the on-device (browser) Sales runtime.
import { researchRoutes } from "./research/routes";
import { dispatch, type Deps } from "./core/router";
import { handleEvents } from "./modules/automation";
import { runSalesJobs } from "./jobs";
import { recordEvents } from "./agents/events";
import type { Integrations } from "./integrations/providers";
import type { SalesRequest, SalesResponse } from "./core/types";
import { logger } from "../../lib/logger";
import { nullFinanceProvider, createHttpFinanceProvider } from "./integrations/providers";

/**
 * Provider registry. Sales reports inventory, invoicing, e-mail and WhatsApp as "not connected" until an adapter
 * is registered here AND switched on in Sales Settings -> Integrations. Agent narration is built in (native, deterministic) and needs no provider.
 * Finance: set CINTEXA_FINANCE_API_BASE (e.g. https://host/api/finance) to post invoices/payments with narratives.
 */
const salesDb = createSalesDb(pool);

const financeBase = (typeof process !== "undefined" && process.env.CINTEXA_FINANCE_API_BASE) || "";
const financeProvider = financeBase.trim()
  ? createHttpFinanceProvider(financeBase.trim())
  : nullFinanceProvider;

export const integrations: Integrations = {
  finance: financeProvider,
};

const router = buildRouter();
router.add(...researchRoutes);
const db = salesDb;
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
