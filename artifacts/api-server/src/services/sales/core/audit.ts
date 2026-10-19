import type { Actor, Queryable } from "./types";

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: number | string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
}

const SENSITIVE_KEYS = /(token|secret|password|hash|authorization)/i;

/** Remove secrets from snapshots before they are written to the (append-only) audit log. */
export function scrub(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((x) => scrub(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SENSITIVE_KEYS.test(k) ? "[redacted]" : scrub(v, depth + 1);
  return out;
}

/** Insert an audit event. Call inside the same transaction as the change it describes. */
export async function audit(q: Queryable, actor: Pick<Actor, "userSub" | "label"> | null, e: AuditInput, requestId?: string): Promise<void> {
  await q.query(
    `INSERT INTO sales_audit_events (actor_id, actor_label, action, entity_type, entity_id, summary, before, after, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::text::jsonb,$8::text::jsonb,$9)`,
    [
      actor?.userSub ?? null,
      actor?.label ?? "system",
      e.action,
      e.entityType,
      e.entityId === undefined || e.entityId === null ? null : String(e.entityId),
      e.summary ?? null,
      e.before === undefined ? null : JSON.stringify(scrub(e.before)),
      e.after === undefined ? null : JSON.stringify(scrub(e.after)),
      requestId ?? null,
    ],
  );
}

/** Record only the fields that changed. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k];
      a[k] = after[k];
    }
  }
  return { before: b, after: a };
}
