# CCDI Phase 21 — Evidence Integrity & Chain of Custody

## Status
Implemented on `main`.

## Table
`ccdi_evidence_custody` — append-only custody events per evidence item.

Actions: `collected`, `transferred`, `accessed`, `exported`, `verified`, `sealed`, `released`, `note`.

## API

| Method | Path | Purpose |
|--------|------|--------|
| GET | `/api/ccdi/evidence/:id/custody?organizationId=` | Custody chain |
| POST | `/api/ccdi/evidence/:id/custody` | Record custody event |
| POST | `/api/ccdi/evidence/:id/verify` | Metadata integrity check |

Verify checks:
- Record present
- SHA-256 format (64 hex chars)
- `storage_ref` present
- Optional client-supplied `computedSha256` match

A `verified` custody event is written for every verification attempt.

## Explicit non-claims
- Does not automatically fetch/re-hash remote object storage blobs
- Callers that hold bytes may supply `computedSha256` for match verification

## Next
Further phases as authorised.
