-- CD Optimizer jobs (optional persistence)
CREATE TABLE IF NOT EXISTS cd_optimizer_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued',
  mode TEXT NOT NULL DEFAULT 'balanced',
  original_name TEXT NOT NULL,
  mime_type TEXT,
  original_size BIGINT NOT NULL DEFAULT 0,
  optimized_size BIGINT,
  bytes_saved BIGINT,
  percent_saved NUMERIC,
  ratio NUMERIC,
  algorithm TEXT,
  pipeline TEXT,
  quality_score NUMERIC,
  integrity_ok BOOLEAN,
  sha256_original TEXT,
  sha256_optimized TEXT,
  processing_ms INTEGER,
  error TEXT,
  organization_id TEXT,
  user_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Nexus Finance analyses
CREATE TABLE IF NOT EXISTS nexus_finance_analyses (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  period_label TEXT,
  currency TEXT DEFAULT 'GHS',
  input JSONB NOT NULL DEFAULT '{}',
  health JSONB NOT NULL DEFAULT '{}',
  distress JSONB NOT NULL DEFAULT '{}',
  survival JSONB NOT NULL DEFAULT '{}',
  organization_id TEXT,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cd_jobs_created ON cd_optimizer_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_analyses_created ON nexus_finance_analyses(created_at DESC);
