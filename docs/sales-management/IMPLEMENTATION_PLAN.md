# Sales Management — Implementation Plan & Dependency Map

Status document for the Cintexa Nexus Sales Management subsystem. Written **before** code was changed,
from an inspection of the actual repository (commit `2d356a9`). Updated at the end of the build with
verified status (see `ACCEPTANCE_REPORT.md`).

## 1. Discovered architecture

| Area | Finding | Consequence for Sales |
|---|---|---|
| Frontend | React 19 + Vite 7 + Tailwind 4 + shadcn/ui, **Wouter** routing (`App.tsx`, lazy pages), TanStack Query, Recharts, Framer Motion, jsPDF | Sales pages are lazy routes under `/sales/*`, use existing `components/ui/*`, `apiJson()` and Recharts |
| Shell | `AppLayout` = fixed `Sidebar` (static `navGroups`) + `Topbar` (search box and bell are visual stubs) | Add a collapsible **Sales Management** group; bell gets real sales notifications |
| API | Express 5, routes mounted in `routes/index.ts` behind a global `apiGuard` (Firebase ID token / legacy JWT / API key, IP allow-list, rate limit) | Mount one `/api/sales` router behind the same guard; add only the explicit public allow-list entries needed for the customer quote link and lead capture form |
| Auth roles | Server derives only `admin` / `editor` / `api` (`ADMIN_EMAILS`; empty = bootstrap mode, everyone admin). Client role comes from Firestore (not trustworthy) | Sales adds its own role layer (`sales_members`) enforced **server-side**; platform `admin` => `sales_admin`; unmapped non-admins are denied |
| Tenancy | Single tenant, no organization id anywhere | No fake multi-tenancy. Isolation is by role + record ownership/team scope. Documented limitation |
| DB | PostgreSQL via `pg` Pool (`@workspace/db`), Drizzle schemas for CMS tables, **idempotent raw-SQL `ensureSchema()` at boot** (`bootstrap.ts`, `wi-schema.ts` pattern), `supabase/migrations/*.sql` | Sales DDL is an idempotent statement list (`sales-schema.ts`) appended to `ensureSchema` + mirrored as a migration file. Sales data access is parameterised SQL through the same pool |
| Existing modules | CMS (sites/pages/posts/media/forms/SEO), diagnostics, website intelligence, webhooks, subscribers, OpenRouter AI helper, scheduler | **No** customers, products, inventory, finance, invoicing or document-management module exists |
| Tests | `tsx --test "src/**/__tests__/*.test.ts"` (node:test) in api-server only | Sales tests use `node:test`; same command picks them up |
| Deploy | Static app on Cloudflare Pages + separately hosted Express API (`API_ORIGIN`), `render.yaml`, Dockerfile | No new infra; one new set of optional env vars |

## 2. Reuse / extend / build

* **Reuse:** auth + `apiGuard`, `pool`, `ensureSchema`, logger, `components/ui/*`, `apiJson`, Recharts, jsPDF, nodemailer (email provider seam), OpenRouter helper (AI assist), webhooks (`dispatchWebhook`), scheduler pattern.
* **Extend:** `routes/index.ts` (mount), `auth-middleware.ts` (public allow-list: customer quote link, lead-capture form), `bootstrap.ts` (schema), `index.ts` (start sales jobs), `webhooks.ts` (sales events), `Sidebar.tsx`, `App.tsx`, `Topbar.tsx` (bell), `dashboard.tsx` (Sales Overview section).
* **Build:** everything else. CRM entities, pipeline, quotes, orders, targets, commissions, forecasting, retention, campaigns, competitors, reports, automation, playbook, documents, settings, audit.
* **Not duplicated:** media storage (documents link to `media` rows), webhooks, AI client, auth.

## 3. Hard constraints discovered, and design answers

1. **No inventory / finance system exists.** Sales defines provider *seams* (`InventoryProvider`, `FinanceProvider`, `EmailProvider`, `WhatsAppProvider`) and a transactional **outbox**. With no provider configured, outbox rows are `unconfigured` and the UI shows "Not connected". Nothing is ever reported as reserved / invoiced / paid / sent unless a provider confirmed it or an authorised person recorded it manually (labelled `manual`).
2. **No product catalog exists** => `sales_products` + price books are created (documented), with stock shown as "not integrated".
3. **Roles are coarse** => dedicated sales role matrix (8 roles) with permission checks and SQL-level record scoping.
4. **Dependency install is blocked in the authoring sandbox** (registry 403). Therefore business logic is dependency-free and the HTTP layer is a thin adapter; see verification matrix.

