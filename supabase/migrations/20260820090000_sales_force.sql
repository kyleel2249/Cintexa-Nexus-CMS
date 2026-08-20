CREATE TABLE IF NOT EXISTS sales_agents (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  role TEXT NOT NULL,
  avatar TEXT,
  personality TEXT,
  specialization TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  autonomy_level INTEGER NOT NULL DEFAULT 1,
  territory TEXT,
  products JSONB NOT NULL DEFAULT '[]',
  permissions JSONB NOT NULL DEFAULT '{}',
  targets JSONB NOT NULL DEFAULT '{}',
  performance JSONB NOT NULL DEFAULT '{}',
  knowledge_version TEXT DEFAULT '1',
  config JSONB NOT NULL DEFAULT '{}',
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_agents_slug ON sales_agents(slug);

CREATE TABLE IF NOT EXISTS sales_leads (
  id SERIAL PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  contact_title TEXT,
  website TEXT,
  industry TEXT,
  company_size TEXT,
  location TEXT,
  source TEXT DEFAULT 'manual',
  stage TEXT NOT NULL DEFAULT 'new_lead',
  fit_score INTEGER,
  engagement_score INTEGER,
  intent_score INTEGER,
  value_score INTEGER,
  timing_score INTEGER,
  priority_score INTEGER,
  quality_label TEXT,
  assigned_agent_id INTEGER,
  owner_human TEXT,
  notes TEXT,
  research_brief JSONB,
  scores_detail JSONB,
  tags JSONB NOT NULL DEFAULT '[]',
  consent_email BOOLEAN NOT NULL DEFAULT false,
  consent_sms BOOLEAN NOT NULL DEFAULT false,
  opted_out BOOLEAN NOT NULL DEFAULT false,
  last_contact_at TIMESTAMPTZ,
  next_action TEXT,
  next_action_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_leads_stage ON sales_leads(stage);
CREATE INDEX IF NOT EXISTS idx_sales_leads_priority ON sales_leads(priority_score DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS sales_opportunities (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER,
  name TEXT NOT NULL,
  company_name TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'qualified',
  amount NUMERIC,
  currency TEXT NOT NULL DEFAULT 'GHS',
  probability INTEGER NOT NULL DEFAULT 10,
  risk_score INTEGER,
  assigned_agent_id INTEGER,
  owner_human TEXT,
  products JSONB NOT NULL DEFAULT '[]',
  expected_close_date TEXT,
  lost_reason TEXT,
  won_at TIMESTAMPTZ,
  lost_at TIMESTAMPTZ,
  notes TEXT,
  context JSONB NOT NULL DEFAULT '{}',
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_activities (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER,
  opportunity_id INTEGER,
  agent_id INTEGER,
  actor_type TEXT NOT NULL DEFAULT 'ai',
  actor_name TEXT,
  action TEXT NOT NULL,
  channel TEXT,
  summary TEXT,
  detail JSONB NOT NULL DEFAULT '{}',
  confidence TEXT,
  result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_activities_lead ON sales_activities(lead_id);

CREATE TABLE IF NOT EXISTS sales_campaigns (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  objective TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  audience JSONB NOT NULL DEFAULT '{}',
  channels JSONB NOT NULL DEFAULT '[]',
  sequence JSONB NOT NULL DEFAULT '[]',
  product TEXT,
  offer TEXT,
  start_date TEXT,
  end_date TEXT,
  stats JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_proposals (
  id SERIAL PRIMARY KEY,
  opportunity_id INTEGER,
  lead_id INTEGER,
  title TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  body JSONB NOT NULL DEFAULT '{}',
  amount NUMERIC,
  currency TEXT DEFAULT 'GHS',
  valid_until TEXT,
  created_by_agent_id INTEGER,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_quotes (
  id SERIAL PRIMARY KEY,
  opportunity_id INTEGER,
  lead_id INTEGER,
  line_items JSONB NOT NULL DEFAULT '[]',
  subtotal NUMERIC,
  discount NUMERIC,
  tax NUMERIC,
  total NUMERIC,
  currency TEXT DEFAULT 'GHS',
  valid_until TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by_agent_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_audit_logs (
  id SERIAL PRIMARY KEY,
  agent_id INTEGER,
  agent_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  reason TEXT,
  data_used JSONB NOT NULL DEFAULT '{}',
  result TEXT,
  revenue_impact NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_playbooks (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  rules JSONB NOT NULL DEFAULT '[]',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_knowledge (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  content TEXT,
  source_url TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_agent_memory (
  id SERIAL PRIMARY KEY,
  agent_id INTEGER NOT NULL,
  lead_id INTEGER,
  opportunity_id INTEGER,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
