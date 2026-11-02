# Architecture

## Lifecycle

Every assessment-type action follows the same controlled path described in the Phase 4 spec:

```
USER REQUEST → AUTHENTICATION → RBAC → TENANT VALIDATION → ASSET OWNERSHIP →
SCOPE VALIDATION → POLICY EVALUATION → APPROVAL → ORCHESTRATION →
ISOLATED SCANNER → RESULT VALIDATION → FINDING NORMALISATION →
EVIDENCE STORAGE → AUDIT → REPORT
```

Concretely, in this codebase:

1. **AUTHENTICATION** — Firebase Auth (`public/assets/js/core/auth.js`). Every Cloud Function requires `request.auth`.
2. **RBAC** — custom claims (`{ tenantId, role }`) set server-side only, checked by `functions/src/lib/rbac.js#requireAuthContext` on every callable, and mirrored (for UX only) by `public/assets/js/core/rbac.js`.
3. **TENANT VALIDATION** — every Firestore document carries `tenantId`; `firestore/firestore.rules` denies any read/write where `resource.data.tenantId != request.auth.token.tenantId`.
4. **ASSET OWNERSHIP / SCOPE VALIDATION** — `functions/src/routes/scans.js#requestScan` refuses to create a scan request unless the target asset's `scopeStatus == 'in_scope'`, which only an Admin can set (`firestore.rules` restricts the `scopeStatus`/`lifecycleStatus` fields on `assets` to Admin+).
5. **POLICY EVALUATION / APPROVAL** — scan and discovery requests are created with `status: 'pending_approval'` and can only reach `approved` through `scans-approve` / `discovery-approveJob`, both Admin-gated callables. Pentest engagements require a separate Owner **authorization** step before Admin **approval** (two distinct people/roles by design).
6. **ORCHESTRATION / ISOLATED SCANNER** — intentionally **not implemented** in this build. See "Connector framework and the execution boundary" below.
7. **RESULT VALIDATION / FINDING NORMALISATION** — `functions/src/routes/scans.js#importScanResult` validates each finding has a title+severity, normalizes severity to the five-level enum, and deduplicates against existing findings for the same asset (by CVE ID or near-identical title) before creating new finding documents.
8. **EVIDENCE STORAGE** — `storage.rules` scopes evidence files to `/tenants/{tenantId}/evidence/...`, readable/writable only by that tenant's Analyst+ members.
9. **AUDIT** — `public/assets/js/core/audit.js` (client-triggered actions) and `functions/src/lib/audit.js` (server-side actions) both write append-only `audit_log` documents; `firestore.rules` denies all updates/deletes on that collection.
10. **REPORT** — `functions/src/routes/reports.js#generateReport` returns the tenant-scoped dataset and logs the generation event; `public/assets/js/modules/reports.js` renders it to PDF (jsPDF)/XLSX (SheetJS)/CSV client-side.

## Connector framework and the execution boundary

The spec is explicit that CCDI must never execute scanners directly from the UI, must never bypass approval, and must never fabricate scan results. This build takes the strictest reading of that boundary:

- `connectors` collection = a **registry** entry (tool name, category, endpoint reference, credential reference). `connectors-register` creates it; `connectors-healthCheck` does a plain HTTP reachability probe of the configured endpoint (not the scan target) — nothing more.
- `scans` collection = a **request/approval/result** record. `scans-request` creates a `pending_approval` row. `scans-approve` moves it to `approved`. **Nothing in this codebase moves a scan from `approved` to `in_progress`/`completed` by actually running a tool.**
- `scans-importResult` is the deliberate integration point: once you have your own isolated worker infrastructure (a queue consumer that watches for `status == 'approved'` scans, invokes the real, licensed scanner against the referenced connector endpoint, and produces a structured JSON result), it (or an operator pasting that JSON manually, as the Connectors UI supports today) calls `scans-importResult` to normalize and ingest findings. This is also exactly where Phase 3's "isolated worker" orchestration layer is meant to plug in — this build does not include a worker/queue implementation, only the request/approval/ingestion contract it would use.
- Passive discovery (`discovery-runPassive`) is the one place this build *does* perform a live network-adjacent action, and it is deliberately limited to read-only, non-intrusive public lookups: DNS resolution of the asset's own hostname, and a query to the public certificate-transparency log (crt.sh) about the domain. Neither sends unusual traffic to the asset itself.
- Active discovery (`discovery-requestActive` / `discovery-approveJob`) only creates/approves a job record — it does not perform port or service discovery. That execution is left to your own Phase 3 worker infrastructure for the same reason as scan execution above.

**If you wire up real scanner execution**, keep the contract: your worker should only ever call `scans-importResult` (or an equivalent Cloud Function you add) with a structured result for a scan whose `status == 'approved'`; it should never write directly to `vulnerability_findings` or flip a scan to `approved` itself.

## Tenant isolation model

Single Firestore database, discriminated by `tenantId` on every document (not a subcollection-per-tenant model, to keep cross-asset queries like "all critical findings" simple). This is enforced at three layers:
1. Firestore rules (`sameTenant()` / `incomingSameTenant()` helpers) — the real boundary.
2. Every Cloud Function calls `requireAuthContext()` which throws unless the caller has a `tenantId` claim, and every Firestore read inside a function re-checks `doc.data().tenantId === ctx.tenantId` before returning/mutating anything.
3. Client-side convenience (`core/tenant.js#getTenantId()`) auto-stamps `tenantId` on every create via `core/data.js`, so module code can't forget it — but this is UX, not security.

## Data model

See each module's constants file for enums (`public/assets/js/modules/*/constants.js`) and `public/assets/js/core/data.js#COLLECTIONS` for the full collection list. Key collections: `assets`, `asset_relationships`, `asset_history`, `discovery_jobs`, `attack_surface_observations`, `vulnerability_findings`, `finding_evidence`, `cve_cache`, `connectors`, `scans`, `api_inventory`, `pentest_engagements`, `pentest_notes`, `remediation_tasks`, `retest_records`, `reports`, `audit_log`, `users`, `tenants`.
