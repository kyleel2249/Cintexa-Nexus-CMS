# CCDI Phase 5 — Advanced Security Engines

## Status
Implemented on `main`.

## Engines
| Key | Domain |
|-----|--------|
| `cloud_audit` | AWS / Azure / GCP / multi-cloud configuration & posture |
| `server_audit` | Linux / Windows host hardening |
| `container_scan` | Container images, Kubernetes |
| `mobile_scan` | Android / iOS application security |
| `database_audit` | SQL / NoSQL configuration & exposure |
| `iot_scan` | IoT and Industrial / OT systems |
| `config_audit` | Baseline / CIS-style configuration audits |
| `dependency_scan` | Software composition / dependency analysis |

## API
- `GET /api/ccdi/advanced/engines` — catalogue
- `POST /api/ccdi/advanced/assessments` — create draft advanced assessment job
- `POST /api/ccdi/advanced/findings` — record domain-specific finding

## Safety
All advanced assessments still create **draft** jobs that must pass:
1. Approved, non-expired scope
2. Human approval
3. Kill-switch check

before any future worker execution. No live unauthorised scanning is performed.

## Connector hints (registered only)
- Cloud: prowler, scoutsuite, cloudquery
- Server: lynis, osquery, inspec
- Container: trivy, grype, kube-bench, kubehunter
- Mobile: mobsf, qark
- Database: sqlmap, db-audit
- IoT: nmap, shodan, iot-scanner

## Explicit non-claims
- No automatic live cloud or OT scanning
- No real tool process execution yet
- Connectors remain in `registered` state until configuration + health verification in later phases

## Next
Phase 6 — Intelligence, automation and AI agents (correlation, prioritisation, SOAR-style workflows, threat intelligence, advisory agents).
