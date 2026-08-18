-- Server-side diagnostic snapshots for continuous history
CREATE TABLE IF NOT EXISTS diagnostic_snapshots (
  id SERIAL PRIMARY KEY,
  profile_id INTEGER,
  session_id INTEGER,
  company_name TEXT NOT NULL,
  industry TEXT,
  mode TEXT NOT NULL DEFAULT 'standard',
  overall_score INTEGER,
  severity TEXT,
  pillar_scores JSONB NOT NULL DEFAULT '{}',
  metrics JSONB NOT NULL DEFAULT '{}',
  answers JSONB NOT NULL DEFAULT '{}',
  competitors JSONB NOT NULL DEFAULT '[]',
  goals JSONB NOT NULL DEFAULT '[]',
  payload JSONB NOT NULL DEFAULT '{}',
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_snapshots_profile ON diagnostic_snapshots(profile_id);
CREATE INDEX IF NOT EXISTS idx_diagnostic_snapshots_company ON diagnostic_snapshots(company_name);
CREATE INDEX IF NOT EXISTS idx_diagnostic_snapshots_captured ON diagnostic_snapshots(captured_at DESC);

-- Data connector registry (stubs)
CREATE TABLE IF NOT EXISTS diagnostic_connectors (
  id SERIAL PRIMARY KEY,
  profile_id INTEGER,
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected',
  config JSONB NOT NULL DEFAULT '{}',
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  metrics_preview JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_connectors_profile ON diagnostic_connectors(profile_id);
