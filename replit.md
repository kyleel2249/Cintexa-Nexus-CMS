# CINTEXA CMS

AI-powered enterprise CMS admin interface with a visual drag-and-drop page builder.

## Run & Operate (npm)

This project uses **npm workspaces**. Do not use pnpm or yarn.

- `npm run dev` — run the CINTEXA frontend (Vite)
- `npm run dev:api` — run the API server (port 8080)
- `npm run dev:all` — run frontend and API together
- `npm run typecheck` — full typecheck across all packages
- `npm run build` — typecheck + build the frontend app
- `npm run build:app` — build frontend only
- `npm run preview` — preview the production frontend build
- `npm run admin:create` — create an admin user via scripts workspace

Required env:

- `DATABASE_URL` — Postgres connection string
- `OPENROUTER_API_KEY` — optional; enables live AI features (deterministic fallbacks otherwise)
- Firebase client env vars (see `artifacts/cintexa/.env.example`)

## Default Login (after seeding)

- **Admin**: `admin@cintexa.com` / `Admin@123456`
- **Editor**: `sarah@cintexa.com` / `Editor@123456`

## Stack

- npm workspaces, Node.js 20.19+ (22 LTS recommended), TypeScript 5.9
- Frontend: React 19 + Vite, Tailwind CSS, shadcn/ui, framer-motion, @dnd-kit
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- AI: OpenRouter (openai/gpt-4o-mini) with deterministic fallback
- Validation: Zod, drizzle-zod
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (API), Vite (frontend)

## Where things live

- `artifacts/cintexa/` — React + Vite frontend CMS UI
- `artifacts/api-server/` — Express API server
- `artifacts/api-server/src/routes/` — route handlers
- `lib/db/src/schema/` — Drizzle ORM schema definitions
- `lib/api-spec/` — OpenAPI spec (source of truth for API contract)
- `lib/api-client-react/src/generated/` — auto-generated hooks (do not edit by hand)
- `artifacts/cintexa/src/components/page-builder/` — visual page builder components

## Architecture decisions

- Contract-first API: OpenAPI drives codegen for React Query hooks and Zod validators
- Page builder stores blocks as JSON in the `content` column
- AI routes call OpenRouter with `OPENROUTER_API_KEY`; fall back to deterministic templates if absent
- All routes mounted under `/api/` prefix
- Dark-first UI with indigo (#6366F1) as the primary accent
- Motion: dashboard and key surfaces use Framer Motion for entrance, stagger, and hover animations

## Product

- **Dashboard** — animated stats grid, 30-day traffic chart, subscriber live card, activity feed
- **Sites** — multi-site management
- **Pages** — visual drag-and-drop page builder (Hero, Features, CTA, Text, Image)
- **Posts** — full post editor with publish controls
- **Media, Users, Categories, Menus, Forms, SEO, AI Studio** — full CMS surfaces

## Windows

See `WINDOWS.md` for Command Prompt / PowerShell setup. All scripts are npm-based and Windows-compatible.

## Gotchas

- Prefer `npm install` at the repository root. The preinstall script rejects non-npm package managers.
- Page builder block data is stored as `JSON.stringify(blocks)` in the `content` field.
