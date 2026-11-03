# Email-to-Diary Intelligence

Native correspondence → structured Business Diary records. **No external AI API keys.**

## Routes
- UI: `/business-diary/email-to-diary`
- API: `POST /api/diary/email/process`, `POST /api/diary/email/approve`, `POST /api/diary/email/fixture-grr`
- Related: `GET /api/diary/opportunities|commitments|organizations|correspondence`

## Engine
`artifacts/cintexa/src/lib/business-diary/extract.ts` — regex/keyword classification, org/contact/date extraction, opportunity & commitment drafts, confidence labels.

## Workflow
1. Paste correspondence (or load Get Remote Ready fixture)
2. Process (local and/or API)
3. Edit Record Configuration
4. Approve and save → diary entry + opportunities + commitments + follow-up + org profile

## Storage
- Runtime: Pages Function store (isolate memory until `DIARY_DB` bound)
- Schema: `migrations/d1/0002_business_diary.sql` + `0004_email_to_diary.sql`

## Get Remote Ready fixture
Loads expected partnership proposal fields; success stays **Pending**; relationship not auto-promoted to Active Partner.
