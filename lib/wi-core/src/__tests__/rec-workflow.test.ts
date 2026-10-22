import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REC_STATUSES, REC_TRANSITIONS, allowedTransitions, applyTransition, canExecute, carryStatus, emptyRecWorkflow, nextStatusForOutcome, validateRecTransition,
  type RecActor, type RecStatus, type RecWorkflow,
} from "../rec-workflow";

const owner: RecActor = { kind: "user", id: "owner@x.test", isOwner: true };
const admin: RecActor = { kind: "user", id: "admin@x.test", isAdmin: true };
const agent: RecActor = { kind: "agent", id: "action-agent" };
const verifier: RecActor = { kind: "verifier", id: "verification-agent" };
const wf = (status: RecStatus, over: Partial<RecWorkflow> = {}): RecWorkflow => ({ ...emptyRecWorkflow("aud_1", "fp_1"), status, version: 1, ...over });
const ok = (w: RecWorkflow, to: RecStatus, actor: RecActor, extra: Partial<Parameters<typeof validateRecTransition>[1]> = {}, ctx = {}) => validateRecTransition(w, { to, note: "A sufficient note", ...extra }, actor, ctx);

test("every status has a transition entry and no edge points at an unknown status", () => {
  for (const s of REC_STATUSES) { assert.ok(REC_TRANSITIONS[s], s); for (const t of REC_TRANSITIONS[s]) assert.ok(REC_STATUSES.includes(t), `${s}>${t}`); }
});

test("the happy path works end to end with the right actors", () => {
  assert.ok(ok(wf("NEW"), "READY", owner).ok);
  assert.ok(ok(wf("READY"), "AWAITING_APPROVAL", owner).ok);
  assert.ok(ok(wf("AWAITING_APPROVAL", { requestedBy: "x" }), "APPROVED", owner).ok);
  const approved = wf("APPROVED", { decidedBy: owner.id, decidedAt: new Date().toISOString() });
  assert.ok(ok(approved, "IN_PROGRESS", owner).ok);
  assert.ok(ok(wf("IN_PROGRESS"), "IMPLEMENTED", owner).ok);
  assert.ok(ok(wf("IMPLEMENTED"), "VERIFYING", owner).ok);
  assert.ok(ok(wf("VERIFYING"), "VERIFIED", verifier, { evidence: { method: "retest", auditId: "aud_2", outcome: "passed" } }).ok);
});

test("edges that do not exist are refused with a clear message", () => {
  for (const [from, to] of [["NEW", "APPROVED"], ["READY", "IN_PROGRESS"], ["AWAITING_APPROVAL", "IMPLEMENTED"], ["IMPLEMENTED", "VERIFIED"], ["FAILED", "IN_PROGRESS"], ["VERIFIED", "FAILED"]] as const) {
    const r = ok(wf(from), to, owner);
    assert.equal(r.ok, false, `${from}>${to}`);
    if (!r.ok) assert.equal(r.code, "no_edge");
  }
  const same = ok(wf("READY"), "READY", owner);
  assert.equal(same.ok, false);
});

test("an AI agent can propose and report authorised work but never approve, reject, defer or verify", () => {
  assert.ok(ok(wf("NEW"), "READY", agent).ok);
  assert.ok(ok(wf("READY"), "AWAITING_APPROVAL", agent).ok);
  assert.ok(ok(wf("IN_PROGRESS"), "IMPLEMENTED", agent).ok);
  for (const [from, to] of [["AWAITING_APPROVAL", "APPROVED"], ["AWAITING_APPROVAL", "REJECTED"], ["READY", "DEFERRED"], ["APPROVED", "READY"], ["REJECTED", "READY"], ["IMPLEMENTED", "VERIFYING"], ["VERIFYING", "VERIFIED"], ["VERIFYING", "FAILED"]] as const) {
    const r = ok(wf(from), to, agent, { evidence: { method: "retest", auditId: "a", outcome: "passed" } });
    assert.equal(r.ok, false, `${from}>${to}`);
    if (!r.ok) assert.equal(r.code, "agent_forbidden");
  }
});

