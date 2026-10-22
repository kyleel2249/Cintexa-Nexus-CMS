# Recommendation approval workflow

Every recommendation has a lifecycle that a person controls. It is the contract the Action Agent and the Verification Agent run against: the Action Agent may only act on an approved recommendation, and only independent evidence can mark one verified.

## Statuses
`NEW` → `READY` → `AWAITING_APPROVAL` → `APPROVED` → `IN_PROGRESS` → `IMPLEMENTED` → `VERIFYING` → `VERIFIED`, with `FAILED`, `REJECTED` and `DEFERRED` as side exits. Allowed edges are in `REC_TRANSITIONS` (`lib/wi-core/src/rec-workflow.ts`); anything else is refused.

## Invariants (enforced on the server, tested)
1. **Agents never decide.** An AI agent may propose (`NEW→READY`, `READY→AWAITING_APPROVAL`) and report (`IN_PROGRESS→IMPLEMENTED/FAILED`). It cannot approve, reject, defer or verify, and cannot start or change verification.
2. **Decisions need a person.** Approve, reject and defer require the audit owner or an administrator, with a reason (5+ characters) for reject, defer and revoke. Approval is recorded in `wi_rec_approvals` (who, when, note).
3. **Verified needs independent evidence.** `VERIFIED` is reached by the Verification Agent citing a finished retest or rescan audit in which the test passed, or by the owner/admin with a manual note of 10+ characters. A user-cited audit is checked against that audit's stored results (same site, same owner, finished, test passed or not applicable). An inconclusive result changes nothing.
4. **Approval expires.** `canExecute` (the Action Agent gate) allows work only while the recommendation is `APPROVED` or `IN_PROGRESS`, an approval is recorded, and it is at most 30 days old.
5. **Four-eyes (optional).** With `requireSeparateApprover` on (Settings), the person who requested approval cannot approve it. An administrator can.
6. **No lost updates.** Every change is a compare-and-set on status and version. A stale write returns 409 with the current state. One atomic statement also writes the event log row.
7. **Tenant isolation.** Every endpoint resolves the audit through the owner check first; another user gets 404.

## Verification
- **Retest:** `POST /:id/recommendations/:fp/verify` starts a targeted retest and moves an implemented recommendation to `VERIFYING`. When the retest finishes, the result decides: passed → `VERIFIED`, failed → `FAILED`, inconclusive → unchanged.
- **Rescan:** after every new audit of the same site, `reconcileAfterAudit` carries state forward. An implemented or verifying recommendation whose test now passes is verified; one whose defect is still present is `FAILED`. A defect that merely disappeared is not treated as fixed unless its test ran and passed. A `VERIFIED` item that returns becomes `READY` again (regression). Approved and in-progress items stay as they are.

## API
| Method | Path | Purpose |
|---|---|---|
| GET | `/:id/recommendations` | Items with `workflow`, `allowed` (what this user may do next), `execution` (Action Agent gate), plus status `counts` |
| POST | `/:id/recommendations/:fp/transition` | `{ to, note?, expectedVersion?, evidence? }`. 400 invalid, 403 not permitted, 404 unknown, 409 stale |
| PATCH | `/:id/recommendations/:fp` | `{ assignee }` (owner/admin) |
| GET | `/:id/recommendations/:fp/history` | Event log and approvals |
| POST | `/:id/recommendations/:fp/verify` | Start independent verification (202, returns the retest audit) |

## For agents
Call `executionGate(auditId, fingerprint)` before acting; do not act unless `allowed` is true. Report through `transitionRecommendation` with an `agent` actor, and report verification through `applyVerificationOutcome`. Both are exported from `@workspace/wi-engine`.
