# CINTEXA Financial Intelligence — Phase 9
**Status:** Implemented · **Date:** 2026-11-02

## Scope
Verification, integration centre, FI settings, automated PGlite suite.

## Features
### Sales ↔ Finance Integration centre
- `/financial-intelligence/integration`
- Party links table, recent event log, period reconciliation (finance:admin)
- Linked from overview and settings

### Financial Settings
- `/financial-intelligence/settings`
- Organisation summary, alert posture, rule list, quick links to Finance policies

### Reports
- Working CSV exports via `fin.download` for P&L, balance sheet, cash flow, trial balance

### Automated tests
- `artifacts/api-server/src/services/finance/__tests__/finance-intelligence.pglite.test.ts`
- Covers dashboard, ratios, statements, capital, dividends, valuation NAV, budgets, alerts, integration status

## Prior UI fix (still on main)
- DataTable `rowKey` + `render` (phases 6–8)
- Live `/ratios` and `/statements/*` on analysis pages

## Files
- settings-integration-page.tsx
- finance-intelligence.pglite.test.ts
- nav + routes wiring
