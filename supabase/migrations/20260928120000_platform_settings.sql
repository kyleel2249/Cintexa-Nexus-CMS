-- Key/value store for General + Security settings, hashed API keys, webhooks and webhook deliveries.
-- The API also creates this automatically on boot (lib/db/src/bootstrap.ts); this file is for manual setups.
CREATE TABLE IF NOT EXISTS platform_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '{}',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
