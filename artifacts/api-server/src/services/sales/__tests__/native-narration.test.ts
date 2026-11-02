import assert from "node:assert/strict";
import { nativeBriefing, nativeContextAnswer } from "../agents/native-narration";

/** Zero-API-key: native narration never needs external providers. */
export function test_native_briefing_empty() {
  const b = nativeBriefing([]);
  assert.equal(b.status, "native_deterministic");
  assert.ok(b.headline.length > 0);
  assert.ok(b.summary.length > 0);
}

export function test_native_briefing_from_findings() {
  const b = nativeBriefing([
    { title: "Stale lead cluster", whatDetected: "12 leads idle > 14 days", whyItMatters: "Pipeline leakage", action: "Assign follow-ups", severity: "high", priority: 90 },
    { title: "Concentration risk", whatDetected: "One account is 40% of open pipeline", priority: 50 },
  ]);
  assert.match(b.headline, /Stale lead/i);
  assert.match(b.summary, /12 leads/i);
  assert.match(b.summary, /Concentration/i);
}

export function test_native_context_answer() {
  const a = nativeContextAnswer(
    "What follow-up is needed?",
    { name: "Acme Ltd", stage: "proposal" },
    [{ title: "Follow-up overdue", whatDetected: "No activity in 10 days", action: "Call the buyer" }],
  );
  assert.match(a, /Call the buyer|No activity/i);
}

export function test_native_context_no_invention() {
  const a = nativeContextAnswer("What is their CEO salary?", { name: "Acme" }, []);
  assert.ok(!/CEO salary is \d/i.test(a));
  assert.match(a, /Insufficient|Record fields|Ask a specific/i);
}

// Run when executed directly
test_native_briefing_empty();
test_native_briefing_from_findings();
test_native_context_answer();
test_native_context_no_invention();
console.log("native-narration.test.ts: PASS");
