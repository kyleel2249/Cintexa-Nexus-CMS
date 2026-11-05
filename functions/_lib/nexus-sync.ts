/**
 * CINTEXA Nexus - sync engine core (shared by /api/sync and every module that publishes events).
 * See functions/api/sync/[[path]].ts for the HTTP surface and the design notes.
 */

import { stableId, type D1Like, type D1Stmt } from "./nexus-db.ts";

export type EventRow = {
  id: string;
  event_type: string;
  source_module: string;
  entity_type: string;
  entity_id: string;
  org_id: string;
  version: number;
  effective_date: string | null;
  payload: string;
  related: string;
  idempotency_key: string;
  status: "pending" | "processing" | "processed" | "failed" | "dead";
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
};
export type LinkRow = { event_id: string; target_module: string; target_entity_type: string; target_entity_id: string };

const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_PAYLOAD_BYTES = 64 * 1024;

/** Module dependency registry: what each event fans out to. */
export const ROUTING: Record<string, string[]> = {
  CUSTOMER_CREATED: ["business-diary", "dashboard"],
  CUSTOMER_UPDATED: ["dashboard"],
  LEAD_CREATED: ["business-diary", "dashboard"],
  SALES_ORDER_CREATED: ["business-diary", "financial-intelligence", "dashboard"],
  SALES_ORDER_CONFIRMED: ["business-diary", "financial-intelligence", "dashboard"],
  SALES_ORDER_CANCELLED: ["business-diary", "financial-intelligence", "dashboard"],
  INVOICE_CREATED: ["business-diary", "financial-intelligence", "dashboard"],
  PAYMENT_RECEIVED: ["business-diary", "financial-intelligence", "dashboard"],
  PAYMENT_REVERSED: ["business-diary", "financial-intelligence", "dashboard"],
  EXPENSE_RECORDED: ["business-diary", "financial-intelligence", "dashboard"],
  DIARY_ENTRY_CREATED: ["dashboard"],
  FI_ENTRY_POSTED: ["dashboard"],
  REVENUE_RECORDED: ["financial-intelligence", "dashboard"],
};

export const MODULES = [
  { id: "sales", name: "Sales Management", publishes: ["LEAD_CREATED", "SALES_ORDER_CREATED", "SALES_ORDER_CONFIRMED", "PAYMENT_RECEIVED"], consumes: [] },
  { id: "finance", name: "CINTEXA Finance", publishes: ["INVOICE_CREATED", "PAYMENT_RECEIVED", "EXPENSE_RECORDED"], consumes: [] },
  { id: "financial-intelligence", name: "Financial Intelligence", publishes: ["FI_ENTRY_POSTED"], consumes: ["SALES_ORDER_CONFIRMED", "PAYMENT_RECEIVED", "EXPENSE_RECORDED", "INVOICE_CREATED"] },
  { id: "business-diary", name: "Business Diary", publishes: ["DIARY_ENTRY_CREATED"], consumes: ["CUSTOMER_CREATED", "LEAD_CREATED", "SALES_ORDER_CREATED", "PAYMENT_RECEIVED", "EXPENSE_RECORDED", "INVOICE_CREATED"] },
  { id: "dashboard", name: "Main Dashboard", publishes: [], consumes: ["*"] },
  { id: "cms", name: "Content / Sites", publishes: [], consumes: [] },
];

