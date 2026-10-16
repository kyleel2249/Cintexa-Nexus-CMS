# Local mode (no API server)

Website Intelligence runs with **no API server and no database**. Open the page on the deployed Cloudflare Pages site and audit.

## How it decides
On first use the app calls `GET /api/v1/website-audits/meta`.

| Result | Mode |
|---|---|
| Valid JSON with `totalTests` | **Server mode**: everything goes to the API (monitors, share links, browser worker, history in Postgres) |
| Anything else (no `API_ORIGIN`, 502, 404, offline API) | **Local mode** |

No setting is required. Setting `API_ORIGIN` later switches users to server mode automatically.

## What runs where
| Piece | Local mode |
|---|---|
| Crawler, 197 tests, scoring, workflow, recommendations, comparison, exports, PDF | In the browser (same `@workspace/wi-engine` code the server uses) |
| History, findings, tasks, reports | IndexedDB, one database per signed-in user (`cintexa-wi-<uid>`) |
| Fetching other sites | `functions/api/wi-relay.ts` (stateless Pages Function) |
| DNS | DNS-over-HTTPS (`cloudflare-dns.com`); private answers are refused |
| Settings | `localStorage` (`wi.localSettings`) |
| PageSpeed Insights | Called straight from the browser with the user's own key (`wi.pagespeedKey`) |
| Explanations | Deterministic, built from recorded evidence |

## The relay
`GET /api/wi-relay?url=<target>&max=<bytes>` with `Authorization: Bearer <Firebase ID token>`.

- Verifies the Firebase ID token (RS256, Google securetoken keys, audience/issuer = `FIREBASE_PROJECT_ID`, default `cintexa-nexus`).
- GET/HEAD only; http/https; ports 80, 443, 8080, 8443; no URL credentials.
- Refuses literal private/loopback/link-local/CGNAT IPs, `localhost`, `.local`, `.internal`, numeric hosts and itself.
- Never follows redirects: the browser revalidates every hop (scope, robots, SSRF) and calls the relay again.
- Streams the body through a size cap (default 2.5 MB, hard 5 MB), 20 s timeout.
- Returns metadata in `x-wi-*` headers. Stores nothing and logs nothing.
- Optional env: `FIREBASE_PROJECT_ID`, `WI_RELAY_ALLOWED_ORIGINS` (comma separated, for a custom domain).

Deploy: nothing extra. The file is in `functions/api/` and is deployed with the site (the copy in `artifacts/cintexa/functions/api/` is kept identical).

## Limits (stated plainly)
- TLS certificate, expiry, protocol and chain tests: **not tested** (a browser cannot inspect them).
- Compression and transfer size: **inconclusive** (the relay runtime decodes bodies).
- Audits run **only while the tab is open**. A closed tab marks the audit as interrupted; use Retry. A warning is shown if you try to leave during a run.
- History is **per browser and per user**. Clearing site data deletes it. Export CSV/JSON/SARIF or the PDF to keep copies.
- No monitors or scheduled re-audits, no public share links, no authenticated (logged-in) crawling, no headless-browser worker. These need the server edition and answer with a clear message instead of failing.
- Relay traffic is subject to Cloudflare Pages Functions plan limits (free plan: 100,000 requests/day).

## Verification performed
`lib/wi-engine/test/local-mode.test.ts`: a real crawl of a fixture site through the relay wire protocol with the in-memory repository, covering all 15 stages, robots.txt, no form submission, scoring, workflow, tasks, CSV export, gate, retest carry-over, export/import persistence, honest server-only answers, and private-target refusal. `tests/wi-relay.test.ts`: token verification, SSRF, caps, manual redirects.
