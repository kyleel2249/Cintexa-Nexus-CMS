# Cintexa Nexus CMS

AI-powered enterprise CMS with a visual page builder, multi-site management, and built-in AI Studio tools that run entirely inside Nexus (no external AI service or API key).

## Requirements

- Node.js **20.19+** (22 LTS recommended)
- **npm 10+** (pnpm and yarn are not supported)
- PostgreSQL (for full API features)
- Git

## Quick start

```bash
git clone https://github.com/kyleel2249/Cintexa-Nexus-CMS.git
cd Cintexa-Nexus-CMS
npm install
npm run typecheck
npm run dev
```

In a second terminal:

```bash
npm run dev:api
```

Or run both:

```bash
npm run dev:all
```

Windows users: follow **[WINDOWS.md](./WINDOWS.md)**.

## Scripts

| Command | Description |
|---|---|
| `npm install` | Install all workspace packages |
| `npm run typecheck` | Typecheck libraries and apps |
| `npm run dev` | Start Vite frontend |
| `npm run dev:api` | Start Express API |
| `npm run dev:all` | Frontend + API together |
| `npm run build` | Typecheck + build frontend |
| `npm run build:app` | Build frontend only |
| `npm run preview` | Preview production frontend |

## Stack

- **Frontend**: React 19, Vite, Tailwind CSS 4, shadcn/ui, Framer Motion, TanStack Query, Wouter
- **API**: Express 5, Drizzle ORM, JWT session auth
- **Database**: PostgreSQL
- **AI Studio**: built-in deterministic generators (content, SEO, titles, blocks) and locally generated cover art; no external API

## License

MIT
