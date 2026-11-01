# CCDI Phase 8 — Worker Foundations & Command Centre UI

## Status
Implemented on `main`.

## Capabilities

### Isolated worker protocol
| Endpoint | Purpose |
|----------|--------|
| `POST /api/ccdi/workers/claim` | Claim next queued job (`FOR UPDATE SKIP LOCKED`) |
| `POST /api/ccdi/workers/heartbeat` | Heartbeat + metrics while running |
| `POST /api/ccdi/workers/complete` | Mark success/failure, attach evidence metadata |

Workers must respect the kill-switch. The control plane does **not** invoke scanner binaries.

### Command Centre UI
- Phase-aware status banner
- Kill-switch indicator
- Real counts: assets, findings, jobs, audit events
- Organisation list
- Operational notes (scope, approval, advisory AI)

## Safety
- Claim blocked when kill-switch is active
- Only `queued` jobs with `cancel_requested = false` are claimable
- Evidence is metadata-only unless a worker supplies storage refs
- No live Nmap/ZAP/Nuclei/etc. execution in this phase

## Explicit non-claims
- No packaged worker binary or Docker image ships in Phase 8
- No automatic tool installation
- Sidebar nav entry for CCDI may still need AppLayout wiring depending on theme

## Next
Further phases may cover live connector adapters inside workers, deeper RBAC middleware on every route, PDF report export, and production deployment hardening.
