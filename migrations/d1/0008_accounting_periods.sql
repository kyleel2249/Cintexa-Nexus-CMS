-- Accounting periods: monthly close / reopen with authorization + reason
CREATE TABLE IF NOT EXISTS fin_periods (
  id TEXT PRIMARY KEY,
  period_ym TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'open',
  label TEXT,
  closed_at TEXT,
  closed_by TEXT,
  close_reason TEXT,
  reopened_at TEXT,
  reopened_by TEXT,
  reopen_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fin_periods_status ON fin_periods(status);
