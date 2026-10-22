# File list and where each file goes

Paths are relative to the repository root. Every file is a complete replacement/new file.

## New
| Path | Purpose |
|---|---|
| `lib/wi-core/` (package.json, tsconfig.json, `src/*`, `src/__tests__/*`) | Shared catalogue, scoring, findings, workflow, compare, URL/IP rules |
| `lib/db/src/wi-schema.ts` | 12 `wi_*` table DDL statements |
| `artifacts/api-server/src/routes/website-audits.ts` | REST router (incl. export and gate) |
| `artifacts/api-server/src/services/website-intelligence/export.ts` | CSV, SARIF and CI-gate logic |
| `artifacts/api-server/src/services/website-intelligence/*.ts` | Engine, crawler, analyzers, store, queue, integrations, etc. |
| `artifacts/api-server/src/services/website-intelligence/__tests__/*` | Unit, security, integration, authorisation tests |
| `artifacts/cintexa/src/lib/website-intelligence/{api,pdf-kit,report-pdf,deliver}.ts` | Data hooks, PDF engine, delivery |
| `artifacts/cintexa/src/pages/website-intelligence/*.tsx` | 10 pages + shared components |
| `services/wi-browser-worker/` | Isolated Playwright worker (own Dockerfile) |
| `docs/website-intelligence/*.md` | This documentation |

## Modified (full replacements supplied)
`lib/db/src/bootstrap.ts` · `lib/wi-core` referenced from `tsconfig.json` · `artifacts/api-server/{package.json,tsconfig.json,.env.example}` · `artifacts/api-server/src/{index.ts,routes/index.ts,lib/auth-middleware.ts,lib/webhooks.ts}` · `artifacts/cintexa/{package.json}` · `artifacts/cintexa/src/{App.tsx,lib/api.ts,components/layout/Sidebar.tsx}`

Unzip the archive at the repository root; paths line up one-to-one. Then run `npm install` (new workspace: `lib/wi-core`; new devDependency `tsx`. The browser worker in `services/wi-browser-worker` is deliberately NOT an npm workspace: it has its own package.json and Dockerfile, so Playwright is never installed in the CMS build).

## Local mode files
- `lib/wi-engine/src/memory-repo.ts`, `index-local.ts`, `local/{net,router,runtime,index}.ts`
- `lib/wi-engine/test/local-mode.test.ts`, `tests/wi-relay.test.ts`
- `functions/api/wi-relay.ts` (+ identical copy in `artifacts/cintexa/functions/api/`)
- `artifacts/cintexa/src/lib/website-intelligence/local.ts`, `pages/website-intelligence/local-banner.tsx`
- `docs/website-intelligence/local-mode.md`

## Competitor intelligence files
- `lib/wi-core/src/competitors.ts`, `benchmarks.ts` (+ `__tests__/competitors.test.ts`, `benchmarks.test.ts`)
- `lib/wi-engine/src/competitor-discovery.ts`; edited: `ports.ts`, `repo.ts`, `memory-repo.ts`, `routes.ts`, `engine.ts`, `settings.ts`, `index.ts`
- `lib/wi-engine/test/competitor-discovery.test.ts`, `competitor-routes.test.ts`
- `lib/db/src/wi-schema.ts` (two tables appended)
- `artifacts/api-server/src/services/website-intelligence/search-provider.ts`; edited: `store.ts`, `wiring.ts`, `integrations.ts`; test `__tests__/competitors.store.test.ts` (needs `DATABASE_URL`)
- `artifacts/cintexa/src/pages/website-intelligence/competitors.tsx`, `benchmark-report.tsx`; edited: `audit-detail.tsx`, `settings.tsx`, `lib/website-intelligence/api.ts`

## Recommendation approval workflow files
- `lib/wi-core/src/rec-workflow.ts` (+ `__tests__/rec-workflow.test.ts`); edited: `index.ts`
- `lib/wi-engine/src/recommendation-lifecycle.ts`; edited: `repo.ts`, `memory-repo.ts`, `routes.ts`, `engine.ts`, `retest.ts`, `settings.ts`, `index.ts`
- `lib/wi-engine/test/recommendation-workflow.test.ts`
- `lib/db/src/wi-schema.ts` (three tables appended)
- `artifacts/api-server/src/services/website-intelligence/store.ts`; test `__tests__/recommendation-workflow.store.test.ts` (needs `DATABASE_URL`)
- `artifacts/cintexa/src/pages/website-intelligence/recommendations.tsx`, `settings.tsx`; `lib/website-intelligence/api.ts`
- `docs/website-intelligence/recommendation-workflow.md`
- `lib/wi-core/src/agents.ts` (+ test), `artifacts/cintexa/src/pages/agents.tsx`; edited `App.tsx`, `Sidebar.tsx`, `GlobalSearch.tsx`, `pages/intelligence.tsx` (AI Agents page and nav entry)
