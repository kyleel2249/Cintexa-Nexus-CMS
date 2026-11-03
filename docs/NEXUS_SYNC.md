# CINTEXA Nexus — Unified Sync Architecture

## Goals
- **Enter data once** → dependent modules receive events
- **Zero API keys** for native tools
- **No Firebase data plane** (Firestore removed from project config)
- Cloudflare Pages Functions for sync/FI/diary

## Engine
`POST /api/sync/events` — transactional outbox (in-memory; D1 schema `migrations/d1/0003_nexus_sync.sql`)

Fields: `eventType`, `sourceModule`, `entityType`, `entityId`, `payload`, `idempotencyKey`

Handlers fan out via routing table to Business Diary, Financial Intelligence, Dashboard.

## Modules registered
- Sales Management (publisher)
- Financial Intelligence (consumer + publisher)
- Business Diary (consumer + publisher)
- Main Dashboard (consumer)
- CMS (independent content)

## Firebase status
- Removed: `firebase.json`, `firestore.rules`, frontend `firebase` npm dependency
- Remaining: optional **JWT verification** of Firebase ID tokens in Express `auth-middleware` if a Bearer token is presented — **not required** for FI, Diary, Sync, or OPEN_ACCESS bootstrap

## Honest limits
- Full PostgreSQL → D1 migration of Sales/CMS is **not** completed in this change set
- Express API remains available via `API_ORIGIN` for legacy modules
- Isolate memory for CF functions until D1 bindings are configured
