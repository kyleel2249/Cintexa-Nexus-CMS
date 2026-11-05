import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { attributeLeadsBySource } from "./attribution";

describe("attributeLeadsBySource", () => {
  it("empty leads", () => {
    const r = attributeLeadsBySource([]);
    assert.equal(r.total, 0);
    assert.equal(r.buckets.length, 0);
  });

  it("groups by source with shares", () => {
    const r = attributeLeadsBySource([
      { source: "Email" },
      { source: "Email" },
      { source: "Social" },
      { source: null },
    ]);
    assert.equal(r.total, 4);
    assert.equal(r.buckets.find((b) => b.source === "Email")?.count, 2);
    assert.equal(r.buckets.find((b) => b.source === "Unspecified")?.count, 1);
    assert.ok(r.limitation.includes("Single source"));
  });
});
