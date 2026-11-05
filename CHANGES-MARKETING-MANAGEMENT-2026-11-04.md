# Marketing Management — 2026-11-04

Native Marketing Management module integrated into Cintexa Nexus CMS.

## Foundation (commit 1)
- Sidebar group **Marketing Management** with 18 sections
- Overview dashboard + Campaign Manager (CRUD, lifecycle)
- `/api/marketing/*` + service
- `marketing_*` schema + migration + bootstrap wiring

## Increment 2 (this commit)
- **DB-backed service** using shared Postgres pool with in-memory fallback
- **Content Studio** — list/create/edit content items (types: blog, social, email, etc.)
- **Social Media Manager** — plan posts, copy-ready captions, **manual publish confirmation only**
- Calendar events API (`/marketing/calendar`)
- Content API (`/marketing/content`)
- **MarketingOverviewWidget** on main Nexus dashboard
- Sync outbox emit (best-effort via sales_outbox when present)

## Design principles
- No external marketing platform APIs
- Manual publish confirmation for social/email
- Metrics only from stored records
- Reuses sales leads / media / pages where applicable

## Limits (honest)
- Email builder UI, full SEO manager page, automation engine UI, brand/assets still scaffolded
- Lead generation page will deep-link to Sales leads in a later increment
- Fine-grained marketing:* RBAC rows not yet seeded
