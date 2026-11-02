-- CINTEXA Finance Financial Intelligence — Cloudflare D1 schema
-- Optional binding: FI_DB. Isolate memory is used when unbound.
-- Amounts stored as INTEGER minor units.

CREATE TABLE IF NOT EXISTS fi_org (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GHS',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fi_entries (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('posted','draft','void')),
  memo TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fi_entry_lines (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  account_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  debit INTEGER NOT NULL DEFAULT 0,
  credit INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fi_fx_rates (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  rate REAL NOT NULL,
  effective_date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual'
);

CREATE INDEX IF NOT EXISTS idx_fi_entries_org_date ON fi_entries(org_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_fi_lines_entry ON fi_entry_lines(entry_id);
