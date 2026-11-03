# CINTEXA Business Diary

Independent Nexus module for institutional business memory.

## Stack
- Frontend: `/business-diary/*`
- API: Cloudflare Pages Function `functions/api/diary/[[path]].ts` → `/api/diary/*`
- Storage: isolate memory by default; D1 schema in `migrations/d1/0002_business_diary.sql`
- **Zero third-party API keys.** Native rule-based insights.

## Features shipped
- Diary entries CRUD (archive)
- Sales pitch tracker
- Customer feedback + local sentiment
- Follow-ups
- Management decisions
- Case study library (manual)
- Dashboard + insights + simple NL question map
- Sidebar + main dashboard widget

## Deploy
Redeploy Cloudflare Pages including `functions/`. Optional: bind `DIARY_DB` and apply D1 migration.
