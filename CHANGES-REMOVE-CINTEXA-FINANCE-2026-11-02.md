# Removal: CINTEXA Finance & Financial Intelligence application
**Date:** 2026-11-02  
**Branch:** main

## Summary

The CINTEXA Finance application and Financial Intelligence UI/API have been **completely removed** from the application layer. Sales, CMS, auth, and other Nexus modules are preserved.

## Deleted (application)

### Frontend
- `artifacts/cintexa/src/pages/finance/` (entire tree)
- `artifacts/cintexa/src/pages/financial-intelligence/` (entire tree)
- `artifacts/cintexa/src/lib/finance/`
- `artifacts/cintexa/src/lib/financial-intelligence/`
- `artifacts/cintexa/src/components/financial-intelligence/`
- `artifacts/cintexa/src/context/FinanceContext.tsx`

### Backend
- `artifacts/api-server/src/services/finance/` (entire tree including integration + tests)
- `artifacts/api-server/src/routes/finance.ts`

### Docs / changelogs
- All `CHANGES-FINANCE*.md` / FI phase logs present at removal time
- `docs/FI_REGRESSION_CHECKLIST.*`
- Related zero-key FI notes that documented the removed app

## Modified
- `artifacts/cintexa/src/App.tsx` — removed `/finance` and `/financial-intelligence` routes
- `artifacts/cintexa/src/components/layout/Sidebar.tsx` — removed Finance & FI nav groups
- `artifacts/cintexa/src/pages/dashboard.tsx` — removed `FiDashboardWidget`
- `artifacts/api-server/src/routes/index.ts` — unmounted `/api/finance`
- `artifacts/api-server/src/services/sales/index.ts` — finance integration → `nullFinanceProvider`
- `artifacts/api-server/src/services/sales/integrations/providers.ts` — added no-op finance provider
- Sales command-centre copy no longer references Finance/FI

## Database (retained on purpose)

**Not dropped:** `lib/db/src/finance-schema.ts`, `finance-integration-schema.ts`, and bootstrap statements that `CREATE` finance tables.

**Why:** Existing deployments may hold journal, invoice, and party-link rows. Dropping tables in a source cleanup would risk irreversible data loss without explicit operator approval. Schema remains inert (no API/UI).

A future reversible migration to drop unused `finance_*` tables may be applied only after backup and explicit approval.

## Sales behaviour after removal

- Sales CRM, orders, payments, agents continue to operate.
- Outbox finance calls receive `{ ok: false, error: "CINTEXA Finance is not installed" }` and do not claim accounting success.

## Verification notes

- Repo search: no remaining imports of deleted finance app modules.
- Production build / full test suite: run after `npm install` on a complete workspace (not executed in this cleanup environment).
