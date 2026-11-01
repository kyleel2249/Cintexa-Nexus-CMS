# CCDI Phase 12 — Worker Adapters, Webhook Retry & HTML Export

## Status
Implemented on `main`.

## Built-in adapters

| Key | Job types | Behaviour |
|-----|-----------|----------|
| `demo.echo` | `demo`, `echo`, `pipeline_test` | No network; echoes parameters |
| `passive.dns` | `dns_lookup`, `passive_dns`, `asset_resolve` | DNS A/AAAA for approved targets only |

**Not included:** Nmap, Nuclei, ZAP, exploit frameworks, credential spraying, etc.

## API

| Endpoint | Purpose |
|----------|--------|
| `GET /api/ccdi/adapters` | List adapters |
| `POST /api/ccdi/adapters/run-next` | Claim + run + complete (in-process worker helper) |
| `POST /api/ccdi/webhooks/retry` | Retry recent failed deliveries |
| `GET /api/ccdi/reporting/reports/:id/export.html` | Print-friendly HTML export |

`run-next` requires `ccdi.job.execute` (or bootstrap / platform admin).

## Safety
- Adapters only run after claim of a **queued** (approved) job
- Kill-switch blocks claims
- Target strings filtered against shell metacharacters
- Passive DNS is resolution only — no port scan

## Explicit non-claims
- Not a full scanner suite
- HTML export is not PDF (browser print-to-PDF is available)
- Webhook retry is a single pass over the last 20 failures, not a durable queue

## Next
Further phases as authorised: additional passive adapters, PDF binary export, durable webhook queue, external worker packaging.
