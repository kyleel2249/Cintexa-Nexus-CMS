import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as M from "../core/money";
import { rangeFor, businessDate, previousRange, startOfDayUtc, isValidTimeZone } from "../core/time";
import { v, parse, normalizeDecimal, isValidDateString, escapeLike } from "../core/validate";
import { HttpError } from "../core/errors";

describe("money", () => {
  test("canonicalises and rejects excess precision", () => {
    assert.equal(M.money("12"), "12.00");
    assert.equal(M.money("0.1"), "0.10");
    assert.throws(() => M.money("1.005"), /decimal places/);
    assert.throws(() => M.money("1,000"), /Invalid/);
  });
  test("no float drift", () => {
    assert.equal(M.add("0.10", "0.20"), "0.30");
    assert.equal(M.sum(Array(10).fill("0.10")), "1.00");
  });
  test("percentOf rounds half up and half even", () => {
    assert.equal(M.percentOf("200.00", "12.5"), "25.00");
    assert.equal(M.percentOf("0.05", "50"), "0.03"); // 0.025 -> half up
    assert.equal(M.percentOf("0.05", "50", "half_even"), "0.02");
    assert.equal(M.percentOf("-0.05", "50"), "-0.03");
  });
  test("allocate never loses a cent", () => {
    const parts = M.allocate("100.00", [1, 1, 1]);
    assert.deepEqual(parts, ["33.34", "33.33", "33.33"]);
    assert.equal(M.sum(parts), "100.00");
    assert.equal(M.sum(M.allocate("0.01", [1, 1, 1])), "0.01");
    assert.throws(() => M.allocate("10.00", [0, 0]));
  });
  test("line totals: percent then fixed discount, tax on net, never negative", () => {
    const t = M.lineTotals({ quantity: 3, unitPrice: "19.99", discountPercent: 10, discountAmount: "1.00", taxRate: 7.5, unitCost: "12.00" });
    assert.equal(t.gross, "59.97");
    assert.equal(t.discount, "6.997".slice(0, 0) + M.add(M.percentOf("59.97", 10), "1.00"));
    assert.equal(t.net, M.sub(t.gross, t.discount));
    assert.equal(t.total, M.add(t.net, t.tax));
    assert.equal(t.cost, "36.00");
    const over = M.lineTotals({ quantity: 1, unitPrice: "10.00", discountAmount: "50.00" });
    assert.equal(over.net, "0.00");
  });
  test("document totals and margin", () => {
    const a = M.lineTotals({ quantity: 2, unitPrice: "100.00", taxRate: 10, unitCost: "60.00" });
    const b = M.lineTotals({ quantity: 1, unitPrice: "50.00", taxRate: 10, unitCost: "20.00" });
    const d = M.documentTotals([a, b]);
    assert.equal(d.netTotal, "250.00");
    assert.equal(d.taxTotal, "25.00");
    assert.equal(d.total, "275.00");
    assert.equal(d.marginTotal, "110.00");
    assert.equal(d.marginPercent, 44);
    const unknown = M.documentTotals([a, M.lineTotals({ quantity: 1, unitPrice: "5.00" })]);
    assert.equal(unknown.marginTotal, null);
  });
  test("convert refuses a missing or zero rate", () => {
    assert.equal(M.convert("100.00", "1.25"), "125.00");
    assert.throws(() => M.convert("100.00", null), /Missing/);
    assert.throws(() => M.convert("100.00", "0"), /Invalid/);
  });
  test("ratioPercent handles zero whole", () => {
    assert.equal(M.ratioPercent("5.00", "0.00"), null);
    assert.equal(M.ratioPercent("1.00", "3.00"), 33.33);
  });
});

