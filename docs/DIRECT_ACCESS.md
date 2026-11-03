# Direct-access Nexus (no user login)

## Behaviour
- Application opens to the dashboard without login, registration, password, OTP, or JWT requirements for ordinary use.
- API `AUTH_MODE` defaults to **`open`** (`artifacts/api-server/src/lib/auth-middleware.ts`).
- `POST /api/auth/login` and `/register` return **410 Gone**.
- `GET /api/auth/me` returns an open-access admin actor when no credential is present.

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

## Re-enabling authentication (not recommended for this deployment mode)
Set `AUTH_MODE=enforced` and restore login UI — out of scope for direct-access Nexus.
