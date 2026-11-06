import test from "node:test";
import assert from "node:assert/strict";
import { renderCoverSvg, coverDataUri, COVER_SPECS, hashString, escapeXml, wrapTitle } from "../cover-art";

test("cover art is deterministic and varies by title", () => {
  const s = COVER_SPECS[0]!;
  assert.equal(renderCoverSvg("Hello", s), renderCoverSvg("Hello", s));
  assert.notEqual(renderCoverSvg("Hello", s), renderCoverSvg("World", s));
  assert.equal(hashString("a"), hashString("a"));
});

test("cover art is well-formed SVG with escaped title and no external references", () => {
  for (const s of COVER_SPECS) {
    const svg = renderCoverSvg(`<script>alert("x")</script> & more`, s);
    assert.ok(svg.startsWith("<svg"));
    assert.ok(svg.includes(`width="${s.width}"`) || svg.includes(`${s.width}`));
    assert.ok(!svg.includes("<script>"));
    assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(svg));
    assert.ok(coverDataUri("t", s).startsWith("data:image/svg+xml"));
  }
});

test("escapeXml and wrapTitle behave", () => {
  assert.equal(escapeXml(`<&>"'`), "&lt;&amp;&gt;&quot;&#39;".replace("&#39;", escapeXml("'")));
  const lines = wrapTitle("one two three four five six seven eight nine ten", 12, 2);
  assert.ok(lines.length <= 2);
  lines.forEach((l) => assert.ok(l.length <= 13));
});
