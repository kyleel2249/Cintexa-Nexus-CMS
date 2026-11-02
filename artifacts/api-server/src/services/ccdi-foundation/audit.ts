/**
 * CCDI foundation — tamper-evident, append-only audit trail.
 *
 * Every entry stores prev_hash and entry_hash = SHA-256(prev_hash || canonical payload).
 * The database trigger `ccdi_audit_logs_immutable` blocks UPDATE and DELETE.
 * organization_id is deliberately outside the hash, because removing an organisation
 * sets it NULL (the one update the trigger permits), and the chain must stay valid.
 */
import { createHash, randomUUID } from "node:crypto";
import { pool, type PoolClient } from "@workspace/db";

/** Derived from the shared pool so this package needs no direct dependency on pg typings. */
export type { PoolClient };

export interface AuditInput {
  organizationId?: string | null;
  actorRef: string;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  outcome: "success" | "failure" | "denied";
  correlationId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown>;
}

const SENSITIVE_KEY = /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|ciphertext|private|recovery|otp|credential_value|value)$/i;
const SENSITIVE_VALUE = /(\bsk-[A-Za-z0-9_-]{12,}|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bAIza[0-9A-Za-z_-]{20,})/g;

export function redact(input: unknown, depth = 0): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (input === null || input === undefined) return input;
  if (typeof input === "string") return input.replace(SENSITIVE_VALUE, "[REDACTED]").slice(0, 2000);
  if (Array.isArray(input)) return input.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out;
  }
  return input;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function computeEntryHash(prevHash: string, p: {
  eventId: string;
  actorRef: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  outcome: string | null;
  correlationId: string | null;
  meta: unknown;
  createdAt: string;
}): string {
  return createHash("sha256").update(prevHash).update("|").update(stableStringify(p)).digest("hex");
}

const GENESIS = "0".repeat(64);
const CHAIN_LOCK = 727_001;

/** Append inside an existing transaction so the change and its audit record commit atomically. */
export async function appendAuditTx(client: PoolClient, e: AuditInput): Promise<string> {
  await client.query("SELECT pg_advisory_xact_lock($1)", [CHAIN_LOCK]);
  const last = await client.query(
    `SELECT entry_hash FROM ccdi_audit_logs WHERE entry_hash IS NOT NULL ORDER BY id DESC LIMIT 1`,
  );
  const prevHash: string = last.rows[0]?.entry_hash ?? GENESIS;
  const eventId = randomUUID();
  const createdAt = new Date();
  const meta = (redact(e.meta ?? {}) ?? {}) as Record<string, unknown>;
  const entryHash = computeEntryHash(prevHash, {
    eventId,
    actorRef: e.actorRef ?? null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    outcome: e.outcome,
    correlationId: e.correlationId ?? null,
    meta,
    createdAt: createdAt.toISOString(),
  });
  await client.query(
    `INSERT INTO ccdi_audit_logs
       (event_id, organization_id, actor_ref, actor_email, action, entity_type, entity_id,
        ip_address, user_agent, meta, outcome, correlation_id, prev_hash, entry_hash, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15)`,
    [
      eventId,
      e.organizationId ?? null,
      e.actorRef,
      e.actorEmail ?? null,
      e.action,
      e.entityType,
      e.entityId ?? null,
      e.ip ?? null,
      (e.userAgent ?? "").slice(0, 300) || null,
      JSON.stringify(meta),
      e.outcome,
      e.correlationId ?? null,
      prevHash,
      entryHash,
      createdAt,
    ],
  );
  return eventId;
}

/** Stand-alone append (denials, failures, reads) in its own short transaction. */
export async function appendAudit(e: AuditInput): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const id = await appendAuditTx(client, e);
    await client.query("COMMIT");
    return id;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Run a mutation and its audit record in one transaction. */
export async function withAudit<T>(
  event: Omit<AuditInput, "outcome"> | ((result: T) => Omit<AuditInput, "outcome">),
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    const base = typeof event === "function" ? event(result) : event;
    await appendAuditTx(client, { ...base, outcome: "success" });
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export interface ChainVerification {
  checked: number;
  valid: boolean;
  firstBrokenId: string | null;
  note: string;
}

/** Re-computes the hash chain. Legacy rows written before the foundation have no hash and are skipped. */
export async function verifyAuditChain(maxRows = 20_000): Promise<ChainVerification> {
  let prev = GENESIS;
  let checked = 0;
  let lastId = "0";
  for (;;) {
    const { rows } = await pool.query(
      `SELECT id::text AS id, event_id, actor_ref, action, entity_type, entity_id, outcome, correlation_id,
              meta, created_at, prev_hash, entry_hash
       FROM ccdi_audit_logs
       WHERE entry_hash IS NOT NULL AND id > $1::bigint
       ORDER BY id ASC LIMIT 1000`,
      [lastId],
    );
    if (!rows.length) break;
    for (const r of rows) {
      lastId = r.id;
      const expected = computeEntryHash(prev, {
        eventId: r.event_id,
        actorRef: r.actor_ref,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        outcome: r.outcome,
        correlationId: r.correlation_id,
        meta: r.meta,
        createdAt: new Date(r.created_at).toISOString(),
      });
      if (r.prev_hash !== prev || r.entry_hash !== expected) {
        return { checked, valid: false, firstBrokenId: r.id, note: "Hash chain mismatch: the audit trail was altered or an entry is missing." };
      }
      prev = r.entry_hash;
      checked += 1;
      if (checked >= maxRows) {
        return { checked, valid: true, firstBrokenId: null, note: `Verified the first ${maxRows} hashed entries (limit reached).` };
      }
    }
  }
  return { checked, valid: true, firstBrokenId: null, note: "Hash chain intact. Entries written before the foundation are not hashed." };
}
