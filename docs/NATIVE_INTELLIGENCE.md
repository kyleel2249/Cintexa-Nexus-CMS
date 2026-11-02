# Native Nexus Intelligence Engine

## Purpose

Core business operations in CINTEXA Nexus **must not** require OpenRouter, OpenAI, or any external AI API key.

## Execution levels

| Level | Name | When used |
|-------|------|-----------|
| 1 | Native engine | Always available. TypeScript services, PostgreSQL, deterministic algorithms. |
| 2 | Enhanced intelligence | Historical data, statistical methods, rule engines (lead scoring, forecasts, KPIs). |
| 3 | External AI | Optional OpenRouter / other providers for language generation and research. |

If Level 3 is unavailable, Levels 1–2 continue without interruption.

## What already runs natively (no API key)

### Sales (`artifacts/api-server/src/services/sales/`)
- CRUD for leads, accounts, contacts, opportunities, quotations, orders, payments
- Lead scoring (`domain/lead-scoring.ts`)
- Commission, targets, KPI, forecast modules
- Agent analyzers fall back to deterministic mode when `resolveKey` returns null

### Finance (`artifacts/api-server/src/services/finance/`)
- Double-entry journals, COA, periods, year-end close
- AR/AP, invoices, bills, banking, reconciliation, tax, capital
- Reports, trial balance, statements, ageing
- Intelligence ops modules use ledger math, not LLMs

### Shared intelligence (`lib/intelligence`)
- `ModelRouter` returns `{ ok: false, degraded: true, reason: 'ai_provider_not_configured' }` when no provider is wired
- Never fabricates research or financial numbers

## Policy

- Do not disable Sales, Finance, or Financial Intelligence UI because a key is missing.
- Do not present degraded/native results as generative AI output.
- External AI is additive (research, autofill prose, free-form diagnostics).
