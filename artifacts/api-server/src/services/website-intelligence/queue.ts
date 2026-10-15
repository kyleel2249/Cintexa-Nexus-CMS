import { logger } from "../../lib/logger";
import { runAudit, abortAudit, isRunning } from "./engine";
import { loadWiSettings } from "./settings";
import * as store from "./store";

const pending: string[] = [];
let active = 0;
let pumping = false;
const MAX_ATTEMPTS = 3;

export function queueDepth(): { pending: number; active: number } { return { pending: pending.length, active }; }

export function enqueueAudit(id: string): void {
  if (!pending.includes(id) && !isRunning(id)) pending.push(id);
  void pump();
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    const { limits } = await loadWiSettings();
    while (active < limits.maxGlobalConcurrentAudits && pending.length) {
      const id = pending.shift() as string;
      active++;
      runAudit(id)
        .catch(async (err) => {
          logger.error({ err, auditId: id }, "Website audit crashed");
          await store.patchAudit(id, { status: "failed", error: (err as Error).message, completedAt: new Date() }).catch(() => undefined);
        })
        .finally(() => { active--; void pump(); });
    }
  } finally {
    pumping = false;
  }
}

export async function cancelAudit(id: string): Promise<void> {
  await store.requestCancel(id);
  abortAudit(id);
  const i = pending.indexOf(id);
  if (i >= 0) {
    pending.splice(i, 1);
    await store.patchAudit(id, { status: "cancelled", completedAt: new Date() });
  }
}

/** Re-queues audits that were queued or interrupted by a restart. Idempotent: an audit that keeps crashing is failed after MAX_ATTEMPTS. */
export async function recoverAudits(): Promise<number> {
  const rows = await store.recoverable(120);
  let n = 0;
  for (const r of rows) {
    if (isRunning(r.id) || pending.includes(r.id)) continue;
    if (r.status === "running") {
      if (r.attempts + 1 >= MAX_ATTEMPTS) { await store.patchAudit(r.id, { status: "failed", error: "The audit was interrupted repeatedly and was stopped.", completedAt: new Date() }); continue; }
      await store.resetForRetry(r.id);
    }
    pending.push(r.id);
    n++;
  }
  if (n) logger.info({ n }, "Website audits re-queued after restart");
  void pump();
  return n;
}

let lastPurge = 0;
async function tick(): Promise<void> {
  try {
    for (const m of await store.dueMonitors()) {
      const audit = await store.createAudit({ ownerId: m.ownerId, ownerEmail: null, hostname: m.hostname, cfg: m.config, monitorId: m.id, workspace: m.workspace });
      await store.patchMonitor(m.id, { nextRunAt: store.nextRun(m.frequency), lastRunAt: new Date() });
      await store.addEvent(audit.id, "info", null, `Created by scheduled monitor ${m.id} (${m.frequency}).`);
      enqueueAudit(audit.id);
    }
    if (Date.now() - lastPurge > 24 * 3600_000) {
      lastPurge = Date.now();
      const { limits } = await loadWiSettings();
      const n = await store.purgeExpired(limits.retentionDays);
      if (n) logger.info({ n }, "Website audits purged by retention policy");
    }
    await recoverAudits();
  } catch (err) {
    logger.error({ err }, "Website intelligence scheduler error");
  }
}

export function startWebsiteIntelligence(): NodeJS.Timeout {
  void recoverAudits().catch((err) => logger.error({ err }, "Website audit recovery failed"));
  logger.info("Website Intelligence engine started (60s monitor tick)");
  return setInterval(() => void tick(), 60_000);
}
