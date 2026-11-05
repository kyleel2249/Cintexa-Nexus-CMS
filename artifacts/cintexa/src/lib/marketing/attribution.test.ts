import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { attributeLeadsBySource, attributeConversionByTouchpoints } from "./attribution";

describe("attributeLeadsBySource", () => {
  it("empty leads", () => {
    const r = attributeLeadsBySource([]);
    assert.equal(r.total, 0);
  });
  it("groups by source", () => {
    const r = attributeLeadsBySource([{ source: "Email" }, { source: "Email" }, { source: null }]);
    assert.equal(r.total, 3);
    assert.equal(r.buckets.find((b) => b.source === "Email")?.count, 2);
  });
});

describe("attributeConversionByTouchpoints", () => {
  const base = {
    lead_id: 1,
    interaction_type: "click",
    manual: true,
    created_at: "2026-01-01",
  };
  it("insufficient without touchpoints", () => {
    const r = attributeConversionByTouchpoints([], "first_touch");
    assert.equal(r.ok, false);
  });
  it("first touch", () => {
    const r = attributeConversionByTouchpoints(
      [
        { id: "a", channel: "Social", at: "2026-01-01", is_conversion: false, ...base },
        { id: "b", channel: "Email", at: "2026-01-02", is_conversion: true, ...base },
      ],
      "first_touch",
    );
    assert.equal(r.ok, true);
    assert.equal(r.credits[0].channel, "Social");
  });
  it("linear", () => {
    const r = attributeConversionByTouchpoints(
      [
        { id: "a", channel: "Social", at: "2026-01-01", is_conversion: false, ...base },
        { id: "b", channel: "Email", at: "2026-01-02", is_conversion: true, ...base },
      ],
      "linear",
    );
    assert.equal(r.ok, true);
    assert.equal(r.credits.length, 2);
  });
});
