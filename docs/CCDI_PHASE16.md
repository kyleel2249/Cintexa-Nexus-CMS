# CCDI Phase 16 — Remediation Workflow & Finding Assignment

## Status
Implemented on `main`.

## Data model
Uses existing `ccdi_remediation_tasks` (Phase 4 schema):
- Linked to findings (`finding_id`)
- Status: open | in_progress | completed | cancelled | deferred
- Priority, assignee, due date

## API

| Method | Path | Purpose |
|--------|------|--------|
| GET | `/api/ccdi/remediation/tasks` | List tasks |
| GET | `/api/ccdi/remediation/summary` | Counts + overdue |
| POST | `/api/ccdi/remediation/tasks` | Create task |
| PATCH | `/api/ccdi/remediation/tasks/:id` | Update task |
| POST | `/api/ccdi/findings/:id/assign` | Assign owner (`createTask` optional) |

Completing a remediation task can mark the linked finding as `resolved` when it is still open/in progress.

## Permissions
Mutations require `ccdi.findings.manage` (or platform admin / non-strict bootstrap).

## Explicit non-claims
- Not a full ITSM / Jira replacement
- No external ticket system sync in this phase

## Next
Further phases as authorised.
