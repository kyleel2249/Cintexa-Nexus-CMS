# Sentinel Key (Secure ID & Password Generator)

Route: `/sentinel-key` (sidebar: System > Sentinel Key; dashboard card "Sentinel Key"). Quick links use `?mode=password|passphrase|id|token|recovery|analyze|safety|vault|overview`. The query carries a mode name only, never a value.

## Where things live
- Engine (no UI, unit-tested): `artifacts/cintexa/src/lib/sentinel-key/` (random, charsets, password, passphrase, wordlist, ids, recovery, analysis, breach, url-check, vault, session-store, clipboard)
- UI: `artifacts/cintexa/src/components/sentinel-key/`, page `artifacts/cintexa/src/pages/sentinel-key/index.tsx`
- Dashboard card: `artifacts/cintexa/src/components/sentinel-key-card.tsx`
- Tests: `tests/sentinel-key.test.ts` (run with `bun test tests/sentinel-key.test.ts`)
- Edited existing files: `App.tsx` (lazy route), `components/layout/Sidebar.tsx` (nav item), `components/layout/Topbar.tsx` (title), `pages/dashboard.tsx` (card)

## Privacy and security model
- All generation, analysis, URL checks and the vault run in the browser. Randomness is `crypto.getRandomValues()` with rejection sampling; `Math.random()` is never used.
- Generated values are not persisted, logged or placed in URLs. Session storage holds counts only.
- Vault: PBKDF2-SHA-256 (600,000 iterations, per-vault 16-byte salt) derives a non-extractable AES-256-GCM key. A fresh 96-bit IV is used on every save. Version and KDF parameters are authenticated as AAD. The master password is never stored or sent. Backups are the same encrypted envelope; imports are size-bounded, schema-validated and decrypted before anything is replaced.
- The optional breach check sends only the first 5 hex characters of a SHA-1 hash to `api.pwnedpasswords.com` (k-anonymity, padded responses). A match means the password is in a known dataset; no match does not prove safety.
- The website checker is heuristic and local. It never labels a site "safe", and it fetches nothing.

## Not implemented (by design or scope)
- No server storage, API routes or database migration: nothing here requires them. Basic generation needs no authentication beyond the existing app shell.
- No cloud sync of the vault. The vault is per browser profile; clearing site data or forgetting the master password loses it unless an encrypted backup exists. There is no recovery.
- No threat-intelligence lookup (it would need a server-side proxy with a protected key and rate limiting).
- Recovery codes are random strings only; no MFA enrolment or verification is implemented.
- Anyone with access to an unlocked device can read an unlocked vault. Malware on the device is out of scope.
- UUID v5, UUID v7 and ULID are identifiers, not secrets.

## Verification performed
- `bun test tests/`: 38 pass (32 Sentinel Key tests covering the engine, URL checker, breach protocol, vault encryption, tampering and malicious backups, plus the 6 existing tests).
- `npx tsc --build` and `tsc -p artifacts/cintexa/tsconfig.json --noEmit`: clean.
- `npm run build --workspace=@workspace/cintexa`: succeeds.
- Headless Chromium smoke test against the production build: generate and reveal a password, website check, vault create/lock/wrong-password/unlock/audit, dashboard card, sidebar link; no page errors.
- Not performed: formal WCAG audit with assistive technology, dependency vulnerability scan, third-party security review.

---

# Update: automatic Vault + History, mandatory aliases

## Behaviour
- Every generator (password, passphrase, ID, token, recovery codes) requires an **alias** (autocomplete over existing aliases, inline create). Generation is disabled until an alias is chosen and the vault is unlocked.
- Flow: `begin` (history event "pending") -> generate -> encrypt in the browser -> `commit` (vault entry + history "saved" in ONE database transaction). Failures at any step mark the event "failed" with a code; the UI reports "Not fully saved" and offers Retry with the same ids (idempotent). The secret is generated only after the history event exists.
- Bulk results (several passwords/IDs, a set of recovery codes) are stored as ONE vault record plus ONE history event (`itemCount` shows the size).
- Tabs and routes: `/sentinel-key` (Generate), `/sentinel-key/vault`, `/sentinel-key/history`, `/sentinel-key/aliases`, plus Analyze, Website safety, Overview. Sidebar and dashboard show Secure Vault, Generation History, Alias Manager and Storage Health.

