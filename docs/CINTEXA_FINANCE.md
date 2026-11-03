# CINTEXA Finance — Double-Entry Accounting

## API (`/api/finance/*`)
- Dashboard, Chart of Accounts, Journals (post/reverse), Trial Balance, P&L, Balance Sheet
- Invoices (AR + revenue journal), Payments (bank + AR), Ledger, Audit
- `POST /from-sales/invoice` — idempotent sales bridge

## Rules
- Integer **minor units** only
- Posted journals must balance; unbalanced posts rejected
- Posted journals are immutable; corrections via **reversal**
- No API keys; no Firebase
- Empty books show zeros (no fabricated demo balances)

## Persistence
Bind Cloudflare D1 as `FIN_DB` and apply `migrations/d1/0005_cintexa_finance.sql`.
Without binding, store is isolate memory (lost on redeploy).

## UI
`/finance` and sidebar **CINTEXA Finance**.
