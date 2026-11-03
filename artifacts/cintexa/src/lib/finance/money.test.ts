/**
 * Monetary formatting tests — guarantees correct magnitude + two decimals.
 * Storage is always integer minor units (e.g. 500000 minor = GHS 5,000.00).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatMinor,
  formatCurrency,
  formatMoney,
  parseToMinor,
  majorToMinor,
  minorToMajor,
} from "./money.ts";

describe("formatMinor — two decimal places always (minor units in)", () => {
  it("formats zero", () => {
    assert.equal(formatMinor(0), "0.00");
  });
  it("formats 5000 minor as 50.00", () => {
    assert.equal(formatMinor(5000), "50.00");
  });
  it("formats 500000 minor as 5,000.00 (dashboard must show this, not 50)", () => {
    assert.equal(formatMinor(500000), "5,000.00");
  });
  it("formats 150000 minor as 1,500.00", () => {
    assert.equal(formatMinor(150000), "1,500.00");
  });
  it("formats 1000000 minor as 10,000.00", () => {
    assert.equal(formatMinor(1000000), "10,000.00");
  });
  it("formats negative values", () => {
    assert.equal(formatMinor(-150000), "-1,500.00");
  });
});

describe("formatCurrency — symbol + correct magnitude", () => {
  it("GHS 5,000.00 from 500000 minor", () => {
    assert.equal(formatCurrency(500000, "GHS"), "GH₵ 5,000.00");
  });
  it("handles zero", () => {
    assert.equal(formatCurrency(0, "GHS"), "GH₵ 0.00");
  });
});

describe("majorToMinor — form boundary (fixes 100× understatement)", () => {
  it("user types 5000 (GHS 5,000) → stores 500000 minor", () => {
    assert.equal(majorToMinor(5000), 500000);
  });
  it("user types 50 (GHS 50) → stores 5000 minor", () => {
    assert.equal(majorToMinor(50), 5000);
  });
  it("round-trip: major 5000 → minor → display 5,000.00", () => {
    const minor = majorToMinor(5000);
    assert.equal(formatMinor(minor), "5,000.00");
    assert.equal(formatCurrency(minor, "GHS"), "GH₵ 5,000.00");
    assert.equal(minorToMajor(minor), 5000);
  });
  it("parseToMinor 5000.00 → 500000", () => {
    const r = parseToMinor("5000.00");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.minor, 500000);
  });
});

describe("formatMoney options", () => {
  it("default forces decimals on whole amounts", () => {
    assert.equal(formatMoney(500000, "GHS"), "5,000.00");
  });
});
