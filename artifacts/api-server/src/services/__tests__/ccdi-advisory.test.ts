import test from "node:test";
import assert from "node:assert/strict";
import { buildAdvisoryAnswer, rankFindings, matchTopics, findingGuidance } from "../ccdi-advisory";

const f = (title: string, severity: string, extra: any = {}) => ({ title, severity, steps: [], ...extra });

test("findings are ranked by severity, unknown last", () => {
  const r = rankFindings([f("l", "low"), f("x", "weird"), f("c", "critical"), f("h", "high")]);
  assert.deepEqual(r.map((x) => x.title), ["c", "h", "l", "x"]);
});

test("topics match on keywords, max three", () => {
  assert.ok(matchTopics("how do we handle phishing emails?").some((t) => t.id === "phishing"));
  assert.ok(matchTopics("patch password firewall backup log data").length <= 3);
  assert.equal(matchTopics("zzz").length, 0);
});

test("guidance uses only recorded fields", () => {
  const g = findingGuidance(f("t", "high", { cve_id: "CVE-2024-0001", remediation: "Upgrade to 2.1", status: "open" }));
  assert.ok(g.some((l) => l.includes("CVE-2024-0001")));
  assert.ok(g.some((l) => l.includes("Upgrade to 2.1")));
  assert.ok(findingGuidance(f("t", "low")).some((l) => /No remediation is recorded/.test(l)));
});

test("answer excludes resolved findings and never throws on empty input", () => {
  const a = buildAdvisoryAnswer("what first?", [f("Open one", "critical", { status: "open" }), f("Done", "critical", { status: "resolved" })]);
  assert.ok(a.includes("Open one")); assert.ok(!a.includes("Done"));
  assert.equal(typeof buildAdvisoryAnswer("", []), "string");
});
