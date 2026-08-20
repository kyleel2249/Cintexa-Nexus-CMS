CREATE TABLE IF NOT EXISTS sales_settings (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_meetings (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER,
  opportunity_id INTEGER,
  title TEXT NOT NULL,
  scheduled_at TEXT,
  duration_minutes INTEGER DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'scheduled',
  attendees JSONB NOT NULL DEFAULT '[]',
  notes TEXT,
  created_by_agent_id INTEGER,
  calendar_synced BOOLEAN NOT NULL DEFAULT false,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_meetings_lead ON sales_meetings(lead_id);
