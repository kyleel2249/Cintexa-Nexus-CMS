/**
 * CINTEXA CCDI — Phase 21 Evidence Integrity & Chain of Custody
 *
 * Records custody events and validates stored evidence metadata.
 * Does not fetch external blob bytes unless storage_provider=local and a path is available.
 */
import { createHash } from "crypto";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

export const CCDI_PHASE21_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS ccdi_evidence_custody (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  evidence_id UUID NOT NULL REFERENCES ccdi_evidence(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN (
    'collected','transferred','accessed','exported','verified','sealed','released','note'
  )),
  actor_ref TEXT NOT NULL,
  note TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_custody_evidence ON ccdi_evidence_custody(evidence_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_custody_org ON ccdi_evidence_custody(organization_id, created_at DESC)`,
];

export async function ensureEvidenceIntegritySchema() {
  for (const stmt of CCDI_PHASE21_SCHEMA) {
    await pool.query(stmt).catch((err) => {
      logger.warn({ err }, "ccdi.evidence_integrity.schema");
    });
  }
}

export async function recordCustodyEvent(opts: {
  organizationId: string;
  evidenceId: string;
  action: string;
  actorRef: string;
  note?: string;
  meta?: Record<string, unknown>;
}) {
  await ensureEvidenceIntegritySchema();

  const { rows: ev } = await pool.query(
    `SELECT id FROM ccdi_evidence WHERE id = $1 AND organization_id = $2`,
    [opts.evidenceId, opts.organizationId],
  );
  if (!ev[0]) return { error: "Evidence not found", status: 404 as const };

  const allowed = [
    "collected",
    "transferred",
    "accessed",
    "exported",
    "verified",
    "sealed",
    "released",
    "note",
  ];
  if (!allowed.includes(opts.action)) {
    return { error: "Invalid custody action", status: 400 as const };
  }

  const { rows } = await pool.query(
    `INSERT INTO ccdi_evidence_custody
       (organization_id, evidence_id, action, actor_ref, note, meta)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      opts.organizationId,
      opts.evidenceId,
      opts.action,
      opts.actorRef,
      opts.note ?? null,
      JSON.stringify(opts.meta ?? {}),
    ],
  );

  await pool.query(
    `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, action, entity_type, entity_id, meta)
     VALUES ($1,$2,'evidence.custody','evidence',$3,$4)`,
    [
      opts.organizationId,
      opts.actorRef,
      opts.evidenceId,
      JSON.stringify({ custodyAction: opts.action }),
    ],
  );

  return { event: rows[0] };
}

export async function listCustodyChain(organizationId: string, evidenceId: string) {
  await ensureEvidenceIntegritySchema();
  const { rows } = await pool.query(
    `SELECT * FROM ccdi_evidence_custody
     WHERE organization_id = $1 AND evidence_id = $2
     ORDER BY created_at ASC`,
    [organizationId, evidenceId],
  );
  return rows;
}

/** Metadata integrity check — validates sha256 format and required fields */
export async function verifyEvidenceIntegrity(opts: {
  organizationId: string;
  evidenceId: string;
  actorRef: string;
  /** Optional hex digest of bytes the caller computed offline */
  computedSha256?: string;
}) {
  await ensureEvidenceIntegritySchema();

  const { rows } = await pool.query(
    `SELECT * FROM ccdi_evidence WHERE id = $1 AND organization_id = $2`,
    [opts.evidenceId, opts.organizationId],
  );
  if (!rows[0]) return { error: "Evidence not found", status: 404 as const };

  const ev = rows[0];
  const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];

  checks.push({
    name: "record_present",
    pass: true,
  });

  const sha = ev.sha256 ? String(ev.sha256).toLowerCase() : "";
  const shaOk = /^[a-f0-9]{64}$/.test(sha);
  checks.push({
    name: "sha256_format",
    pass: shaOk,
    detail: shaOk ? "valid sha256 hex" : "missing or invalid sha256",
  });

  checks.push({
    name: "storage_ref_present",
    pass: Boolean(ev.storage_ref),
    detail: ev.storage_ref ? String(ev.storage_ref) : "missing storage_ref",
  });

  if (opts.computedSha256) {
    const computed = String(opts.computedSha256).toLowerCase();
    const match = shaOk && computed === sha;
    checks.push({
      name: "sha256_match",
      pass: match,
      detail: match ? "matches stored digest" : "does not match stored digest",
    });
  }

  const passed = checks.every((c) => c.pass);

  await recordCustodyEvent({
    organizationId: opts.organizationId,
    evidenceId: opts.evidenceId,
    action: "verified",
    actorRef: opts.actorRef,
    note: passed ? "Integrity checks passed" : "Integrity checks failed",
    meta: { checks, computedSha256: opts.computedSha256 ?? null },
  });

  return {
    evidenceId: opts.evidenceId,
    passed,
    checks,
    evidence: {
      id: ev.id,
      filename: ev.filename,
      sha256: ev.sha256,
      storage_provider: ev.storage_provider,
      storage_ref: ev.storage_ref,
      size_bytes: ev.size_bytes,
      redacted: ev.redacted,
      collected_at: ev.collected_at,
    },
  };
}

/** Helper for callers that have raw bytes in-process */
export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

logger.info("CCDI Phase 21 evidence integrity service loaded");
