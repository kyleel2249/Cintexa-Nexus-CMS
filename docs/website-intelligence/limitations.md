# Known limitations (stated plainly)
- Audits run in-process; the API host must be always-on and a single instance (no distributed queue).
- Rendered checks need the browser worker; without it they are `not_tested`.
- Colour contrast (`a11y.contrast`) is not measured; it remains `not_tested`.
- Keyboard/focus/navigation checks are heuristics; they cannot replace manual accessibility testing and automated tools find only a subset of WCAG issues.
- PageSpeed/CrUX data requires a key; CrUX has no data for low-traffic sites.
- Authenticated-area auditing supports only explicitly authorised, passive scopes; credentials are never stored.
- PDFs are generated client-side with jsPDF; very large audits produce long reports.
- robots.txt disallowed pages are not fetched, so their tests are `blocked`.
- Single-vantage-point measurements: results reflect the API host's region/network.
