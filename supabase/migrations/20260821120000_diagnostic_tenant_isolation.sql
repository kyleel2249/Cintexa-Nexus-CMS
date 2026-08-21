-- Closes the tenant-isolation gap on the Business Diagnostic module.
-- Child tables (diagnostic_sessions, diagnostic_competitors, diagnostic_goals)
-- inherit isolation transitively via profile_id/session_id FK back to
-- diagnostic_profiles, checked at the route layer (see diagnostics.ts) —
-- same pattern already used by cd_optimizer_jobs / nexus_finance_analyses.

ALTER TABLE diagnostic_profiles ADD COLUMN IF NOT EXISTS organization_id TEXT;
CREATE INDEX IF NOT EXISTS idx_diagnostic_profiles_org ON diagnostic_profiles(organization_id);
