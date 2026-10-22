# @workspace/intelligence - CINTEXA NEXUS Intelligence Orchestrator

One codebase, two runtimes: the **API server** (`/api/intelligence/*`, node-postgres) and the **browser** (on-device PGlite, the same
database Sales uses). Moved here from `services/agent-orchestrator` so both can import it; behaviour of the original orchestrator
(task queue, retries, timeouts, cancellation, idempotency, approvals, tamper-evident audit chain, SSRF guard) is preserved.

## What it does
- **Agents** (`src/agents.ts`): 15 registered roles. Leaf analysts read live Sales data through read-only SQL tools (`src/sales-tools.ts`):
  lead_intelligence, opportunity_pipeline, sales_forecasting, customer_intelligence, sales_performance, data_quality,
  financial_diagnostic, operations_diagnostic, website_audit, security_governance. Directors coordinate them: sales_director,
  business_diagnostic_director, website_director, recommendation_planner, chief_executive.
- **Deterministic first.** Every figure comes from SQL and stated formulas. A model (optional, API server only) may only write the executive
  narrative from the structured findings; it never produces numbers. Without an AI key everything still works and says so.
- **Findings** persist (`intel_findings`) with severity, evidence, confidence, owner, due date and history. A finding is auto-resolved only when
  an analyst that completed *with data* no longer observes it ("resolved by reassessment"); failed/degraded analysts never resolve anything.
- **Autonomy** (levels 0-4, `src/autonomy.ts`): default 2 (prepare). Mandatory-approval action types (external comms, discounts, orders, refunds,
  payouts, permissions, deletion/export, website publishing, production, financial policy) can never be auto-executed, at any level.
  Only one executor exists today: `create_followup_activity` (internal, reversible). Anything else records `no_executor_configured`.
- **Honest degradation.** Missing tool/integration => agent reports unavailable, run is marked degraded, health score is withheld below 50% coverage.

## Layout
`orchestrator.ts` engine - `sql-store.ts` + `schema.ts` durable store (`intel_*`, idempotent, ISO-text timestamps) - `api.ts` transport-neutral
request handler - `runtime.ts` wiring + settings - `findings.ts` persistence/reassessment/snapshots - `executors.ts` - `website-tools.ts` (server only).
`ssrf.ts` needs `node:dns`; import it from `@workspace/intelligence/ssrf` (server only).

## Tenancy
`org_id` is on every intel row and in every query. Sales tables are a single-business database, so Sales tools carry no org column:
**one deployment (or one browser profile) = one organisation** (`orgId = "default"`).

## Test / typecheck
`npm test --workspace=@workspace/intelligence` (runs the agents end-to-end against real PostgreSQL semantics via PGlite and the real Sales schema)
`npm run typecheck`

## Routes (`/api/intelligence`)
`GET /overview /agents /findings /approvals /audit /settings /metrics/:key /tasks /tasks/:id /health` - `POST /runs /tasks/:id/cancel /approvals/:id/promote|decide` -
`PATCH /findings/:id` - `PUT /settings` (admin). API keys are refused; callers need an `admin`/`editor` identity.
