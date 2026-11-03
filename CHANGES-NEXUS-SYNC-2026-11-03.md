# Nexus Sync + Firebase surface reduction
**Date:** 2026-11-03

- Central `/api/sync/*` outbox with idempotency and module routing
- Dashboard SyncStatusWidget
- FI/Diary demo seeds publish sync events
- Removed firebase.json, firestore.rules, frontend firebase package
- Docs: docs/NEXUS_SYNC.md

Not claimed: complete D1 migration of entire Express/Postgres surface; real-time WebSocket fan-out.
