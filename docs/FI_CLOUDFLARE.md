# CINTEXA Finance Financial Intelligence — Cloudflare deployment

## What this is

Native financial intelligence inside Nexus:

- **No third-party API keys** (no OpenAI/OpenRouter/FX APIs required)
- **No Firebase**
- API: Cloudflare Pages Function `functions/api/fi/[[path]].ts` → `/api/fi/*`
- UI: `/financial-intelligence/*`
- Engine: deterministic TS (P&amp;L, balance sheet, ratios, health, OLS forecast, scenarios)

## Bindings (optional)

| Binding | Purpose |
|---------|---------|
| `FI_DB` (D1) | Persist journals/FX (schema: `migrations/d1/0001_fi_schema.sql`) |

Without `FI_DB`, data lives in **function isolate memory** (lost on redeploy). Core product still works.

## Local / production

```bash
npm install
npm run build:app
npx wrangler pages deploy artifacts/cintexa/dist/public
```

Ensure Pages project includes `functions/` directory.

## Acceptance (zero keys)

1. Open `/financial-intelligence`
2. Click **Load demo journals** or post entries
3. Dashboard, P&amp;L, ratios, forecast, scenarios work without any API key env vars

## Honesty

Full D1 persistence adapter is schema-ready; runtime store in this version is isolate memory unless you wire `FI_DB` queries. Express is not required for FI endpoints.
