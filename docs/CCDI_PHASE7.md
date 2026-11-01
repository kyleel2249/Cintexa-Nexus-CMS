# CCDI Phase 7 — Reporting, Compliance & Executive Dashboards

## Status
Implemented on `main`.

## Capabilities

| Capability | Description |
|------------|-------------|
| Posture summary | Evidence-backed assets, findings, jobs, evidence, compliance counts |
| Report generation | executive, operational, audit, compliance, evidence_package |
| Compliance frameworks | ISO 27001, NIST CSF, CIS Controls, PCI DSS, SOC 2, GDPR (seeded) |
| Control catalogue | Minimal NIST CSF control set seeded; extensible |
| Control mappings | Per-organisation status (compliant / partial / non_compliant / …) |
| Evidence packages | Inventory of collected evidence for audit export |

## API (`/api/ccdi`)
- `GET /reporting/posture?organizationId=`
- `POST /reporting/generate` — body: `{ organizationId, reportType, title? }`
- `GET /reporting/reports`
- `GET /reporting/reports/:id`
- `GET /reporting/frameworks`
- `GET /reporting/controls?frameworkId=`
- `GET /reporting/mappings?organizationId=`
- `POST /reporting/mappings`

## Safety & integrity
- All metrics derived from live database records only
- No fabricated KPIs or scores
- Report generation is audited

## Explicit non-claims
- PDF/DOCX binary export not yet implemented (JSON report records only)
- Full control catalogues for every framework are not pre-loaded (NIST sample only)
- Trend charts over long time windows require accumulated historical data

## Next
Phase 8+ — UI polish, isolated workers, live connector execution, deeper compliance content, and production hardening as authorised.
