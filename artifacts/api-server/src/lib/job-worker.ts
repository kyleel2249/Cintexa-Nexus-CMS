/**
 * Background workers for Sales sequences and async tool maintenance.
 * Runs in-process alongside content scheduler — not a separate Redis queue yet.
 */
import { logger } from "./logger";

let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function runSalesSequenceTick() {
  try {
    const { db, salesLeadsTable, salesActivitiesTable } = await import("@workspace/db");
    const { planSequenceActions } = await import("../services/sales-force-ops");
    const leads = await db.select().from(salesLeadsTable);
    const plan = planSequenceActions(leads as any);
    for (const step of plan.planned.slice(0, 10)) {
      await db.insert(salesActivitiesTable).values({
        leadId: step.leadId,
        actorName: "Ryan",
        action: "sequence_prepared_worker",
        summary: `${step.label} (day ${step.sequenceDay}) — worker tick`,
        detail: { theme: step.theme, reason: step.reason, execute: false },
        status: "completed",
      } as any);
    }
    if (plan.planned.length) {
      logger.info({ count: plan.planned.length }, "Sales sequence worker prepared due steps (no auto-send)");
    }
  } catch (err) {
    logger.debug({ err }, "Sales sequence worker skipped (DB or empty)");
  }
}

/** Expire in-memory note: DB is source of truth when available */
async function maintenanceTick() {
  await runSalesSequenceTick();
}

export function startJobWorkers() {
  if (intervalHandle) return intervalHandle;
  logger.info("Nexus job workers started (120s interval) — sequences prepare-only, no silent sends");
  maintenanceTick().catch((err) => logger.error(err, "Worker error"));
  intervalHandle = setInterval(() => {
    maintenanceTick().catch((err) => logger.error(err, "Worker error"));
  }, 120_000);
  return intervalHandle;
}
