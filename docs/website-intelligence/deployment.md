# Deployment
Step-by-step API host instructions (and the fix for "The API backend is unreachable"): [api-host-setup.md](api-host-setup.md). Root `Dockerfile` and `render.yaml` are provided.

1. **Unzip** at the repo root and run `npm install`.
2. **API host** (must be always-on: audits run in-process and are recovered after restarts): deploy `artifacts/api-server` as today. Add the optional variables from [environment.md](environment.md). The `wi_*` tables are created on first start.
3. **Cloudflare Pages**: deploy the SPA exactly as before (`npm run build:app`). `functions/api/[[path]].ts` already proxies `/api/*` to `API_ORIGIN`, so the new routes need no change. No new Pages variables.
4. **Browser worker (optional but needed for rendered checks)**: build `services/wi-browser-worker/Dockerfile`, run it on a host with no route to private networks (Fly.io, Cloud Run, a VM). Set `WI_BROWSER_WORKER_TOKEN`, then set `WI_BROWSER_WORKER_URL` + the same token on the API host. See [browser-worker.md](browser-worker.md).
5. **Firebase**: no rule or hosting change is required; authentication reuses the existing Firebase ID-token verification.
6. **Smoke check**: open `/website-intelligence`, Settings → integrations should show which of PageSpeed / worker / SMTP / AI are configured; run a New Audit against a site you own.

## No API host required
Cloudflare Pages alone is enough. `functions/api/wi-relay.ts` ships with the site; set `FIREBASE_PROJECT_ID` only if your Firebase project id is not `cintexa-nexus`. An API host (see api-host-setup.md) is optional and adds monitors, share links, TLS tests and the browser worker.