## 4. Architecture of the new subsystem

```
artifacts/api-server/src/services/sales/
  core/      types, errors, validate, money, time, rbac, audit, idempotency, settings, router, pg-adapter
  domain/    pure logic: lead-scoring, dedupe, state-machines, pricing, targets, commission, forecast,
             health, automation-engine, kpi definitions
  modules/   one file per business module: route definitions + SQL services
  __tests__/ unit tests (pure) + integration tests (real Postgres, skipped when no DB available)
artifacts/api-server/src/routes/sales.ts   thin Express adapter (auth -> actor -> dispatch)
lib/db/src/sales-schema.ts                 idempotent DDL (single source of truth)
supabase/migrations/…_sales_management.sql  generated from the same statements
artifacts/cintexa/src/pages/sales/*        UI
artifacts/cintexa/src/lib/sales/*          typed API client, formatting, permissions
```

Request flow: Express `apiGuard` → adapter resolves `Actor` (role, member id, team) → route table dispatch →
permission check → validation → scoped SQL in a transaction → audit event → post-commit automation events.

## 5. Data model (entities → tables, all prefixed `sales_`)

members, teams, territories(+members) · leads, lead_touches, lead_forms · accounts, contacts · pipelines, pipeline_stages,
opportunities, opportunity_stage_history, opportunity_competitors, ownership_history · activities, notifications ·
target_periods, targets, target_adjustments · products, bundle_items, price_books, price_book_entries, promotions ·
quotations, quotation_lines · orders, order_lines, order_fulfilments, order_payments, order_returns, order_credits ·
forecast_snapshots, forecast_overrides · commission_plans, commission_entries · feedback, referrals, account_plans ·
campaigns, campaign_members · competitors, competitor_intel · automation_rules, automation_runs · playbook_articles,
playbook_versions, training_completions · document_templates, documents · settings · audit_events · outbox ·
idempotency_keys, counters, saved_views, report_schedules, ai_usage.

Integrity rules: serial PKs (matches the codebase), real foreign keys, `CHECK` constraints on enums and money ≥ 0 where
applicable, `NUMERIC(18,2)` money, `TIMESTAMPTZ` timestamps, soft-delete via `archived_at`, partial unique indexes to make duplicate
order-from-quotation and duplicate automation runs impossible, indexes on every filter/join column.

## 6. Role & permission model (server-enforced)

`sales_admin` · `sales_director` · `sales_manager` · `sales_rep` · `sales_analyst` · `finance` · `support_agent` · `readonly_exec` · `api_reader`.
Record scope: `own` (reps), `team` (managers), `all` (others). Cost/margin fields require `cost:read`. Platform `admin` maps to `sales_admin`.

## 7. Phases and exit criteria

| Phase | Deliverable | Exit evidence |
|---|---|---|
| 1 | This document | Reviewed against code |
| 2 | Schema, core, RBAC, audit, settings, router, adapter, sidebar/route/dashboard shells | DDL applied twice to real Postgres without error; unit tests |
| 3 | Leads, accounts, contacts, opportunities, activities, targets, products, quotations, orders | Integration tests against real Postgres incl. lead→order journey |
| 4 | Dashboard KPIs, forecasting, performance, commissions, retention, campaigns, reports | Reconciliation tests (dashboard vs source rows) |
| 5 | Automation engine, playbook, documents, AI assist | Cycle detection, idempotency, retry tests |
| 6 | Integration seams + outbox | Tests prove "unconfigured" never reports success |
| 7 | Hardening | Authz matrix tests, SQL-injection/IDOR tests, concurrency tests |
| 8 | Docs, acceptance report, zip | Honest verified/unverified matrix |

## 8. Verification matrix (what can be proven where)

| Check | Authoring sandbox | Maintainer machine |
|---|---|---|
| Pure domain unit tests (`tsx --test`) | Yes | `npm test -w @workspace/api-server` |
| DDL idempotency + constraints on PostgreSQL 16 | Yes (real server) | Auto via `ensureSchema` |
| Service/SQL integration tests | Yes (real server, Bun driver) | `SALES_TEST_DATABASE_URL=… npm test` (uses `pg`) |
| Route dispatch + authz tests (no Express) | Yes | Yes |
| `tsc` against real library types, `vite build`, Express boot, UI rendering | **No** (npm registry blocked) | `npm run typecheck && npm run build` |
