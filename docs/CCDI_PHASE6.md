# CCDI Phase 6 — Intelligence, Automation & AI Agents

## Status
Implemented on `main`.

## Capabilities

| Capability | Description |
|------------|-------------|
| Risk prioritisation | Severity + CVSS + asset risk scoring |
| Correlation | Rule-based grouping of high/critical findings on same asset |
| Automated triage | Rule suggestions + optional OpenRouter AI enrichment |
| AI advisory agent | Question-answering with optional finding context (advisory only) |
| Threat intelligence | Indicator store (manual ingest; feed connectors later) |
| SOAR-style workflows | Workflow definitions (trigger + steps); execution is advisory |
| Agent run history | Audit trail of triage / advisory runs |

## API (`/api/ccdi`)
- `GET /intelligence/priorities?organizationId=`
- `POST /intelligence/correlate`
- `GET /intelligence/correlations`
- `POST /intelligence/triage/:findingId`
- `POST /intelligence/advisory`
- `GET/POST /intelligence/threat-intel`
- `GET/POST /intelligence/workflows`
- `GET /intelligence/agent-runs`

## Safety
- AI agents are **advisory only** — no autonomous exploitation or scanning
- Kill-switch still blocks new execution
- All agent runs are logged
- OpenRouter is used only when configured; missing key returns a clear 503

## Tables
- `ccdi_threat_intel`
- `ccdi_correlations`
- `ccdi_workflows`
- `ccdi_workflow_runs`
- `ccdi_agent_runs`

## Explicit non-claims
- No fully autonomous SOAR action execution
- No automatic threat-feed polling (manual/API ingest only in Phase 6)
- AI quality depends on configured OpenRouter model and key

## Next
Phase 7 — Reporting, compliance and executive dashboards.
