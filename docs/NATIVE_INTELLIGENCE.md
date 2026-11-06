# Native Nexus Intelligence Engine

## Absolute rule

**Sales Management, CINTEXA Finance, and Financial Intelligence do not require any external API key.**

No OpenRouter, OpenAI, Anthropic, Gemini, or similar credential is needed to install, configure, or operate these modules.

## Execution model

| Level | Name | Role |
|-------|------|------|
| 1 | **Native engine (primary)** | TypeScript services, PostgreSQL, deterministic algorithms, statistical methods, business rules. Always on. |
| 2 | Enhanced analytics | Historical series, scoring, forecasts, KPIs from ledger and CRM tables. |
| 3 | External generative AI | **Optional only.** Phrasing/narration and internet research when an administrator explicitly enables it **and** a provider key exists. |

If Level 3 is absent, Levels 1–2 continue without interruption and without warning banners that block work.

## Native capabilities (no key)

### Sales
- Full CRM CRUD (leads, accounts, contacts, opportunities, quotations, orders, payments)
- Lead scoring, commission, targets, KPI, pipeline health (`domain/*`)
- Agent **analyzers** (deterministic findings from SQL)
- **Native briefing and context answers** (`agents/native-narration.ts`)
- Public-web enrichment jobs that do not use LLM providers
- PDF/CSV exports where implemented

### Finance
- Double-entry journals, COA, periods, year-end close
- AR/AP, invoices, bills, banking, reconciliation, tax, capital
- Statements, ageing, reports — ledger math only

### Financial Intelligence
- KPI dashboards, ratio packs, stress views, board packs from posted ledger data
- Forecasting modules that use historical series (not generative models)

## Classification of outputs

| Kind | Label in product |
|------|------------------|
| Deterministic calculation | Exact / from ledger |
| Rule-based recommendation | Agent finding / native |
| Statistical forecast | Forecast (with confidence notes) |
| Generative language | Only when external AI is enabled; never implied otherwise |

## Settings

Nexus contains no external AI integration at all: AI Studio, advisory, explanations and agent narration all run on built-in engines.

Sales Settings → Integrations → AI controls optional narration only; default operation is native.
