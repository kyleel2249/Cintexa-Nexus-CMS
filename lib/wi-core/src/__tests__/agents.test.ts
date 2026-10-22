import assert from "node:assert/strict";
import { test } from "node:test";
import { WI_AGENTS } from "../agents";

test("the registry lists all twelve agent roles with unique ids and honest limits", () => {
  assert.equal(WI_AGENTS.length, 12);
  assert.equal(new Set(WI_AGENTS.map((a) => a.id)).size, 12);
  for (const a of WI_AGENTS) { assert.ok(a.purpose.length > 10 && a.limits.length > 10 && a.where.href.startsWith("/")); }
});

test("the Action Agent is described as gated, never as active, and the Recommendations Agent cannot decide", () => {
  assert.equal(WI_AGENTS.find((a) => a.id === "action")?.status, "gated");
  assert.match(WI_AGENTS.find((a) => a.id === "recommendations")!.limits, /cannot approve/);
});
