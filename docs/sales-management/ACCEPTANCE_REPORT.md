# Sales Management – Acceptance Report

Status legend: **VERIFIED** = executed and observed here; **STATIC** = reviewed/type-checked under stubs only;
**NOT VERIFIED** = could not be run in the build sandbox (no npm network, empty node_modules).

## Delivered
- Backend `artifacts/api-server/src/services/sales/` (225 routes mounted at `/api/sales`), schema `lib/db/src/sales-schema.ts`
  (65 `sales_*` tables, applied on boot; mirrored in `supabase/migrations/20261019120000_sales_management.sql`).
- Frontend `artifacts/cintexa/src/pages/sales/` (27 pages + 2 public pages `/q/:token`, `/f/:token`), sidebar group
  "Sales Management" (22 items), dashboard Sales Overview widget with drill-down, global search (Ctrl/Cmd+K), notification bell.
- Reuses existing auth (Firebase ID token / JWT cookie / API keys). No second user or customer database.

## Verification matrix
| Area | Result |
|---|---|
| Backend tests (105: RBAC, field protection, audit, idempotency, money, transactions, workflows) on Postgres 16 | VERIFIED |
| Schema applies cleanly and re-applies idempotently on an empty DB | VERIFIED |
| 49 Sales routes render in Chromium with no page errors | VERIFIED (stubbed wouter/lucide/ui) |
| Flows: create lead, duplicate warning, global search, bell, public lead form, quotation share + customer accept, settings save, rep denied on settings | VERIFIED (same harness) |
| No horizontal scroll at 375px on 6 pages | VERIFIED |
| Type-check of Sales/layout code | STATIC (stubbed libs, loose mode) |
| `npm run typecheck`, frontend build, API build (GitHub Actions run 110, commit 97feb09) | VERIFIED – all green |
| Real `pg` adapter at runtime, Express boot, Firebase sign-in | NOT VERIFIED |
| Sidebar / Topbar / AppLayout in a browser, real wouter/lucide/shadcn | NOT VERIFIED (syntax + stub type-check only) |

## On-device mode (current default)
Verified: engine bundles for the browser with no Node built-ins; SHA-256/random helpers match `node:crypto`; the full
116-test suite passes with a single database connection (PGlite is single-connection); the browser glue (`localFetch`)
served /me, lead, dashboard, CSV and public routes against Postgres through a stand-in for PGlite.
NOT verified here: the real PGlite WebAssembly loading in a browser/Cloudflare, IndexedDB persistence, and backup/restore
(`dumpDataDir`/`loadDataDir`). Check these on first load of the deployed site.

## Integrations (honest status)
No email/SMS/WhatsApp/payment/e-signature/accounting provider is installed. Such actions are recorded in the outbox
as `pending` / `manual` and are never reported as sent. Register a provider via `integrations` in
`services/sales/index.ts`. Signature records are manual records, not legally verified e-signatures. Finance-dependent
KPIs (e.g. outstanding receivables) show "Not available" instead of an invented number. AI features report status
and stay disabled without a configured provider; AI output is draft-only.

## Security notes
- **Bootstrap mode:** the platform treats every user as admin when `ADMIN_EMAILS` is empty. Sales therefore
  auto-provisions *Sales Admin* only when no active sales_admin exists (first run) or for emails in `SALES_ADMIN_EMAILS`.
  Because `/me` is fetched on any CMS page, the first visitor on a fresh install becomes Sales Admin. Set
  `SALES_ADMIN_EMAILS` before first deployment.
- Authorization, field protection, audit (append-only) and idempotency are enforced server-side; the UI only mirrors them.
- Public endpoints are token-scoped; the lead form has a honeypot and rate limiting.

## Not implemented / follow-ups
- Sales webhook events on the existing outbound webhook system.
- Additional tests: full authz matrix, SQL-injection fuzz, concurrency stress, non-sales regression.
