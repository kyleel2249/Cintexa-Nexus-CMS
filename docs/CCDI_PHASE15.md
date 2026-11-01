# CCDI Phase 15 — PDF Export & Durable Webhook Outbox

## Status
Implemented on `main`.

## PDF export
```
GET /api/ccdi/reporting/reports/:id/export.pdf
```
Dependency-free text PDF (Helvetica). Complements existing HTML export.

## Durable webhook outbox
Table: `ccdi_webhook_outbox`

- Failed immediate deliveries are enqueued automatically
- Exponential backoff (30s → 1h, max 8 attempts)
- Dead-letter status after max attempts

| Endpoint | Purpose |
|----------|--------|
| `POST /api/ccdi/webhooks/outbox/process` | Drain due outbox rows |
| `GET /api/ccdi/webhooks/outbox` | List outbox (admin) |

Schedule `outbox/process` via cron or ops automation.

## Explicit non-claims
- PDF is text-oriented (not a branded design system)
- Outbox is DB-backed; no external message broker required
- Still no unauthorised scanning

## Next
Further phases as authorised.
