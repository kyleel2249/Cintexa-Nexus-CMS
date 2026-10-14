# Rollback
- **Code**: revert the commit / redeploy the previous build. The only edited existing behaviours are additive (routes, nav item, 3 webhook events, one public-route rule, schema append).
- **Data**: `wi_*` tables are isolated. To remove: `DROP TABLE IF EXISTS wi_events, wi_comparisons, wi_monitors, wi_reports, wi_tasks, wi_recommendations, wi_performance, wi_finding_workflow, wi_findings, wi_checks, wi_pages, wi_audits CASCADE;` and delete the `platform_settings` row with key `website_intelligence`. Business Diagnostics and other tables are untouched.
- **Disable without removing**: hide the sidebar item or unset nothing — with no audits running the feature is inert.
