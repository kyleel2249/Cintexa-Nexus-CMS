# CCDI Phase 5 — Advanced Security Engines

## Honest status: PARTIALLY COMPLETE (foundation only)

Phase 5 on `main` is a **job-drafting and finding-recording foundation**. It is not
the full engine set described in the Phase 5 specification. Nothing here executes a
security tool, and no scan results exist unless a human records them.

### Implemented
- Engine catalogue (`GET /api/ccdi/advanced/engines`).
- Draft assessment creation through the Phase 3 orchestrator
  (`POST /api/ccdi/advanced/assessments`) — approved scope required, human approval
  required before queueing, kill-switch honoured.
- Domain finding recording (`POST /api/ccdi/advanced/findings`) into the shared
  Phase 4 `ccdi_findings` table.
- Pure validation / safety rules (`services/ccdi-advanced-validation.ts`).

### Not implemented (required by the Phase 5 specification)
- Dedicated data models, inventories and migrations: cloud accounts/resources, server
  inventory, container images/registries, Kubernetes resources, SBOMs, mobile apps and
  packages, database instances, IoT/OT devices, firmware records, assessment profiles,
  retests, evidence references.
- Tool adapters (Prowler, ScoutSuite, Checkov, OpenSCAP, Lynis, Trivy, Grype, Syft,
  kube-bench, Falco, MobSF, JADX, Apktool, Frida, Objection, Binwalk, EMBA, Ghidra, YARA).
  No tool is installed, configured, connected, executed or validated.
- Mobile package intake and isolated analysis; firmware analysis.
- Asset relationship graph; unified risk model; deduplication across scanners.
- Frontend sections for the six engines.
- Per-engine and consolidated PDF/CSV/XLSX reports.
- Integration, security and end-to-end acceptance tests (only unit tests exist).

## API
| Method | Path | Permission |
|--------|------|------------|
| GET | `/api/ccdi/advanced/engines` | `ccdi.jobs.view` |
| POST | `/api/ccdi/advanced/assessments` | `ccdi.jobs.request` |
| POST | `/api/ccdi/advanced/findings` | `ccdi.findings.manage` |

## Safety rules enforced in code
- `scopeId` is mandatory; the scope must be approved and unexpired (orchestrator).
- Referenced assets must belong to the organisation and not be retired/rejected.
  The error is identical for missing and cross-tenant assets (no tenant probing).
- No engine maps to `port_scan`. IoT/OT is **passive by default**; `mode: "active"`
  is rejected unless `parameters.otAuthorisation` carries system-owner permission,
  an approved test procedure, a qualified OT reviewer and a valid maintenance window,
  and is then flagged `requiresAdditionalApproval` / `requiresQualifiedOtReview`.
- `sqlmap`, `metasploit`, `hydra`, `masscan`, `nmap` and `shodan` are refused as
  connectors. Frida/Objection require `mobile_scan` and
  `parameters.authorisedTestApplication = true`.
- Callers cannot set `engine`, `phase`, `approved`, `approvedBy`, `scopeValidated`.
- Connector hints are registry suggestions only; they do not mean a tool is operational.

## Defects found in the review and fixed
| # | Defect | Fix |
|---|--------|-----|
| 1 | Phase 5 routes had authentication only: no RBAC permission check | Added `ccdi.jobs.request`, `ccdi.findings.manage`, `ccdi.jobs.view` |
| 2 | `iot_scan` mapped to `port_scan` (active scanning of OT/IoT) | Maps to `config_audit`; passive-by-default guard added |
| 3 | `sqlmap`, `nmap`, `shodan` advertised as connector hints | Removed; refused as connectors |
| 4 | `scopeId` was optional end-to-end (`createJob` skips scope checks without it) | Mandatory for Phase 5 |
| 5 | `assetId` / `jobId` on findings not tied to the organisation | Ownership verified |
| 6 | Invalid `severity` hit the DB CHECK and returned a generic 500 | Validated, returns 400 |
| 7 | Unknown `connectorKey` silently ignored (job created with no connector) | Returns 404; disabled → 409 |
| 8 | No dedicated audit record for advanced assessments | `advanced.assessment.request` audit row |
| 9 | **Cross-phase:** routes required `ccdi.job.approve`, `ccdi.scope.approve`, `ccdi.job.execute`, none of which are seeded (seed uses `.jobs.` / `.scopes.`), so role-based approval could never match | Routes now use seeded codes; added seeded `ccdi.jobs.execute` (super_administrator, security_director only). Regression test added |

Defect 9 touches Phase 3/9 code (`index.ts`, `phase25.ts`, `adapters.ts`, `ccdi-schema.ts`)
as a minimum compatibility correction because the Phase 5 approval gate depends on it.
After deploying, run `POST /api/ccdi/rbac/seed` so the new permission is written.

## Known issues NOT changed (shared Phase 3/4 code — need a decision)
- `upsertFinding` fingerprint excludes `sourceConnector`, and its `ON CONFLICT` update
  overwrites `severity`. Findings from different scanners can merge and a later
  `info` can overwrite an earlier `critical`. This conflicts with the specification
  ("do not silently overwrite findings from different scanners").
- `requireCcdiPermission` allows any authenticated user with **zero** CCDI roles unless
  `CCDI_STRICT_RBAC=1` (documented "open-access mode"). Set it in any real deployment.
- `userHasCcdiPermission` matches a role in *any* organisation when no `organizationId`
  is supplied; routes must always require `organizationId`.
- `validateTargetsAgainstScope` only enforces the asset allow-list for object targets
  that carry an `assetId`/`id`; plain string targets are only checked against exclusions.

## Verification status
- Executed and passing: 20 unit tests (`ccdi-advanced-validation.test.ts`), including
  an RBAC regression test confirmed to fail on the original code.
- **Not executed:** full TypeScript typecheck, API route tests, database/migration
  tests, frontend build. The review environment could not install the project's
  dependencies (the npm registry was blocked by the sandbox's egress policy), so
  `express`, `@types/node` and the pinned TypeScript were unavailable.
  Run `npm install && npm run typecheck && npm test --workspace=@workspace/api-server`
  before merging.

## Next
Phase 6 starts only on explicit instruction: `APPROVED — PROCEED TO PHASE 6`.
