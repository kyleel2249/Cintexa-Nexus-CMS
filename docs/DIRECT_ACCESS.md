# Direct-access Nexus (no user login)

## Behaviour
- There is **no authentication of any kind**: no login, registration, password, OTP, session, JWT, API key or admin sign-in, and no `AUTH_MODE` switch.
- The `/api/auth/*` routes, `/api/users/:id/set-password` and `/api/settings/api-keys` no longer exist.
- Every request is served as one fixed built-in operator (`open-access`, email from `OPEN_ACCESS_EMAIL`), set in `artifacts/api-server/src/lib/auth-middleware.ts`. Existing records keyed on that identity (Sales members, audit owners, Sentinel records) stay reachable.
- What remains is **not** authentication: an optional IP allow-list and a request rate limit (Settings -> Security).
- The `cms_users` table is kept as a team/author directory. Its legacy `password_hash` and `last_login_at` columns are untouched but no longer read or written.
- Anyone who can reach the URL can read and change everything. If the deployment is public, put Cloudflare Access (or an IP allow-list) in front of it.

## Modules removed from navigation and routes
- Cyber Defense (CCDI) — `/ccdi`
- Content — Sites, Pages, Posts, Calendar, Pipeline
- Media — `/media`
- Taxonomy — Categories, Menus, Forms

Page source files may still exist in the tree for recovery but are **not routed** and **not linked** in the sidebar.

## Preserved
- Sales Management, CINTEXA Finance, Business Diary, Financial Intelligence routes
- Dashboard, Intelligence tools (Agents, Command Centre, Diagnostics, Website Intelligence)
- Audience (Users, Subscribers), System (SEO, Settings, Sentinel Key, etc.)
- `FIN_DB` and business/financial data

## Re-enabling authentication
Not possible by configuration any more; the credential code was removed. Restore it from git history (branch point before this change) if ever needed.
