-- CINTEXA Finance — double-entry accounting (Cloudflare D1)
-- Amounts: INTEGER minor units (e.g. pesewas). Base currency default GHS.

CREATE TABLE IF NOT EXISTS fin_accounts (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  subtype TEXT,
  currency TEXT NOT NULL DEFAULT 'GHS',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fin_journals (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  journal_type TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  posting_date TEXT,
  description TEXT,
  source_module TEXT,
  source_id TEXT,
  currency TEXT NOT NULL DEFAULT 'GHS',
  status TEXT NOT NULL CHECK (status IN ('draft','posted','reversed')),
  created_at TEXT NOT NULL,
  posted_at TEXT,
  reversed_by TEXT
);

CREATE TABLE IF NOT EXISTS fin_journal_lines (
  id TEXT PRIMARY KEY,
  journal_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  account_code TEXT NOT NULL,
  memo TEXT,
  debit INTEGER NOT NULL DEFAULT 0,
  credit INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_fin_lines_journal ON fin_journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_fin_lines_account ON fin_journal_lines(account_code);

CREATE TABLE IF NOT EXISTS fin_customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  source_module TEXT,
  source_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fin_invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id TEXT,
  customer_name TEXT,
  issue_date TEXT NOT NULL,
  due_date TEXT,
  currency TEXT NOT NULL DEFAULT 'GHS',
  amount_minor INTEGER NOT NULL,
  amount_paid_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  source_module TEXT,
  source_id TEXT,
  journal_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fin_payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT,
  customer_name TEXT,
  payment_date TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GHS',
  method TEXT,
  journal_id TEXT,
  source_module TEXT,
  source_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fin_audit (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
