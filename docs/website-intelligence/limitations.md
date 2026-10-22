# Known limitations (stated plainly)
- Audits run in-process; the API host must be always-on and a single instance (no distributed queue).
- Rendered checks need the browser worker; without it they are `not_tested`.
- Colour contrast is measured only for text over solid backgrounds; text over images/gradients is reported as not measured, and hover/focus states are not covered.
- The CI gate endpoint authenticates with a Firebase ID token (no long-lived API keys are issued yet), so pipelines must obtain a short-lived token.
- Keyboard/focus/navigation checks are heuristics; they cannot replace manual accessibility testing and automated tools find only a subset of WCAG issues.
- PageSpeed/CrUX data requires a key; CrUX has no data for low-traffic sites.
- Authenticated-area auditing supports only explicitly authorised, passive scopes; credentials are never stored.
- PDFs are generated client-side with jsPDF; very large audits produce long reports.
- robots.txt disallowed pages are not fetched, so their tests are `blocked`.
- Single-vantage-point measurements: results reflect the API host's region/network.

## Local mode limits
TLS tests are not tested, compression is inconclusive, audits run only while the tab is open, history is per browser, and monitors, share links, authenticated crawling and the browser worker are unavailable. Details: [local-mode.md](local-mode.md).

## Competitor intelligence (stated plainly)
- Discovery needs an approved search API key. Without one, only manual and previously benchmarked competitors exist, and the product says so.
- Topic inference uses titles and descriptions of audited pages (term frequency), not a language model. Sites with little descriptive text yield no queries and an explicit "insufficient evidence" report.
- Geography is inferred only from country-code domains and page language; otherwise it is reported as not measured.
- Classification is heuristic and transparent (thresholds in `lib/wi-core/src/competitors.ts`). "Direct" requires fetched, similar content; an unverified suggestion can never be direct. "Aspirational" is only ever set by a person.
- Competitor pages are sampled passively (home page for discovery; up to 15 pages for a benchmark). Peer medians describe the selected peer set and are never presented as industry averages.
- Registrable-domain detection uses a built-in list of common multi-part suffixes, not the full public suffix list.
- Not implemented: AI-generated competitor suggestions, directory or publication mining, scheduled re-discovery and competitor-change alerts, and page-level competitor comparison. Local mode keeps competitors in memory only and has no search provider.

## Approval workflow (stated plainly)
- The Action Agent itself is not built. The workflow supplies its gate (`executionGate`) and reporting path; nothing applies changes to a site.
- Verification evidence is only as strong as the retest: a passing test shows the checked condition holds on the sampled pages, not that the whole site is fixed. Manual verification is the owner's or an administrator's recorded statement.
- Approvals do not notify anyone yet; reviewers see pending items in the Recommendations page.
- Workflow state is per audit and carried to the next audit of the same site; it is not shared across different sites. Local mode keeps it in memory for the open tab.
- The approval, concurrency and persistence logic is tested (engine tests and against PostgreSQL 16). The React page parses but has not been rendered or type-checked in this environment.
