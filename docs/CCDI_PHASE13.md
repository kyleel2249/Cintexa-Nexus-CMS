# CCDI Phase 13 — Extended Passive Adapters & Worker Packaging

## Status
Implemented on `main`.

## Built-in adapters (complete list)

| Key | Job types | Behaviour |
|-----|-----------|----------|
| `demo.echo` | `demo`, `echo`, `pipeline_test` | No network |
| `passive.dns` | `dns_lookup`, `passive_dns`, `asset_resolve` | DNS A/AAAA |
| `passive.tls` | `tls_cert`, `passive_tls`, `cert_metadata` | Cert subject/issuer/validity |
| `passive.http` | `http_headers`, `passive_http`, `header_check` | HEAD/GET security headers |

Still **not** included: port scanners, vuln scanners, credential attacks, crawling/spidering.

## External worker packaging (operator guide)

You do not need a separate process if you use:

```http
POST /api/ccdi/adapters/run-next
Authorization: Bearer <token>
{ "organizationId": "<uuid>", "workerId": "worker-1" }
```

For an isolated worker host:

1. Authenticate with a service account that has `ccdi.job.execute` (or assign after `CCDI_STRICT_RBAC=1`).
2. Loop:
   - `POST /api/ccdi/workers/claim`
   - Map `job.job_type` → adapter (or call your own tool **only** if authorised and in scope)
   - `POST /api/ccdi/workers/heartbeat` periodically
   - `POST /api/ccdi/workers/complete` with evidence metadata
3. Honour kill-switch (`GET /api/ccdi/kill-switch` or claim will 503).
4. Network-restrict the worker so it can only reach approved targets and the API.

Example claim body:
```json
{ "workerId": "edge-worker-a", "organizationId": "<org-uuid>" }
```

## Safety
- TLS adapter uses `rejectUnauthorized: false` only to **read** presented certs (metadata collection), not to establish trust for application traffic.
- HTTP adapter does not follow full crawl graphs (`redirect: manual`).
- Targets still pass the safety filter.

## Explicit non-claims
- Not a vulnerability assessment suite
- No automated exploitation
- Packaging guide is operational documentation, not a published container image

## Next
Phase 14+ as authorised: finding auto-ingest from adapter results, PDF export, durable queues.
