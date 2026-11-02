# Zero API-key transformation — Sales / Finance / Financial Intelligence
**Date:** 2026-11-02  
**Commit target:** main

## Directive

Sales Management, CINTEXA Finance, and Financial Intelligence must operate with **zero external API-key requirements**.

## Audit findings (repository inspection)

| Area | API-key dependency for core ops? | Notes |
|------|----------------------------------|-------|
| Finance services (`services/finance/**`) | **None** | No OpenRouter/OpenAI imports. Ledger, journals, AR/AP, bank, tax, capital are pure SQL/TS. |
| FI UI + finance intelligence modules | **None** | KPIs from posted ledger; no provider calls. |
| Sales CRM CRUD / domain scoring | **None** | Domain modules are deterministic. |
| Sales agent **analyzers** | **None** | SQL findings; no LLM required to run agents. |
| Sales agent **narration** (briefing headline) | Was optional external | If AI disabled or key missing, status was `unavailable` with empty headline. **Fixed:** native deterministic briefing always produced. |
| Sales **context assist** | Was optional external | Returned fallback without answer when AI off. **Fixed:** `nativeContextAnswer` always answers from facts/findings. |
| Sales Command Centre UI | Messaging implied OpenRouter for explanations | **Fixed:** native-mode message; keys never required. |
| Platform Settings OpenRouter | Unrelated optional CMS AI | Left in place for AI Studio etc.; **not** gated onto Sales/Finance/FI. |
| `/api/intelligence` (shared CMS intelligence) | Optional LLM via OpenRouter | `buildLlm()` returns null without key; ModelRouter degrades. Not a Sales/Finance/FI blocker. |

Search coverage included: `OPENROUTER`, `OPENAI_API`, `api key required`, `resolveOpenRouter`, sales/finance/FI trees.

## Code changes this deliverable

1. **`agents/native-narration.ts`** (new) — pure deterministic briefing + context answers.
2. **`agents/briefing.ts`** — always returns native briefing; external AI only enhances when enabled + key present.
3. **`agents/context.ts`** — native answers when AI off, policy-refused, or provider error.
4. **`command-centre.tsx`** — zero-key native mode messaging.
5. **`AgentCard.tsx`** — model override clearly optional / leave blank for native.
6. **`sales/settings.tsx`** — policy message no longer says “AI is blocked” as if CRM stopped.
7. **`docs/NATIVE_INTELLIGENCE.md`** — absolute zero-key rule for the three modules.
8. **`__tests__/native-narration.test.ts`** — unit coverage for native engine.

## What was already correct

- Finance double-entry and FI math never called external AI.
- Sales agent network runs analyzers without a provider.
- `AUTH_MODE=open` / local sales mode do not require keys.
- Prior key-normalize work remains for **optional** platform OpenRouter settings only.

## Tests

| Test | Result |
|------|--------|
| Native briefing pure logic | **PASS** (this session) |
| Finance openrouter import scan | **PASS** (zero matches) |
| FI frontend openrouter scan | **PASS** (zero matches) |
| Full PGlite sales/finance suites | **NOT TESTED** (deps not installed in this environment) |
| Browser E2E zero-key | **NOT TESTED** |
| Production build | **NOT TESTED** |

## Acceptance (honest)

- [x] No API key required for Finance core services (verified by code search)
- [x] No API key required for FI core services (verified by code search)
- [x] No API key required for Sales CRM + agent analyzers (verified)
- [x] Native briefing/context without external AI (implemented)
- [x] UI does not instruct users that OpenRouter is needed for agents
- [ ] Full browser workflow suite — **NOT TESTED** here
- [ ] Full production build — **NOT TESTED** here

## Deploy

Merge/push this commit to `main`. Cloudflare Pages / Render pick up from GitHub if linked. No new env vars required for Sales/Finance/FI. Optional `OPENROUTER_API_KEY` remains only for unrelated optional CMS AI features.
