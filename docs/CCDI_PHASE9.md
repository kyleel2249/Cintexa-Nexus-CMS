# CCDI Phase 9 — RBAC Hardening, Navigation & Production Readiness

## Status
Implemented on `main`.

## Delivered

### Sidebar navigation
- **Cyber Defense (CCDI)** entry under Intelligence → `/ccdi`

### RBAC
- Permission + system role seeder (`seedCcdiRbac`)
- `requireCcdiPermission` middleware (bootstrap-friendly: allows access until roles are assigned)
- Routes:
  - `POST /api/ccdi/rbac/seed`
  - `GET /api/ccdi/rbac/roles`
  - `GET /api/ccdi/rbac/permissions`
  - `POST /api/ccdi/rbac/assign`
  - `GET /api/ccdi/rbac/assignments`

### Production readiness checklist
See below. Use before any production deployment claim.

## Production readiness checklist

| Item | Status |
|------|--------|
| Authenticated API (apiGuard + requireAuth) | Implemented |
| Org isolation on CCDI tables | Implemented |
| Scope + approval gates for jobs | Implemented |
| Kill-switch | Implemented |
| Audit logging of critical actions | Implemented |
| No raw secrets in DB | Implemented (secret_refs only) |
| Worker claim protocol | Implemented (no live scanners) |
| RBAC seed + assignment API | Implemented |
| Fine-grained permission on every route | Partial (middleware available; apply per-route as needed) |
| Live scanner workers | Not in scope yet |
| PDF report export | Not in scope yet |
| Automated external threat feeds | Not in scope yet |
| HTTPS / secrets in env | Operator responsibility |
| DATABASE_URL / OPENROUTER_API_KEY | Operator responsibility |

## Explicit non-claims
- CCDI is **not** claimed production-complete for unattended internet-facing scanning
- Live tool execution remains future work
- Operators must configure auth, DB, and secrets before any deployment claim

## Next
Phase 10+ as authorised: live connector workers, PDF export, stricter default-deny RBAC, deployment automation.
