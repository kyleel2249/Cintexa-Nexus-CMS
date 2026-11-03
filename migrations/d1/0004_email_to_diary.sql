
-- Email-to-Diary extensions
CREATE TABLE IF NOT EXISTS bd_correspondence (
  id TEXT PRIMARY KEY,
  subject TEXT,
  body TEXT NOT NULL,
  extraction_json TEXT,
  diary_entry_id TEXT,
  status TEXT NOT NULL DEFAULT 'processed',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bd_organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT,
  industry TEXT,
  relationship_status TEXT NOT NULL DEFAULT 'Prospect',
  last_engagement TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bd_org_name ON bd_organizations(name);
CREATE TABLE IF NOT EXISTS bd_opportunities (
  id TEXT PRIMARY KEY,
  diary_entry_id TEXT,
  title TEXT NOT NULL,
  organization TEXT,
  category TEXT,
  description TEXT,
  stage TEXT,
  estimated_value TEXT,
  status TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bd_commitments (
  id TEXT PRIMARY KEY,
  diary_entry_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  party TEXT,
  priority TEXT,
  status TEXT,
  due_date TEXT,
  created_at TEXT NOT NULL
);
