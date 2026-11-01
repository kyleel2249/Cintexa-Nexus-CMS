/**
 * CINTEXA CCDI — Phase 17 operational metrics (JSON)
 * Evidence-backed counts only — no fabricated series.
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import * as orch from "./ccdi-orchestration";
import * as engines from "./ccdi-engines";
import * as sla from "./ccdi-sla";

export async function collectCcdiMetrics(organizationId?: string | null) {
  const kill = await orch.isKillSwitchActive().catch(() => false);
  const params: any[] = [];
  let orgFilter = "";
  if (organizationId) {
    params.push(organizationId);
    orgFilter = `AND organization_id = $1`;
  }

  const [orgs, jobs, findings, evidence, webhooks, outbox] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS total FROM ccdi_organizations WHERE status = 'active'`,
    ),
    pool.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE status = 'queued')::int AS queued,
         count(*) FILTER (WHERE status = 'running')::int AS running,
         count(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM ccdi_jobs WHERE true ${orgFilter}`,
      params,
    ),
    engines.findingsSummary(organizationId),
    pool.query(
      `SELECT count(*)::int AS total FROM ccdi_evidence WHERE true ${orgFilter}`,
      params,
    ),
    pool.query(
      `SELECT count(*)::int AS endpoints
       FROM ccdi_webhook_endpoints WHERE status = 'active' ${organizationId ? "AND organization_id = $1" : ""}`,
      organizationId ? [organizationId] : [],
    ).catch(() => ({ rows: [{ endpoints: 0 }] })),
    pool.query(
      `SELECT
         count(*) FILTER (WHERE status = 'pending')::int AS pending,
         count(*) FILTER (WHERE status = 'dead')::int AS dead
       FROM ccdi_webhook_outbox WHERE true ${orgFilter}`,
      params,
    ).catch(() => ({ rows: [{ pending: 0, dead: 0 }] })),
  ]);

  let slaSnapshot = null as Awaited<ReturnType<typeof sla.slaBreaches>> | null;
  if (organizationId) {
    slaSnapshot = await sla.slaBreaches(organizationId).catch(() => null);
  }

  return {
    module: "ccdi",
    phase: 17,
    collectedAt: new Date().toISOString(),
    killSwitchActive: kill,
    organizationsActive: orgs.rows[0]?.total ?? 0,
    jobs: jobs.rows[0] ?? { total: 0, queued: 0, running: 0, failed: 0 },
    findings,
    evidenceTotal: evidence.rows[0]?.total ?? 0,
    webhooks: {
      activeEndpoints: webhooks.rows[0]?.endpoints ?? 0,
      outboxPending: outbox.rows[0]?.pending ?? 0,
      outboxDead: outbox.rows[0]?.dead ?? 0,
    },
    sla: slaSnapshot,
    note: "All metrics are derived from live database records.",
  };
}

logger.info("CCDI Phase 17 metrics service loaded");
