# File list and where each file goes

Paths are relative to the repository root. Every file is a complete replacement/new file.

## New
| Path | Purpose |
|---|---|
| `lib/wi-core/` (package.json, tsconfig.json, `src/*`, `src/__tests__/*`) | Shared catalogue, scoring, findings, workflow, compare, URL/IP rules |
| `lib/db/src/wi-schema.ts` | 12 `wi_*` table DDL statements |
| `artifacts/api-server/src/routes/website-audits.ts` | REST router |
| `artifacts/api-server/src/services/website-intelligence/*.ts` | Engine, crawler, analyzers, store, queue, integrations, etc. |
| `artifacts/api-server/src/services/website-intelligence/__tests__/*` | Unit, security, integration, authorisation tests |
| `artifacts/cintexa/src/lib/website-intelligence/{api,pdf-kit,report-pdf,deliver}.ts` | Data hooks, PDF engine, delivery |
| `artifacts/cintexa/src/pages/website-intelligence/*.tsx` | 10 pages + shared components |
| `artifacts/wi-browser-worker/` | Isolated Playwright worker (own Dockerfile) |
| `docs/website-intelligence/*.md` | This documentation |

## Modified (full replacements supplied)
`lib/db/src/bootstrap.ts` · `lib/wi-core` referenced from `tsconfig.json` · `artifacts/api-server/{package.json,tsconfig.json,.env.example}` · `artifacts/api-server/src/{index.ts,routes/index.ts,lib/auth-middleware.ts,lib/webhooks.ts}` · `artifacts/cintexa/{package.json}` · `artifacts/cintexa/src/{App.tsx,lib/api.ts,components/layout/Sidebar.tsx}`

Unzip the archive at the repository root; paths line up one-to-one. Then run `npm install` (new workspaces: `lib/wi-core`, `artifacts/wi-browser-worker`, new devDependency `tsx`).
