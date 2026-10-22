# API — base `/api/v1/website-audits` (Firebase-authenticated; owner-scoped; 404 for non-owners)
| Method | Path | Notes |
|---|---|---|
| GET | `/meta`, `/catalog`, `/integrations`, `/stats`, `/trend` | Config, test catalogue, integration status, dashboard data |
| GET/PUT | `/settings` | PUT is admin-only (403 otherwise) |
| GET/POST | `/monitors` · PATCH/DELETE `/monitors/:id` · POST `/monitors/:id/run` | Scheduled re-audits and regression alerts |
| GET | `/public/:token` | **Unauthenticated**, sanitised shared view; revocable |
| GET/POST | `/` | List / create audit (scope validated; unauthorised authenticated scope rejected) |
| GET | `/:id`, `/:id/bundle`, `/:id/events` | Audit, full data bundle, real stage events |
| POST | `/:id/cancel`, `/:id/retry` · DELETE `/:id` | Lifecycle |
| GET | `/:id/findings`, `/:id/findings/:fp` · PATCH `/:id/findings/:fp` | Workflow transitions are validated |
| POST | `/:id/findings/:fp/explain` | AI explanation (labelled) |
| POST | `/:id/retest` | Retest of selected/all findings; lineage kept |
| GET | `/:id/recommendations` | Priority-ranked, with approval workflow state, allowed actions, execution gate and status counts |
| POST | `/:id/recommendations/:fp/transition` | Move a recommendation through the approval workflow; see [recommendation-workflow.md](recommendation-workflow.md) |
| PATCH | `/:id/recommendations/:fp` | Set the assignee |
| GET | `/:id/recommendations/:fp/history` | Event log and approvals |
| POST | `/:id/recommendations/:fp/verify` | Start a targeted retest to verify an implemented recommendation |
| GET/POST | `/:id/tasks` · PATCH/DELETE `/:id/tasks/:taskId` | Remediation tasks |
| GET/POST | `/:id/report` | Report metadata / record generation (PDF is rendered client-side) |
| GET | `/:id/export?format=csv\|json\|sarif` | Findings CSV (formula-injection-safe), full bundle JSON, SARIF 2.1.0 for code-scanning dashboards |
| GET | `/:id/gate?minScore=70&maxCritical=0&maxHigh=&requireComplete=1&strict=1` | CI quality gate; verdict with reasons. `strict=1` returns HTTP 422 on failure. Only outstanding (not verified/accepted/dismissed) findings count; unscored or provisional audits never silently pass |
| GET | `/:id/comparison` | Regression vs previous audit |
| GET/POST/DELETE | `/:id/share` | Client share link |
| GET/POST | `/:id/benchmark(s)` | Competitor benchmarking |
| GET | `/:id/competitors` | Competitors for the audited site (owner-scoped), search-provider status, recent discovery runs, and the automatic comparison selection |
| POST | `/:id/competitors/discover` | Starts discovery in the background (202). 409 while the audit is unfinished or a run is already in progress; 400 for benchmark audits |
| POST | `/:id/competitors` | Adds a competitor by hand (approved and user-confirmed). Rejects social profiles, the site itself and invalid hosts. Capped at 100 per site |
| PATCH/DELETE | `/:id/competitors/:domain` | Approve, reject, reclassify, rename; or remove. Edits mark the record user-confirmed so reruns cannot override them |
| POST | `/:id/competitors/benchmark` | Starts passive benchmark audits for approved competitors (or the automatic selection). Needs `authorization.confirmed`; idempotent per domain |
| GET | `/:id/benchmarks` | Per-site scores plus `report` (per-dimension benchmark, method `benchmark-1.0`), `sample` note and `peerMedian` |
