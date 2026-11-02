# Financial Intelligence — Release Regression Checklist

Use before promoting a release. FI figures must come only from **posted** Finance ledger data.

## Bootstrap
- [ ] `FINANCE_PHASE10_21_STATEMENTS` and `FINANCE_PHASE22_35_STATEMENTS` applied (bootstrap / migrate)
- [ ] `FINANCE_INTEGRATION_STATEMENTS` applied
- [ ] `GET /api/finance/intelligence/readiness` → `ready: true`
- [ ] `GET /api/finance/intelligence/smoke` → `passed: true`
- [ ] Sales outbox worker is running (or a manual outbox drain is available in the environment)
- [ ] Pending `finance.invoice` / `finance.payment` outbox rows can leave `pending` and reach `sent` or a terminal failure state

## Core analysis
- [ ] Overview KPIs match trial balance (posted only)
- [ ] Ratios page loads (null metrics when denominators missing — not invented)
- [ ] P&L / Balance sheet / Cash flow lines + CSV download
- [ ] Working capital and cashflow routes load without errors
- [ ] Empty org: empty states, no sample GHS amounts

## Capital & returns
- [ ] Create investor, share class, shareholding → cap table %
- [ ] Contribution does **not** change ownership
- [ ] Dividend draft → generate lines → approve
- [ ] Dividend void or reject path does not invent payable balances
- [ ] Cap table with more than one share class (when used) still totals correctly
- [ ] Valuation NAV from equity

## Planning
- [ ] Budget lines + vs-actual from posted ledger
- [ ] Budget scenario adjustment does not change posted actuals
- [ ] Alert rule evaluate + acknowledge
- [ ] Evaluate with no rules configured shows a clear empty / zero state

## Integration
- [ ] Sales invoice outbox → Finance invoice + journal
- [ ] Sales payment outbox → Finance receipt + AR allocation (when invoice exists)
- [ ] Unpaid Sales orders never post revenue to Finance
- [ ] Payment bridge page (`/financial-intelligence/payment-bridge`) shows payment-related events after a Sales payment
- [ ] Failed outbox / retry path is visible (event or outbox status), not silent
- [ ] Integration centre shows events; reconcile requires `finance:admin`

## Ops / advanced
- [ ] FX rate + convert
- [ ] `POST /fx/revalue` returns disclosure (rate + balances) without inventing a revaluation journal when cost bases are absent
- [ ] Board pack create/publish/bundle
- [ ] Board pack annotation can be added without changing statement figures
- [ ] KPI targets evaluate
- [ ] Stress scenario from posted YTD
- [ ] Working-capital snapshot capture
- [ ] Tax intelligence and investor concentration pages load (empty when no data)
- [ ] Notification digest + deliver (in-app; webhook if `FI_NOTIFICATION_WEBHOOK_URL` is set)
- [ ] Version page shows phase 35+ / smoke pass

## Permissions
- [ ] `ledger:read` can view FI; create/approve actions gated
- [ ] User **without** `ledger:read` cannot open `/financial-intelligence/*` (permission denied)
- [ ] `finance:admin` required for integration reconcile and notification deliver
- [ ] `audit:read` for FI audit trail; denied without it

## Ownership (ops, not code)
- [ ] Named owner: who publishes board packs
- [ ] Named owner: who approves dividends
- [ ] Named owner: who acknowledges alerts
- [ ] Temporary CI/deploy secrets (e.g. GitHub PAT) revoked after use

## Suggested minimum pass bar
1. Bootstrap section all green (including outbox worker).
2. Core analysis + empty-org rule.
3. At least one capital path and one budget/alert path.
4. Invoice **and** payment bridge once each in a non-prod org.
5. Permissions: viewer can read; creator cannot approve dividends/packs without approve perms; no `ledger:read` is denied.
