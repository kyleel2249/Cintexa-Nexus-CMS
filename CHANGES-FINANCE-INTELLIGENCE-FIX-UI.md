# Financial Intelligence — UI / API wiring fix
**Date:** 2026-11-02

## Root causes
1. `DataTable` requires `rowKey` and each column must define `render(row)`. Phase 6–8 pages passed only `key`/`header` and omitted `rowKey`, causing runtime crashes (`c.render is not a function`).
2. Analysis pages for ratios, P&L, balance sheet, cash flow, and CAC still called only `GET /dashboard` instead of `/ratios` and `/statements/*`.
3. CSV export used a broken `/api/finance…` anchor; now uses `fin.download`.

## Fixes
- Rewrote analysis-page to consume live ratio and statement APIs
- Rewrote capital, dividends/valuation, and budget/health pages with correct DataTable usage
- Redirect stubs for budget/health/investors/shareholders/dividends/valuation to dedicated pages
