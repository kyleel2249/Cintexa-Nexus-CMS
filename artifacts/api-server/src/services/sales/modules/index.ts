import { Router } from "../core/router";
import { memberRoutes } from "./members";
import { accountRoutes } from "./accounts";
import { leadRoutes } from "./leads";
import { pipelineRoutes } from "./pipeline";
import { activityRoutes } from "./activities";
import { catalogRoutes } from "./catalog";
import { targetRoutes } from "./targets";
import { quotationRoutes } from "./quotations";
import { orderRoutes } from "./orders";
import { commissionRoutes } from "./commissions";
import { analyticsRoutes } from "./analytics";
import { retentionRoutes } from "./retention";
import { campaignRoutes } from "./campaigns";
import { competitorRoutes } from "./competitors";
import { automationRoutes } from "./automation";
import { enablementRoutes } from "./enablement";
import { adminRoutes } from "./admin";
import { searchRoutes, assistRoutes } from "./assist";
import { agentRoutes } from "./agents";
import { contextAssistRoutes } from "../agents/context";

/** Assemble every sales route into one table. Add new module route arrays here. */
export function buildRouter(): Router {
  const r = new Router();
  r.add(...memberRoutes, ...accountRoutes, ...leadRoutes, ...pipelineRoutes, ...activityRoutes, ...catalogRoutes, ...targetRoutes, ...quotationRoutes, ...orderRoutes, ...commissionRoutes, ...analyticsRoutes, ...retentionRoutes, ...campaignRoutes, ...competitorRoutes, ...automationRoutes, ...enablementRoutes, ...adminRoutes, ...searchRoutes, ...assistRoutes, ...agentRoutes, ...contextAssistRoutes);
  return r;
}
