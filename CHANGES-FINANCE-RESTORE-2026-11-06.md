# Finance and Financial Intelligence restored – 2026-11-06

Done on explicit owner instruction ("Restore the Finance and Finance intelligence that was just removed"). This supersedes the 2026-11-02 removal record and the 2026-11-05 reconcile (both kept as history).

Branch `restore/finance-and-fi`, made by reverting commits 8db38b9 and b0f48bb on top of main (096341f).

## Restored
- Finance pages, routes, nav, dashboard widget, API client, engines and tests (`pages/finance`, `components/finance`, `lib/finance`).
- Financial Intelligence pages, widget, API client, engine and nav.
- Pages Functions `functions/api/finance` and `functions/api/fi`, Finance sync wiring in `functions/_lib/nexus-sync.ts`, Sales finance adapter, CSI/Corporate Strategy links to Finance, `tests/finance-sync.test.ts`, docs.
- Database schemas, migrations and data were never removed, so nothing needs restoring there.

## Not restored
No external API or key requirement. A scan of the restored files found none.

## Verified (parse check only)
46 changed TypeScript files parse with 0 syntax errors.

## NOT run
Type-check, tests, production build, e2e, deployment (package downloads are blocked here).

## Heads-up
PR #16 (external-API removal) edits some of the same files (CSI, sync registry, Sales). Merge order may need a small conflict fix. Remove the `kpi-card`/`format/currency` helpers from PR #16 only if Finance code now makes them redundant.

## Amount entry and display fix (2026-11-06, later)
- Cause of "5,000 shows as 50": the discount invoice/purchase forms sent typed values straight in as minor units (x100 too small); other amount fields used `Number("5,000")`, which is NaN, so a comma lost the amount.
- Fix: new `amountInputToMinor` / `amountInputToMajor` (comma and space safe) used by all Finance amount fields; discount forms now take normal amounts.
- Display: whole amounts show as typed ("5,000"); decimals appear only when present ("1,234.50"). Trial balance, ledger and journal lists now format their raw minor figures too.
- Tests: `lib/finance/money.test.ts` updated and extended (35 Finance unit tests pass). Not run: type-check, build, browser check.

## Crash fix, accounting guidance, deletion, sync and forecasts (2026-11-06, third batch)
- Crash: `FinancePage` and `FiPage` called different hooks per mode inside one component; moving between sub-pages could break React and take the page down. Each mode is now keyed so it remounts cleanly.
- Mobile phones: account 1215 (asset), 1283 (accumulated depreciation), 6312 (depreciation expense); category `mobile_phone` is forced to 25% straight-line like computers and laptops and posts to its own accounts.
- Delete: journals (existing), plus invoices and payments (new). Deleting a payment restores the invoice balance; an invoice with payments must have them deleted first. Closed periods block deletion until reopened. Every deletion is audited.
- Narration, memo, line notes: written automatically and kept live (placeholders follow account, side and amount changes; "Apply line notes" copies them). The server fills a memo and line notes for any journal that arrives without them.
- Double-entry guide (`lib/finance/double-entry-guide.ts`): effect of each debit/credit by account type (contra accounts handled), accounting-equation check, "what if reversed", and the GAAP concepts that apply (ASC references), with a cheat sheet.
- Sync: new events JOURNAL_POSTED, JOURNAL_DELETED, INVOICE_DELETED, PAYMENT_DELETED, ASSET_DEPRECIATED delivered to Sales, Marketing, Corporate Strategy, Business Diary, Financial Intelligence and the dashboard. Marketing and Corporate Strategy and Sales receive a refresh link; the UI reads live data.
- Forecasts and 3D: `/nexus-synchrony` page and a dashboard card show a rotating 3D map of real sync flows, monthly revenue/expense/net/cash forecasts from posted journals and weekly activity forecasts per tool (Holt linear smoothing, 80% interval, confidence label; no forecast under 3 periods). The journal form has a predictive check per line (unusually large amounts, projected account movement). New endpoints: `GET /api/finance/analytics/series`, `GET /api/sync/activity`.
- Honest limits: forecasts extrapolate history; activity forecasts for Sales, Marketing, Strategy and Diary are based on synced event counts, not their own business metrics. Marketing and Strategy do not yet publish events of their own.
- Tests run: tests/finance-sync.test.ts 7 pass (3 new), double-entry-guide 5 pass, forecast 5 pass. Not run: type-check, build, browser check (the crash fix is from code reading, not a reproduced run).

## Fourth batch: Data Bandwidth, financial ratios, reciprocal sync, recommendations (2026-11-06)
- Chart of accounts: 1085 Data Bandwidth (current asset, prepaid: counts in current assets, not in quick assets) and 6085 Data Bandwidth Consumed (expense, for usage adjustments).
- Ratio engine (`functions/_lib/finance-ratios.ts`, 28 ratios): liquidity (current, quick, cash, working capital); profitability (gross, operating, net, EBITDA margins, ROA, ROE); leverage (debt-to-equity, debt ratio, equity multiplier, interest coverage); efficiency (asset, fixed-asset, receivables, payables, inventory turnover, DSO, DPO); acquisition (Customer Acquisition Cost, CAC ratio, LTV:CAC, CAC payback, marketing % of revenue). Each has formula, meaning, healthy guide, how to improve, and the accounts that feed it.
- CAC = account 6200 Marketing and Advertising (plus any account named marketing/advertising/promotion/sales commission) ÷ customers whose first invoice falls in the period. Closing balances are used for balance-sheet ratios (no averages).
- Endpoints: `GET /api/finance/analytics/ratios`, `POST /api/finance/analytics/ratio-impact` (before/after, direction, explanation per ratio for any set of lines), `GET /api/finance/analytics/account-ratios?code=`.
- UI: Finance > Financial Ratios page; "Effect on financial ratios" card on every journal; "Ratios this account affects" on each account; ratios inside Financial Intelligence; key ratios on the Finance dashboard widget.
- Reciprocal sync: every event now fans out to every tool except its source (Sales, Marketing, Corporate Strategy, Business Diary, Financial Intelligence, Finance, Dashboard). Records entered in Corporate Strategy, the Diary, Financial Intelligence and Sales (remote and local mode) and Marketing (browser store, diffed on save) are announced as RECORD_CREATED/UPDATED/DELETED. Finance publishes its own events on the server.
- Recommendations (`functions/_lib/nexus-recommend.ts`): rules per record kind and receiving tool; added to the Diary entry text, returned when an event is published, shown in a toast and a dashboard card, and served by `GET /api/sync/recommendations`.
- Tests run: tests/ 68 pass (finance-ratios 6, finance-sync 8, nexus-sync updated link counts); frontend announce 2 pass; double-entry and forecast tests still pass. Not run: type-check, build, browser check. One suite needs pglite (not installable here).
- Limits: recommendations are rules, not analysis of your market; ratio guides are rules of thumb. Local-mode Sales and browser-stored Marketing data announce from the browser, so they sync only while the app is open and online. Marketing "spent/budget" amounts are announced as major units x100.

### Update: delivery also returns to the source
Every event now reaches all seven tools (Sales, Marketing, Corporate Strategy, Business Diary, Financial Intelligence, Finance, Dashboard) including the tool it came from, and the dashboard can be a source. A diary-originated record is acknowledged back to the diary (`source_ack` link) without writing a duplicate entry. Tests: tests/ 68 pass (reciprocal test now covers all seven sources).
