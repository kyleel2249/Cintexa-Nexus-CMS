# CCDI Phase 4 — Core Security Engines

## Status
Implemented on `main`.

## What was added

### Data model
- `ccdi_findings` — normalised vulnerabilities / findings with CVE/CWE, CVSS, severity, status, fingerprint de-duplication, remediation guidance
- `ccdi_attack_surface` — open ports, endpoints, technologies, certificates, etc.
- `ccdi_remediation_tasks` — tracking remediation work linked to findings

### Engines service (`ccdi-engines.ts`)
- Asset discovery / upsert (inventory-driven)
- Attack-surface recording
- Finding upsert with fingerprint-based de-duplication
- Finding status workflow
- Controlled assessment job scaffolding (still requires Phase-3 scope + approval)

### Safety
All assessment requests still flow through:
```
Scope (approved) → Job (draft) → Submit → Approval → Queue
```
No live unauthorised scanning is performed. Connectors remain in `registered` state until later configuration and health verification.

## API additions (to be fully wired in routes)
- Findings list / create / status update
- Attack-surface list / record
- Assessment job request helpers (web_scan, port_scan, api_scan, vuln_scan, asset_discovery)
- Enhanced Command Centre metrics (findings by severity)

## Explicit non-claims
- No automatic active scanning of external targets without an approved scope and job
- No real Nmap/ZAP/Nuclei process execution yet (workers in later phases)
- Findings created via API or future worker results only

## Next
Phase 5 will extend to cloud, server, container, mobile, database and IoT/OT engines using the same control plane.
