# CCDI Phase 18 — Command Centre UI & Prometheus Metrics

## Status
Implemented on `main`.

## Command Centre UI (`/ccdi`)
- Organisation selector
- Remediation summary card
- SLA breach card
- Webhooks / evidence ops card
- SLA policy days display

## Prometheus metrics
```
GET /api/ccdi/metrics/prometheus
GET /api/ccdi/metrics/prometheus?organizationId=<uuid>
```

Text exposition (`text/plain; version=0.0.4`) for scrape targets. Requires auth (same as other CCDI routes).

## Explicit non-claims
- Not a full Grafana dashboard pack
- Prometheus endpoint is authenticated JSON-platform style (Bearer/session), not anonymous public scrape by default

## Next
Further phases as authorised.
