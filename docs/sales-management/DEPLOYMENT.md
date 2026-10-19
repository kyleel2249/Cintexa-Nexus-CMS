# Deployment

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
