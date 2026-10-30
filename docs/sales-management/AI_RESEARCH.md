# Sales AI Autofill, web research and plain-language help

Added on top of the existing 24-agent network. Nothing was replaced.

## What users get
* **AI Autofill panel** on the New/Edit **Lead**, **Account**, **Contact** and **Competitor** forms (`FormModal autofill="lead|account|contact|competitor"`).
  Enter a company name and/or website, press **Research company**. A durable job reads the company's *public* pages and returns a preview.
* **Preview, never auto-save.** Each suggestion shows: current value, proposed value, status (New / Differs / Conflict / Same), confidence band and %, verification, kind (fact / estimate / hypothesis), source link and excerpt.
  Only *New* suggestions with confidence >= 55% that are not hypotheses are pre-ticked. **Apply selected** copies values into the open form; the person still reviews and presses **Save**, so every existing validation and permission runs.
  Existing values are never overwritten unless the person ticks a "Differs" row. **Accept all new**, **Clear AI drafts**, **Refresh research**, **Show alternative**, **Cancel** and source links all work.
* **SEO & AEO tab**: observed findings (title, meta description, h1, canonical, sitemap, robots, viewport, alt text, structured data, question headings, noindex), suggested question topics and clearly labelled *sales hypotheses* tied to the observations. No rankings, volumes or traffic are ever produced.
* **Contact form** lists publicly named leaders only (from the company's own structured data). Personal emails/phones are never proposed.
* **Clues everywhere:** an (i) icon or dotted underline on every form label, table header, tab, KPI card, status badge and page/panel title that the glossary knows (about 520 of the ~780 labels on the Sales screens; the rest are buttons, dialog titles and empty-state messages). Hover, focus or tap to read it. **Sales -> Glossary & Help** lists and searches all ~520 entries. To explain a new term, add it to `lib/sales/glossary.ts` / `glossary-extra.ts`.

## Architecture
| Piece | Location |
|---|---|
| Tables `sales_research_jobs`, `sales_research_evidence`, `sales_autofill_decisions` | `lib/db/src/sales-research-schema.ts` (auto-applied on boot) and `supabase/migrations/20261029120000_sales_research.sql` |
| HTML reader, fetcher + robots.txt | `services/sales/research/html.ts`, `fetcher.ts` |
| Research engine (deterministic extraction + evidence) | `research/engine.ts` |
| Confidence method (documented) | `research/confidence.ts` |
| SEO / AEO analysis | `research/seo.ts` |
| Search provider layer (Brave, Serper, Tavily, ordered fallback) | `research/search.ts` |
| Durable jobs, idempotency, cache, recovery | `research/jobs.ts` |
| REST routes (`/api/sales/research/*`, all need `ai:use`) | `research/routes.ts`, registered in `services/sales/index.ts` (server only) |
| UI | `components/sales/AiAutofillPanel.tsx`, `lib/sales/research-api.ts`, `Hint.tsx`, `pages/sales/glossary.tsx` |

Routes: `GET /research/status`, `POST /research/company`, `GET /research/jobs`, `GET /research/jobs/:id`, `POST /research/jobs/:id/cancel`, `POST /research/jobs/:id/decisions`.
Job states: queued -> researching -> extracting -> validating -> awaiting_review -> completed (or partial / failed / cancelled). A job interrupted by a restart is marked failed ("interrupted") on next read; nothing is silently lost.

## Security
* Every request passes the SSRF guard (`lib/intelligence/src/ssrf.ts`): http(s) only, ports 80/443, no credentials in URLs, blocked hostnames, every resolved IP and **every redirect hop** checked against private/loopback/link-local/metadata ranges; size, time and content-type limits; max 6 pages (configurable, hard cap 12).
* `robots.txt` is honoured (our user-agent `CintexaResearchBot`). No logins, CAPTCHAs or paywalls are bypassed.
* **No model reads page text**; extraction is deterministic code, so page text cannot instruct anything. Instruction-like text is detected, flagged to the user and ignored.
* Search keys live in server environment variables only; `/research/status` reports provider *names*, never keys (tested).
* Per-member hourly limit, concurrent cap, 24 h cache, idempotent enqueue (double-click returns the same job), all decisions audited in `sales_autofill_decisions` and `sales_audit_events`.
* Research routes are **not** bundled into the on-device (browser) Sales runtime; the panel calls the API server and says so if it is unreachable.

## Confidence method (also shown in the UI)
`score = clamp(base(source) x extractionReliability + corroboration + domainAdjustment - stalenessPenalty)`; base: structured data 0.85, page text 0.70, search snippet 0.40, derived 0.35; +0.075 per extra agreeing page (max +0.15); +0.05 if the value's domain is the company's own, -0.10 if not; -0.02 per 30 days (max -0.20). It is a transparent heuristic, not a probability.

## Setup
1. Apply nothing manually on the normal server path (tables are created on boot). For Supabase-style setups run `supabase/migrations/20261029120000_sales_research.sql`.
2. Website-based research works with **no key**. To find a company from its name alone set one of `BRAVE_SEARCH_API_KEY`, `SERPER_API_KEY`, `TAVILY_API_KEY` (see `artifacts/api-server/.env.example`).
3. The API server must be able to make outbound HTTPS requests. Sales in "local mode" still needs the API server for research only.

## Requirements matrix (honest status)
| Requirement in the master prompt | Status |
|---|---|
| Real server-side public web research with sources, timestamps, robots, SSRF guard | **Done, tested** (against a simulated website; no live internet in the build sandbox) |
| Search by company name via provider | **Built; needs a key; not verified live** |
| Evidence store, documented confidence, fact/estimate/hypothesis | **Done, tested** |
| Universal autofill (preview, selective apply, protect existing, audit) | **Done for Lead, Account, Contact, Competitor forms** |
| Autofill on other forms (opportunity, quotation, campaign, product, target, activity…) | **Not done.** Their fields (amounts, dates, stages) are not publicly researchable; they get clues instead |
| SEO / AEO analysis of a prospect's website | **Done** (observed vs hypothesis); no third-party metrics (rankings/volume/backlinks) |
| CINTEXA service-fit hypotheses from observed findings | **Done** (SEO, AEO, website development) |
| Durable jobs, progress, cancel, retry-safe, cache | **Done** (in-process worker over durable rows; no separate queue service) |
| Pluggable AI provider abstraction for *research* | **Not needed for extraction** (deterministic). Existing OpenRouter layer unchanged |
| Bulk enrichment of many records, scheduled refresh, import-mapping AI | **Not done** |
| Admin UI for research settings | **Partial**: limits and providers are environment-driven and visible through `/research/status`; no settings screen yet |
| Clues/explanations for every term | **Done for all sections, fields, columns, tabs, KPIs, statuses (~67% of all strings; remainder are actions/messages)** |

## Tests
`cd artifacts/api-server && npx tsx --test src/services/sales/__tests__/research.test.ts` (13 tests, incl. real-Postgres semantics via PGlite) and `cd artifacts/cintexa && npx tsx --test "src/**/*.test.ts"` (glossary guard: every section name and status has a clue).
Two **pre-existing** failures exist in `src/services/website-intelligence/__tests__/{export,unit}.test.ts`; they fail identically on the untouched repository.
