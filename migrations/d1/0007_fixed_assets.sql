-- Fixed assets & depreciation (accounting policy: computers/laptops 25% SL)
-- Tax capital allowances are NOT applied here — accounting depreciation only.

CREATE TABLE IF NOT EXISTS fin_fixed_assets (
  id TEXT PRIMARY KEY,
  asset_number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  acquisition_date TEXT NOT NULL,
  in_service_date TEXT NOT NULL,
  cost_minor INTEGER NOT NULL,
  residual_minor INTEGER NOT NULL DEFAULT 0,
  depreciation_rate_bps INTEGER NOT NULL DEFAULT 2500,
  method TEXT NOT NULL DEFAULT 'straight_line',
  useful_life_months INTEGER,
  accumulated_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  location TEXT,
  custodian TEXT,
  disposal_date TEXT,
  source_journal_id TEXT,
  currency TEXT NOT NULL DEFAULT 'GHS',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fin_assets_status ON fin_fixed_assets(status);
CREATE INDEX IF NOT EXISTS idx_fin_assets_category ON fin_fixed_assets(category);

CREATE TABLE IF NOT EXISTS fin_depreciation_runs (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  period_ym TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  journal_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(asset_id, period_ym)
);
