/**
 * CINTEXA CCDI — Phase 19 Asset ownership verification & bulk findings
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import * as webhooks from "./ccdi-webhooks";

const ASSET_STATUSES = ["discovered", "verified", "approved", "retired", "rejected"] as const;
const FINDING_STATUSES = [
  "open",
  "confirmed",
  "in_progress",
  "resolved",
  "accepted_risk",
  "false_positive",
  "duplicate",
] as const;

export async function verifyAssetOwnership(opts: {
  assetId: string;
  organizationId: string;
  actor: string;
  decision: "verified" | "approved" | "rejected";
  note?: string;
  ownerRef?: string;
}) {
  if (!ASSET_STATUSES.includes(opts.decision as any) && !["verified", "approved", "rejected"].includes(opts.decision)) {
    return { error: "Invalid decision", status: 400 as const };
  }

  const ownershipVerified = opts.decision === "verified" || opts.decision === "approved";

  const { rows } = await pool.query(
    `UPDATE ccdi_assets SET
       status = $3,
       ownership_verified = $4,
       owner_ref = COALESCE($5, owner_ref),
       updated_at = now()
     WHERE id = $1 AND organization_id = $2 AND status <> 'retired'
     RETURNING *`,
    [
      opts.assetId,
      opts.organizationId,
      opts.decision,
      ownershipVerified,
      opts.ownerRef ?? null,
    ],
  );

  if (!rows[0]) return { error: "Asset not found", status: 404 as const };

  await pool.query(
    `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, action, entity_type, entity_id, meta)
     VALUES ($1,$2,'asset.ownership_decision','asset',$3,$4)`,
    [
      opts.organizationId,
      opts.actor,
      opts.assetId,
      JSON.stringify({ decision: opts.decision, note: opts.note ?? null, ownerRef: opts.ownerRef ?? null }),
    ],
  );

  return { asset: rows[0] };
}

export async function bulkUpdateFindings(opts: {
  organizationId: string;
  findingIds: string[];
  status?: string;
  ownerRef?: string | null;
  actor: string;
}) {
  const ids = (opts.findingIds || []).filter(Boolean).slice(0, 200);
  if (!ids.length) return { error: "findingIds required (max 200)", status: 400 as const };

  if (opts.status && !FINDING_STATUSES.includes(opts.status as any)) {
    return { error: "Invalid status", status: 400 as const };
  }
  if (!opts.status && opts.ownerRef === undefined) {
    return { error: "status and/or ownerRef required", status: 400 as const };
  }

  const { rows } = await pool.query(
    `UPDATE ccdi_findings SET
       status = COALESCE($3, status),
       owner_ref = CASE WHEN $4::boolean THEN $5 ELSE owner_ref END,
       resolved_at = CASE
         WHEN $3 IN ('resolved','accepted_risk','false_positive','duplicate')
           THEN COALESCE(resolved_at, now())
         WHEN $3 IS NOT NULL THEN NULL
         ELSE resolved_at
       END,
       updated_at = now()
     WHERE organization_id = $1 AND id = ANY($2::uuid[])
     RETURNING id, status, owner_ref`,
    [
      opts.organizationId,
      ids,
      opts.status ?? null,
      opts.ownerRef !== undefined,
      opts.ownerRef ?? null,
    ],
  );

  await pool.query(
    `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, action, entity_type, entity_id, meta)
     VALUES ($1,$2,'findings.bulk_update','finding',NULL,$3)`,
    [
      opts.organizationId,
      opts.actor,
      JSON.stringify({
        count: rows.length,
        status: opts.status ?? null,
        ownerRef: opts.ownerRef,
        ids: rows.map((r) => r.id),
      }),
    ],
  );

  if (rows.length) {
    await webhooks
      .emitCcdiEvent({
        organizationId: opts.organizationId,
        eventType: "finding.updated",
        data: { bulk: true, count: rows.length, status: opts.status },
      })
      .catch(() => undefined);
  }

  return { updated: rows.length, findings: rows };
}

export async function listPendingOwnership(organizationId: string, limit = 50) {
  const { rows } = await pool.query(
    `SELECT id, name, asset_type, identifier, status, ownership_verified, risk_level, owner_ref, created_at, updated_at
     FROM ccdi_assets
     WHERE organization_id = $1
       AND status IN ('discovered','verified')
       AND ownership_verified = false
     ORDER BY updated_at DESC
     LIMIT $2`,
    [organizationId, Math.min(limit, 200)],
  );
  return rows;
}

logger.info("CCDI Phase 19 assets workflow service loaded");
