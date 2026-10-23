# Sales AI Agent Network & Command Centre

Added 2026-10-23. Extends the Sales Management module; nothing existing was removed or renamed.

## Where to find it
* **Sidebar → Sales Management → Sales AI Command Centre** (pinned under the 22 sections; shows a badge with the number of approvals waiting). Also in the Cmd/Ctrl+K search, and as a banner on Sales Overview.
* Direct URL: `/sales/command-centre` (tabs: Agents, Findings, Approvals, Activity, Executive briefing). Reps without network access see **My findings**.
* "Ask about this record" appears at the bottom of Opportunity, Account, Lead and Quotation pages.
* If you do not see it after updating: hard-refresh (Ctrl+Shift+R) so the new bundle loads; in remote-API mode deploy the API too (the sidebar entry is shown only when the server reports the `agents:read` permission).

## What it is
24 specialised agents (`artifacts/api-server/src/services/sales/agents/`), one orchestrator, a durable event bus, a generic approval
framework, an executive briefing, a record-aware assistant and a Command Centre UI (`/sales/command-centre`, linked from Sales Overview).

**Design rule: the agents' analysis is deterministic code over your records. AI (optional) only phrases text.** An AI model can never
create a finding, change a number, approve anything, or touch a record. Its output is validated against a schema, stripped of markup and
links, and stored as an inert "AI-written explanation" beside the facts.

## The agents
| # | Key | Level (default / max) | What it checks |
|---|-----|-----|----|
| 1 | chief_orchestrator | 2 / 2 | Runs the others in dependency order; supersedes duplicate proposals; raises records flagged by ≥2 agents; escalates critical findings to leaders (internal notification); verifies outcomes; builds the briefing |
| 2 | sales_operations | 2 / 3 | Stalled deals, unassigned leads (+assignment proposal), duplicate accounts, slow quotations, blocked orders, overdue backlogs |
| 3 | lead_enrichment | 1 / 2 | Missing/invalid lead data (unknown stays unknown), duplicates, likely account matches; no external enrichment provider is connected |
| 4 | lead_qualification | 2 / 2 | BANT-style coverage from recorded fields, explains scores, recommends qualify/convert (never converts silently) |
| 5 | account_intelligence | 1 / 2 | Revenue concentration, account health, same-industry cross-sell evidence, unresolved complaints |
| 6 | contact_relationship | 1 / 1 | No/single/unreachable contacts on open deals, consent gaps, duplicates (title ≠ authority) |
| 7 | opportunity_pipeline | 2 / 2 | Transparent deal-health score (every deduction listed), unusual stage moves, coverage vs target, historical win rate |
| 8 | activities_followup | 3 / 3 | Overdue activities; deals/leads with no next step → internal follow-up tasks (auto-created, de-duplicated) |
| 9 | targets_quotas | 1 / 2 | Booked revenue vs approved targets, gap sizing; booked/invoiced/collected never mixed |
| 10 | product_pricebook | 1 / 1 | Unpriced products, expired price books, discounts beyond policy, low margin, outdated list prices |
| 11 | quotation_proposal | 2 / 2 | Recomputes totals deterministically, expiring-quotation reminders (consent-checked, approval required), outcomes |
| 12 | sales_order | 1 / 2 | Late delivery, blocked stock, overdue payment, totals mismatch, duplicate orders (recorded data only) |
| 13 | sales_forecasting | 1 / 2 | Worst/expected/best forecast with assumptions, Wilson CI only with enough data, accuracy from snapshots |
| 14 | performance_coaching | 1 / 1 | Peer-median comparison with minimum sample; no causal claims |
| 15 | territory_team | 1 / 1 | Workload skew, records without territory, records owned by inactive members |
| 16 | commissions_incentives | 1 / 1 | Missing entries, anomalies, approval backlog. Cannot calculate, approve or release |
| 17 | retention_expansion | 3 / 3 | Renewals, overdue reorders, silent customers, growing accounts; alerts owners |
| 18 | campaign_intelligence | 1 / 1 | Cost per lead, return where spend exists, fatigue; cannot send anything |
| 19 | competitor_intelligence | 1 / 1 | Competitors frequent in lost deals, unverified/outdated evidence. **No public-web discovery** (no research provider installed) |
| 20 | reporting_analytics | 1 / 1 | Headline metrics with definition/period/source/aggregation; unusual swings |
| 21 | automation_workflow | 1 / 1 | Failing rules, failed outbox, dead events, stuck approvals, failing agents |
| 22 | playback_training | 1 / 1 | Meeting-note coverage, loss reasons without playbook guidance, incomplete training. **No recordings/transcripts exist to analyse** |
| 23 | document_intelligence | 1 / 1 | Multiple active versions, unlinked documents, accepted-but-unconverted quotations. Metadata only; document text is never read |
| 24 | admin_governance | 1 / 1 | No admin, enabled-but-missing integrations, stage probabilities, discount limits, autonomy, approval backlog |

