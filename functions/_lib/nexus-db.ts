/**
 * CINTEXA Nexus - shared Cloudflare D1 access for Pages Functions.
 *
 * One authoritative database: NEXUS_DB when bound, otherwise FIN_DB (the existing CINTEXA Finance database). Every module
 * that persists through this file lands in the same D1 so records can be joined and synchronised.
 *
 * Schema is created with CREATE TABLE IF NOT EXISTS on first use per isolate (same approach as CINTEXA Finance), and is
 * mirrored in migrations/d1/0006_nexus_sync_v2.sql for operators who prefer `wrangler d1 execute`.
 */

export interface D1Result {
  results?: any[];
  meta?: { changes?: number; last_row_id?: number };
}
export interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  run(): Promise<D1Result>;
  all<T = any>(): Promise<{ results: T[] }>;
  first<T = any>(): Promise<T | null>;
}
export interface D1Like {
  prepare(sql: string): D1Stmt;
  batch(statements: D1Stmt[]): Promise<D1Result[]>;
}
export type NexusEnv = { NEXUS_DB?: D1Like; FIN_DB?: D1Like };

export function resolveDb(env: NexusEnv | undefined): D1Like | null {
  return env?.NEXUS_DB ?? env?.FIN_DB ?? null;
}

export const NEXUS_SCHEMA_SQL: string[] = [
  // Business Diary entries (shared with /api/diary)
  `CREATE TABLE IF NOT EXISTS bd_entries (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT 'default',
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    subcategory TEXT,
    activity_date TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    location TEXT,
    department TEXT,
    client_name TEXT,
    outcome TEXT,
    success_status TEXT,
    priority TEXT DEFAULT 'medium',
    tags TEXT,
    lessons TEXT,
    follow_up_required INTEGER DEFAULT 0,
    follow_up_deadline TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_by TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bd_entries_date ON bd_entries(activity_date)`,
  `CREATE INDEX IF NOT EXISTS idx_bd_entries_status ON bd_entries(status)`,
  // Transactional outbox: every business event, exactly once per idempotency key
  `CREATE TABLE IF NOT EXISTS nx_sync_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    source_module TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    org_id TEXT NOT NULL DEFAULT 'default',
    version INTEGER NOT NULL DEFAULT 1,
    effective_date TEXT,
    payload TEXT NOT NULL DEFAULT '{}',
    related TEXT NOT NULL DEFAULT '[]',
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    next_attempt_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    processed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_nx_events_status ON nx_sync_events(status, next_attempt_at)`,
  `CREATE INDEX IF NOT EXISTS idx_nx_events_entity ON nx_sync_events(org_id, entity_type, entity_id, event_type)`,
  // Records an event produced in other modules (traceability: event -> target record)
  `CREATE TABLE IF NOT EXISTS nx_sync_links (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    target_module TEXT NOT NULL,
    target_entity_type TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (event_id, target_module, target_entity_type, target_entity_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_nx_links_event ON nx_sync_links(event_id)`,
  // Every processing attempt, for audit and failure analysis
  `CREATE TABLE IF NOT EXISTS nx_sync_log (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_nx_log_event ON nx_sync_log(event_id)`,
];

const ready = new WeakSet<object>();

/** Creates the Nexus tables once per database object per isolate. Safe to call on every request. */
export async function ensureNexusSchema(db: D1Like): Promise<void> {
  if (ready.has(db as object)) return;
  for (const sql of NEXUS_SCHEMA_SQL) await db.prepare(sql).run();
  ready.add(db as object);
}

/** Deterministic id so that retries / duplicate events can never create a second record. */
export async function stableId(prefix: string, ...parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join("␟"));
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${hex.slice(0, 32)}`;
}
