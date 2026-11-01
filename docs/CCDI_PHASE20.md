# CCDI Phase 20 — In-App Alerts & Subscriptions

## Status
Implemented on `main`.

## Tables
- `ccdi_alerts` — operator notification feed
- `ccdi_alert_subscriptions` — per-user channel preferences

## API

| Method | Path | Purpose |
|--------|------|--------|
| GET | `/api/ccdi/alerts` | List alerts (`unacknowledged=true` optional) |
| POST | `/api/ccdi/alerts` | Raise manual alert (admin) |
| POST | `/api/ccdi/alerts/:id/acknowledge` | Ack alert |
| GET | `/api/ccdi/alerts/subscriptions` | List subscriptions |
| PUT | `/api/ccdi/alerts/subscriptions` | Upsert subscription |
| GET | `/api/ccdi/alerts/digest` | JSON digest for external mailers |

## Explicit non-claims
- Does **not** send email/SMS/push by itself
- Use digests + webhooks for external delivery

## Next
Further phases as authorised.
