# CINTEXA CMS

AI-powered enterprise CMS admin interface with a visual drag-and-drop page builder.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/scripts run seed` — seed database with demo data (safe to re-run; skips if already seeded)
- `pnpm --filter @workspace/scripts run seed:force` — wipe and re-seed from scratch
- Required env: `DATABASE_URL` — Postgres connection string, `OPENROUTER_API_KEY` — for AI features

## Default Login (after seeding)

- **Admin**: `admin@cintexa.com` / `Admin@123456`
- **Editor**: `sarah@cintexa.com` / `Editor@123456`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Tailwind CSS, shadcn/ui, framer-motion, @dnd-kit
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- AI: OpenRouter (openai/gpt-4o-mini) with deterministic fallback
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/cintexa/` — React + Vite frontend CMS UI
- `artifacts/api-server/` — Express API server
- `artifacts/api-server/src/routes/` — all route handlers (dashboard, sites, pages, posts, media, users, taxonomy, menus, forms, seo, ai)
- `lib/db/src/schema/` — Drizzle ORM schema definitions
- `lib/api-spec/` — OpenAPI spec (source of truth for API contract)
- `lib/api-client-react/src/generated/` — auto-generated hooks and Zod schemas (do not edit)
- `artifacts/cintexa/src/components/page-builder/` — visual page builder components

## Architecture decisions

- Contract-first API: OpenAPI spec drives codegen for both React Query hooks and Zod validators
- Page builder stores blocks as JSON in the `content` column — `htmlToBlocks` parses it back on load
- AI routes call OpenRouter (OpenAI-compatible) with `OPENROUTER_API_KEY`; fall back to deterministic templates if key is absent
- All routes mounted under `/api/` prefix; proxy routes traffic from `/` to the frontend
- Dark-first UI with indigo (#6366F1) as the primary accent

## Product

- **Dashboard** — live stats grid (pages, posts, media, users, sites, forms), 30-day traffic chart, activity feed
- **Sites** — multi-site management with domain, status, and per-site settings
- **Pages** — visual drag-and-drop page builder with Hero, Features, CTA, Text, and Image blocks; AI block generation; raw HTML fallback mode; SEO meta sidebar
- **Posts** — full post editor with author, category, reading time, featured image, publish controls
- **Media Library** — grid view with hover overlays, type filtering, alt text
- **Users** — team management with role badges
- **Categories, Menus, Forms** — CRUD for taxonomy, navigation, and form definitions
- **SEO** — global settings, robots.txt, redirect manager
- **AI Studio** — content generator, SEO optimizer, title suggester (all powered by OpenRouter)

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- `pnpm --filter @workspace/api-spec run codegen` must be re-run after any OpenAPI spec change
- `pnpm --filter @workspace/db run push` must be run after any schema change
- Do NOT run `pnpm dev` at workspace root — use workflow restart instead
- Page builder block data is stored as `JSON.stringify(blocks)` in the `content` field

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
