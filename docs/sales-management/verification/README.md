# Verification harness (not shipped to production)

Browser tests of the Sales UI that run **without** the monorepo's node_modules: wouter, lucide and the shadcn
primitives are replaced by small stubs (`stub-*.tsx`), the real sales router (`dispatch()`) runs on Bun against a
real Postgres, and Chromium drives the pages. It proves the Sales pages, public pages, search, bell and
dashboard widget work end to end. It does **not** replace `npm run typecheck && npm run build`, and it does not
render Sidebar/Topbar/AppLayout.

1. `sh pgup.sh` (starts local Postgres 16 on :54329, DB `cintexa_test`)
2. `bun build.ts && node css.mjs` (bundle + Tailwind CSS into `dist/`)
3. `cd artifacts/api-server && SALES_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/cintexa_test bun ../../docs/sales-management/verification/server.ts &`
4. `PW=<playwright module dir> CHROME=<chromium binary> node smoke.cjs && node flows.cjs`

Paths inside the scripts point at the original scratch location; adjust the constants at the top of each file.
