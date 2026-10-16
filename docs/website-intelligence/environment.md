# Environment variables (placeholders only; set real values in your host's secret store)
API host (`artifacts/api-server/.env.example`): existing variables plus
| Variable | Purpose | If unset |
|---|---|---|
| `PAGESPEED_API_KEY` | PageSpeed Insights lab + CrUX field data | Performance tests needing it report `not_tested` with reason |
| `WI_BROWSER_WORKER_URL` / `WI_BROWSER_WORKER_TOKEN` | Browser worker endpoint and bearer token | 11 rendered tests report `not_tested` |
| `WI_REGION` | Label for the audit vantage point | Recorded as unknown |
| `SMTP_HOST/PORT/SECURE/USER/PASS/FROM` | Notification e-mail | In-app and webhooks only |
| `OPENROUTER_API_KEY` | AI explanations (always labelled as AI) | Explain action returns "not configured" |

Worker (`services/wi-browser-worker/.env.example`): `PORT`, `HOST`, `WI_BROWSER_WORKER_TOKEN`, `WI_WORKER_MAX_CONCURRENT`.
Frontend: no new variables.

## Pages Function variables (local mode)
| Variable | Default | Purpose |
|---|---|---|
| `FIREBASE_PROJECT_ID` | `cintexa-nexus` | Audience/issuer checked on the Firebase ID token |
| `WI_RELAY_ALLOWED_ORIGINS` | none | Extra browser origins allowed to call the relay |
