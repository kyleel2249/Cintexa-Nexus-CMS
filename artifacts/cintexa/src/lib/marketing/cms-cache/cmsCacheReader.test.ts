/**
 * Read-only cache reader tests — no network.
 * Run: npm test (tsx --test) from cintexa package.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { readCachedMedia, readCachedPages, readCachedForms } from "./cmsCacheReader";
import {
  markMediaSessionAvailable,
  markPagesSessionAvailable,
  markFormsSessionAvailable,
  isMediaSessionAvailable,
  isPagesSessionAvailable,
  isFormsSessionAvailable,
  __resetSessionMarkersForTests,
} from "./sessionMarkers";

function seedQuery(qc: QueryClient, key: unknown[], data: unknown) {
  qc.setQueryData(key, data);
}

describe("cmsCacheReader", () => {
  it("returns unavailable media when cache empty", () => {
    const qc = new QueryClient();
    const r = readCachedMedia(qc);
    assert.equal(r.available, false);
    assert.equal(r.items.length, 0);
  });

  it("reads media from /api/media success cache", () => {
    const qc = new QueryClient();
    seedQuery(qc, ["/api/media"], [
      {
        id: 1,
        originalName: "hero.png",
        filename: "hero.png",
        mimeType: "image/png",
        size: 100,
        url: "data:image/png;base64,xx",
      },
    ]);
    const r = readCachedMedia(qc);
    assert.equal(r.available, true);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].cmsMediaId, 1);
    assert.equal(r.items[0].name, "hero.png");
  });

  it("reads pages from /api/pages", () => {
    const qc = new QueryClient();
    seedQuery(qc, ["/api/pages"], [{ id: 9, title: "Home", slug: "home", status: "published", createdAt: "", updatedAt: "" }]);
    const r = readCachedPages(qc);
    assert.equal(r.available, true);
    assert.equal(r.items[0].cmsPageId, 9);
    assert.equal(r.items[0].slug, "home");
  });

  it("reads forms with submissionCount", () => {
    const qc = new QueryClient();
    seedQuery(qc, ["/api/forms"], [{ id: 3, name: "Contact", fields: "[]", submissionCount: 12, createdAt: "" }]);
    const r = readCachedForms(qc);
    assert.equal(r.available, true);
    assert.equal(r.items[0].cmsFormId, 3);
    assert.equal(r.items[0].submissionCount, 12);
  });

  it("ignores non-matching query keys", () => {
    const qc = new QueryClient();
    seedQuery(qc, ["/api/other"], [{ id: 1 }]);
    assert.equal(readCachedMedia(qc).available, false);
  });
});

describe("sessionMarkers", () => {
  it("starts unavailable and marks independently", () => {
    __resetSessionMarkersForTests();
    assert.equal(isMediaSessionAvailable(), false);
    assert.equal(isPagesSessionAvailable(), false);
    assert.equal(isFormsSessionAvailable(), false);
    markMediaSessionAvailable();
    assert.equal(isMediaSessionAvailable(), true);
    assert.equal(isPagesSessionAvailable(), false);
    markPagesSessionAvailable();
    assert.equal(isPagesSessionAvailable(), true);
    assert.equal(isFormsSessionAvailable(), false);
    markFormsSessionAvailable();
    assert.equal(isFormsSessionAvailable(), true);
    __resetSessionMarkersForTests();
    assert.equal(isMediaSessionAvailable(), false);
  });
});
