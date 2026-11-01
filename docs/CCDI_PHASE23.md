# CCDI Phase 23 — Production Readiness Assessment

## Status
Implemented on `main`.

## Endpoints

| Method | Path | Purpose |
|--------|------|--------|
| GET | `/api/ccdi/readiness` | Full check report (platform admin) |
| GET | `/api/ccdi/readiness/summary` | Compact summary (authenticated) |

## Check categories
- **schema** — core and optional CCDI tables
- **security** — kill switch, RBAC, strict mode env
- **config** — database URL, OpenRouter key
- **operations** — active orgs / jobs
- **capability** — honest statements (passive adapters vs active scanning, email)

## Production guidance
- Enable `CCDI_RBAC_STRICT=true` in production
- Schedule webhook outbox processing and retention dry-runs
- Wire external mail/chat from alert digests + webhooks
- Do not claim active scanning or built-in email delivery without further work

## Explicit non-claims
- Not a penetration test
- Not multi-node rate-limit verification
- Not external worker-fleet health

## Next
Phase 24 (final consolidation) when authorised.
