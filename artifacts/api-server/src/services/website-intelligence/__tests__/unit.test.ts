process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LIMITS } from "@workspace/wi-core";
import { isAllowed, parseRobots, blocksEverything } from "../robots";
import { normalizeConfig } from "../config";
import { parseHtml, byTag, textOf, countWords } from "../html";

const UA = "CINTEXA-NEXUS-WebsiteIntelligence";

test("robots.txt: longest match wins, wildcards and $ anchors work, specific agent beats *", () => {
  const r = parseRobots("User-agent: *\nDisallow: /private/\nAllow: /private/public.html\nDisallow: /*.pdf$\n\nUser-agent: cintexa-nexus-websiteintelligence\nDisallow: /agent-only/\n");
  assert.equal(isAllowed(r, "/private/x", "OtherBot"), false);
  assert.equal(isAllowed(r, "/private/public.html", "OtherBot"), true);
  assert.equal(isAllowed(r, "/doc.pdf", "OtherBot"), false);
  assert.equal(isAllowed(r, "/doc.pdf?x=1", "OtherBot"), true);
  assert.equal(isAllowed(r, "/agent-only/a", UA), false);
  assert.equal(isAllowed(r, "/private/x", UA), true, "a matching specific group replaces the * group");
  assert.equal(blocksEverything(parseRobots("User-agent: *\nDisallow: /")), true);
  assert.equal(blocksEverything(parseRobots("User-agent: *\nDisallow:")), false);
});

test("normalizeConfig requires authorization, refuses private targets and clamps to platform limits", () => {
  const ok = { userEmail: "a@b.c", allowAuthenticated: false };
  assert.equal(normalizeConfig({ url: "https://example.com" }, DEFAULT_LIMITS, ok).ok, false);
  assert.equal(normalizeConfig({ url: "http://127.0.0.1", authorization: { confirmed: true } }, DEFAULT_LIMITS, ok).ok, false);
  assert.equal(normalizeConfig({ url: "http://169.254.169.254/", authorization: { confirmed: true } }, DEFAULT_LIMITS, ok).ok, false);
  assert.equal(normalizeConfig({ url: "https://user:pw@example.com", authorization: { confirmed: true } }, DEFAULT_LIMITS, ok).ok, false);
  const r = normalizeConfig({ url: "https://example.com", maxPages: 99999, maxDepth: 99, concurrency: 99, authorization: { confirmed: true } }, { ...DEFAULT_LIMITS, maxPages: 50, maxDepth: 3, maxConcurrency: 4 }, ok);
  assert.ok(r.ok && r.cfg);
  assert.equal(r.cfg!.maxPages, 50); assert.equal(r.cfg!.maxDepth, 3); assert.equal(r.cfg!.concurrency, 4);
  assert.equal(r.cfg!.authorization.confirmedBy, "a@b.c");
  assert.equal(normalizeConfig({ url: "https://example.com", permittedHosts: ["10.0.0.1"], authorization: { confirmed: true } }, DEFAULT_LIMITS, ok).ok, false);
  assert.equal(normalizeConfig({ url: "https://example.com", modules: Object.fromEntries(["seo", "performance", "accessibility", "security", "content", "functionality", "structuredData", "localSeo", "ecommerce", "business", "analytics"].map((k) => [k, false])), authorization: { confirmed: true } }, DEFAULT_LIMITS, ok).ok, false);
});

test("authenticated scope needs platform permission, second confirmation, path prefixes and a credential that is not kept in the config", () => {
  const body = { url: "https://example.com", authorization: { confirmed: true }, authenticated: { enabled: true, confirmed: true, allowedPathPrefixes: ["/account/"], headerName: "Authorization", credential: "Bearer top-secret" } };
  assert.equal(normalizeConfig(body, DEFAULT_LIMITS, { userEmail: "a@b.c", allowAuthenticated: false }).ok, false);
  assert.equal(normalizeConfig({ ...body, authenticated: { ...body.authenticated, confirmed: false } }, DEFAULT_LIMITS, { userEmail: "a@b.c", allowAuthenticated: true }).ok, false);
  assert.equal(normalizeConfig({ ...body, authenticated: { ...body.authenticated, allowedPathPrefixes: ["../etc"] } }, DEFAULT_LIMITS, { userEmail: "a@b.c", allowAuthenticated: true }).ok, false);
  const r = normalizeConfig(body, DEFAULT_LIMITS, { userEmail: "a@b.c", allowAuthenticated: true });
  assert.ok(r.ok);
  assert.equal(r.credential, "Bearer top-secret");
  assert.ok(!JSON.stringify(r.cfg).includes("top-secret"));
});

test("HTML parser tolerates broken markup and ignores script text", () => {
  const doc = parseHtml('<html><head><title>T</title><script>var a="<h1>no</h1>"</script></head><body><h1>Hello <b>world<p>unclosed<img src=x alt="">');
  assert.equal(byTag(doc.root, "h1").length, 1);
  assert.match(textOf(doc.root), /Hello world/);
  assert.ok(!textOf(doc.root).includes("no"));
  assert.equal(countWords("one two  three"), 3);
});
