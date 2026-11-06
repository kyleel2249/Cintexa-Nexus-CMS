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

## Chart of Accounts integration (v1.1)

- Expanded CINTEXA technology-services COA template (assets, liabilities, equity, revenue, COS, opex, tax controls).
- `GET /api/finance/accounts/search?q=` — searchable active accounts for journal dropdowns.
- `POST /api/finance/accounts` — create account; immediately available in search (no redeploy).
- `POST /api/finance/accounts/:id/deactivate` — hide from new postings; historical lines retain codes.
- UI `AccountSelect` component used on General Journal lines, ledger picker, and invoice revenue account.
- Multi-line journal grid with live debit/credit totals; post only when balanced.

## FIN_DB (Cloudflare D1) persistence

### wrangler.toml
```toml
[[d1_databases]]
binding = "FIN_DB"
database_name = "cintexa-finance-db"
database_id = "ed7ed00b-05e7-4c28-96fc-536ccad3e89e"
migrations_dir = "migrations/finance"
```

`migrations/finance/` contains only Finance SQL (`0001_cintexa_finance.sql`, `0002_amount_precision.sql`) so diary/sync migrations are **not** applied to this database.

### Apply remote migration (Cloudflare account required)
```bash
npx wrangler d1 migrations apply cintexa-finance-db --remote
```

### Runtime
- When `FIN_DB` is bound: accounts, journals, lines, invoices, payments, audit hydrate from D1; writes persist via prepared statements / batch.
- When missing: mutations return **503 FIN_DB_REQUIRED** unless `FIN_ALLOW_MEMORY=1` (local/dev only).
- Dashboard `storage` field reports `d1` | `isolate-memory-dev` | `isolate-memory`.

### Amount display
`lib/finance/money.ts`: full values, no K/M abbreviation; whole numbers without forced `.00`; excess decimals rejected with validation error.

## Availability repair (2026-11)

### Root causes of "Finance unavailable"
1. `FIN_DB` bound but tables missing → hydrate threw → **all** requests 503.
2. Frontend showed a generic message without the API error body.

### Fixes
- Auto `CREATE TABLE IF NOT EXISTS` bootstrap on every D1 request (`ensureSchema`).
- Soft-fail hydrate: dashboard still loads with memory COA if schema temporarily fails.
- `GET /api/finance/health` reports binding, connection, schema status.
- Overview UI shows HTTP status and health details.

### Cloudflare checklist
1. Pages project has Function `functions/api/finance/[[path]].ts`.
2. D1 binding **FIN_DB** → `cintexa-finance-db` (`ed7ed00b-05e7-4c28-96fc-536ccad3e89e`).
3. Redeploy after push.
4. Open `/api/finance/health` — expect `"api":"operational"`.
5. Open `/api/finance/dashboard` — expect JSON with `engine` and `storage`.
