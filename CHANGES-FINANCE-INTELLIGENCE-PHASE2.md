# CINTEXA Financial Intelligence — Phase 2

**Phase completed:** Shared financial data architecture and synchronisation  
**Date:** 2026-11-02  
**Status:** Implemented (code landed; browser / production verification pending Phase 9)

## Features implemented

1. **Shared integration schema** (`lib/db/src/finance-integration-schema.ts`)
   - `finance_integration_events` — durable, idempotent event log for every Sales↔Finance action
   - `finance_party_links` — maps `sales_accounts` ↔ `finance_customers` (auto by code/email or manual)
   - `finance_reconciliation_runs` — period reconciliation snapshots

2. **Sales → Finance bridge** (`artifacts/api-server/src/services/finance/integration/`)
   - Real `FinanceProvider` implementing `createInvoice` and `voidInvoice`
   - Registered in Sales `integrations` registry so the existing Sales outbox (`finance.invoice` / `finance.void_invoice`) is no longer "unconfigured"
   - Creates finance customer from sales account when needed (idempotent link)
   - Posts balanced automated journal via the same engine as native Finance (`source_module = 'sales.order'`, `source_ref = orderId`)
   - Invoice number + journal reference returned to Sales outbox
   - Void posts a reversing journal and marks the finance invoice cancelled

3. **Event handling**
   - Every bridge call emits a `finance_integration_events` row with stable idempotency key
   - Status: pending → processing → succeeded | failed | skipped | dead
   - Duplicate outbox deliveries are safe (returns prior result)

4. **Reconciliation API**
   - `GET /api/finance/integration/status` — event counts + recent events + party-link count
   - `GET /api/finance/integration/party-links` — current mappings
   - `POST /api/finance/integration/reconcile` — period comparison of Sales order/payment totals vs Finance invoice/receipt totals (admin only)

## Files created / modified

| Path | Change |
|------|--------|
| `lib/db/src/finance-integration-schema.ts` | **New** |
| `lib/db/src/bootstrap.ts` | Include integration statements |
| `lib/db/src/index.ts` | Export integration schema |
| `artifacts/api-server/src/services/finance/integration/*` | **New** (party-link, events, sales-bridge, reconciliation, index) |
| `artifacts/api-server/src/services/finance/modules/integration-routes.ts` | **New** |
| `artifacts/api-server/src/services/finance/index.ts` | Register integration routes + export provider |
| `artifacts/api-server/src/services/sales/index.ts` | Register `createCintexaFinanceProvider` |

## Database changes

Additive only. No existing tables altered. New tables created on next API boot via `ensureSchema`.

## APIs / integrations

- Sales outbox `finance.invoice` → creates Finance invoice + posted journal
- Sales outbox `finance.void_invoice` → reversing journal + cancelled invoice
- Finance integration status & reconcile endpoints

## Design rules preserved

- Double-entry and balanced journals only
- Posted journals immutable; voids use reversals
- `source_module` + `source_ref` uniqueness prevents duplicate postings
- Money as NUMERIC(18,2) / bigint minor units
- No mock figures presented as company results
- Investor ownership still unassigned (not in this phase)

## Tests performed

- Static review of adapter against existing journal/invoice posting contracts
- Schema statements are idempotent (`IF NOT EXISTS` / `ON CONFLICT`)
- **Not yet run:** full PGlite suite, browser E2E, or live Sales order → Finance invoice path on a running server

## Outstanding / limitations

- Payment (receipt) synchronisation from `sales_order_payments` is not yet automated; reconciliation will flag cash differences until Phase 2 follow-up or Phase 5 payment bridge
- Credit notes / multi-currency revaluation still deferred
- Full automated test file for the bridge not added in this commit (to be added with Phase 9 suite)
- UI for integration status not yet built (API only)

## Security considerations

- Bridge runs as system actor `sales-bridge`; uses existing period-lock and control-account rules
- Reconciliation endpoint requires `finance:admin`
- Status endpoints require `ledger:read`
- No secrets introduced

## Deployment considerations

- Restart API so `ensureSchema` creates the three new tables
- Confirm at least one Finance organisation and a revenue + AR account exist before Sales invoices will post
- Existing Sales outbox rows that were `unconfigured` will be retried by the Sales job runner once the provider is present

## Acceptance criteria (Phase 2)

| Criterion | Status |
|-----------|--------|
| Shared financial data model | ✅ event log + party links + reconciliation runs |
| Reliable three-way foundation (Sales ↔ Finance; Intelligence consumes later) | ✅ bridge + events |
| Event-driven updates via existing outbox | ✅ provider registered |
| Data validation & reconciliation | ✅ period reconcile API |
| Transaction identifiers & audit trails | ✅ source_ref + integration events + finance audit |
| No breakage of existing Finance / Sales | ✅ additive only |

**PHASE 2 COMPLETE — awaiting explicit authorisation before Phase 3.**
