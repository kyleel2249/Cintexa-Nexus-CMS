# Marketing Management expansion (2026-11-05)

Local-first only. No marketing HTTP APIs. No new authentication.

## Added
- CSV import (campaigns, leads) with mapping, preview, duplicate modes
- Marketing calendar (month + agenda) from existing dated records
- Activity log UI (search, filters, export)
- Touchpoints + first/last/linear attribution when conversion exists
- Template library, A/B variants (manual metrics)
- Persona recommendation panel (content, email, social)
- Budget alert thresholds + overview alerts
- Integration completeness (n/5) on campaigns + filters/sort
- Role-aware marketing nav when Sales session perms exist
- Soft schema migration for new entity bags

## Limits
- Browser-local persistence only
- Multi-touch attribution requires recorded touchpoints
- CMS Media/Pages/Forms pickers are session cache-only
- CI/e2e not fully verified in agent environment
- Activity log coverage is broad but not guaranteed for every edge mutation
