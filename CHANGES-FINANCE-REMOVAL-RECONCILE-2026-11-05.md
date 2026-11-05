# Reconciliation against the 2026-11-02 Finance removal record
**Date:** 2026-11-05 | **Branch:** audit/finance-removal-reconcile (not merged to main)

The removal record (CHANGES-REMOVE-CINTEXA-FINANCE-2026-11-02.md) takes precedence over later commits.
Commits from 2026-11-03 to 2026-11-05 had reintroduced the removed Finance / Financial Intelligence application.

## Removed again (32 files)
- Routes `/finance/*?` and `/financial-intelligence/*?` and their lazy imports (App.tsx)
- Sidebar "CINTEXA Finance" group (Sidebar.tsx)
- Dashboard `FinanceDashboardWidget` and unused `FiDashboardWidget` import (dashboard.tsx)
- `pages/finance/`, `pages/financial-intelligence/`, `components/finance/`, `lib/financial-intelligence/`
- `lib/finance/*` except `money.ts` / `money.test.ts` (see open items)
- `components/financial-intelligence/FiDashboardWidget.tsx`, `MiniBarChart.tsx`
- `functions/api/finance/`, `functions/api/fi/`, `tests/finance-sync.test.ts`
- `docs/CINTEXA_FINANCE.md`, `CHANGES-FI-CLOUDFLARE-NATIVE-2026-11-02.md`

## Deliberately NOT touched
- All D1 schemas, migrations (`migrations/finance`, `migrations/d1`), `lib/db` finance schema files and the `FIN_DB` binding in wrangler.toml. No tables dropped, no data touched.
- Sales, CMS, auth, Business Diary, Marketing, sync engine.

## Open items needing a decision (kept in place until answered)
1. Corporate Strategy imports `lib/finance/money.ts` (formatters) and `components/financial-intelligence/AnimatedKpiCard.tsx`.
   They are generic helpers but live inside paths the record deleted. Moving them would be relocation of deleted code.
2. `functions/api/csi` soft-calls `/api/finance/{dashboard,accounts,journals,invoices}`; calls now 404 and degrade silently (try/catch).
3. `functions/_lib/nexus-sync.ts` still registers `finance` and `financial-intelligence` modules/event routes.
4. Sales `createHttpFinanceProvider` (env `CINTEXA_FINANCE_API_BASE`) and `docs/SALES_FINANCE_SYNC.md` remain.
5. Whether to keep the migrations for finance tables, or approve a separate backed-up drop.

## Verification actually run
- node --test tests/{diary-sync,nexus-schema,nexus-sync}: 17/17 pass
- tsx unit tests in artifacts/cintexa: 26/27 pass; 1 fails on missing dependency (@tanstack/react-query not installed), unrelated file
- Grep: no remaining imports of deleted modules
- NOT run: typecheck, production build, deployment, live-site checks (no node_modules, package installs blocked here)
