# CCDI Phase 25 — Scheduled Passive Monitoring

## Status
Implemented on `main` (post Phase 24 extension).

## Table
`ccdi_schedules` — organisation schedules for **passive** adapter monitoring only.

Allowed adapters: `dns`, `tls`, `http`, `dns_posture`.
Interval: 15 minutes – 7 days (default 24h).

## API

| Method | Path | Purpose |
|--------|------|--------|
| GET | `/api/ccdi/schedules?organizationId=` | List schedules |
| POST | `/api/ccdi/schedules` | Create schedule |
| POST | `/api/ccdi/schedules/:id/enable` | Enable/disable |
| POST | `/api/ccdi/schedules/process-due` | Process due schedules (ops cron) |

## Behaviour
- Respects **kill-switch** (no processing when active)
- Writes audit ticks per asset/adapter pair
- Does **not** launch intrusive scanners
- Actual adapter execution remains via existing passive adapter endpoints/workers

## Ops
Cron example:
```
POST /api/ccdi/schedules/process-due
Authorization: Bearer <admin>
```

## Explicit non-claims
- Not active vulnerability scanning
- Not a full workflow engine / SOAR
