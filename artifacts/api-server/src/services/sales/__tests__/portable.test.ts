import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash as nodeHash, randomBytes as nodeRandom } from "node:crypto";
import { createHash, randomBytes, randomUUID, sha256Hex, env, base64Utf8 } from "../core/portable";

describe("portable crypto matches node:crypto", () => {
  const samples = ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(1000), "héllo wörld ✓ 日本語", JSON.stringify({ a: [1, 2, { b: null }] })];
  for (const s of samples) {
    test(`sha256 of ${s.length} chars`, () => {
      assert.equal(sha256Hex(s), nodeHash("sha256").update(s).digest("hex"));
      assert.equal(createHash("sha256").update(s).digest("hex"), nodeHash("sha256").update(s).digest("hex"));
    });
  }
  test("random bytes and uuid shapes", () => {
    assert.match(randomBytes(18).toString("base64url"), /^[A-Za-z0-9_-]{24}$/);
    assert.match(randomBytes(32).toString("base64url"), /^[A-Za-z0-9_-]{43}$/);
    assert.match(randomBytes(4).toString("hex"), /^[0-9a-f]{8}$/);
    assert.match(randomUUID(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(randomBytes(16).toString("hex"), randomBytes(16).toString("hex"));
    void nodeRandom;
  });
  test("base64Utf8 matches Buffer", () => {
    for (const s of ["", "a,b\n1,2", "héllo ✓ 日本語", "x".repeat(70000)]) assert.equal(base64Utf8(s), Buffer.from(s, "utf8").toString("base64"));
  });
  test("env prefers injected values", () => {
    (globalThis as any).__SALES_ENV__ = { X_TEST: "1" };
    assert.equal(env("X_TEST"), "1");
    delete (globalThis as any).__SALES_ENV__;
    assert.equal(env("X_TEST"), undefined);
  });
});
