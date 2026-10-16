# Architecture

```
Browser (React, Cloudflare Pages)
  └─ /website-intelligence/*  ── TanStack Query ──►  /api/*  (Pages Function proxy → API_ORIGIN)
                                                         │
API host (Express 5, always-on)  /api/v1/website-audits ─┤
  routes/website-audits.ts  (auth, ownership, validation)│
  services/website-intelligence/                         ▼
     queue ─► engine (15 stages) ─► crawler ─► safe-fetch (SSRF guard)
                │        │             │
                │        │             └─ robots.txt, sitemap, page-data, html
                │        ├─ analyze-seo / analyze-quality (per page)
                │        ├─ site-infra / site-seo / site-security / site-misc (site-wide)
                │        ├─ integrations (PageSpeed/CrUX), browser-client ──► wi-browser-worker (Playwright, isolated)
                │        └─ explain (OpenRouter, labelled AI), notify (webhooks, SMTP)
                ▼
          store.ts ─► Postgres (wi_* tables, created by ensureSchema)
lib/wi-core (shared, isomorphic): catalogue (197 tests), scoring, findings, workflow, compare, URL/IP classification
Frontend lib: report-pdf.ts + pdf-kit.ts (jsPDF, vector charts, TOC, validation), deliver.ts (Download / Print)
```

## Principles
- **Evidence or nothing.** Each test yields one of 8 statuses (passed, failed, warning, informational, not_applicable, not_tested, blocked, inconclusive) with provenance (measured, observed, inferred, user_supplied, unavailable). A test that could not run is never a pass.
- **Scoring** (`lib/wi-core/src/scoring.ts`): weights SEO 20, performance 15, functionality 15, UX 12, security 12, content 8, accessibility 7, infrastructure 6, analytics 5. Not-applicable is excluded from the denominator; coverage is reported and scores are provisional when coverage is incomplete; a critical-defect gate caps readiness. Scoring is versioned and stored with every audit.
- **Safety.** SSRF: DNS resolved, every answer must be public, IP pinned, redirects revalidated manually, ports 80/443/8080/8443, no URL credentials, size/time caps. robots.txt respected. Public forms are never submitted. Authenticated scope is off unless explicitly authorised; credentials live in memory for the run only and are never persisted.
- **Execution.** Audits run in-process on the API host through a queue; state, events and progress are persisted, and interrupted audits are recovered on restart. The progress shown is real stage state.
- **Workflow.** Findings move open → triaged → planned → in_progress → fixed → retest_required → verified / accepted_risk / dismissed. "Verified" requires a passing retest or documented manual verification. Retests carry workflow state forward by fingerprint.

## Portable engine and ports
`lib/wi-engine` holds the crawler, tests, scoring and the shared HTTP routes. It reaches the outside world only through ports (`configureEngine`): network, repository, settings, browser worker, PageSpeed, notifier, runtime info. The API server wires Node implementations (Postgres, pinned sockets, TLS probe). Local mode wires browser implementations (`MemoryRepo` + IndexedDB, relay fetch, DNS-over-HTTPS). The same route handlers are mounted on Express and on an in-browser router. See [local-mode.md](local-mode.md).