test("an agent cannot verify its own work even with evidence that looks valid", () => {
  const r = ok(wf("VERIFYING"), "VERIFIED", agent, { evidence: { method: "retest", auditId: "aud_2", outcome: "passed" } });
  assert.equal(r.ok, false);
  const claimed = ok(wf("IMPLEMENTED"), "VERIFIED", verifier, { evidence: { method: "retest", auditId: "aud_2", outcome: "passed" } });
  assert.equal(claimed.ok, false, "must pass through VERIFYING");
});

test("VERIFIED requires passing independent evidence; manual verification needs an owner and a real note", () => {
  assert.equal(ok(wf("VERIFYING"), "VERIFIED", verifier).ok, false);
  assert.equal(ok(wf("VERIFYING"), "VERIFIED", verifier, { evidence: { method: "retest", auditId: "a", outcome: "failed" } }).ok, false);
  assert.equal(ok(wf("VERIFYING"), "VERIFIED", verifier, { evidence: { method: "retest", outcome: "passed" } }).ok, false, "automated evidence must cite an audit");
  assert.equal(ok(wf("VERIFYING"), "VERIFIED", verifier, { evidence: { method: "manual", outcome: "passed", note: "n" } }).ok, false, "the verifier cannot assert manual checks");
  assert.equal(ok(wf("VERIFYING"), "VERIFIED", owner, { evidence: { method: "manual", outcome: "passed" }, note: "ok" }).ok, false);
  assert.ok(ok(wf("VERIFYING"), "VERIFIED", owner, { evidence: { method: "manual", outcome: "passed" }, note: "Checked the live page source and the rendered title." }).ok);
});

test("decisions require an owner or administrator and a recorded reason where one is due", () => {
  const stranger: RecActor = { kind: "user", id: "stranger@x.test" };
  assert.equal(ok(wf("AWAITING_APPROVAL"), "APPROVED", stranger).ok, false);
  assert.equal(validateRecTransition(wf("AWAITING_APPROVAL"), { to: "REJECTED", note: "no" }, owner).ok, false);
  assert.ok(validateRecTransition(wf("AWAITING_APPROVAL"), { to: "REJECTED", note: "Out of scope this quarter" }, owner).ok);
  assert.equal(validateRecTransition(wf("AWAITING_APPROVAL"), { to: "DEFERRED" }, owner).ok, false);
  assert.equal(validateRecTransition(wf("IN_PROGRESS"), { to: "IMPLEMENTED", note: "" }, owner).ok, false);
  assert.equal(validateRecTransition(wf("APPROVED"), { to: "READY", note: "" }, owner).ok, false);
});

test("separate-approver policy blocks self-approval except for administrators", () => {
  const submitted = wf("AWAITING_APPROVAL", { requestedBy: owner.id });
  const strict = { requireSeparateApprover: true };
  const r = ok(submitted, "APPROVED", owner, {}, strict);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "separate_approver");
  assert.ok(ok(submitted, "APPROVED", admin, {}, strict).ok);
  assert.ok(ok(submitted, "APPROVED", owner, {}, {}).ok);
});

test("canExecute refuses anything that is not approved, unexpired and recorded", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  for (const s of REC_STATUSES.filter((x) => x !== "APPROVED" && x !== "IN_PROGRESS")) assert.equal(canExecute(wf(s, { decidedBy: "o", decidedAt: now.toISOString() }), now).allowed, false, s);
  assert.equal(canExecute(wf("APPROVED"), now).allowed, false, "no recorded approval");
  const good = canExecute(wf("APPROVED", { decidedBy: "o@x", decidedAt: "2026-10-10T00:00:00Z" }), now);
  assert.equal(good.allowed, true);
  if (good.allowed) assert.equal(good.approvedBy, "o@x");
  const stale = canExecute(wf("IN_PROGRESS", { decidedBy: "o@x", decidedAt: "2026-08-01T00:00:00Z" }), now);
  assert.equal(stale.allowed, false);
  if (!stale.allowed) assert.match(stale.reason, /expired/);
  assert.equal(validateRecTransition(wf("APPROVED", { decidedBy: "o", decidedAt: "2026-08-01T00:00:00Z" }), { to: "IN_PROGRESS" }, owner, { now }).ok, false);
});

