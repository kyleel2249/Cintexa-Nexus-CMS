# CCDI Phase 10 — Connector Health, Report Export & Deployment Hardening

## Status
Implemented on `main`.

## Capabilities

### Connector health (local only)
- `POST /api/ccdi/connectors/:id/health`
- `POST /api/ccdi/connectors/health-all`
- Validates registration, config presence, disabled flag, secret ref integrity
- **Does not** probe customer networks or run scanners

### Report export
- `GET /api/ccdi/reporting/reports/:id/export?format=json|markdown`
- Returns `Content-Disposition` attachment

### Deployment readiness
- `GET /api/ccdi/readiness`
- Honest flags: control plane vs live scanning

### Strict RBAC mode (optional)
- Env: `CCDI_STRICT_RBAC=1`
- When set, bootstrap allow (users with zero CCDI roles) is disabled for routes using `requireCcdiPermission`
- Enable **only after** roles are assigned

## Deployment runbook (operator)

1. Provision PostgreSQL and set `DATABASE_URL`
2. Start API; CCDI tables bootstrap idempotently
3. Configure Firebase/JWT auth as per Nexus
4. `POST /api/ccdi/rbac/seed`
5. Create organisation; assign roles via `POST /api/ccdi/rbac/assign`
6. Optionally set `OPENROUTER_API_KEY` for advisory agents
7. Optionally set `CCDI_STRICT_RBAC=1` after assignments
8. Keep worker claim endpoints behind auth + network policy
9. **Do not** claim live scanning readiness until dedicated workers exist

## Explicit non-claims
- No PDF/DOCX binary export (JSON + Markdown only)
- No live scanner process execution
- Readiness `liveScanning: false` is intentional

## Next
Further phases as authorised: real worker adapters, PDF pipeline, SIEM integrations.
