-- CINTEXA Nexus: persistent sync outbox + Business Diary entries (Cloudflare D1)
-- Generated from functions/_lib/nexus-db.ts (NEXUS_SCHEMA_SQL); tests/nexus-schema.test.ts fails if they drift.
-- Supersedes 0003_nexus_sync.sql (nexus_sync_events), which the application never used.
-- The Pages Functions also create these tables automatically on first use, so applying this file is optional.

CREATE TABLE IF NOT EXISTS bd_entries (
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
  );

CREATE INDEX IF NOT EXISTS idx_bd_entries_date ON bd_entries(activity_date);

CREATE INDEX IF NOT EXISTS idx_bd_entries_status ON bd_entries(status);

CREATE TABLE IF NOT EXISTS nx_sync_events (
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
  );

CREATE INDEX IF NOT EXISTS idx_nx_events_status ON nx_sync_events(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_nx_events_entity ON nx_sync_events(org_id, entity_type, entity_id, event_type);

CREATE TABLE IF NOT EXISTS nx_sync_links (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    target_module TEXT NOT NULL,
    target_entity_type TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (event_id, target_module, target_entity_type, target_entity_id)
  );

CREATE INDEX IF NOT EXISTS idx_nx_links_event ON nx_sync_links(event_id);

CREATE TABLE IF NOT EXISTS nx_sync_log (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_nx_log_event ON nx_sync_log(event_id);
