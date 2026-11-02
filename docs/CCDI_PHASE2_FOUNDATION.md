# CCDI Phase 2: Platform Foundation

Status: **implemented, not executed.** No dependencies could be installed in the build environment, so
nothing here has been type-checked, linted, built, run against PostgreSQL or tested. See "Verification status".

## Access mode (sign-in is intentionally off)

`CCDI_ACCESS_MODE` on the API server:

| Mode | Behaviour |
|------|-----------|
| `open` (default) | No sign-in. `/api/ccdi/v1/*` is public, permissions and membership are not enforced, actor is recorded as `open-access`. Every response carries `X-CCDI-Access-Mode: open`; the UI shows a banner. |
| `enforced` | Requires an authenticated identity, active organisation membership and the specific permission, all checked on the server. Denials are audited. |

Open mode still: validates input, scopes queries by organisation, audits every change, never returns secrets, and refuses to
grant restricted permissions. Switching to `enforced` needs no code change.

Existing Nexus routes, the legacy login and `apiGuard` are unchanged. `/ccdi/v1` is added to the guard's public list so it can
run its own access logic; this also means the global IP allow-list does not apply to it (it has its own rate limit).

## What was added

- `lib/db/src/ccdi-foundation-schema.ts`: additive, idempotent tables (run by `ensureSchema()` on boot): `ccdi_org_members`,
  `ccdi_settings`, `ccdi_security_policies`, `ccdi_mfa_configs`, `ccdi_auth_events`, `ccdi_credentials`, `ccdi_integrations`,
  `ccdi_ai_providers`, reserved `ccdi_incident_meta` / `ccdi_ai_agent_meta`; audit columns, hash chain and an append-only trigger.
  Existing asset, scan-job, finding and evidence tables from earlier phases already cover those extension points.
- `artifacts/api-server/src/services/ccdi-foundation/`: `access` (context, tenancy, permissions), `audit`, `vault`, `totp`, `seed`, `http`.
- `artifacts/api-server/src/routes/ccdi/v1.ts`: the versioned API. `GET /api/ccdi/v1/docs` lists every route.
- `artifacts/cintexa/src/pages/ccdi/`: shell with the 22-item navigation, plus Users and Access, Integrations (integrations,
  credentials, AI providers), Settings (security settings, audit log, account security). The earlier Command Centre is unchanged
  (`command-centre.tsx`). Modules without a backend are labelled "soon" and are not operational.

## Roles and privilege separation

All 11 requested roles exist. Wildcard roles (`ccdi.org.admin`, `ccdi.platform.admin`) never expand to the restricted
permissions: `ccdi.secrets.reveal`, `ccdi.tools.execute`, `ccdi.pentest.approve`, `ccdi.deploy.production`,
`ccdi.destructive.run`, `ccdi.workers.admin`, `ccdi.cross_tenant.access`. No system role includes them; they must be granted
explicitly. An organisation admin does not inherit platform administration. A caller can only grant permissions they hold.

## Secrets

Values are accepted once, sealed with AES-256-GCM (key from `CCDI_MASTER_KEYS`, ciphertext bound to the row id) and never
returned; the API exposes a masked hint only. Credentials can be rotated, revoked (ciphertext wiped) and soft-deleted. With no
key configured the vault refuses to store anything. This is application-level encryption; **no external KMS or secrets manager
is connected.** `storage: env` credentials reference a `CCDI_*` environment variable by name.

## Audit

Entries are SHA-256 hash-chained and a database trigger rejects UPDATE and DELETE. `GET /audit/verify` recomputes the chain.
Sensitive keys and token patterns are redacted before storage. Rows written before this phase are not hashed.

## Known limitations

- Rate limiting is per process and keyed on `req.ip`; the app sets `trust proxy: true`, so `X-Forwarded-For` can be spoofed.
- MFA (TOTP, recovery codes) is verified on the backend but is not part of any login flow while sign-in is disabled. Passkeys/WebAuthn are not implemented.
- Password reset, account recovery, sessions table and login lockout are not built: they need the sign-in work that was deferred.
- Integration "Check config" never reports a service as connected. AI provider "Test connection" is a real call for OpenAI, Anthropic, Gemini and OpenRouter only.
- PostgreSQL row-level security is not enabled; tenant isolation is application-level.
- Existing platform weaknesses found in review and **not changed** (they concern sign-in): public `POST /api/auth/register` accepts `role: "admin"`,
  the JWT secret falls back to a hardcoded value, an empty `ADMIN_EMAILS` makes every signed-in user an admin, `routes/users.ts` has no
  authorisation, and CORS reflects any origin with credentials. Fix these before enabling real sign-in or going to production.

## Verification status

Run: a TypeScript **syntax** parse of every new and changed file (passed), and a throwaway check of the TOTP (RFC 6238 vectors),
recovery-code, vault (round-trip, key versions, row binding, refusal without a key) and audit-redaction helpers (passed; not committed).

Not run: type-check, lint, production build, database migrations, any API or UI behaviour, automated tests (none were written, at the
owner's instruction), security scans. Dependencies could not be installed in the build environment. Treat the schema, SQL, API routes
and screens as unverified until `npm run typecheck && npm run build` and a run against PostgreSQL succeed.
