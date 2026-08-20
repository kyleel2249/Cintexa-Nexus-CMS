-- Adds dedicated storage for buying signals, sales forecasts, sales alerts,
-- sales experiments, revenue attribution, and follow-up sequences.
-- Previously these were either computed live with no persistence (forecast,
-- alerts) or not implemented at all (buying signals, experiments,
-- attribution, sequences) — see sales-force.ts route/service changes in the
-- same change set for how each table is populated from real system activity.

CREATE TABLE IF NOT EXISTS buying_signals (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER,
  opportunity_id INTEGER,
  signal_type TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  source TEXT NOT NULL DEFAULT 'system',
  evidence TEXT NOT NULL DEFAULT 'CALCULATED',
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_buying_signals_lead ON buying_signals(lead_id);
CREATE INDEX IF NOT EXISTS idx_buying_signals_opportunity ON buying_signals(opportunity_id);

CREATE TABLE IF NOT EXISTS sales_forecasts (
  id SERIAL PRIMARY KEY,
  period TEXT NOT NULL,
  period_type TEXT NOT NULL,
  pipeline_total NUMERIC NOT NULL DEFAULT 0,
  weighted_pipeline NUMERIC NOT NULL DEFAULT 0,
  best_case NUMERIC NOT NULL DEFAULT 0,
  expected_case NUMERIC NOT NULL DEFAULT 0,
  worst_case NUMERIC NOT NULL DEFAULT 0,
  actual_closed NUMERIC,
  note TEXT,
  evidence TEXT NOT NULL DEFAULT 'CALCULATED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_forecasts_period ON sales_forecasts(period_type, period);

CREATE TABLE IF NOT EXISTS sales_alerts (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  detail TEXT,
  entity_type TEXT,
  entity_id INTEGER,
  evidence TEXT NOT NULL DEFAULT 'CALCULATED',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sales_alerts_status ON sales_alerts(status);
CREATE INDEX IF NOT EXISTS idx_sales_alerts_entity ON sales_alerts(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS sales_experiments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  audience TEXT,
  variable TEXT NOT NULL,
  variants JSONB NOT NULL DEFAULT '[]',
  success_metric TEXT NOT NULL,
  sample_size INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_date TIMESTAMPTZ,
  results JSONB,
  winning_variant TEXT,
  recommendation TEXT,
  created_by_agent_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_attribution (
  id SERIAL PRIMARY KEY,
  opportunity_id INTEGER NOT NULL,
  revenue_amount NUMERIC NOT NULL DEFAULT 0,
  agent_id INTEGER,
  campaign_id INTEGER,
  lead_source TEXT,
  channel TEXT,
  touch_type TEXT NOT NULL DEFAULT 'last_touch',
  weight NUMERIC NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_attribution_opportunity ON sales_attribution(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_sales_attribution_agent ON sales_attribution(agent_id);
CREATE INDEX IF NOT EXISTS idx_sales_attribution_campaign ON sales_attribution(campaign_id);

CREATE TABLE IF NOT EXISTS sales_sequences (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL,
  sequence_name TEXT NOT NULL DEFAULT 'standard_outbound',
  status TEXT NOT NULL DEFAULT 'active',
  current_step INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 6,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_step_at TIMESTAMPTZ,
  next_step_due_at TIMESTAMPTZ,
  stopped_reason TEXT,
  created_by_agent_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_sequences_lead ON sales_sequences(lead_id);
CREATE INDEX IF NOT EXISTS idx_sales_sequences_status ON sales_sequences(status);
