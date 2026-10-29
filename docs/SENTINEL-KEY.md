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
