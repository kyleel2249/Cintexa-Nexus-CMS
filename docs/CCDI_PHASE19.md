# CCDI Phase 19 — Asset Ownership Verification & Bulk Findings

## Status
Implemented on `main`.

## Asset ownership
| Path | Purpose |
|------|--------|
| `GET /api/ccdi/assets/pending-ownership?organizationId=` | Assets awaiting ownership proof |
| `POST /api/ccdi/assets/:id/ownership` | Decide `verified` / `approved` / `rejected` |

Body example:
```json
{
  "organizationId": "...",
  "decision": "approved",
  "ownerRef": "user-or-team",
  "note": "DNS TXT verified"
}
```

## Bulk findings
```
POST /api/ccdi/findings/bulk
{
  "organizationId": "...",
  "findingIds": ["...", "..."],
  "status": "false_positive",
  "ownerRef": "secops"
}
```
Max 200 IDs per request. Audited and webhook-notified.

## Explicit non-claims
- Ownership decision is human-driven; no automated domain-control proof protocol in this phase
- Bulk update is status/owner only (not arbitrary field merge)

## Next
Further phases as authorised.
