/*
# Create Business Diagnostic tables

1. New Tables
- `diagnostic_profiles` — Company intelligence profiles with 30+ fields covering company info, financials, sales, marketing, technology
- `diagnostic_sessions` — Assessment sessions with answers, scores, AI analysis, recommendations, SMART goals, execution roadmap, SWOT, competitive analysis
- `diagnostic_competitors` — Competitor intelligence entries with scorecard and strategy analysis
- `diagnostic_goals` — Strategic/tactical/operational goals with SMART scoring, cascading hierarchy, KPI tracking

2. Security
- RLS enabled on all tables
- anon + authenticated CRUD (single-tenant CMS admin app — all data shared)
*/

CREATE TABLE IF NOT EXISTS diagnostic_profiles (
  id SERIAL PRIMARY KEY,
  company_name TEXT NOT NULL,
  industry TEXT,
  sub_industry TEXT,
  business_model TEXT,
  customer_type TEXT,
  geographic_markets TEXT,
  target_customers TEXT,
  company_size TEXT,
  employee_count INTEGER,
  revenue_range TEXT,
  annual_growth TEXT,
  monthly_revenue INTEGER,
  gross_margin INTEGER,
  net_margin INTEGER,
  avg_transaction_value INTEGER,
  customer_lifetime_value INTEGER,
  customer_acquisition_cost INTEGER,
  monthly_leads INTEGER,
  monthly_qualified_leads INTEGER,
  monthly_customers INTEGER,
  conversion_rate INTEGER,
  customer_churn INTEGER,
  retention_rate INTEGER,
  sales_cycle_days INTEGER,
  main_products TEXT,
  main_services TEXT,
  main_revenue_sources TEXT,
  main_competitors TEXT,
  technology_stack TEXT,
  crm_system TEXT,
  accounting_system TEXT,
  marketing_platforms TEXT,
  ecommerce_platform TEXT,
  communication_systems TEXT,
  existing_automation TEXT,
  strategic_objectives TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS diagnostic_sessions (
  id SERIAL PRIMARY KEY,
  profile_id INTEGER REFERENCES diagnostic_profiles(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'standard',
  status TEXT NOT NULL DEFAULT 'in_progress',
  current_step INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 10,
  answers JSONB NOT NULL DEFAULT '{}',
  pillar_scores JSONB NOT NULL DEFAULT '{}',
  overall_score INTEGER,
  ai_analysis JSONB,
  recommendations JSONB,
  smart_goals JSONB,
  execution_roadmap JSONB,
  swot_analysis JSONB,
  competitive_analysis JSONB,
  benchmark_comparison JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS diagnostic_competitors (
  id SERIAL PRIMARY KEY,
  profile_id INTEGER REFERENCES diagnostic_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  website TEXT,
  positioning TEXT,
  strengths TEXT,
  weaknesses TEXT,
  pricing TEXT,
  target_customers TEXT,
  market_share TEXT,
  scorecard JSONB NOT NULL DEFAULT '{}',
  strategy_analysis JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS diagnostic_goals (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES diagnostic_sessions(id) ON DELETE CASCADE,
  goal_type TEXT NOT NULL DEFAULT 'strategic',
  title TEXT NOT NULL,
  description TEXT,
  owner TEXT,
  department TEXT,
  deadline TEXT,
  kpi TEXT,
  baseline TEXT,
  target TEXT,
  current_value TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'not_started',
  priority TEXT NOT NULL DEFAULT 'medium',
  parent_goal_id INTEGER,
  smart_score INTEGER,
  dependencies TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE diagnostic_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE diagnostic_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE diagnostic_competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE diagnostic_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_diagnostic_profiles" ON diagnostic_profiles;
CREATE POLICY "anon_select_diagnostic_profiles" ON diagnostic_profiles FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_diagnostic_profiles" ON diagnostic_profiles;
CREATE POLICY "anon_insert_diagnostic_profiles" ON diagnostic_profiles FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_diagnostic_profiles" ON diagnostic_profiles;
CREATE POLICY "anon_update_diagnostic_profiles" ON diagnostic_profiles FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_diagnostic_profiles" ON diagnostic_profiles;
CREATE POLICY "anon_delete_diagnostic_profiles" ON diagnostic_profiles FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_diagnostic_sessions" ON diagnostic_sessions;
CREATE POLICY "anon_select_diagnostic_sessions" ON diagnostic_sessions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_diagnostic_sessions" ON diagnostic_sessions;
CREATE POLICY "anon_insert_diagnostic_sessions" ON diagnostic_sessions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_diagnostic_sessions" ON diagnostic_sessions;
CREATE POLICY "anon_update_diagnostic_sessions" ON diagnostic_sessions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_diagnostic_sessions" ON diagnostic_sessions;
CREATE POLICY "anon_delete_diagnostic_sessions" ON diagnostic_sessions FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_diagnostic_competitors" ON diagnostic_competitors;
CREATE POLICY "anon_select_diagnostic_competitors" ON diagnostic_competitors FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_diagnostic_competitors" ON diagnostic_competitors;
CREATE POLICY "anon_insert_diagnostic_competitors" ON diagnostic_competitors FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_diagnostic_competitors" ON diagnostic_competitors;
CREATE POLICY "anon_update_diagnostic_competitors" ON diagnostic_competitors FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_diagnostic_competitors" ON diagnostic_competitors;
CREATE POLICY "anon_delete_diagnostic_competitors" ON diagnostic_competitors FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_diagnostic_goals" ON diagnostic_goals;
CREATE POLICY "anon_select_diagnostic_goals" ON diagnostic_goals FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_diagnostic_goals" ON diagnostic_goals;
CREATE POLICY "anon_insert_diagnostic_goals" ON diagnostic_goals FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_diagnostic_goals" ON diagnostic_goals;
CREATE POLICY "anon_update_diagnostic_goals" ON diagnostic_goals FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_diagnostic_goals" ON diagnostic_goals;
CREATE POLICY "anon_delete_diagnostic_goals" ON diagnostic_goals FOR DELETE TO anon, authenticated USING (true);
