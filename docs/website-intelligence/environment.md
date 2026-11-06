# Environment variables (placeholders only; set real values in your host's secret store)
API host (`artifacts/api-server/.env.example`): existing variables plus
| Variable | Purpose | If unset |
|---|---|---|
| `WI_BROWSER_WORKER_URL` / `WI_BROWSER_WORKER_TOKEN` | Browser worker endpoint and bearer token | 11 rendered tests report `not_tested` |
| `WI_REGION` | Label for the audit vantage point | Recorded as unknown |
| `SMTP_HOST/PORT/SECURE/USER/PASS/FROM` | Notification e-mail | In-app and webhooks only |

Worker (`services/wi-browser-worker/.env.example`): `PORT`, `HOST`, `WI_BROWSER_WORKER_TOKEN`, `WI_WORKER_MAX_CONCURRENT`.
Frontend: no new variables.

## Pages Function variables (local mode)
| Variable | Default | Purpose |
|---|---|---|
| `WI_RELAY_ALLOWED_ORIGINS` | none | Extra browser origins allowed to call the relay |

## Competitor discovery (API host)
| Variable | Default | Purpose |
|---|---|---|

Neither set = search-based discovery is reported as not configured in Settings and on the Competitors tab. Competitors can still be added by hand. Result pages are never scraped. Setting `autoDiscoverCompetitors` (Settings) controls automatic discovery after each audit and only has an effect when a provider is configured.
