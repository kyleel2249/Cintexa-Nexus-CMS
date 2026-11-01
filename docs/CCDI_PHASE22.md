# CCDI Phase 22 — Data Retention & Rate Limiting

## Status
Implemented on `main`.

## Retention
Stored under `ccdi_organizations.settings.retention`.

Defaults:
| Stream | Days |
|--------|------|
| Audit logs | 365 |
| Acknowledged alerts | 90 |
| Webhook deliveries | 30 |
| Webhook outbox (delivered/dead) | 30 |
| Finished executions | 180 |

**Never deleted by retention job:** findings, evidence records/blobs, assets.

| Method | Path | Purpose |
|--------|------|--------|
| GET | `/api/ccdi/retention?organizationId=` | Read policy |
| PUT | `/api/ccdi/retention` | Update policy |
| POST | `/api/ccdi/retention/apply` | Dry-run (default) or execute |

`apply` defaults to **dryRun: true**. Pass `"dryRun": false` to delete.

## Rate limiting
In-memory fixed-window limiter (`ccdi-rate-limit` middleware) applied to retention mutations (30/min per user+route). Single-node only.

## Explicit non-claims
- Not a distributed rate limiter (Redis/etc.)
- Retention does not touch evidence or findings

## Next
Further phases as authorised.
