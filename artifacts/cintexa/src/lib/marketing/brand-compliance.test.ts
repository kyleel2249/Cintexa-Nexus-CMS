import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scanBrandCompliance } from "./brand-compliance";

describe("scanBrandCompliance", () => {
  it("flags empty text as info", () => {
    const issues = scanBrandCompliance("", null, []);
    assert.ok(issues.some((i) => i.id === "empty"));
  });

  it("flags prohibited claim text", () => {
    const issues = scanBrandCompliance(
      "We offer guaranteed results every time.",
      { name: "CINTEXA" } as any,
      [{ id: 1, brand_id: 1, text: "guaranteed results", category: "claim", status: "prohibited", created_at: "", updated_at: "" }],
    );
    assert.ok(issues.some((i) => i.severity === "critical" || i.severity === "warning"));
  });

  it("flags risky performance language", () => {
    const issues = scanBrandCompliance("Get 100% success with our plan.", null, []);
    assert.ok(issues.some((i) => i.message.includes("overstated") || i.severity === "warning"));
  });
});
