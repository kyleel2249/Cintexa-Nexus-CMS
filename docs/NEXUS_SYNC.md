# CINTEXA Nexus — Unified Sync Architecture

## Goals
- **Enter data once** → dependent modules receive an event and update
- **Zero API keys** for native tools, **no Firebase**, **no sign-in**
- One Cloudflare D1 database as the shared store

## Database
All sync and Diary-entry data lives in one D1 database: `NEXUS_DB` if bound, otherwise the existing `FIN_DB` (CINTEXA Finance). No new binding is required. Tables are created automatically on first use (`CREATE TABLE IF NOT EXISTS`); `migrations/d1/0006_nexus_sync_v2.sql` is the same schema for operators who prefer `wrangler d1 execute` (a test fails if the two drift). `0003_nexus_sync.sql` is superseded and was never used by the application.

Without any D1 binding the sync routes answer **503** and `GET /api/sync/meta` reports `persistent: false`. Events are never held in isolate memory.

| Table | Purpose |
|---|---|
| `nx_sync_events` | The outbox: one row per business event, unique `idempotency_key`, `version`, `effective_date`, `status`, `attempts`, `next_attempt_at`, `last_error` |
| `nx_sync_links` | Event → target record (e.g. the diary entry created), unique per event/target |
| `nx_sync_log` | Every processing attempt and its outcome |
| `bd_entries` | Business Diary entries (shared with `/api/diary`) |

## Engine (`functions/_lib/nexus-sync.ts`, HTTP in `functions/api/sync/[[path]].ts`)
- **Idempotent enqueue** — a repeated `idempotencyKey` returns the original event (`duplicate: true`) and applies nothing again.
- **Conflict detection** — an event whose `version` is lower than one already recorded for the same business/entity/type is rejected `409`.
- **Leased claiming** — one worker processes an event at a time; a crashed worker's lease (5 min) expires and the event is retried.
- **Atomic effects** — a target's records, its links, the status change and the log row are committed in one D1 batch, so an event is never half-applied. Diary entries use deterministic ids, so even a repeat is harmless.
- **Retry and dead-letter** — failures back off exponentially (30 s, 60 s, … capped at 1 h); after 5 attempts the event becomes `dead` and needs `POST /api/sync/retry`.
- **Live updates** — `GET /api/sync/changes?after=<seq>` returns new events and a cursor; the dashboard widget refreshes every 10 s.

| Route | |
|---|---|
| `POST /events` | enqueue + process. Body: `eventType` (UPPER_SNAKE), `sourceModule`, `entityType`, `entityId`, `payload`, optional `idempotencyKey`, `version`, `effectiveDate` (YYYY-MM-DD), `businessId`, `related[]` |
| `GET /events`, `GET /events/:id` | list (filter by `status`, `entityType`, `entityId`, `sourceModule`, `eventType`) / one event with its log |
| `POST /process` | drain everything that is due |
| `POST /retry {id}` | re-run a `failed` or `dead` event |
| `GET /status`, `/meta`, `/registry`, `/changes` | health counts, capabilities, module routing, cursor feed |

## Who publishes and who consumes
| Module | Publishes | Consumes |
|---|---|---|
| CINTEXA Finance | `INVOICE_CREATED`, `PAYMENT_RECEIVED`, `EXPENSE_RECORDED` — written straight into the outbox (no network hop) | — |
| Sales Management | **not yet connected** (still on the Express/Postgres API) | — |
| Business Diary | — | creates a diary entry for CUSTOMER/LEAD/SALES_ORDER/INVOICE/PAYMENT/EXPENSE events |
| Financial Intelligence | — | records a `recalculate` link only; FI itself is still isolate memory, so it does **not** recompute from these events yet |
| Dashboard | — | records an `invalidate` link; the widget polls |

## Tested (node --test, against SQLite standing in for D1)
`tests/nexus-sync.test.ts`, `tests/finance-sync.test.ts`, `tests/diary-sync.test.ts`, `tests/nexus-schema.test.ts`: persistence, idempotency, concurrent claim, stale version, rollback on failure, retry, dead-letter, lease expiry, cursor, validation, Finance→Sync→Diary end to end, and the three Finance persistence defects below. **Not tested against a real Cloudflare D1 or a deployed Pages project.**

## Finance defects fixed while wiring this
- Invoice creation persisted the invoice twice (unique-number violation, request failed after the invoice was saved).
- A payment updated the invoice's paid amount/status in memory only, so the next request showed it unpaid.
- The discounted-expense journal was never written to D1.

## Honest limits
- Sales Management, the CMS and everything else on Express/PostgreSQL are **not** migrated to D1 and **do not publish sync events yet**.
- Business Diary follow-ups, pitches, feedback, decisions, case studies, opportunities, commitments, organisations and correspondence are still isolate memory. Only diary **entries** are in D1.
- Financial Intelligence is still isolate memory; its demo button remains.
- There is no double-entry reversal/backdating/multi-currency engine beyond what Finance already had; reconciliation reports are not built.
- Diary hydrates up to 5,000 entries per request; very large diaries need pagination.
- The other Pages Functions (`/api/fi`, `/api/finance`, `/api/diary`) still send `access-control-allow-origin: *`; the sync function no longer does.
