-- CINTEXA Business Diary — Cloudflare D1
CREATE TABLE IF NOT EXISTS bd_entries (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  subcategory TEXT,
  activity_date TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  location TEXT,
  department TEXT,
  client_name TEXT,
  outcome TEXT,
  success_status TEXT,
  priority TEXT DEFAULT 'medium',
  tags TEXT,
  lessons TEXT,
  follow_up_required INTEGER DEFAULT 0,
  follow_up_deadline TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bd_entries_date ON bd_entries(activity_date);
CREATE INDEX IF NOT EXISTS idx_bd_entries_cat ON bd_entries(category);
CREATE INDEX IF NOT EXISTS idx_bd_entries_status ON bd_entries(status);

CREATE TABLE IF NOT EXISTS bd_followups (
  id TEXT PRIMARY KEY,
  entry_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to TEXT,
  priority TEXT DEFAULT 'medium',
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bd_pitches (
  id TEXT PRIMARY KEY,
  prospect TEXT NOT NULL,
  company TEXT,
  industry TEXT,
  product TEXT,
  pitch_date TEXT NOT NULL,
  method TEXT,
  amount_minor INTEGER,
  currency TEXT DEFAULT 'GHS',
  stage TEXT NOT NULL DEFAULT 'prospecting',
  outcome TEXT,
  lessons TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bd_feedback (
  id TEXT PRIMARY KEY,
  customer TEXT NOT NULL,
  feedback_date TEXT NOT NULL,
  category TEXT,
  body TEXT NOT NULL,
  sentiment TEXT,
  severity TEXT,
  resolution_status TEXT DEFAULT 'open',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bd_decisions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  decision_date TEXT NOT NULL,
  owner TEXT,
  reasoning TEXT,
  expected_result TEXT,
  actual_result TEXT,
  status TEXT DEFAULT 'recorded',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bd_case_studies (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT,
  country TEXT,
  industry TEXT,
  challenge TEXT,
  actions TEXT,
  results TEXT,
  lessons TEXT,
  source_url TEXT,
  verification TEXT DEFAULT 'unverified',
  created_at TEXT NOT NULL
);