test("applyTransition records who and when, resets approval on reopen, and stamps verification", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const sub = applyTransition(wf("READY"), { to: "AWAITING_APPROVAL" }, owner, now);
  assert.equal(sub.requestedBy, owner.id);
  const dec = applyTransition(wf("AWAITING_APPROVAL"), { to: "APPROVED", note: "Go ahead" }, admin, now);
  assert.deepEqual([dec.decidedBy, dec.decisionNote, dec.decidedAt], [admin.id, "Go ahead", now.toISOString()]);
  const start = applyTransition(wf("APPROVED"), { to: "IN_PROGRESS" }, owner, now);
  assert.equal(start.assignee, owner.id);
  const impl = applyTransition(wf("IN_PROGRESS"), { to: "IMPLEMENTED", note: "Added description" }, agent, now);
  assert.equal(impl.implementedBy, "agent:action-agent");
  const ver = applyTransition(wf("VERIFYING"), { to: "VERIFIED", evidence: { method: "retest", auditId: "aud_2", outcome: "passed" } }, verifier, now);
  assert.equal(ver.verifiedBy, "verifier:verification-agent");
  assert.equal(ver.verification?.auditId, "aud_2");
  const reopen = applyTransition(wf("VERIFIED", { decidedBy: "o", decidedAt: "x", verifiedBy: "v" }), { to: "READY", note: "Regression" }, verifier, now);
  assert.deepEqual([reopen.decidedBy, reopen.verifiedBy, reopen.verification], [null, null, null]);
});

test("allowedTransitions only offers what the server would accept for that actor", () => {
  const allowed = (w: RecWorkflow, a: RecActor) => allowedTransitions(w, a).map((t) => t.to).sort();
  assert.deepEqual(allowed(wf("AWAITING_APPROVAL"), owner), ["APPROVED", "DEFERRED", "READY", "REJECTED"]);
  assert.deepEqual(allowed(wf("AWAITING_APPROVAL"), agent), []);
  assert.deepEqual(allowed(wf("VERIFIED"), owner), [], "only the verifier reopens a verified recommendation");
  assert.ok(allowed(wf("READY"), agent).includes("AWAITING_APPROVAL"));
  assert.ok(!allowed(wf("READY"), agent).includes("APPROVED"));
  const v = allowedTransitions(wf("VERIFYING"), owner).find((t) => t.to === "VERIFIED")!;
  assert.equal(v.needsEvidence, true);
  assert.equal(v.noteRequired, true);
  const rej = allowedTransitions(wf("AWAITING_APPROVAL"), owner).find((t) => t.to === "REJECTED")!;
  assert.deepEqual([rej.noteRequired, rej.confirm], [true, true]);
});

test("verification outcomes and carry-over follow the stated rules", () => {
  assert.equal(nextStatusForOutcome("VERIFYING", "passed"), "VERIFIED");
  assert.equal(nextStatusForOutcome("VERIFYING", "failed"), "FAILED");
  assert.equal(nextStatusForOutcome("VERIFYING", "inconclusive"), null);
  assert.equal(nextStatusForOutcome("IMPLEMENTED", "inconclusive"), "VERIFYING");
  assert.equal(nextStatusForOutcome("APPROVED", "passed"), null);
  assert.equal(nextStatusForOutcome("VERIFIED", "failed"), null);
  assert.deepEqual(carryStatus("APPROVED"), { status: "APPROVED", keepApproval: true, reason: null });
  assert.equal(carryStatus("IN_PROGRESS").keepApproval, true);
  assert.equal(carryStatus("IMPLEMENTED").status, "FAILED");
  assert.equal(carryStatus("VERIFYING").status, "FAILED");
  assert.equal(carryStatus("VERIFIED").status, "READY");
  assert.match(carryStatus("VERIFIED").reason ?? "", /Regression/);
  assert.equal(carryStatus("REJECTED").status, "REJECTED");
  assert.equal(carryStatus("DEFERRED").status, "DEFERRED");
});
