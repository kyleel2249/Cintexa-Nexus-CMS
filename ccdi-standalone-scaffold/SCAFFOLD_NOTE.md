# About this folder

This is a **standalone, self-contained** CCDI Phase 4 scaffold (Firebase Auth/Firestore/Functions + static HTML/CSS/JS, no build step) generated in a separate session, kept entirely independent of the rest of this repository.

**It does not integrate with, replace, or depend on** this repo's existing CCDI implementation described in `../docs/CCDI_PHASE4.md` (which is marked "Implemented on `main`" and uses a completely different stack — TypeScript workspaces, Drizzle ORM, Postgres/Supabase, Cloudflare Pages Functions). The two should not be run together or merged without a deliberate integration decision.

It also does not touch, use, or conflict with the repo-root `firebase.json`, `firestore.rules`, `functions/`, or `README.md` — this folder has its own copies of those filenames for its own independent deployment, scoped entirely to this directory. If you ever do want to deploy *this* scaffold, run Firebase CLI commands from inside `ccdi-standalone-scaffold/`, not the repo root.

See `README.md` in this folder for what it actually contains, and `docs/PHASE4_COMPLETION_REPORT.md` for an honest implemented/simulated/outstanding breakdown of this specific scaffold.
