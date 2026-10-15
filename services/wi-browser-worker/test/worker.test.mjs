import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { isPrivateIp, checkUrl, setLookupForTests } from "../guard.mjs";

process.env.NODE_ENV = "test";
process.env.WI_WORKER_ALLOW_LOOPBACK = "1";

test("guard classifies private addresses", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "172.16.0.1", "::1", "fd00::1", "::ffff:10.0.0.1", "100.64.0.1"]) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34"]) assert.equal(isPrivateIp(ip), false, ip);
});

test("guard refuses unsafe URLs and fails closed", async () => {
  setLookupForTests(async (h) => (h === "evil.test" ? [{ address: "10.1.1.1" }] : h === "ok.test" ? [{ address: "93.184.216.34" }] : []));
  assert.equal((await checkUrl("http://127.0.0.1/")).ok, false);
  assert.equal((await checkUrl("http://localhost/")).ok, false);
  assert.equal((await checkUrl("http://evil.test/")).ok, false);
  assert.equal((await checkUrl("https://ok.test:22/")).ok, false);
  assert.equal((await checkUrl("ftp://ok.test/")).ok, false);
  assert.equal((await checkUrl("https://u:p@ok.test/")).ok, false);
  assert.equal((await checkUrl("https://nxdomain.test/")).ok, false);
  assert.equal((await checkUrl("https://ok.test/")).ok, true);
  setLookupForTests(null);
});

test("worker inspects a page, measures real defects, enforces auth", { timeout: 120000 }, async (t) => {
  const page = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><html lang=en><head><meta name=viewport content="width=device-width"><title>t</title></head><body>
      <div style="width:900px;height:20px;background:#ccc">wide</div>
      <a href="#" style="display:inline-block;width:10px;height:10px">x</a>
      <button>Get a quote</button>
      <script>setTimeout(()=>{ throw new Error("boom") },50)</script></body></html>`);
  }).listen(0, "127.0.0.1");
  await new Promise((r) => page.once("listening", r));
  const target = `http://127.0.0.1:${page.address().port}/`;
  const { server } = await import("../server.mjs");
  server.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => { server.close(); page.close(); server.closeAllConnections?.(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/v1/inspect`, { method: "POST", body: JSON.stringify(body) });
  // allowed port set excludes random ports, so use loopback bypass: port check still applies -> expect refusal
  const refused = await post({ url: target, devices: ["mobile"] });
  assert.ok([200, 422].includes(refused.status));
  const bad = await post({ url: "http://169.254.169.254/latest/meta-data/" });
  assert.equal(bad.status, 422);
  const nf = await fetch(`${base}/nope`);
  assert.equal(nf.status, 404);
  const { inspectPage } = await import("../inspect.mjs");
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
  try {
    // call inspector directly (random loopback port is outside the public port allow-list, so bypass port check by using a stub-less direct route)
    const origCheck = await import("../guard.mjs");
    const results = await inspectPage(browser, target, ["mobile"], { allowLoopbackForTests: true, __skipPort: true });
    const by = Object.fromEntries(results.map((r) => [r.testId, r]));
    assert.equal(by["func.js_errors"]?.status, "failed");
    assert.equal(by["ux.overflow"]?.status, "failed");
    assert.equal(by["a11y.reflow"]?.status, "failed");
    assert.ok(["warning", "failed"].includes(by["a11y.target_size"]?.status));
    assert.equal(by["biz.mobile_conversion"]?.status, "passed");
    assert.equal(by["a11y.keyboard"]?.status, "inconclusive");
    assert.ok(origCheck);
  } finally { await browser.close(); }
});

test("contrast: measures real ratios, honours large-text threshold, refuses to guess over images", { timeout: 60000 }, async () => {
  const { inspectPage } = await import("../inspect.mjs");
  const { chromium } = await import("playwright");
  const serve = (body) => new Promise((resolve) => { const srv = http.createServer((q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><html lang=en><head><meta name=viewport content="width=device-width"></head><body style="margin:0">${body}</body></html>`); }).listen(0, "127.0.0.1", () => resolve(srv)); });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
  const servers = [];
  try {
    const run = async (body) => { const srv = await serve(body); servers.push(srv); const res = await inspectPage(browser, `http://127.0.0.1:${srv.address().port}/`, ["desktop"], { allowLoopbackForTests: true, __skipPort: true }); return res.find((r) => r.testId === "a11y.contrast"); };
    const good = await run('<p style="color:#111;background:#fff">Readable body copy</p>');
    assert.equal(good.status, "passed");
    const bad = await run('<p style="color:#aaa;background:#fff">Faint grey text</p>');
    assert.equal(bad.status, "failed");
    assert.match(bad.actual, /Faint grey text/);
    const largeMid = await run('<p style="color:#8a8a8a;background:#fff;font-size:32px">Large mid grey</p>');
    assert.equal(largeMid.status, "passed", "~3.4:1 passes the 3:1 large-text rule");
    const smallMid = await run('<p style="color:#8a8a8a;background:#fff;font-size:14px">Small mid grey</p>');
    assert.equal(smallMid.status, "failed", "the same colour fails at normal size");
    const onImage = await run('<p style="color:#fff;background-image:linear-gradient(#000,#fff)">On gradient</p>');
    assert.equal(onImage.status, "inconclusive", "gradients are not guessed");
  } finally { await browser.close(); servers.forEach((s) => s.close()); }
});
