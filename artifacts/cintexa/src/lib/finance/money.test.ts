/**
 * Monetary formatting tests — guarantees two-decimal display contract.
 * Storage is always integer minor units (e.g. 5000 minor = GHS 50.00).
 * Run via: npm test (from artifacts/cintexa workspace)
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
  it("formats 5000 minor as 50.00 (the classic missing-zeros case)", () => {
    assert.equal(formatMinor(5000), "50.00");
  });
  it("formats 50 minor as 0.50", () => {
    assert.equal(formatMinor(50), "0.50");
  });
  it("formats 50000 minor as 500.00", () => {
    assert.equal(formatMinor(50000), "500.00");
  });
  it("formats 150000 minor as 1,500.00", () => {
    assert.equal(formatMinor(150000), "1,500.00");
  });
  it("formats 500000 minor as 5,000.00", () => {
    assert.equal(formatMinor(500000), "5,000.00");
  });
  it("formats 2000000 minor as 20,000.00", () => {
    assert.equal(formatMinor(2000000), "20,000.00");
  });
  it("formats negative values", () => {
    assert.equal(formatMinor(-150000), "-1,500.00");
  });
  it("formats fractional major correctly (12345 minor → 123.45)", () => {
    assert.equal(formatMinor(12345), "123.45");
  });
});

describe("formatCurrency — symbol + two decimals", () => {
  it("prefixes GH₵ for GHS 5,000.00", () => {
    assert.equal(formatCurrency(500000, "GHS"), "GH₵ 5,000.00");
  });
  it("handles zero", () => {
    assert.equal(formatCurrency(0, "GHS"), "GH₵ 0.00");
  });
  it("handles 50.00 major (5000 minor)", () => {
    assert.equal(formatCurrency(5000, "GHS"), "GH₵ 50.00");
  });
});

describe("parseToMinor / majorToMinor round-trip", () => {
  it("parses 50.00 to 5000 minor", () => {
    const r = parseToMinor("50.00");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.minor, 5000);
  });
  it("majorToMinor(50) === 5000", () => {
    assert.equal(majorToMinor(50), 5000);
  });
  it("minorToMajor(5000) === 50", () => {
    assert.equal(minorToMajor(5000), 50);
  });
  it("does not invent magnitude — 50.00 major stays 50.00 display", () => {
    assert.equal(formatMinor(5000), "50.00");
  });
});

describe("formatMoney options", () => {
  it("can disable forceDecimals when explicitly requested (legacy)", () => {
    // 5000 minor, forceDecimals false, frac=0 → "50"
    assert.equal(formatMoney(5000, "GHS", { forceDecimals: false, useGrouping: true }), "50");
  });
  it("default forces decimals (the fix)", () => {
    assert.equal(formatMoney(5000, "GHS"), "50.00");
  });
});
