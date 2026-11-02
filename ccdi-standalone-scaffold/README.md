# CINTEXA CCDI — Phase 4 Core Security Engines

A standalone, deployable scaffold for the CINTEXA Advanced Cyber Defense & Security Intelligence (CCDI) platform's Phase 4 modules: Asset Discovery, Attack Surface Management, Vulnerability Management, Website/Network/API Security assessment workflows, and Controlled Penetration Testing engagement management.

Built with plain HTML/CSS/JavaScript (ES modules, no build step) on the frontend and Firebase (Auth, Firestore, Cloud Functions, Hosting, Storage) on the backend.

## What this is — and isn't

This platform implements the **governance, data management and workflow** layer of a vulnerability-management/GRC product: asset inventory, approval-gated assessment requests, a normalized vulnerability database with CVE/CWE/CVSS tracking, NVD + CISA KEV intelligence sync, remediation/retest tracking, penetration-test engagement and authorization management, and reporting.

**It does not include, and will not include, actual scanning or exploitation logic.** There is no code here that performs port scanning, web vulnerability probing (SQLi/XSS/CSRF/etc.), or any other offensive action against a target. The `connectors` module is a **registry and approval framework** for tools you install and run yourself (OWASP ZAP, Nuclei, Nikto, testssl.sh, Burp, Nmap, OpenVAS, Schemathesis, etc.), under your own authorization — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#connector-framework-and-the-execution-boundary) for exactly where that boundary sits and how to wire in your own scanner-execution worker.

## Quick start

```bash
# 1. Install the Firebase CLI if you don't have it
npm install -g firebase-tools

# 2. Create a Firebase project (console.firebase.google.com) with
#    Authentication (Email/Password), Firestore, Storage and Functions enabled.

# 3. Fill in your project config
#    - public/assets/js/core/firebase-config.js  (web app config)
#    - .firebaserc                                (project ID)
#    - functions/.env or `firebase functions:config:set` (see .env.example)

# 4. Install Cloud Functions dependencies
cd functions && npm install && cd ..

# 5. Log in and deploy
firebase login
firebase deploy
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for full setup, emulator usage, and connector installation notes.

## Project layout

```
public/                      Frontend (static, no build step — open via Firebase Hosting or any static server)
  index.html                 Auth redirect
  login.html                 Sign in / tenant signup
  dashboard.html              \
  assets.html                 |
  attack-surface.html         |  One HTML shell per module; each loads
  vulnerabilities.html        |  assets/js/modules/<module>.js
  website-security.html       |
  network-security.html       |
  api-security.html           |
  connectors.html              /
  pentest.html
  reports.html
  audit.html
  settings.html
  assets/css/main.css         Design system (dark navy/charcoal, cyan + gold accents)
  assets/js/core/              Auth, RBAC, tenant scoping, audit logging, API client, UI kit, layout
  assets/js/modules/            One folder per Phase 4 module

functions/                   Cloud Functions backend (Node 20)
  src/index.js                Callable function exports
  src/lib/                    Shared RBAC + audit helpers
  src/routes/                 One file per domain (tenants, users, assets,
                               discovery, vulnintel, connectors, scans, pentest, reports)

firestore/
  firestore.rules             Tenant isolation + RBAC enforcement (the real trust boundary)
  firestore.indexes.json

storage.rules                 Evidence/attachment storage rules
firebase.json, .firebaserc    Firebase project config
docs/                         Architecture, deployment, and the Phase 4 completion report
```

## Roles

| Role    | Can do |
|---------|--------|
| Owner   | Everything, including user management and pentest authorization |
| Admin   | Approve scans/discovery/engagements, manage connectors, accept risk, manage users' roles (not Owner) |
| Analyst | Manage assets, findings, remediation, request assessments, run passive discovery |
| Tester  | Execute approved assessments, import scan results, log engagement findings |
| Viewer  | Read-only, can generate reports |

Enforced in two places that must stay in sync: `public/assets/js/core/rbac.js` (client-side UX hiding) and `functions/src/lib/rbac.js` + `firestore/firestore.rules` (the actual trust boundary).

## Status

See [docs/PHASE4_COMPLETION_REPORT.md](docs/PHASE4_COMPLETION_REPORT.md) for the detailed, per-module implemented/configured/simulated/unverified breakdown, outstanding items, and what you need to supply (a Firebase project, and your own licensed/installed scanner tools) before this is live in production.
