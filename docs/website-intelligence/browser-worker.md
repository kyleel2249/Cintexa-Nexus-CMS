# Browser worker
`artifacts/wi-browser-worker` — Node + Playwright Chromium. Endpoints: `GET /health`, `POST /v1/inspect` `{url, devices:["mobile","desktop"]}` → `{results: BrowserFinding[], version}`. Bearer token auth (constant-time compare); concurrency cap (429 when busy); 20 KB body cap.

**Egress guard** (`guard.mjs`): every browser request is intercepted; scheme, port (80/443/8080/8443), credentials, hostname and **resolved addresses** must be public, otherwise the request is aborted and reported. Fails closed on DNS errors. Run it in an isolated network as defence in depth.

**Measured tests** (11): `func.js_errors`, `func.failed_requests`, `ux.overflow`, `ux.layout` (360/768/1280), `ux.navigation.mobile`, `biz.mobile_conversion`, `a11y.reflow` (320 px), `a11y.target_size` (24 px), `a11y.keyboard`, `a11y.focus.visible`. `a11y.contrast` is computed from rendered colours (WCAG relative luminance; alpha composited through ancestors; 3:1 for large text, 4.5:1 otherwise; up to 400 text elements per page). Text over background images or gradients is skipped and reported as not measured, never guessed.
Heuristic tests say so in their `note`. Keyboard reachability is reported `inconclusive` (full operability needs manual testing).

Tests: `npm test --workspace=@workspace/wi-browser-worker` (needs Chromium; set `CHROMIUM_PATH` if not in Playwright's default location).
