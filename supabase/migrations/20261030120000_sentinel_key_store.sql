-- Sentinel Key store (sk_user_keys, sk_aliases, sk_vault_entries, sk_history, sk_audit). Additive and idempotent.
-- The API applies the same statements on boot (lib/db/src/sentinel-schema.ts); this file is for manual / Supabase setups.
-- Secrets are stored only as client-side AES-256-GCM ciphertext; every row carries owner_id.
CREATE TABLE IF NOT EXISTS sk_user_keys (
  owner_id TEXT PRIMARY KEY,
  kdf JSONB NOT NULL,
  verifier_iv TEXT NOT NULL,
  verifier_ct TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sk_aliases (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  name_key TEXT NOT NULL,
  category TEXT,
  service TEXT,
  project TEXT,
  environment TEXT,
  notes TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sk_aliases_owner_name ON sk_aliases(owner_id, name_key) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_sk_aliases_owner ON sk_aliases(owner_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS sk_vault_entries (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL,
  alias_id UUID NOT NULL REFERENCES sk_aliases(id) ON DELETE RESTRICT,
  history_event_id UUID,
  type TEXT NOT NULL CHECK (type IN ('password','passphrase','id','token','recovery')),
  iv TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  enc_version INTEGER NOT NULL DEFAULT 1,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  item_count INTEGER NOT NULL DEFAULT 1,
  category TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  expires_at TIMESTAMPTZ,
  pinned BOOLEAN NOT NULL DEFAULT false,
  favorite BOOLEAN NOT NULL DEFAULT false,
  last_accessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sk_vault_history ON sk_vault_entries(history_event_id) WHERE history_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_sk_vault_owner_created ON sk_vault_entries(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_sk_vault_owner_alias ON sk_vault_entries(owner_id, alias_id);
CREATE TABLE IF NOT EXISTS sk_history (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL,
  alias_id UUID NOT NULL REFERENCES sk_aliases(id) ON DELETE RESTRICT,
  alias_name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('password','passphrase','id','token','recovery')),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  item_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','saved','failed')),
  failure_code TEXT,
  vault_entry_id UUID REFERENCES sk_vault_entries(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sk_history_owner_created ON sk_history(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_sk_history_owner_alias ON sk_history(owner_id, alias_id);
CREATE INDEX IF NOT EXISTS ix_sk_history_owner_status ON sk_history(owner_id, status);
CREATE TABLE IF NOT EXISTS sk_audit (
  id BIGSERIAL PRIMARY KEY,
  owner_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sk_audit_owner_created ON sk_audit(owner_id, created_at DESC);
