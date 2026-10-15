# API host setup (fixes "The API backend is unreachable")

The Cloudflare Pages site is static. Every data call goes to `/api/*`, which the Pages Function `functions/api/[[path]].ts` forwards to the Express API at **`API_ORIGIN`**. If `API_ORIGIN` is not set (or the host is down) you get *"The API backend is unreachable"* — on Website Intelligence and on every other data page (content, media, forms, SEO…).

## 1. Deploy the API (one of)
- **Render (blueprint in repo):** Dashboard → New → Blueprint → pick this repo (uses `render.yaml`: Docker web service + Postgres). Enter `ADMIN_EMAILS` (and optional `OPENROUTER_API_KEY`, `PAGESPEED_API_KEY`) when prompted.
- **Any Docker host (Fly.io, Railway, Cloud Run, a VPS):** build the root `Dockerfile`, set the variables from `artifacts/api-server/.env.example` (`DATABASE_URL`, `PORT`, `FIREBASE_PROJECT_ID`, `ADMIN_EMAILS`, `JWT_SECRET`, `PUBLIC_APP_URL`), expose the port.
- Keep **one always-on instance**: audits run in-process and a sleeping/scaled-to-zero host interrupts them.
- Tables (including the 12 `wi_*` tables) are created automatically on first start.

## 2. Point Cloudflare at it
Cloudflare Pages → your project → Settings → Variables and Secrets → add `API_ORIGIN` = `https://<your-api-host>` (no trailing slash, **no `/api`**) for Production → redeploy (or "Retry deployment").

## 3. Verify
Open `https://<your-pages-domain>/api/healthz` — it must return JSON from the API (not the "API backend not configured" stub). Then open Website Intelligence.

## Not verified here
These deployment files were written without being able to run a Docker build or reach any host from the authoring sandbox; check the first deploy's build log.