## Storage and access control
- Tables (`lib/db/src/sentinel-schema.ts`, applied by the existing idempotent bootstrap; the same statements ship as `supabase/migrations/20261030120000_sentinel_key_store.sql`, kept in sync by a test and verified to apply twice on a fresh PostgreSQL 16): `sk_user_keys`, `sk_aliases`, `sk_vault_entries`, `sk_history`, `sk_audit`. Foreign keys, indexes, `owner_id` on every row. No existing table was changed.
- Service code: `artifacts/api-server/src/services/sentinel/` (same code runs on the API server and in the browser). Every statement is scoped by `owner_id`; another owner's ids behave like missing ids (404). API keys are refused. Per-owner rate limits (in-memory per process).
- **Two stores, one contract.** This app has no sign-in, so by default the store runs on-device (PGlite in IndexedDB, one owner per browser profile; same model as the Sales module). Set `VITE_SENTINEL_API_MODE=remote` to use `/api/sentinel/*` on the server instead, where `apiGuard` authentication and per-user scoping apply (Firebase uid or JWT subject).
- Encryption: PBKDF2-SHA-256 600k -> AES-256-GCM, in the browser. AAD binds each ciphertext to its record id and type. The database/server stores ciphertext, IV, KDF parameters and a verifier only. Argon2id is not available in Web Crypto, so PBKDF2 is used.
- NOT encrypted (visible to whoever holds the database): alias names/metadata, credential type, generation settings, tags, notes, dates, counts. Not "zero-knowledge" for metadata. No master-password recovery. The master password CAN be changed (Vault tab): every record is re-encrypted in the browser and swapped with the new key envelope in one atomic server call (`POST /sentinel/key/rotate`); the call is refused, changing nothing, if the set of records changed meanwhile. Older encrypted exports still need the old password.
- Deleting history never deletes the vault record and vice versa unless "both" is explicitly chosen and confirmed. Deleting an alias is refused while records reference it (archive instead); renaming keeps all links (History also keeps the name at generation time).

## Verification performed
- `tsx --test` on `src/services/sentinel/__tests__/sentinel.test.ts`: 16 tests against real PostgreSQL semantics (PGlite): alias required for all five types, vault+history written under the same alias id, ciphertext-only storage, alias reuse, rename, idempotent begin/commit (including concurrent), failure + retry, atomic rollback, cross-user access attempts, independent deletes, pagination/filters, key envelope, API-key/rate-limit behaviour.
- `bun test tests/`: 46 pass, including the client workflow against the real service (alias required, locked vault, begin/generate/encrypt/save failures, safe retries, decryption/AAD checks).
- Typecheck of both apps, production build, and a headless-Chromium run: create master password, inline alias creation, generate, saved banner, open vault record, reveal (masked by default), history, rename propagation, dashboard health tile, sidebar links. No page errors.
- The same 16 service tests also pass against a live PostgreSQL 16 server through the production node-postgres adapter (`SENTINEL_TEST_DATABASE_URL=postgres://... npx tsx --test src/services/sentinel/__tests__/sentinel.test.ts`), including genuinely concurrent commits.
- The Express route was exercised over HTTP against that server (401 unauthenticated, 403 API key, 404 for another user's ids, `Cache-Control: no-store`), using a stand-in for the platform's `apiGuard`.
- axe-core (WCAG 2.0/2.1/2.2 A and AA rule sets) reports 0 violations on all Sentinel Key pages at 1280 and 390 px, with no horizontal overflow. The slider thumbs now carry accessible names (small backward-compatible change to `components/ui/slider.tsx`).
- Not verified: the real `apiGuard` with Firebase/JWT tokens, remote mode in a deployed environment, manual screen-reader and keyboard testing, third-party security review.
- `npm audit --omit=dev` reports 19 findings (2 critical: dompurify, proxy-addr) in the repository's EXISTING dependencies; this work added no dependencies and did not change package files. They need their own review.

## Later additions (verified)
- Master-password change with atomic re-encryption: 3 service/client tests (success, record added mid-rotation, corrupted record/foreign/duplicate ids) plus a browser run (generate, change password, reload, old password rejected, new one unlocks, the same secret decrypts).
- On-device durability: every write transaction now flushes PGlite to IndexedDB before success is reported. Without it a credential saved right before a reload could be lost; the browser run saves, reloads immediately and finds it.
- The Sales module's on-device store (separate code) may have the same flush behaviour; it was not changed or tested here.
