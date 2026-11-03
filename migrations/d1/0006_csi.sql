-- CINTEXA Corporate Strategy & Intelligence (CSI)
-- Bind as CSI_DB (or reuse FIN_DB with these tables). Amounts: INTEGER minor units.

CREATE TABLE IF NOT EXISTS csi_profile (
  id TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  trading_name TEXT NOT NULL,
  vision TEXT,
  mission TEXT,
  brand_promise TEXT,
  positioning TEXT,
  philosophy TEXT,
  values_json TEXT,
  business_model TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS csi_departments (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  head_title TEXT,
  parent_id TEXT,
  budget_minor INTEGER NOT NULL DEFAULT 0,
  objectives TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS csi_objectives (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  horizon TEXT,
  department_id TEXT,
  owner TEXT,
  start_date TEXT,
  target_date TEXT,
  budget_minor INTEGER NOT NULL DEFAULT 0,
  kpi TEXT,
  target_value REAL NOT NULL DEFAULT 0,
  actual_value REAL NOT NULL DEFAULT 0,
  progress_override_pct REAL,
  progress_override_reason TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  expected_outcome TEXT,
  comments TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_csi_obj_status ON csi_objectives(status);

CREATE TABLE IF NOT EXISTS csi_products (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'concept',
  version TEXT,
  target_market TEXT,
  pricing_minor INTEGER NOT NULL DEFAULT 0,
  cost_minor INTEGER NOT NULL DEFAULT 0,
  revenue_model TEXT,
  roadmap TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS csi_prices (
  id TEXT PRIMARY KEY,
  product_id TEXT,
  sku TEXT,
  name TEXT NOT NULL,
  tier TEXT,
  currency TEXT NOT NULL DEFAULT 'GHS',
  amount_minor INTEGER NOT NULL DEFAULT 0,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS csi_budgets (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  category TEXT NOT NULL,
  department_id TEXT,
  product_id TEXT,
  planned_minor INTEGER NOT NULL DEFAULT 0,
  actual_minor INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_csi_bud_year ON csi_budgets(year);

-- Map CSI budget category → Finance expense account codes (comma-separated multi OK)
CREATE TABLE IF NOT EXISTS csi_budget_mappings (
  id TEXT PRIMARY KEY,
  budget_category TEXT NOT NULL,
  finance_account_codes TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(budget_category)
);

CREATE TABLE IF NOT EXISTS csi_risks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,
  description TEXT,
  probability INTEGER NOT NULL DEFAULT 1,
  impact INTEGER NOT NULL DEFAULT 1,
  owner TEXT,
  mitigation TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  review_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS csi_roadmap (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL UNIQUE,
  title TEXT,
  priorities TEXT,
  budget_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planned',
  symbolic_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS csi_allocation (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  operations_pct REAL NOT NULL,
  marketing_pct REAL NOT NULL,
  personnel_pct REAL NOT NULL,
  expansion_pct REAL NOT NULL,
  reserves_pct REAL NOT NULL,
  retained_pct REAL NOT NULL,
  available_cash_minor INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS csi_audit (
  id TEXT PRIMARY KEY,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_csi_audit_created ON csi_audit(created_at);
