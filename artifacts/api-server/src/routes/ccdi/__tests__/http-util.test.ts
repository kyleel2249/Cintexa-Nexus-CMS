import test from "node:test";
import assert from "node:assert/strict";
import { pid, httpStatus } from "../http-util";

test("pid takes the first value of a repeated route param and never returns undefined", () => {
  assert.equal(pid("abc"), "abc"); assert.equal(pid(["a", "b"]), "a"); assert.equal(pid([]), ""); assert.equal(pid(undefined), "");
});
test("httpStatus passes valid HTTP codes and falls back instead of letting res.status(undefined) throw", () => {
  assert.equal(httpStatus(404), 404); assert.equal(httpStatus(503), 503);
  for (const bad of [undefined, null, "open", NaN, 42, 99, 600, 4.5]) assert.equal(httpStatus(bad), 500);
  assert.equal(httpStatus(undefined, 400), 400);
});
test("report HTML escaping covers & < > \" '", () => {
  const escape = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  assert.equal(escape(`<img src="x" onerror='a&b'>`), "&lt;img src=&quot;x&quot; onerror=&#39;a&amp;b&#39;&gt;");
});