describe("time", () => {
  test("validates time zones", () => {
    assert.ok(isValidTimeZone("Africa/Accra"));
    assert.ok(!isValidTimeZone("Mars/Base"));
  });
  test("today is computed in the business timezone, not UTC", () => {
    // 2026-10-17T23:30Z is already 2026-10-18 in Lagos-style UTC+1 zones
    const now = new Date("2026-10-17T23:30:00Z");
    assert.equal(businessDate(now, "Africa/Lagos"), "2026-10-18");
    assert.equal(businessDate(now, "UTC"), "2026-10-17");
    const r = rangeFor("today", now, "Africa/Lagos");
    assert.equal(r.from, "2026-10-17T23:00:00.000Z");
    assert.equal(r.to, "2026-10-18T23:00:00.000Z");
  });
  test("DST days are 23 or 25 hours long", () => {
    const now = new Date("2026-03-08T18:00:00Z"); // US spring-forward day
    const r = rangeFor("today", now, "America/New_York");
    assert.equal((Date.parse(r.to) - Date.parse(r.from)) / 3_600_000, 23);
  });
  test("week starts Monday, quarter and year boundaries", () => {
    const now = new Date("2026-10-17T10:00:00Z"); // Saturday
    assert.equal(rangeFor("week", now, "UTC").from, "2026-10-12T00:00:00.000Z");
    assert.equal(rangeFor("quarter", now, "UTC").from, "2026-10-01T00:00:00.000Z");
    assert.equal(rangeFor("quarter", now, "UTC").label, "Q4 2026");
    assert.equal(rangeFor("last_quarter", now, "UTC").label, "Q3 2026");
    assert.equal(rangeFor("last_quarter", new Date("2026-02-10T00:00:00Z"), "UTC").label, "Q4 2025");
    assert.equal(rangeFor("year", now, "UTC").to, "2027-01-01T00:00:00.000Z");
  });
  test("previous range has equal length", () => {
    const r = rangeFor("month", new Date("2026-10-17T00:00:00Z"), "UTC");
    const p = previousRange(r);
    assert.equal(Date.parse(p.to) - Date.parse(p.from), Date.parse(r.to) - Date.parse(r.from));
    assert.equal(p.to, r.from);
  });
  test("startOfDayUtc", () => {
    assert.equal(startOfDayUtc(2026, 10, 17, "Africa/Accra").toISOString(), "2026-10-17T00:00:00.000Z");
  });
});

describe("validate", () => {
  const schema = v.object({
    name: v.string({ min: 2, max: 10 }),
    email: v.optional(v.email()),
    amount: v.money({ min: "0" }),
    kind: v.enumOf(["a", "b"] as const),
    n: v.withDefault(v.int({ min: 1 }), 5),
    tags: v.optional(v.array(v.string({ max: 5 }), { max: 2 })),
  });
  test("accepts valid input, strips unknown keys, normalises", () => {
    const out = parse(schema, { name: "  Bob ", email: "A@B.CO", amount: 12, kind: "a", admin: true });
    assert.deepEqual(out, { name: "Bob", email: "a@b.co", amount: "12.00", kind: "a", n: 5 });
    assert.ok(!("admin" in out));
  });
  test("collects every issue", () => {
    try {
      parse(schema, { name: "x", amount: "-1", kind: "z", tags: ["toolong1", "ok", "x"] });
      assert.fail("should throw");
    } catch (e) {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 422);
      const paths = (e.details as any).issues.map((i: any) => i.path).sort();
      assert.deepEqual(paths, ["amount", "kind", "name", "tags"]);
    }
  });
  test("rejects prototype pollution keys in records", () => {
    const rec = v.record(v.string());
    const body = JSON.parse('{"__proto__":"x","a":"b"}');
    assert.throws(() => parse(v.object({ r: rec }), { r: body }));
  });
  test("dates are strictly validated", () => {
    assert.ok(isValidDateString("2026-02-28"));
    assert.ok(!isValidDateString("2026-02-30"));
    assert.ok(!isValidDateString("26-1-1"));
  });
  test("timestamps require a timezone designator", () => {
    const s = v.object({ at: v.timestamp() });
    assert.equal(parse(s, { at: "2026-10-17T09:00:00+01:00" }).at, "2026-10-17T08:00:00.000Z");
    assert.throws(() => parse(s, { at: "2026-10-17T09:00:00" }));
  });
  test("normalizeDecimal edge cases", () => {
    assert.equal(normalizeDecimal("-0", 2), "0.00");
    assert.equal(normalizeDecimal("1e3", 2), null);
    assert.equal(normalizeDecimal("1.50", 1), "1.5");
    assert.equal(normalizeDecimal("1.55", 1), null);
    assert.equal(normalizeDecimal(1e21, 2), null);
  });
  test("escapeLike", () => assert.equal(escapeLike("50%_off\\"), "50\\%\\_off\\\\"));
  test("control characters are rejected", () => {
    assert.throws(() => parse(v.object({ s: v.string() }), { s: "a\u0000b" }));
  });
});
