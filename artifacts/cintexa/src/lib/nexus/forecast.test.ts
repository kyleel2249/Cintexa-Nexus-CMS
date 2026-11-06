import test from "node:test";
import assert from "node:assert/strict";
import { forecastSeries, checkAmount, densify } from "./forecast.ts";

test("needs at least three periods", () => {
  const f = forecastSeries([100, 200]);
  assert.equal(f.method, "insufficient-data"); assert.equal(f.points.length, 0);
});

test("rising series forecasts upward and is deterministic", () => {
  const s = [100, 120, 140, 160, 180, 200];
  const a = forecastSeries(s, 3), b = forecastSeries(s, 3);
  assert.deepEqual(a, b);
  assert.equal(a.trend, "up");
  assert.ok(a.points[0]! > 200 && a.points[2]! > a.points[0]!);
  assert.ok(a.lower[0]! <= a.points[0]! && a.upper[0]! >= a.points[0]!);
  assert.equal(a.confidence, "medium");
});

test("flat series stays flat; falling series falls", () => {
  assert.equal(forecastSeries([50, 50, 50, 50]).trend, "flat");
  assert.equal(forecastSeries([300, 250, 200, 150, 100]).trend, "down");
});

test("amount check catches an extra zero", () => {
  const hist = [500000, 520000, 480000, 510000, 495000];
  assert.equal(checkAmount(505000, hist).verdict, "typical");
  assert.equal(checkAmount(5000000, hist).verdict, "much-larger-than-usual");
  assert.equal(checkAmount(1, [1]).verdict, "no-history");
});

test("densify fills gaps with zeros", () => {
  assert.deepEqual(densify([{ key: "a", n: 2 }, { key: "c", n: 5 }], ["a", "b", "c"]), [2, 0, 5]);
});
