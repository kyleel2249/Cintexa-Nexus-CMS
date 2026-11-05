
-- Marketing Management Schema (2026-11-04)
-- Safe to re-run (IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS marketing_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketing_audit_events (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id TEXT,
  actor_label TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT,
  before JSONB,
  after JSONB,
  request_id TEXT
);

CREATE TABLE IF NOT EXISTS marketing_idempotency_keys (
  actor TEXT NOT NULL,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor, scope, key)
);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id SERIAL PRIMARY KEY,
  number TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  objective TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PLANNED','APPROVED','ACTIVE','PAUSED','COMPLETED','ARCHIVED')),
  priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  channels TEXT[] NOT NULL DEFAULT '{}',
  start_date DATE,
  end_date DATE,
  budget NUMERIC(18,2) NOT NULL DEFAULT 0,
  spent NUMERIC(18,2) NOT NULL DEFAULT 0,
  owner_id TEXT,
  team_member_ids TEXT[] NOT NULL DEFAULT '{}',
  target_audience JSONB NOT NULL DEFAULT '{}'::jsonb,
  kpis JSONB NOT NULL DEFAULT '{}'::jsonb,
  linked_page_ids INTEGER[] NOT NULL DEFAULT '{}',
  linked_lead_ids INTEGER[] NOT NULL DEFAULT '{}',
  asset_ids INTEGER[] NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS marketing_campaigns_number ON marketing_campaigns(number) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS marketing_campaigns_status ON marketing_campaigns(status) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS marketing_campaigns_dates ON marketing_campaigns(start_date, end_date) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS marketing_campaigns_owner ON marketing_campaigns(owner_id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS marketing_campaign_activities (
  id BIGSERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id TEXT,
  actor_label TEXT,
  action TEXT NOT NULL,
  summary TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS marketing_campaign_activities_campaign ON marketing_campaign_activities(campaign_id, at DESC);

CREATE TABLE IF NOT EXISTS marketing_campaign_expenses (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  amount NUMERIC(18,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  category TEXT,
  description TEXT,
  incurred_at DATE NOT NULL DEFAULT CURRENT_DATE,
  recorded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketing_campaign_expenses_campaign ON marketing_campaign_expenses(campaign_id);

CREATE TABLE IF NOT EXISTS marketing_content (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT,
  type TEXT NOT NULL DEFAULT 'blog' CHECK (type IN ('blog','website','landing','social','video_script','ad_copy','email','newsletter','press','product','case_study','presentation','announcement','story','seo')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','SCHEDULED','PUBLISHED','ARCHIVED')),
  body TEXT,
  body_html TEXT,
  excerpt TEXT,
  campaign_id INTEGER REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  owner_id TEXT,
  category TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  channel TEXT,
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketing_content_status ON marketing_content(status) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS marketing_content_campaign ON marketing_content(campaign_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS marketing_content_type ON marketing_content(type) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS marketing_content_versions (
  id BIGSERIAL PRIMARY KEY,
  content_id INTEGER NOT NULL REFERENCES marketing_content(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT,
  body TEXT,
  body_html TEXT,
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_summary TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS marketing_content_versions_unique ON marketing_content_versions(content_id, version);

CREATE TABLE IF NOT EXISTS marketing_calendar_events (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL DEFAULT 'content' CHECK (event_type IN ('content','campaign','social','email','event','deadline','other')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','SCHEDULED','READY_TO_PUBLISH','PUBLISHED_MANUALLY','FAILED','CANCELLED')),
  channel TEXT,
  campaign_id INTEGER REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  content_id INTEGER REFERENCES marketing_content(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  all_day BOOLEAN NOT NULL DEFAULT FALSE,
  owner_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketing_calendar_events_range ON marketing_calendar_events(starts_at, ends_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS marketing_calendar_events_campaign ON marketing_calendar_events(campaign_id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS marketing_strategies (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  period TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  objectives JSONB NOT NULL DEFAULT '[]'::jsonb,
  positioning TEXT,
  value_propositions JSONB NOT NULL DEFAULT '[]'::jsonb,
  segments JSONB NOT NULL DEFAULT '[]'::jsonb,
  personas JSONB NOT NULL DEFAULT '[]'::jsonb,
  competitors JSONB NOT NULL DEFAULT '[]'::jsonb,
  swot JSONB NOT NULL DEFAULT '{}'::jsonb,
  okrs JSONB NOT NULL DEFAULT '[]'::jsonb,
  body TEXT,
  owner_id TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketing_brand_profiles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  logo_url TEXT,
  colours JSONB NOT NULL DEFAULT '{}'::jsonb,
  typography JSONB NOT NULL DEFAULT '{}'::jsonb,
  tone_of_voice TEXT,
  messaging JSONB NOT NULL DEFAULT '{}'::jsonb,
  guidelines TEXT,
  approved_claims TEXT[] NOT NULL DEFAULT '{}',
  taglines TEXT[] NOT NULL DEFAULT '{}',
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS marketing_brand_profiles_default ON marketing_brand_profiles((TRUE)) WHERE is_default AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS marketing_budgets (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  spent NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  campaign_id INTEGER REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  notes TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketing_budgets_period ON marketing_budgets(period_start, period_end) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS marketing_metrics (
  id BIGSERIAL PRIMARY KEY,
  metric_key TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  value NUMERIC NOT NULL,
  unit TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('measured','manual','calculated','estimated')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_start DATE,
  period_end DATE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS marketing_metrics_entity ON marketing_metrics(entity_type, entity_id, metric_key, recorded_at DESC);
CREATE INDEX IF NOT EXISTS marketing_metrics_key ON marketing_metrics(metric_key, recorded_at DESC);

CREATE TABLE IF NOT EXISTS marketing_automations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  trigger_event TEXT NOT NULL,
  conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  owner_id TEXT,
  last_run_at TIMESTAMPTZ,
  run_count INTEGER NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketing_automation_runs (
  id BIGSERIAL PRIMARY KEY,
  automation_id INTEGER NOT NULL REFERENCES marketing_automations(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed','skipped')),
  trigger_payload JSONB,
  result JSONB,
  error TEXT
);
CREATE INDEX IF NOT EXISTS marketing_automation_runs_auto ON marketing_automation_runs(automation_id, started_at DESC);