export const nowIso = () => new Date().toISOString();
export const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  try {
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function toEvent(r: EventRow, links: LinkRow[] = []) {
  return {
    id: r.id,
    eventType: r.event_type,
    sourceModule: r.source_module,
    entityType: r.entity_type,
    entityId: r.entity_id,
    businessId: r.org_id,
    version: r.version,
    effectiveDate: r.effective_date,
    payload: parseJson<Record<string, unknown>>(r.payload, {}),
    related: parseJson<unknown[]>(r.related, []),
    idempotencyKey: r.idempotency_key,
    status: r.status,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    nextAttemptAt: r.next_attempt_at,
    lastError: r.last_error,
    createdAt: r.created_at,
    processedAt: r.processed_at,
    links: links.map((l) => ({ targetModule: l.target_module, targetEntityType: l.target_entity_type, targetEntityId: l.target_entity_id })),
  };
}

export async function loadEvent(db: D1Like, id: string): Promise<EventRow | null> {
  return db.prepare("SELECT * FROM nx_sync_events WHERE id = ?").bind(id).first<EventRow>();
}

export async function loadLinks(db: D1Like, ids: string[]): Promise<Map<string, LinkRow[]>> {
  const map = new Map<string, LinkRow[]>();
  if (!ids.length) return map;
  const { results } = await db
    .prepare(`SELECT event_id, target_module, target_entity_type, target_entity_id FROM nx_sync_links WHERE event_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at`)
    .bind(...ids)
    .all<LinkRow>();
  for (const l of results) (map.get(l.event_id) ?? map.set(l.event_id, []).get(l.event_id)!).push(l);
  return map;
}

// ---------------------------------------------------------------------------
// Effects: one idempotent statement set per target module
// ---------------------------------------------------------------------------

async function linkStmt(db: D1Like, ev: EventRow, module: string, type: string, targetId: string, at: string): Promise<D1Stmt> {
  const id = await stableId("lnk", ev.id, module, type, targetId);
  return db
    .prepare("INSERT OR IGNORE INTO nx_sync_links (id, event_id, target_module, target_entity_type, target_entity_id, created_at) VALUES (?,?,?,?,?,?)")
    .bind(id, ev.id, module, type, targetId, at);
}

async function buildEffects(db: D1Like, ev: EventRow, at: string): Promise<D1Stmt[]> {
  const payload = parseJson<Record<string, any>>(ev.payload, {});
  const stmts: D1Stmt[] = [];
  for (const target of ROUTING[ev.event_type] ?? ["dashboard"]) {
    if (target === "business-diary") {
      const diaryId = await stableId("sync", ev.org_id, ev.entity_type, ev.entity_id, ev.event_type);
      const title = str(payload.title || `${ev.event_type} - ${ev.entity_type} ${ev.entity_id}`, 300);
      const description =
        str(payload.description, 4500) ||
        `Auto-recorded from ${ev.source_module}: ${ev.event_type}. Source record ${ev.entity_type}/${ev.entity_id}.`;
      const activityDate = str(payload.activityDate || ev.effective_date || at, 10);
      stmts.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO bd_entries
             (id, org_id, title, description, category, activity_date, recorded_at, client_name, success_status, priority, tags, status, created_by, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,'active','nexus-sync',?)`,
          )
          .bind(
            diaryId,
            ev.org_id,
            title,
            description,
            str(payload.category || "General Business", 80),
            activityDate,
            at,
            payload.clientName ? str(payload.clientName, 200) : null,
            payload.successStatus ? str(payload.successStatus, 40) : null,
            str(payload.priority || "medium", 20),
            JSON.stringify(["auto-sync", ev.source_module, ev.event_type, `${ev.entity_type}:${ev.entity_id}`]),
            at,
          ),
      );
      stmts.push(await linkStmt(db, ev, "business-diary", "diary_entry", diaryId, at));
    } else if (target === "financial-intelligence") {
      stmts.push(await linkStmt(db, ev, "financial-intelligence", "recalculate", `${ev.entity_type}:${ev.entity_id}`, at));
    } else if (target === "dashboard") {
      stmts.push(await linkStmt(db, ev, "dashboard", "invalidate", "*", at));
    }
  }
  return stmts;
}

/** Claim -> apply effects atomically -> mark processed; on error record the failure and schedule a retry or dead-letter. */
export async function processEvent(db: D1Like, id: string): Promise<EventRow | null> {
  const start = nowIso();
  const lease = new Date(Date.now() + LEASE_MS).toISOString();
  const claim = await db
    .prepare(
      `UPDATE nx_sync_events SET status='processing', attempts = attempts + 1, next_attempt_at = ?
       WHERE id = ? AND (status IN ('pending','failed') OR (status = 'processing' AND next_attempt_at <= ?))`,
    )
    .bind(lease, id, start)
    .run();
  if ((claim.meta?.changes ?? 0) === 0) return loadEvent(db, id); // already done, dead, or held by another worker

  const ev = (await loadEvent(db, id))!;
  const logId = await stableId("log", ev.id, String(ev.attempts));
  try {
    const effects = await buildEffects(db, ev, start);
    await db.batch([
      ...effects,
      db.prepare("UPDATE nx_sync_events SET status='processed', processed_at=?, next_attempt_at=NULL, last_error=NULL WHERE id=?").bind(start, ev.id),
      db.prepare("INSERT OR IGNORE INTO nx_sync_log (id, event_id, attempt, outcome, detail, created_at) VALUES (?,?,?,?,?,?)").bind(logId, ev.id, ev.attempts, "processed", null, start),
    ]);
  } catch (e: any) {
    const message = str(e?.message || e, 500);
    const dead = ev.attempts >= ev.max_attempts;
    const backoffSec = Math.min(3600, 30 * 2 ** Math.max(0, ev.attempts - 1));
    const next = dead ? null : new Date(Date.now() + backoffSec * 1000).toISOString();
    await db.batch([
      db.prepare("UPDATE nx_sync_events SET status=?, last_error=?, next_attempt_at=? WHERE id=?").bind(dead ? "dead" : "failed", message, next, ev.id),
      db.prepare("INSERT OR IGNORE INTO nx_sync_log (id, event_id, attempt, outcome, detail, created_at) VALUES (?,?,?,?,?,?)").bind(logId, ev.id, ev.attempts, dead ? "dead" : "failed", message, nowIso()),
    ]);
  }
  return loadEvent(db, id);
}

/** Processes everything that is due (pending, failed past its backoff, or an expired lease). */
export async function drain(db: D1Like, limit = 50): Promise<EventRow[]> {
  const now = nowIso();
  const { results } = await db
    .prepare(
      `SELECT id FROM nx_sync_events
       WHERE (status IN ('pending','failed') AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
          OR (status = 'processing' AND next_attempt_at <= ?)
       ORDER BY created_at LIMIT ?`,
    )
    .bind(now, now, limit)
    .all<{ id: string }>();
  const out: EventRow[] = [];
  for (const r of results) {
    const ev = await processEvent(db, r.id);
    if (ev) out.push(ev);
  }
  return out;
}

export type EnqueueResult = { ok: true; event: EventRow; duplicate: boolean } | { ok: false; status: number; error: string };

export async function enqueue(db: D1Like, body: any): Promise<EnqueueResult> {
  const eventType = str(body.eventType, 64);
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(eventType)) return { ok: false, status: 400, error: "eventType must be UPPER_SNAKE_CASE" };
  const payload = typeof body.payload === "object" && body.payload && !Array.isArray(body.payload) ? body.payload : {};
  const payloadText = JSON.stringify(payload);
  if (payloadText.length > MAX_PAYLOAD_BYTES) return { ok: false, status: 413, error: "payload too large (64 KB max)" };
  const version = Number.isInteger(Number(body.version)) && Number(body.version) >= 1 ? Number(body.version) : 1;
  const entityType = str(body.entityType || "record", 64);
  const entityId = str(body.entityId || crypto.randomUUID(), 128);
  const orgId = str(body.businessId || body.orgId || "default", 64);
  const sourceModule = str(body.sourceModule || "unknown", 64);
  const effectiveDate = body.effectiveDate ? str(body.effectiveDate, 10) : null;
  if (effectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) return { ok: false, status: 400, error: "effectiveDate must be YYYY-MM-DD" };
  const related = Array.isArray(body.related) ? body.related.slice(0, 20) : [];
  const idempotencyKey = str(body.idempotencyKey || `${eventType}:${entityType}:${entityId}:${version}`, 200);

  const existing = await db.prepare("SELECT * FROM nx_sync_events WHERE idempotency_key = ?").bind(idempotencyKey).first<EventRow>();
  if (existing) return { ok: true, event: existing, duplicate: true };

  const newest = await db
    .prepare("SELECT MAX(version) AS v FROM nx_sync_events WHERE org_id=? AND entity_type=? AND entity_id=? AND event_type=?")
    .bind(orgId, entityType, entityId, eventType)
    .first<{ v: number | null }>();
  if (newest?.v != null && version < newest.v) {
    return { ok: false, status: 409, error: `stale version ${version}: version ${newest.v} of this ${eventType} for ${entityType}/${entityId} is already recorded` };
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO nx_sync_events
       (id, event_type, source_module, entity_type, entity_id, org_id, version, effective_date, payload, related, idempotency_key, status, attempts, max_attempts, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',0,?,?)
       ON CONFLICT(idempotency_key) DO NOTHING`,
    )
    .bind(id, eventType, sourceModule, entityType, entityId, orgId, version, effectiveDate, payloadText, JSON.stringify(related), idempotencyKey, MAX_ATTEMPTS, nowIso())
    .run();
  const stored = (await db.prepare("SELECT * FROM nx_sync_events WHERE idempotency_key = ?").bind(idempotencyKey).first<EventRow>())!;
  return { ok: true, event: stored, duplicate: stored.id !== id };
}

