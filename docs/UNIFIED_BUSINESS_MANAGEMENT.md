# Unified Sales · Finance · Business Diary

## Flow
1. **Sales** creates commercial records (existing Sales Management / Express).
2. **Finance** (`/api/finance`) posts double-entry journals for invoices & payments.
3. **Diary** receives activity notes (invoice issue auto-POST, sync events).
4. **Sync** (`/api/sync`) outbox provides idempotent cross-module events.

## Sales → Finance
`POST /api/finance/from-sales/invoice` with `{ customerName, amountMinor, orderId, currency }`.
Idempotent on `sourceModule=sales` + `sourceId`.

## Finance → Diary
Invoice creation attempts diary entry + `INVOICE_CREATED` sync event.

## Honesty
Full Express Sales ↔ D1 Finance unified database migration is progressive.
This layer provides the accounting spine and bridges without requiring API keys.
