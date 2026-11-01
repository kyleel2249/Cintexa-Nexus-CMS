# CINTEXA FINANCE - development changelog (branch feature/cintexa-finance-enterprise)

## Phases 1-3 (backend foundation) - 2026-10-31
- Schema: `lib/db/src/finance-schema.ts` (idempotent, appended to bootstrap). 12 `finance_*` tables, NUMERIC(18,2) money,
  composite (org_id,id) foreign keys for tenant isolation, DB triggers: balanced-only posting, immutable posted journals/lines,
  append-only ledger and audit events, hard-closed period lock, account code/type lock once used.
- Service: `artifacts/api-server/src/services/finance/` (core: money, rbac, audit hash-chain, router; modules: organisations,
  accounts, periods + year-end close, journals, reports). Mounted at `/api/finance` (routes/finance.ts). Existing Sales and CMS untouched.
- API: organisations, members, permissions, accounts, fiscal years/periods, journals (create/edit/approve/reject/post/reverse),
  ledger, trial balance (unadjusted/adjusted/post-closing, comparative, CSV), overview, audit + chain verification.
- Tests: `services/finance/__tests__/finance.pglite.test.ts` (11 tests, in-memory PostgreSQL via PGlite).

## Finance UI + dashboard - 2026-10-31
- API: `GET /api/finance/dashboard` (KPIs from posted ledger entries only, each with its formula; integer-only margin maths).
- Frontend: `/finance/*` (lazy route, own organisation context + server-only API client with Idempotency-Key on every POST).
  Screens: Finance Dashboard, Chart of Accounts, Journal Entries (live balance editor, approve/reject/post/reverse drawer),
  General Ledger, Trial Balance (3 bases, movement, comparative, CSV), Accounting Periods (soft/hard close, year-end close),
  Approval Centre, Audit Trail (+ chain verification), Company Settings (details, approval policy, people & roles, role matrix).
  Sidebar group "Cintexa Finance" lists only finished modules.
- Verified: repo-wide `npm run typecheck` clean, `vite build` succeeds, 12 backend tests pass. Screens have NOT yet been exercised in a browser.

## Not yet built (later phases)
Sales/purchases/AR/AP, banking, payroll, inventory, assets, tax, budgets, statements, intelligence agents,
approvals engine, integrations, SaaS plans, Sales Management adapter, multi-currency revaluation, PDF/Excel export.
