# Database / migrations
No manual migration. `lib/db/src/bootstrap.ts` appends `WI_SCHEMA_STATEMENTS` to the existing idempotent `ensureSchema` run, which executes on API start (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). Existing tables are untouched.

Tables: `wi_audits`, `wi_pages`, `wi_checks`, `wi_findings`, `wi_finding_workflow`, `wi_recommendations`, `wi_performance`, `wi_tasks`, `wi_reports`, `wi_comparisons`, `wi_monitors`, `wi_events`. Engine settings reuse `platform_settings` (key `website_intelligence`).

Scoring is versioned (`scoring_version` per audit) so historic scores remain interpretable when weights change.

Competitor intelligence adds `wi_competitors` (primary key `owner_id, site_hostname, domain`; evidence and the confidence breakdown stored as JSONB; `confidence` is `DOUBLE PRECISION`) and `wi_competitor_runs` (one row per discovery run with provider, queries and the run report). Both are created by the same idempotent statements; nothing is altered or dropped.

The approval workflow adds `wi_rec_workflow` (primary key `audit_id, fingerprint`; `version` for compare-and-set), `wi_rec_events` (append-only log) and `wi_rec_approvals`. Created idempotently with the other tables. See [recommendation-workflow.md](recommendation-workflow.md).