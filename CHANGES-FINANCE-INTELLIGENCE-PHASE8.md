# CINTEXA Financial Intelligence — Phase 8
**Status:** Implemented · **Date:** 2026-11-02

## Scope
Budget vs actual, scenario planning, financial health signals, rule-based alerts.

## Features
### Budgets
- Schema: finance_budgets, finance_budget_lines, finance_budget_scenarios
- CRUD budgets (draft → active), lines by category, conservative/base/aggressive scenarios
- GET /budgets/:id/vs-actual — actuals from posted ledger in the budget period by account category
- Scenarios apply % adjustments to budget lines only; they never invent actuals

### Health & alerts
- Schema: finance_alert_rules, finance_alert_events
- Configurable rules on KPIs (current_ratio, margins, cash, WC, etc.)
- POST /alerts/evaluate evaluates active rules against posted KPIs
- GET /health/summary — automatic signals + open alert counts
- Acknowledge workflow for open events

### Frontend
- /financial-intelligence/budget
- /financial-intelligence/health

## Files
- lib/db/src/finance-schema.ts (FINANCE_PHASE8_STATEMENTS)
- artifacts/api-server/src/services/finance/modules/budget-health.ts
- artifacts/cintexa/src/pages/financial-intelligence/budget-health-page.tsx
