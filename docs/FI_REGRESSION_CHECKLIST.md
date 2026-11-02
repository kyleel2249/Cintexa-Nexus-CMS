# Financial Intelligence — Release Regression Checklist

Use before promoting a release. FI figures must come only from **posted** Finance ledger data.

## Bootstrap
- [ ] `FINANCE_PHASE10_21_STATEMENTS` and `FINANCE_PHASE22_35_STATEMENTS` applied (bootstrap / migrate)
- [ ] `FINANCE_INTEGRATION_STATEMENTS` applied
- [ ] `GET /api/finance/intelligence/readiness` → `ready: true`
- [ ] `GET /api/finance/intelligence/smoke` → `passed: true`

## Core analysis
- [ ] Overview KPIs match trial balance (posted only)
- [ ] Ratios page loads (null metrics when denominators missing — not invented)
- [ ] P&L / Balance sheet / Cash flow lines + CSV download
- [ ] Empty org: empty states, no sample GHS amounts

## Capital & returns
- [ ] Create investor, share class, shareholding → cap table %
- [ ] Contribution does **not** change ownership
- [ ] Dividend draft → generate lines → approve
- [ ] Valuation NAV from equity

## Planning
- [ ] Budget lines + vs-actual from posted ledger
- [ ] Alert rule evaluate + acknowledge

## Integration
- [ ] Sales invoice outbox → Finance invoice + journal
- [ ] Sales payment outbox → Finance receipt + AR allocation (when invoice exists)
- [ ] Integration centre shows events; reconcile requires `finance:admin`

## Ops / advanced
- [ ] FX rate + convert
- [ ] Board pack create/publish/bundle
- [ ] KPI targets evaluate
- [ ] Stress scenario from posted YTD
- [ ] Version page shows phase 35+ / smoke pass

## Permissions
- [ ] `ledger:read` can view FI; create/approve actions gated
- [ ] `audit:read` for FI audit trail

## Ownership (ops, not code)
- Who publishes board packs
- Who approves dividends
- Who acknowledges alerts
