import test from "node:test";
import assert from "node:assert/strict";
import { buildShareText, SHARE_PLATFORMS } from "../share-text";

test("share text respects each platform limit", () => {
  const post = { title: "A title", excerpt: "word ".repeat(400) };
  for (const p of SHARE_PLATFORMS) {
    const t = buildShareText(p, post);
    assert.ok(t.length <= { twitter: 280, facebook: 600, linkedin: 700 }[p], p);
    assert.ok(t.startsWith("A title"));
  }
});

test("short posts are not truncated and missing excerpt is fine", () => {
  assert.equal(buildShareText("facebook", { title: "Hi", excerpt: "There" }), "Hi\n\nThere");
  assert.equal(buildShareText("facebook", { title: "Only" }), "Only");
});