Agents start **paused** (secure default). Tools and data access are fixed in code (`agents/catalog.ts`); the API has no field to change them.

## Autonomy and approvals
* **L1 Observe** – findings only. **L2 Prepare** – also creates approval requests (nothing executes). **L3 Execute** – may run internal actions the policy allows without approval.
* Approval states: PENDING, APPROVED, REJECTED, EXECUTING, COMPLETED, FAILED, CANCELLED, EXPIRED.
* An approval stores the exact payload (SHA-256) and a fingerprint of the record's material fields. Execution re-checks: not expired, payload unchanged, record unchanged, live business rules. A change voids the approval. A failed or interrupted execution is **never** retried automatically.
* Protected (cannot be made automatic, DB-enforced): customer messages, campaign publishing, price changes, exceptional discounts, final proposals, order confirmation, commission rule changes/release, record deletion, permission changes, sensitive exports. Policies live in `sales_approval_policies` (editable by `agents:manage`, audited).
* Built-in executors: internal follow-up task, internal notification, lead assignment, customer email (**queued via the outbox; reported as queued, never as sent**). Other approved actions are decisions a person performs and attests ("Record as completed", stored as manual).
* Nobody can approve a request they made; finance-gated actions need finance or an administrator.

## Event bus
Committed domain events are stored in `sales_events`, processed by the scheduler (or "Process pending now"), consumed idempotently (event id + agent), retried with back-off up to 5 times, then dead-lettered. Agent-caused events are never dispatched to agents (no recursion).

## AI configuration
Off by default and inert until **all** of: Sales Settings → Integrations → AI enabled, "allow external provider" on, and a key is available to the server (platform OpenRouter settings or `OPENROUTER_API_KEY`). Models: tier defaults `openai/gpt-4o-mini` (economy), `anthropic/claude-3.5-haiku` (standard), `anthropic/claude-3.7-sonnet` (reasoning), overridable per tier with `SALES_AI_MODEL_ECONOMY|STANDARD|REASONING` and per agent in the Command Centre. Chain: agent model → tier model → fallback model → platform default. 6 AI calls/agent/hour cap. Usage is logged in `sales_ai_usage`; tokens and provider-reported cost appear per execution. **Model ids change over time – confirm the defaults exist on your OpenRouter account.**
Never commit a key; if a key was ever pasted into a chat or ticket, rotate it.

## API (all under `/api/sales`)
`GET /agents/command-centre`, `GET /agents`, `GET|PATCH /agents/:key`, `POST /agents/:key/(enable|pause|resume|disable|run)`, `POST /agents/bulk`, `POST /agents/orchestrate`,
`GET /agents/(tasks|executions|executions/:id|events|recommendations|briefing|my-actions)`, `POST /agents/recommendations/:id/(accept|dismiss)`, `POST /agents/events/(process|:id/retry|:id/ignore)`,
`GET /approvals[/:id]`, `POST /approvals/:id/(approve|reject|cancel|execute|complete-manually)`, `GET|PATCH /approval-policies[/:action]`, `POST /ai/context-assist`.
Permissions: `agents:read` (own findings), `agents:run` (network view), `agents:manage`, `approvals:read`, `approvals:decide`.

## Verification actually performed (see ACCEPTANCE addendum)
* API: `tsc` clean; 36 new agent tests + all earlier Sales tests pass on PostgreSQL 16 (179 tests run, 176 pass; the 3 failures are pre-existing website-intelligence authorisation tests unrelated to Sales and failed identically before these changes).
* On-device: the same agent flows pass on PGlite (WebAssembly Postgres) in Node.
* Migration `20261023120000_sales_ai_agents.sql` applied twice to a clean database.
* Frontend: `tsc` clean; production `vite build` succeeds; the real sidebar, Overview banner and Command Centre were rendered in jsdom on top of the on-device engine (24 agent cards, activate all, run network, all tabs) without errors.

## Not verified / limitations (honest)
* **No live call to OpenRouter was made** (the build sandbox has no route to it). The adapter is unit-tested against a stubbed `fetch` (auth header, usage/cost parsing, retries, timeouts, no key leakage). Do one real call in staging.
* The Command Centre UI was rendered in jsdom (real React + the on-device engine) but **not opened in a real browser with real styling/layout**; check the visual layout on desktop and phone.
* No data-enrichment, public-web research, call-recording or document-text extraction provider exists, so those capabilities are reported as unavailable instead of simulated.
* Single-tenant deployment: isolation is role- and ownership-based (as in the existing module), not multi-organisation.
* "Sales Playbook & Training" keeps its existing label (the brief says "Playback"); rename in `lib/sales/nav.ts` if intended.
