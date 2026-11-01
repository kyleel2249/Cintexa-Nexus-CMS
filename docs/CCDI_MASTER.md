# CINTEXA CCDI — Master Handbook (Phase 24)

**Module:** CINTEXA Advanced Cyber Defense & Security Intelligence (CCDI)  
**Repository:** `kyleel2249/Cintexa-Nexus-CMS`  
**Branch:** `main`  
**Current implementation phase:** 24

---

## 1. Executive summary

CCDI is a **secure, modular cybersecurity control plane** integrated into Cintexa Nexus CMS and namespaced under `ccdi_*` tables / `/api/ccdi` routes / `/ccdi` UI.

It provides:

- Multi-tenant organisations, RBAC, audit logging
- Scope + job orchestration with human approval and global kill-switch
- Findings, remediation, SLA, ownership workflows
- Passive adapters (DNS/TLS/HTTP/DNS posture) with findings ingest
- Webhooks (HMAC) + durable outbox
- Reporting (JSON/HTML/PDF text), SIEM NDJSON, Prometheus metrics
- In-app alerts, retention policies, evidence chain-of-custody
- Production readiness assessment endpoint

**What it is not (honest non-claims):**

- Not an autonomous active-scanning botnet
- Not a full ITSM / Jira replacement
- Not a built-in email/SMS gateway
- Not a distributed rate-limit fabric (in-memory single-node limiter only)

---

## 2. Architecture

```
[ Cintexa UI /ccdi ]
        |
        v
[ Express /api/ccdi ] ---- RBAC / audit / kill-switch
        |
        +-- orchestration (scopes, jobs, approvals)
        +-- engines / adapters (passive)
        +-- intelligence (OpenRouter advisory)
        +-- reporting / PDF
        +-- workers protocol (claim/heartbeat/complete)
        +-- webhooks + outbox
        +-- remediation / SLA / alerts / retention
        +-- evidence custody / readiness
        |
        v
[ PostgreSQL ccdi_* tables ]
```

Security boundaries:

1. Tenant isolation via `organization_id`
2. Scope approval before job execution paths
3. Kill-switch blocks new execution
4. Secrets stored as **references only** (`ccdi_secret_refs`)
5. Passive adapters only unless a worker is explicitly configured offline

---

## 3. Phase map (implemented)

| Phase | Capability |
|------:|------------|
| 1–3 | Foundation, schema, orchestration control plane |
| 4–5 | Findings, attack surface, engines |
| 6–7 | Intelligence, reporting |
| 8–9 | Workers protocol, RBAC, Command Centre UI seed |
| 10–11 | Connectors health, webhooks/SIEM |
| 12–14 | Passive adapters + findings ingest |
| 15 | PDF export + durable webhook outbox |
| 16 | Remediation + finding assignment |
| 17 | SLA policies + JSON metrics |
| 18 | Command Centre enrichment + Prometheus |
| 19 | Asset ownership + bulk findings |
| 20 | In-app alerts + subscriptions |
| 21 | Evidence integrity + custody |
| 22 | Retention + rate limit middleware |
| 23 | Production readiness assessment |
| 24 | Master handbook + final phase marker |

---

## 4. Key API surfaces

Base path: `/api/ccdi`

| Area | Examples |
|------|----------|
| Health | `GET /health` |
| Tenancy | `/organizations`, `/assets`, `/scopes`, `/jobs` |
| Findings | `/findings`, `/findings/bulk`, `/findings/:id/assign` |
| Adapters | `/adapters`, run-next passive checks |
| Workers | claim / heartbeat / complete |
| Webhooks | endpoints, outbox process |
| Reporting | reports, `.../export.pdf` |
| Remediation | `/remediation/tasks` |
| SLA / metrics | `/sla`, `/metrics`, `/metrics/prometheus` |
| Alerts | `/alerts`, `/alerts/digest` |
| Evidence | `/evidence/:id/custody`, `/verify` |
| Retention | `/retention`, `/retention/apply` |
| Readiness | `/readiness`, `/readiness/summary` |

UI: `/ccdi` Command Centre (sidebar + dashboard card).

---

## 5. Environment variables

| Variable | Purpose |
|----------|--------|
| `DATABASE_URL` / `POSTGRES_URL` | PostgreSQL |
| `CCDI_RBAC_STRICT` | `true` to enforce RBAC strictly in production |
| `OPENROUTER_API_KEY` | Optional advisory intelligence |
| Existing Nexus auth (Firebase/JWT) | Shared authentication |

No CCDI feature requires embedding raw third-party scanner credentials in the DB — use `ccdi_secret_refs`.

---

## 6. Operational checklist

1. Bootstrap DB (existing Nexus bootstrap applies `ccdi_*` statements).
2. Set `CCDI_RBAC_STRICT=true` in production.
3. Create organisation → approve scopes → register webhooks.
4. Cron: `POST /api/ccdi/webhooks/outbox/process`
5. Cron: `POST /api/ccdi/retention/apply` with dry-run first.
6. Monitor `GET /api/ccdi/metrics/prometheus` and `/readiness`.
7. Keep kill-switch procedure documented for on-call.

---

## 7. Production-readiness stance

Use `GET /api/ccdi/readiness` for an evidence-based report.  
**Pass criteria are technical**, not a substitute for penetration testing, legal authorisation process design, or worker fleet hardening.

---

## 8. Known limitations

- Active scanners require external workers; not shipped as autonomous cloud scanners.
- Rate limiter is single-node memory.
- PDF export is text-oriented (no branded design system).
- Alerting has no built-in SMTP/SMS.
- Optional tables are created lazily on first use of their features.

---

*End of Phase 24 master handbook.*
