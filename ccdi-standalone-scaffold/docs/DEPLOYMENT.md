# Deployment

## 1. Prerequisites

- Node.js 20+
- `npm install -g firebase-tools`
- A Firebase project (Blaze/pay-as-you-go plan — required for Cloud Functions to make outbound HTTP calls to NVD/CISA/crt.sh)

## 2. Firebase project setup

1. Create a project at console.firebase.google.com.
2. Enable **Authentication → Email/Password**.
3. Enable **Firestore** (Native mode, choose a region).
4. Enable **Storage**.
5. Note your web app config: Project settings → General → "Your apps" → add a Web app → copy the config object.

## 3. Configure this repo

- `public/assets/js/core/firebase-config.js` — paste your web app config into `firebaseConfig`.
- `.firebaserc` — replace `YOUR_FIREBASE_PROJECT_ID` with your project ID.
- `functions/` — `cd functions && npm install`.

## 4. First deploy

```bash
firebase login
firebase deploy --only firestore:rules,firestore:indexes,storage,functions,hosting
```

The very first user to sign up (login.html → "Create tenant") automatically becomes that tenant's **Owner** via `tenants-bootstrap`. Every subsequent user must be invited from Settings.

## 5. Local development (emulators)

```bash
cd functions && npm install && cd ..
firebase emulators:start --only auth,firestore,functions,storage,hosting
```

Set `USE_EMULATORS = true` in `public/assets/js/core/firebase-config.js` while developing locally, and serve `public/` through the Hosting emulator (`http://localhost:5000`) rather than opening the HTML files directly, since ES module `fetch`/Firestore SDK calls need a real origin.

## 6. Installing & wiring external scanners (optional, your own infrastructure)

CCDI's Connectors page only *registers* these tools and records an endpoint + credential reference — it does not install or run them. To actually execute assessments:

1. Stand up the tool yourself (examples):
   - **OWASP ZAP**: run in daemon mode with its REST API enabled (`zap.sh -daemon -port 8090 -config api.key=...`).
   - **Nuclei**: install the CLI (`go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest`) behind your own runner service that exposes an HTTP trigger.
   - **Nikto / testssl.sh**: install per their own docs; wrap with a small runner service.
   - **Burp Suite Enterprise**: requires a commercial license; use its REST API.
   - **Nmap / OpenVAS (Greenbone)**: install per vendor docs; OpenVAS requires its own feed sync and GVM daemon.
   - **Schemathesis**: `pip install schemathesis`, run against an OpenAPI schema from a runner service.
2. Register the tool on the **Connectors** page with its reachable endpoint and a credential *reference* (store the actual secret in Google Secret Manager; never paste a raw key into the app).
3. Build a worker (outside this repo, or as an additional Cloud Run service / Cloud Function you add) that:
   - Watches `scans` documents where `status == 'approved'`.
   - Invokes the real tool against the connector's endpoint, within the profile's scope/rate limits.
   - Calls the `scans-importResult` callable with the structured result once finished.
   - Flips the scan to `in_progress` while running (direct Firestore write from a trusted service account is appropriate here, since the worker itself is the orchestration layer Phase 3 describes).
4. Until step 3 exists, the **Connectors → Import result** modal lets an authorized operator paste a JSON result manually (e.g. ZAP's JSON report, or a hand-normalized summary) to exercise the full ingestion → normalization → dedup → finding pipeline end-to-end.

## 7. Email delivery for invites

`functions/src/routes/users.js#inviteUser` creates the invite record and attaches an existing Firebase Auth account immediately, but does not send an email. Wire in a transactional email provider (SendGrid, Postmark, etc.) of your choice inside that function — the invite record and token scaffolding is already there (`tenant_invites` collection).

## 8. Environment variables

Copy `.env.example`. For Cloud Functions runtime config in 2nd-gen functions, use `.env` files in `functions/` (loaded automatically by the Functions Framework) rather than the deprecated `functions:config:set`.
