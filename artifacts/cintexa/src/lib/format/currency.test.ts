import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMinor, formatCurrency, majorToMinor, minorToMajor } from "./currency.ts";

test("formatMinor groups thousands and keeps two decimals", () => {
  assert.equal(formatMinor(0), "0.00");
  assert.equal(formatMinor(50), "0.50");
  assert.equal(formatMinor(500000), "5,000.00");
  assert.equal(formatMinor(-150000), "-1,500.00");
  assert.equal(formatMinor(123456789), "1,234,567.89");
});
test("formatCurrency prefixes symbol or code", () => {
  assert.equal(formatCurrency(500000), "GH₵ 5,000.00");
  assert.equal(formatCurrency(1999, "usd"), "$ 19.99");
  assert.equal(formatCurrency(100, "XOF"), "XOF 1.00");
});
test("majorToMinor / minorToMajor round-trip without float drift", () => {
  assert.equal(majorToMinor(5000), 500000);
  assert.equal(majorToMinor(19.99), 1999);
  assert.equal(majorToMinor(0.1 + 0.2), 30);
  assert.equal(minorToMajor(1999), 19.99);
});
test("non-finite input does not produce NaN output", () => {
  assert.equal(formatMinor(NaN), "0.00");
});
