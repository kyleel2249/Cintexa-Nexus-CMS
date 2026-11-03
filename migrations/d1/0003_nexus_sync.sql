-- Central Nexus synchronization outbox (Cloudflare D1)
CREATE TABLE IF NOT EXISTS nexus_sync_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  source_module TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  org_id TEXT NOT NULL DEFAULT 'default',
  payload TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_nexus_sync_status ON nexus_sync_events(status, created_at);

CREATE TABLE IF NOT EXISTS nexus_sync_links (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  target_module TEXT NOT NULL,
  target_entity_type TEXT,
  target_entity_id TEXT,
  created_at TEXT NOT NULL
);
