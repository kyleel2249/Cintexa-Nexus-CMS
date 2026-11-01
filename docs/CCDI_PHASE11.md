# CCDI Phase 11 — Webhooks, SIEM Export & Stricter Route RBAC

## Status
Implemented on `main`.

## Capabilities

### Webhooks
| Endpoint | Purpose |
|----------|--------|
| `POST /api/ccdi/webhooks` | Register endpoint (returns signing secret once) |
| `GET /api/ccdi/webhooks?organizationId=` | List endpoints |
| `DELETE /api/ccdi/webhooks/:id?organizationId=` | Remove endpoint |
| `GET /api/ccdi/webhooks/deliveries?organizationId=` | Delivery log |
| `POST /api/ccdi/webhooks/test` | Synthetic test event |

Outbound deliveries include `X-CCDI-Signature: sha256=<hmac>`.
Private/local webhook targets are rejected (basic SSRF guard).

### SIEM export
- `GET /api/ccdi/siem/export?organizationId=&since=&limit=`
- NDJSON stream of audit events suitable for log pipelines

### Stricter RBAC
- Kill-switch changes require `ccdi.platform.admin` (via `requireCcdiPermission`)
- Webhook admin routes require `ccdi.org.admin`
- Bootstrap allow still applies unless `CCDI_STRICT_RBAC=1`

## Explicit non-claims
- Webhooks are best-effort; no guaranteed delivery queue / retries beyond single attempt
- No live scanner integrations
- SIEM export is pull-based (no push agent)

## Next
Phase 12+ as authorised: worker tool adapters, PDF reports, default-deny on all routes.
