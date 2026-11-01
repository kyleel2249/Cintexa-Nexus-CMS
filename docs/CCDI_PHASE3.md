# CCDI Phase 3 — Secure Execution & Orchestration

## Status
Implemented and committed on `main`.

## Control-plane pipeline
```
REQUEST → SCOPE VALIDATION → POLICY CHECK → APPROVAL → QUEUE
  → (isolated worker placeholder) → RESULT VALIDATION → EVIDENCE → REPORTING
```

No arbitrary shell commands are accepted. No live scanner binaries are invoked in Phase 3.

## New tables
- `ccdi_connectors` — tool adapter registry
- `ccdi_jobs` — requested work units with full lifecycle
- `ccdi_executions` — runtime instances
- `ccdi_approvals` — human gates for scopes and jobs
- `ccdi_evidence` — evidence metadata + integrity hash fields
- `ccdi_kill_switch` — global emergency stop (singleton)

## Key APIs (`/api/ccdi`)
| Method | Path | Purpose |
|--------|------|--------|
| GET | /health | Phase + kill-switch status |
| GET/POST | /organizations | Tenants |
| GET/POST | /assets | Inventory |
| GET/POST | /scopes | Authorisation scopes |
| POST | /scopes/:id/submit | Request scope approval |
| POST | /scopes/:id/decide | Approve / reject scope |
| GET/POST | /jobs | Security jobs |
| POST | /jobs/:id/submit | Submit job for approval |
| POST | /jobs/:id/decide | Approve / reject job |
| POST | /jobs/:id/cancel | Cancel job + running executions |
| GET | /connectors | Registered connectors |
| GET | /evidence | Evidence metadata |
| GET | /approvals | Approval inbox |
| GET/POST | /kill-switch | Emergency stop |
| GET | /audit | Audit trail |
| GET | /command-centre | Evidence-backed summary |

## Safety guarantees implemented
- Kill-switch blocks new job creation and cancels queued/running work
- Jobs require an approved, non-expired scope before submission
- Target validation against scope allow-list and exclusions
- Explicit human approval records for scopes and jobs
- Cancellation marks jobs and in-flight executions
- All state changes write audit log entries
- Connectors start as `registered` only — never claimed healthy without verification

## Explicit non-claims (Phase 3)
- No isolated Docker/Kubernetes workers yet
- No real Nmap / ZAP / Nuclei / Trivy execution
- Connector status remains `registered` until later configuration + health-check phases
- Evidence storage is metadata-only (object-store integration later)

## Next phase
Phase 4 will introduce the first real security engines (asset discovery, attack-surface, vulnerability management, website/network/API assessment) that call into this control plane under the same approval and scope rules.
