# Deployment

## Default: on-device mode (no API, no sign-in)
The CMS ships with Sales Management running **inside the browser**: the same Sales engine as the API server, on PGlite
(PostgreSQL compiled to WebAssembly) persisted in IndexedDB. Cloudflare Pages alone is enough; no `API_ORIGIN`, no
database server and no sign-in are needed. The device owner is the Sales Administrator.

Consequences (also shown in Sales Settings -> Data & backup):
- Data exists only in that browser profile. Use **Download backup** regularly; **Restore** replaces local data.
- Customer quotation links (`/q/:token`) and public lead forms (`/f/:token`) work only in the same browser profile.
- E-mail/WhatsApp/payment/accounting stay "not connected"; queued items are never reported as sent.
- Background jobs (reminders, expiry, automation retries) run every minute while the app is open and visible.

## Optional: server mode
Build the frontend with `VITE_SALES_API_MODE=remote` and deploy the Express API (Render blueprint / Dockerfile), set
`API_ORIGIN` in Cloudflare Pages. The API still enforces its own authentication; the UI has no sign-in screen.

## Environment variables (API)
| Var | Purpose |
|---|---|
| `SALES_ADMIN_EMAILS` | Comma list of emails auto-provisioned as Sales Admin. **Set before first deploy.** |
| `SALES_PUBLIC_BASE_URL` / `PUBLIC_APP_URL` | Base URL used in customer quotation / lead-form links. |
| `SALES_JOBS=off` | Disable background jobs (outbox, schedules, reminders) on a given instance. |
| `DATABASE_URL` | Existing Postgres; Sales tables are created on boot. |

## Steps
1. On your machine: `npm install && npm run typecheck && npm run build` (not runnable in the build sandbox).
2. Database: nothing to do (boot applies `sales-schema.ts`); for manual/Supabase setups run
   `supabase/migrations/20261019120000_sales_management.sql` (idempotent).
3. API: deploy as before with the new env vars.
4. Frontend (Cloudflare Pages): deploy as before. Ensure the SPA fallback serves `/q/*`, `/f/*`, `/sales/*` (existing `_redirects`).
5. Sign in as a `SALES_ADMIN_EMAILS` user → Sales Management → Settings → configure.

## Rollback
The change is additive. Revert the frontend deploy to hide the UI; set `SALES_JOBS=off` to stop jobs. `sales_*` tables
are independent and can stay or be dropped (`DROP TABLE sales_… CASCADE`) without touching CMS data.

## AI agent network (added 2026-10-23)
1. Run `supabase/migrations/20261023120000_sales_ai_agents.sql` (or just boot the API: the same statements run automatically).
2. Optional AI narration: set `OPENROUTER_API_KEY` on the API server (or use the platform OpenRouter settings), optionally `SALES_AI_MODEL_ECONOMY|STANDARD|REASONING`. Then in Sales Settings → Integrations enable AI **and** allow the external provider. Without this the agents run deterministically and no record data leaves the system.
3. Open `/sales/command-centre` as a Sales Administrator, use **Activate all**, then **Run all agents**. Agents start paused by design.
4. Background scheduling uses the existing Sales job runner (`SALES_JOBS`); with the orchestrator active only it runs on schedule and delegates.
