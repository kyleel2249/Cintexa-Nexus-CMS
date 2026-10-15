# Database / migrations
No manual migration. `lib/db/src/bootstrap.ts` appends `WI_SCHEMA_STATEMENTS` to the existing idempotent `ensureSchema` run, which executes on API start (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). Existing tables are untouched.

Tables: `wi_audits`, `wi_pages`, `wi_checks`, `wi_findings`, `wi_finding_workflow`, `wi_recommendations`, `wi_performance`, `wi_tasks`, `wi_reports`, `wi_comparisons`, `wi_monitors`, `wi_events`. Engine settings reuse `platform_settings` (key `website_intelligence`).

Scoring is versioned (`scoring_version` per audit) so historic scores remain interpretable when weights change.
