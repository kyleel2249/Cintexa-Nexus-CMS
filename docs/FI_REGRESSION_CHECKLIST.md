# Financial Intelligence — Release Regression Checklist

Use before promoting a release. FI figures must come only from **posted** Finance ledger data.

## Bootstrap
- [ ] `FINANCE_PHASE10_21_STATEMENTS` and `FINANCE_PHASE22_35_STATEMENTS` applied (bootstrap / migrate)
- [ ] `FINANCE_INTEGRATION_STATEMENTS` applied
- [ ] `GET /api/finance/intelligence/readiness` → `ready: true`
- [ ] `GET /api/finance/intelligence/smoke` → `passed: true`
- [ ] `GET /api/finance/intelligence/health-check` → overall `ok` (or documented degraded modules)
- [ ] Sales outbox worker is running (or a manual outbox drain is available in the environment)
- [ ] Pending `finance.invoice` / `finance.payment` outbox rows can leave `pending` and reach `sent` or a terminal failure state

## Core analysis
- [ ] Overview KPIs match trial balance (posted only)
- [ ] Overview chart / monthly movement uses posted periods only
- [ ] Ratios page loads (null metrics when denominators missing — not invented)
- [ ] CAC / customer-acquisition page does not invent CAC when inputs are missing
- [ ] P&L / Balance sheet / Cash flow lines + CSV download
- [ ] Reports hub opens statement links and CSV exports work
- [ ] Working capital and cashflow routes load without errors
- [ ] Revenue and expenses analysis pages load from dashboard/posted data
- [ ] Empty org: empty states, no sample GHS amounts

## Capital & returns
- [ ] Create investor, share class, shareholding → cap table %
- [ ] Contribution does **not** change ownership
- [ ] Dividend draft → generate lines → approve
- [ ] Dividend mark-paid / void path does not invent payable balances
- [ ] Cap table with more than one share class (when used) still totals correctly
- [ ] Investor concentration page matches share register (or empty when none)
- [ ] Valuation NAV from equity
- [ ] Valuation scenario save does not alter the ledger

## Planning
- [ ] Budget lines + vs-actual from posted ledger
- [ ] Budget activate from draft
- [ ] Budget scenario adjustment does not change posted actuals
- [ ] Alert rule evaluate + acknowledge
- [ ] Evaluate with no rules configured shows a clear empty / zero state
- [ ] Health summary signals do not invent numbers beyond posted KPIs

## Integration
- [ ] Sales invoice outbox → Finance invoice + journal
- [ ] Sales payment outbox → Finance receipt + AR allocation (when invoice exists)
- [ ] Unpaid Sales orders never post revenue to Finance
- [ ] Payment bridge page (`/financial-intelligence/payment-bridge`) shows payment-related events after a Sales payment
- [ ] Failed outbox / retry path is visible (event or outbox status), not silent
- [ ] Integration centre shows events; party links list loads
- [ ] Reconcile requires `finance:admin` and accepts a valid period range
- [ ] Credit/debit note / void invoice path posts reversing journal (no invented CN balances)

## Ops / advanced
- [ ] FX rate + convert
- [ ] `POST /fx/revalue` returns disclosure (rate + balances) without inventing a revaluation journal when cost bases are absent
- [ ] Board pack create/publish/bundle
- [ ] Board pack annotation can be added without changing statement figures
- [ ] Comparative analysis run (period vs period) from posted ledger only
- [ ] Intelligence agents generate rule-based recommendations only (no generative invented figures)
- [ ] Agent accept / dismiss does not change ledger balances
- [ ] KPI targets evaluate
- [ ] Saved views create + open path
- [ ] Export job history records statement export requests
- [ ] Stress scenario from posted YTD
- [ ] Working-capital snapshot capture
- [ ] Tax intelligence and investor concentration pages load (empty when no data)
- [ ] Notification digest + deliver (in-app; webhook if `FI_NOTIFICATION_WEBHOOK_URL` is set)
- [ ] FI settings page links to Finance settings and integration
- [ ] Permissions matrix page loads
- [ ] FI audit trail lists FI-related audit events (or empty)
- [ ] API index and version pages load; version shows phase 35+ / smoke pass
- [ ] System health page matches readiness/smoke

## Permissions
- [ ] `ledger:read` can view FI; create/approve actions gated
- [ ] User **without** `ledger:read` cannot open `/financial-intelligence/*` (permission denied)
- [ ] `finance:admin` required for integration reconcile and notification deliver
- [ ] `finance:approve` required for dividend approve / board pack publish / budget activate
- [ ] `audit:read` for FI audit trail; denied without it

## Deferred / out of scope (confirm still not claimed as done)
- [ ] Full automated FX revaluation **journals** (cost-base driven) — disclosure only unless explicitly enabled later
- [ ] PDF board-pack export — CSV and live bundles only unless PDF is shipped
- [ ] Email notification channel — in-app + optional webhook only unless email provider wired
- [ ] Sales payment **reversal** bridge — reverse in Sales does not silently invent Finance reversals unless implemented
- [ ] Generative AI insights — not part of FI; agents remain rule-based
- [ ] Payroll / inventory / bank API feeds — not under FI

## Ownership (ops, not code)
- [ ] Named owner: who publishes board packs
- [ ] Named owner: who approves dividends
- [ ] Named owner: who acknowledges alerts
- [ ] Named owner: who runs period reconciliation
- [ ] Temporary CI/deploy secrets (e.g. GitHub PAT) revoked after use

## Suggested minimum pass bar
1. Bootstrap section all green (including outbox worker).
2. Core analysis + empty-org rule.
3. At least one capital path and one budget/alert path.
4. Invoice **and** payment bridge once each in a non-prod org.
5. Permissions: viewer can read; creator cannot approve dividends/packs without approve perms; no `ledger:read` is denied.
6. Deferred section reviewed so release notes do not claim PDF/email/full FX reval/generative AI unless shipped.
