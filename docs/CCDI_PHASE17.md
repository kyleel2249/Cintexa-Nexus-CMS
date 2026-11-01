# CCDI Phase 17 — SLA Policies & Operational Metrics

## Status
Implemented on `main`.

## Default SLA (remediation due days)
| Severity | Days |
|----------|------|
| critical | 7 |
| high | 14 |
| medium | 30 |
| low | 60 |
| info | none |

Override per organisation via `settings.sla` JSON or:
```
PUT /api/ccdi/sla/policy
{ "organizationId": "...", "sla": { "critical": 3, "high": 7 } }
```

Remediation tasks without an explicit `dueDate` inherit SLA from finding severity (or task priority).

## API
| Path | Purpose |
|------|--------|
| `GET /api/ccdi/sla?organizationId=` | Policy + breach counters |
| `PUT /api/ccdi/sla/policy` | Update org SLA days |
| `GET /api/ccdi/metrics?organizationId=` | Ops snapshot (JSON) |

## Explicit non-claims
- Not a full GRC/SLA product
- Breach counters use default windows for findings (7/14 days) plus task due dates
- Metrics are JSON snapshots, not Prometheus exposition format

## Next
Further phases as authorised.
