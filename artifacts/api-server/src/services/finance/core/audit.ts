import { createHash } from "node:crypto";
import type { Q } from "./types";

export interface AuditInput {
  orgId: number | null; actorId?: string; actorLabel?: string; action: string; entityType: string; entityId?: string | number;
  summary?: string; before?: unknown; after?: unknown; requestId?: string; sourceModule?: string;
}

/** stable stringify (sorted keys) - JSONB does not preserve key order, so the hash must not depend on it */
const stable = (v: unknown): unknown => v instanceof Date ? v.toISOString() : typeof v === "bigint" ? v.toString() : Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as any)[k])])) : v;
const canon = (v: unknown): string => JSON.stringify(stable(v ?? null));

/**
 * Tamper-evident audit trail: each event stores the hash of the previous event of the same organisation, so editing
 * or deleting history breaks the chain (and the database triggers already refuse UPDATE/DELETE). Must run inside the
 * caller's transaction; a per-organisation advisory lock keeps the chain linear under concurrency.
 */
export async function audit(q: Q, e: AuditInput): Promise<void> {
  const scope = e.orgId ?? 0;
  await q.query("SELECT pg_advisory_xact_lock($1, $2)", [7001, scope]);
  const last = (await q.query<{ seq: string | number; hash: string }>("SELECT seq, hash FROM finance_audit_events WHERE COALESCE(org_id,0) = $1 ORDER BY seq DESC LIMIT 1", [scope])).rows[0];
  const seq = last ? Number(last.seq) + 1 : 1;
  const prev = last?.hash ?? "GENESIS";
  const at = new Date().toISOString();
  const entityId = e.entityId == null ? null : String(e.entityId);
  const payload = canon([seq, at, e.actorId ?? null, e.action, e.entityType, entityId, e.summary ?? null, e.before ?? null, e.after ?? null, e.requestId ?? null]);
  const hash = createHash("sha256").update(prev).update(payload).digest("hex");
  await q.query(
    `INSERT INTO finance_audit_events (org_id, seq, at, actor_id, actor_label, action, entity_type, entity_id, source_module, summary, before, after, request_id, prev_hash, hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [e.orgId, seq, at, e.actorId ?? null, e.actorLabel ?? null, e.action, e.entityType, entityId, e.sourceModule ?? "finance", e.summary ?? null,
      e.before === undefined ? null : JSON.stringify(e.before), e.after === undefined ? null : JSON.stringify(e.after), e.requestId ?? null, prev, hash],
  );
}

/** Recomputes the chain for an organisation. Returns the first broken sequence number, if any. */
export async function verifyAuditChain(q: Q, orgId: number | null): Promise<{ ok: boolean; checked: number; brokenAtSeq?: number }> {
  const rows = (await q.query<any>("SELECT * FROM finance_audit_events WHERE COALESCE(org_id,0) = $1 ORDER BY seq", [orgId ?? 0])).rows;
  let prev = "GENESIS";
  for (const r of rows) {
    const at = r.at instanceof Date ? r.at.toISOString() : r.at;
    const payload = canon([Number(r.seq), at, r.actor_id, r.action, r.entity_type, r.entity_id, r.summary, r.before, r.after, r.request_id]);
    const h = createHash("sha256").update(prev).update(payload).digest("hex");
    if (r.prev_hash !== prev || r.hash !== h) return { ok: false, checked: rows.length, brokenAtSeq: Number(r.seq) };
    prev = r.hash;
  }
  return { ok: true, checked: rows.length };
}
