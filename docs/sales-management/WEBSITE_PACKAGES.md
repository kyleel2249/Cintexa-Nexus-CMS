# Website packages, order dating, payment plans and permanent deletion

## What was added
* **Catalogue** (`sales_website_packages` + features, seeded once from the "Website Packages & Payment Plan" sheet): Basic GHC 3,000 / SEO Growth GHC 5,000 / SEO + AI Assistant + Customer Support GHC 9,000 / Premium Full Stack GHC 15,000, every feature, 50% upfront, 2/3/4/6 monthly instalments, upfront notes ("Paid before work starts" …). Package 3's balance is **GHC 4,500** (the 7,500 on the sheet is wrong and is not reproduced). Editable by `products:write`; edits affect new orders only.
* **Package orders** `POST /orders/package`: creates the order, a frozen snapshot (`sales_order_packages`: name, description, features, catalogue price, agreed price, upfront %, terms, negotiated changes) and the schedule (`sales_order_instalments`) in one transaction. Customisation: agreed price, discount %, extra items/charges, removable optional features, special terms, requirements, upfront %, instalments, first due date.
* **Payment plans** (`domain/instalments.ts`): exact integer arithmetic; the last instalment absorbs rounding (5,000 → 2,500 + 833.33 + 833.33 + 833.34). Payments stay separate immutable records and are allocated to the schedule in order, so early, partial, extra and settle-in-full payments just work. `PUT /orders/:id/payment-plan`, `PATCH /orders/:id/instalments/:seq`, `GET /orders/:id/payment-summary|agreement`.
* **Booking date** = `transaction_date` (reports use `booked_at`, set to that date). Past/today/future at any stage; changeable on confirmed, paid, completed and cancelled orders with `orders:approve`. Entry time, confirmation time and payment dates are never rewritten.
* **Permanent deletion** `POST /orders/:id/delete` (`orders:delete`, administrators only): typed order number, reason (5+ chars), extra acknowledgements for confirmed orders, received payments and approved/paid commissions. A snapshot of everything is stored in `sales_deleted_orders`; dependants are removed; the audit trail is kept. **Deleting is not refunding**; the dialog, API and records say so. `GET /orders-deleted` (admin) lists the evidence.
* **PDFs** (`lib/sales/pdf.ts`, `order-docs.ts`): sales order confirmation, customer quotation, website package proposal, payment plan, instalment schedule, payment receipt (one per payment), outstanding balance statement, customer agreement. Built from `GET /orders/:id/agreement`. Every Sales page also has a **PDF** button in its header that exports the page's current tables, details and filters.
* **Reporting** `GET /website-packages/report` + panel with PDF/CSV: by package, customer, representative, payments received (payment date), monthly collections, outstanding/overdue, completed/cancelled, deleted package orders (admin).
* **Multi-currency**: currency catalogue (`/currencies`), exchange rates with history (`/fx/rates`), historical exact conversion (`/fx/convert`), per-currency + consolidated summary that lists missing rates instead of guessing (`/fx/summary`).
* **AI assist** is ON by default (available only when a provider key exists); a one-time migration switches installs still on the old OFF/blocked default.

## Status (evidence = tests in `artifacts/api-server/src/services/sales/__tests__/`)
| Requirement | Status | Evidence / note |
|---|---|---|
| Booking date past/today/future; edit at any stage; events untouched | PASS | `sales-packages…` "booking date", `sales-multicurrency…` |
| Permanent deletion at every stage, safeguards, roles, evidence, cleanup | PASS | `sales-packages…` "permanent deletion" |
| Four packages, features, prices, upfront/balance/instalments, snapshot immutability | PASS | seeded-catalogue and snapshot tests |
| Payment plan generation, rounding, flexibility, no overwriting of payments | PASS | plan tests |
| Payment tracking (upfront, instalments, early/extra, no double count) | PASS | payment-tracking test (idempotency key) |
| Customer agreement view and eight PDFs from real data | PARTIAL | PDFs generated from a live order and text-checked with `pdftotext` (totals match the database); not opened in a browser; the page-level PDF button is unverified in a browser |
| Currency separation, exact arithmetic, GHC default, USD/GBP/EUR | PASS | multicurrency tests |
| Reports by package/customer/rep, collections, overdue; CSV + PDF | PASS (data) / PARTIAL (UI) | report test; the panel itself was not exercised in a browser |
| Refunds and payment adjustments as separate transaction types | PARTIAL | payments can be **reversed** (kept, marked reversed); no separate refund ledger |
| Responsive mobile/tablet/desktop behaviour | PARTIAL | built with the existing responsive components; not tested on devices |
| Navigation of every section | PARTIAL | every nav link has a route (checked statically); not clicked through in a browser |
| Live exchange-rate provider | BLOCKED | no provider key available; rates are entered manually |
| Existing 2 failing tests (`website-intelligence` export/unit) | FAIL (pre-existing) | fail identically on the untouched repository |
