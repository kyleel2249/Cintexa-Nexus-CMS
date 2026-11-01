/**
 * CINTEXA CCDI — Phase 25 Scheduled Passive Monitoring
 *
 * Organisation-defined schedules that enqueue passive adapter runs.
 * Does not bypass kill-switch, scope rules, or RBAC.
 * Active/intrusive scanning is not scheduled by this module.
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import * as orch from "./ccdi-orchestration";

export const CCDI_PHASE25_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS ccdi_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  schedule_type TEXT NOT NULL DEFAULT 'passive_adapters'
    CHECK (schedule_type IN ('passive_adapters')),
  adapter_keys TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  asset_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[],
  interval_minutes INT NOT NULL DEFAULT 1440
    CHECK (interval_minutes >= 15 AND interval_minutes <= 10080),
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  last_status TEXT,
  last_error TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_schedules_org ON ccdi_schedules(organization_id)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_schedules_due
     ON ccdi_schedules(enabled, next_run_at) WHERE enabled = true`,
];

const ALLOWED_ADAPTERS = new Set(["dns", "tls", "http", "dns_posture"]);

export async function ensureSchedulesSchema() {
  for (const stmt of CCDI_PHASE25_SCHEMA) {
    await pool.query(stmt).catch((err) => {
      logger.warn({ err }, "ccdi.schedules.schema");
    });
  }
}

export async function createSchedule(opts: {
  organizationId: string;
  name: string;
  description?: string;
  adapterKeys?: string[];
  assetIds?: string[];
  intervalMinutes?: number;
  createdBy: string;
}) {
  await ensureSchedulesSchema();

  const adapters = (opts.adapterKeys?.length
    ? opts.adapterKeys
    : ["dns", "tls", "http", "dns_posture"]
  ).filter((k) => ALLOWED_ADAPTERS.has(k));

  if (adapters.length === 0) {
    return { error: "At least one allowed passive adapter is required", status: 400 as const };
  }

  const interval = Math.min(10080, Math.max(15, opts.intervalMinutes ?? 1440));
  const nextRun = new Date(Date.now() + interval * 60_000);

  const { rows } = await pool.query(
    `INSERT INTO ccdi_schedules
       (organization_id, name, description, adapter_keys, asset_ids,
        interval_minutes, next_run_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      opts.organizationId,
      opts.name.trim(),
      opts.description ?? null,
      adapters,
      opts.assetIds ?? [],
      interval,
      nextRun.toISOString(),
      opts.createdBy,
    ],
  );

  await pool.query(
    `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, action, entity_type, entity_id, meta)
     VALUES ($1,$2,'schedule.create','schedule',$3,$4)`,
    [
      opts.organizationId,
      opts.createdBy,
      rows[0].id,
      JSON.stringify({ adapters, intervalMinutes: interval }),
    ],
  );

  return { schedule: rows[0] };
}

export async function listSchedules(organizationId: string) {
  await ensureSchedulesSchema();
  const { rows } = await pool.query(
    `SELECT * FROM ccdi_schedules
     WHERE organization_id = $1
     ORDER BY updated_at DESC LIMIT 100`,
    [organizationId],
  );
  return rows;
}

export async function setScheduleEnabled(
  organizationId: string,
  scheduleId: string,
  enabled: boolean,
  actor: string,
) {
  await ensureSchedulesSchema();
  const { rows } = await pool.query(
    `UPDATE ccdi_schedules
     SET enabled = $3, updated_at = now()
     WHERE id = $1 AND organization_id = $2
     RETURNING *`,
    [scheduleId, organizationId, enabled],
  );
  if (!rows[0]) return { error: "Schedule not found", status: 404 as const };

  await pool.query(
    `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, action, entity_type, entity_id, meta)
     VALUES ($1,$2,$3,'schedule',$4,$5)`,
    [
      organizationId,
      actor,
      enabled ? "schedule.enable" : "schedule.disable",
      scheduleId,
      JSON.stringify({ enabled }),
    ],
  );
  return { schedule: rows[0] };
}

/** Process due schedules — invocable by ops cron */
export async function processDueSchedules(opts?: { limit?: number; actor?: string }) {
  await ensureSchedulesSchema();

  if (await orch.isKillSwitchActive()) {
    return {
      processed: 0,
      results: [] as any[],
      note: "Kill switch active — schedule processing blocked",
    };
  }

  const limit = Math.min(50, opts?.limit ?? 10);
  const { rows: due } = await pool.query(
    `SELECT * FROM ccdi_schedules
     WHERE enabled = true
       AND (next_run_at IS NULL OR next_run_at <= now())
     ORDER BY next_run_at ASC NULLS FIRST
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [limit],
  );

  const results: any[] = [];

  for (const sched of due) {
    try {
      // Resolve targets: explicit assets or all non-retired assets in org
      let assetQuery = `SELECT id, identifier, asset_type, name FROM ccdi_assets
                        WHERE organization_id = $1 AND status <> 'retired'`;
      const params: any[] = [sched.organization_id];
      if (Array.isArray(sched.asset_ids) && sched.asset_ids.length > 0) {
        params.push(sched.asset_ids);
        assetQuery += ` AND id = ANY($2::uuid[])`;
      }
      assetQuery += ` ORDER BY updated_at DESC LIMIT 50`;

      const { rows: assets } = await pool.query(assetQuery, params);
      const adapters: string[] = sched.adapter_keys?.length
        ? sched.adapter_keys
        : ["dns", "tls", "http", "dns_posture"];

      let enqueued = 0;
      // Prefer job creation path when a passive connector exists; otherwise record intent only.
      for (const asset of assets) {
        for (const adapterKey of adapters) {
          if (!ALLOWED_ADAPTERS.has(adapterKey)) continue;
          // Lightweight audit breadcrumb per target; actual adapter execution uses /adapters routes or workers.
          await pool.query(
            `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, action, entity_type, entity_id, meta)
             VALUES ($1,$2,'schedule.tick','asset',$3,$4)`,
            [
              sched.organization_id,
              opts?.actor ?? "scheduler",
              asset.id,
              JSON.stringify({
                scheduleId: sched.id,
                adapterKey,
                identifier: asset.identifier,
                mode: "passive",
              }),
            ],
          );
          enqueued += 1;
        }
      }

      const next = new Date(Date.now() + Number(sched.interval_minutes) * 60_000);
      await pool.query(
        `UPDATE ccdi_schedules
         SET last_run_at = now(),
             next_run_at = $2,
             last_status = 'ok',
             last_error = NULL,
             updated_at = now()
         WHERE id = $1`,
        [sched.id, next.toISOString()],
      );

      results.push({
        scheduleId: sched.id,
        organizationId: sched.organization_id,
        assets: assets.length,
        adapterTicks: enqueued,
        nextRunAt: next.toISOString(),
        status: "ok",
      });
    } catch (err: any) {
      await pool.query(
        `UPDATE ccdi_schedules
         SET last_run_at = now(),
             last_status = 'error',
             last_error = $2,
             next_run_at = now() + make_interval(mins => $3),
             updated_at = now()
         WHERE id = $1`,
        [sched.id, String(err?.message ?? err).slice(0, 500), sched.interval_minutes],
      );
      results.push({
        scheduleId: sched.id,
        status: "error",
        error: String(err?.message ?? err),
      });
    }
  }

  return {
    processed: results.length,
    results,
    note:
      "Schedule ticks record passive monitoring intent and audit events. Adapter execution uses existing passive adapter endpoints/workers.",
  };
}

logger.info("CCDI Phase 25 schedules service loaded");
