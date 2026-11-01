# CCDI Phase 14 — Findings Ingest & DNS Posture

## Status
Implemented on `main`.

## Delivered

### Findings auto-ingest
When `POST /api/ccdi/adapters/run-next` completes an adapter run, any `findings[]` in the adapter result are upserted into `ccdi_findings` (fingerprint-deduped) and optional `finding.created` webhooks are emitted.

Response includes `findingsIngested`.

### New adapter: `passive.dns_posture`
| Job types | Checks |
|-----------|--------|
| `dns_posture`, `email_posture`, `spf_dmarc`, `passive_dns_posture` | SPF, DMARC, MX, CAA |

Example findings:
- Missing SPF / DMARC
- SPF `+all`
- DMARC `p=none`
- Missing CAA (info)

## Adapter catalogue (current)
- `demo.echo`
- `passive.dns`
- `passive.tls`
- `passive.http`
- `passive.dns_posture`

## Explicit non-claims
- Still not a vulnerability scanner suite
- DNS posture is advisory; mail-flow validation is not performed
- No SMTP probing

## Next
Phase 15+ as authorised: PDF export, durable webhook queue, further passive checks.
