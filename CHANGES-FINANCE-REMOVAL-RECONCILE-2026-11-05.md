# Reconciliation against the 2026-11-02 Finance removal record
**Date:** 2026-11-05 | **Branch:** audit/finance-removal-reconcile (not merged to main)

The removal record (CHANGES-REMOVE-CINTEXA-FINANCE-2026-11-02.md) takes precedence over later commits.
Commits from 2026-11-03 to 2026-11-05 had reintroduced the removed Finance / Financial Intelligence application.

## Removed again (32 files)
- Routes `/finance/*?` and `/financial-intelligence/*?` and their lazy imports (App.tsx)
- Sidebar "CINTEXA Finance" group (Sidebar.tsx)
- Dashboard `FinanceDashboardWidget` and unused `FiDashboardWidget` import (dashboard.tsx)
- `pages/finance/`, `pages/financial-intelligence/`, `components/finance/`, `lib/financial-intelligence/`
- All of `lib/finance/*`, including `money.ts`
- All of `components/financial-intelligence/`
- `functions/api/finance/`, `functions/api/fi/`, `tests/finance-sync.test.ts`
- `docs/CINTEXA_FINANCE.md`, `CHANGES-FI-CLOUDFLARE-NATIVE-2026-11-02.md`

## Deliberately NOT touched
- All D1 schemas, migrations (`migrations/finance`, `migrations/d1`), `lib/db` finance schema files and the `FIN_DB` binding in wrangler.toml. No tables dropped, no data touched.
- Sales, CMS, auth, Business Diary, Marketing, sync engine.

## Dependency repairs (second pass)
Corporate Strategy (CSI) depended on deleted Finance code. Repaired without restoring or moving any deleted code:
- New generic `lib/format/currency.ts` (+ test) and `components/ui/kpi-card.tsx`, written fresh; CSI now imports these.
- CSI server: removed all calls to `/api/finance/*`. Dashboard no longer returns `financeLive` or the cash-vs-receivables insight.
  `budget-vs-actual` now uses only the actuals stored on CSI budget lines. `product-performance` and `budget-mappings`
  endpoints removed (the `csi_budget_mappings` table and its data are untouched).
- CSI UI: removed the "Live Finance snapshot" card, the dead "Open Finance" link and the product-performance PDF section.
- Sales: removed the HTTP Finance adapter and the `CINTEXA_FINANCE_API_BASE` switch; Sales uses the existing no-op provider.
- Sync engine: removed the `finance` and `financial-intelligence` modules, their routing targets and the FI link branch.
  Each event now fans out to diary + dashboard; tests updated (3 links -> 2).
- Removed Financial Intelligence docs found in `docs/`.

## Left untouched by design
D1 schemas/migrations/data, `FIN_DB` binding, `csi_budget_mappings` table, Diary "Finance" category, CSI role names (cfo, finance_manager),
CSI nav section label "Finance planning" (CSI's own budgets/forecasts).

## Open items
1. **External API conflict (needs your decision):** Sales contains an optional OpenRouter AI adapter (`services/sales`, `lib/openrouter`).
   It is off by default and needs an admin to enable it plus an API key, but it conflicts with "zero external APIs".
   Preserving it vs. removing it are both defensible; I have not changed it.
2. Type-check, production build, end-to-end tests and live/deployed checks have NOT been run (no `node_modules`; installs are blocked here).
3. Authentication, security and database-communication audits across all modules were not performed beyond the Finance/CSI/sync scope.

## Verification actually run
- `bun test tests/`: 54 pass, 1 fail (missing `@electric-sql/pglite` package, not installed)
- `node --test` Diary/sync/schema: 17/17 pass
- `tsx --test` currency test: 4/4 pass; other frontend unit tests 17/18 (1 fails on missing `@tanstack/react-query`)
- Static import-resolution scan over frontend, functions, api-server, tests: 0 unresolved
- Grep: no remaining references to deleted Finance/FI modules, `/api/finance`, `/api/fi`, or `CINTEXA_FINANCE_API_BASE`
