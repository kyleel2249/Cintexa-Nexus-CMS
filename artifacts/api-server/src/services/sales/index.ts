import { pool, createSalesDb } from "@workspace/db";
import { buildRouter } from "./modules";
import { dispatch, type Deps } from "./core/router";
import { handleEvents } from "./modules/automation";
import { runSalesJobs } from "./jobs";
import type { Integrations } from "./integrations/providers";
import type { SalesRequest, SalesResponse } from "./core/types";
import { logger } from "../../lib/logger";

/**
 * Provider registry. Sales reports inventory, invoicing, e-mail, WhatsApp and AI as "not connected" until an adapter
 * is registered here AND switched on in Sales Settings -> Integrations. No adapter ships in this release because none
 * could be verified against a live service; add one by assigning to this object at start-up, e.g.
 *   import { integrations } from "./services/sales"; integrations.email = myEmailAdapter;
 */
export const integrations: Integrations = {};

const router = buildRouter();
const db = createSalesDb(pool);
const deps: Deps = {
  now: () => new Date(),
  integrations,
  log: { info: (o, m) => logger.info(o as object, m), warn: (o, m) => logger.warn(o as object, m), error: (o, m) => logger.error(o as object, m) },
  onCommitted: (events, ctx) => handleEvents(events, ctx),
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
