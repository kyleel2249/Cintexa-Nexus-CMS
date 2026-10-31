import { pool, createSalesDb } from "@workspace/db";
import { dispatch, type Deps } from "./core/router";
import { organisationRoutes } from "./modules/organisations";
import { accountRoutes } from "./modules/accounts";
import { periodRoutes } from "./modules/periods";
import { journalRoutes } from "./modules/journals";
import { reportRoutes } from "./modules/reports";
import { logger } from "../../lib/logger";
import type { Db, FinanceRequest, FinanceResponse } from "./core/types";

export const financeRoutes = [...organisationRoutes, ...accountRoutes, ...periodRoutes, ...journalRoutes, ...reportRoutes];
export const financeDeps: Deps = { now: () => new Date(), log: { error: (o, m) => logger.error(o as object, m) } };
export { dispatch };

let db: Db | undefined;
/** Server PostgreSQL stays the source of truth for posted financial records. */
export function handleFinanceRequest(req: FinanceRequest): Promise<FinanceResponse> {
  const d = (db ??= createSalesDb(pool));
  return dispatch(financeRoutes, d, financeDeps, req);
}
