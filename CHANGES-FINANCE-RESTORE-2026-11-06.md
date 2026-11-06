# Finance and Financial Intelligence restored – 2026-11-06

Done on explicit owner instruction ("Restore the Finance and Finance intelligence that was just removed"). This supersedes the 2026-11-02 removal record and the 2026-11-05 reconcile (both kept as history).

Branch `restore/finance-and-fi`, made by reverting commits 8db38b9 and b0f48bb on top of main (096341f).

## Restored
- Finance pages, routes, nav, dashboard widget, API client, engines and tests (`pages/finance`, `components/finance`, `lib/finance`).
- Financial Intelligence pages, widget, API client, engine and nav.
- Pages Functions `functions/api/finance` and `functions/api/fi`, Finance sync wiring in `functions/_lib/nexus-sync.ts`, Sales finance adapter, CSI/Corporate Strategy links to Finance, `tests/finance-sync.test.ts`, docs.
- Database schemas, migrations and data were never removed, so nothing needs restoring there.

## Not restored
No external API or key requirement. A scan of the restored files found none.

## Verified (parse check only)
46 changed TypeScript files parse with 0 syntax errors.

## NOT run
Type-check, tests, production build, e2e, deployment (package downloads are blocked here).

## Heads-up
PR #16 (external-API removal) edits some of the same files (CSI, sync registry, Sales). Merge order may need a small conflict fix. Remove the `kpi-card`/`format/currency` helpers from PR #16 only if Finance code now makes them redundant.
