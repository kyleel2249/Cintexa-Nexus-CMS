# External API removal – 2026-11-06

Branch `chore/remove-external-apis`. Finance and Financial Intelligence stay removed; nothing from them was restored or renamed.

## Removed (no dormant integrations left)
- OpenRouter client, provider adapters, AI-provider settings tab and routes, API-key requirements, `openai` and `twitter-api-v2` dependencies, `.replit_integration_files/`.
- PageSpeed/CrUX lab data, search-engine competitor discovery, auto-generated post comments (no internal equivalent exists; features report the gap honestly instead of inventing data).

## Internal replacements
- Post cover images: deterministic SVG art (`lib/cover-art.ts`).
- Social publishing: share pack text per platform (`lib/share-text.ts`); posts are marked "ready", the user posts them.
- CCDI advisory/triage: rule-based engine over recorded findings (`services/ccdi-advisory.ts`).
- Sales company research from a name only: internal domain guess verified by reading the page, parked pages rejected (`research/search.ts`), disclosed to the user.
- Narration/AI Studio: deterministic native implementations.

## Tests actually run (this environment, no package downloads)
- New: cover-art, share-text, ccdi-advisory unit tests: 9 passed.
- api-server `tsx --test`: only failures left are suites needing `pino`/`@electric-sql/pglite` (not installable here): sentinel, WI export, WI unit.
- Sales research tests: 11 passed. wi-core: 53 passed. wi-engine (bun): 41 passed. root `bun test tests/`: 54 passed, 1 file blocked (pglite missing).
- TypeScript parse check of 51 changed files: 0 syntax errors.

## NOT run / blocked
Full `tsc` project type-check, `vite build`, e2e, `lib/intelligence` and PGlite-backed tests, dependency audit, deployment and live verification: package tarballs cannot be downloaded here.

## Left untouched on purpose
- DB tables, CHECK constraints and permission seeds for AI providers (no destructive changes without authorization).
- A stored `platform_settings` row "openrouter" may still hold a key: an admin should delete it.
- SMTP (own mail server) and Google Fonts links in `index.html` (CDN, not an API) remain.
