# Financial Intelligence — Gap close (post phase 35)
**Date:** 2026-11-02

## Closed
1. **Sales payment → Finance receipt** — `FinanceProvider.recordPayment`, outbox kind `finance.payment`, enqueue on order payment; bridge posts bank/AR journal + optional invoice allocation.
2. **Credit note posture** — void invoice already posts reversing journals; documented.
3. **FX revaluation disclosure** — `POST /fx/revalue` reports rate + foreign-currency account balances; auto journal deferred until cost bases exist.
4. **Notification delivery** — `POST /intelligence/notifications/deliver` for in-app + optional `FI_NOTIFICATION_WEBHOOK_URL`.
5. **Regression checklist** — `docs/FI_REGRESSION_CHECKLIST.md`.
6. Bootstrap already includes phases 10–35 schema statements.

## Ops
- Revoke any temporary GitHub PAT used for pushes.
- Run readiness + smoke after deploy.
