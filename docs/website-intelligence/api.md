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
| GET | `/:id/recommendations` | Priority-ranked |
| GET/POST | `/:id/tasks` · PATCH/DELETE `/:id/tasks/:taskId` | Remediation tasks |
| GET/POST | `/:id/report` | Report metadata / record generation (PDF is rendered client-side) |
| GET | `/:id/export?format=csv\|json\|sarif` | Findings CSV (formula-injection-safe), full bundle JSON, SARIF 2.1.0 for code-scanning dashboards |
| GET | `/:id/gate?minScore=70&maxCritical=0&maxHigh=&requireComplete=1&strict=1` | CI quality gate; verdict with reasons. `strict=1` returns HTTP 422 on failure. Only outstanding (not verified/accepted/dismissed) findings count; unscored or provisional audits never silently pass |
| GET | `/:id/comparison` | Regression vs previous audit |
| GET/POST/DELETE | `/:id/share` | Client share link |
| GET/POST | `/:id/benchmark(s)` | Competitor benchmarking |
