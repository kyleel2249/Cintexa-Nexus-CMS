process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import { afterEach, before, after, test } from "node:test";
import { safeFetch, setResolverForTests, resolvePublic, BlockedTargetError } from "../safe-fetch";
import { gzipBomb, send, startSite, type Fixture } from "./helpers";

let site: Fixture;
before(async () => {
  site = await startSite({
    "/": (_q, r) => send(r, 200, "text/html", "<html><title>ok</title></html>"),
    "/to-internal": (_q, r) => send(r, 302, "text/html", "", { location: "http://169.254.169.254/latest/meta-data/" }),
    "/to-rebind": (_q, r) => send(r, 302, "text/html", "", { location: "http://rebind.test:8080/" }),
    "/to-other-host": (_q, r) => send(r, 302, "text/html", "", { location: "http://other.test:8080/" }),
    "/to-file": (_q, r) => send(r, 302, "text/html", "", { location: "file:///etc/passwd" }),
    "/loop": (_q, r) => send(r, 302, "text/html", "", { location: "/loop" }),
    "/bomb": (_q, r) => send(r, 200, "text/html", gzipBomb(40 * 1024 * 1024), { "content-encoding": "gzip" }),
    "/big": (_q, r) => send(r, 200, "text/html", Buffer.alloc(3 * 1024 * 1024, 0x62)),
  });
});
after(async () => { await site.close(); setResolverForTests(null); });
afterEach(() => setResolverForTests(null));

const loopbackFor = (map: Record<string, string>, calls?: string[]) => setResolverForTests(async (h) => { calls?.push(h); const a = map[h]; if (!a) throw Object.assign(new Error("nxdomain"), { code: "ENOTFOUND" }); return [{ address: a, family: a.includes(":") ? 6 : 4 }]; }, { allowLoopback: true });

test("literal private, loopback, link-local and metadata addresses are refused", async () => {
  for (const u of ["http://127.0.0.1:8080/", "http://10.1.2.3/", "http://192.168.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://[fd00::1]/", "http://0.0.0.0/", "http://2130706433/", "http://0x7f.1/", "http://[::ffff:127.0.0.1]/", "http://metadata.google.internal/", "http://localhost/"]) {
    const r = await safeFetch(u, { timeoutMs: 2000 });
    assert.equal(r.ok, false, u);
    assert.equal(r.error?.blocked, true, `${u} should be blocked, got ${r.error?.code}`);
  }
});

test("without the test hook loopback stays blocked even if DNS says it is allowed", async () => {
  setResolverForTests(async () => [{ address: "127.0.0.1", family: 4 }]); // no allowLoopback
  const r = await safeFetch("http://site.test:8080/", { timeoutMs: 2000 });
  assert.equal(r.error?.blocked, true);
});

test("a hostname that resolves to a private address is blocked (any answer, not only the first)", async () => {
  setResolverForTests(async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }]);
  await assert.rejects(() => resolvePublic("mixed.test"), BlockedTargetError);
  const r = await safeFetch("http://mixed.test/", { timeoutMs: 2000 });
  assert.equal(r.error?.blocked, true);
});

test("redirects are revalidated: internal literal, rebinding hostname, other scope and non-http schemes", async () => {
  loopbackFor({ "site.test": "127.0.0.1", "rebind.test": "10.0.0.1", "other.test": "127.0.0.1" });
  const internal = await safeFetch("http://site.test:8080/to-internal", { timeoutMs: 3000 });
  assert.equal(internal.error?.blocked, true);
  assert.equal(internal.redirects.length, 1);
  const rebind = await safeFetch("http://site.test:8080/to-rebind", { timeoutMs: 3000 });
  assert.equal(rebind.error?.blocked, true, "second hop that resolves privately must be refused");
  const scoped = await safeFetch("http://site.test:8080/to-other-host", { timeoutMs: 3000, scope: (u) => u.hostname === "site.test" });
  assert.equal(scoped.error?.code, "OUT_OF_SCOPE");
  const file = await safeFetch("http://site.test:8080/to-file", { timeoutMs: 3000 });
  assert.equal(file.error?.blocked, true);
});

test("DNS is resolved once per hop and the connection is pinned to that answer", async () => {
  const calls: string[] = [];
  loopbackFor({ "site.test": "127.0.0.1" }, calls);
  const r = await safeFetch("http://site.test:8080/", { timeoutMs: 3000 });
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(calls.filter((c) => c === "site.test").length, 1);
});

test("a late DNS change (rebinding) cannot redirect an established hop to an internal address", async () => {
  let n = 0;
  setResolverForTests(async () => (++n === 1 ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "10.9.9.9", family: 4 }]), { allowLoopback: true });
  const first = await safeFetch("http://site.test:8080/", { timeoutMs: 3000 });
  assert.equal(first.ok, true);
  const second = await safeFetch("http://site.test:8080/", { timeoutMs: 3000 });
  assert.equal(second.error?.blocked, true);
});

test("ports, credentials in URLs and schemes are restricted", async () => {
  loopbackFor({ "site.test": "127.0.0.1" });
  assert.equal((await safeFetch("http://site.test:22/", { timeoutMs: 1000 })).error?.blocked, true);
  assert.equal((await safeFetch("http://site.test:5432/", { timeoutMs: 1000 })).error?.blocked, true);
  assert.equal((await safeFetch("http://user:pw@site.test:8080/", { timeoutMs: 1000 })).error?.blocked, true);
  assert.equal((await safeFetch("ftp://site.test/", { timeoutMs: 1000 })).error?.blocked, true);
});

test("redirect loops end with an error instead of spinning", async () => {
  loopbackFor({ "site.test": "127.0.0.1" });
  const r = await safeFetch("http://site.test:8080/loop", { timeoutMs: 3000 });
  assert.equal(r.ok, false);
  assert.match(r.error?.code ?? "", /LOOP|TOO_MANY/);
});

test("response size is capped, including decompressed size (zip bomb)", async () => {
  loopbackFor({ "site.test": "127.0.0.1" });
  const big = await safeFetch("http://site.test:8080/big", { timeoutMs: 5000, maxBytes: 1024 * 1024 });
  assert.equal(big.truncated, true);
  assert.ok(big.body.length <= 1024 * 1024);
  const bomb = await safeFetch("http://site.test:8080/bomb", { timeoutMs: 8000, maxBytes: 1024 * 1024 });
  assert.equal(bomb.truncated, true);
  assert.ok(bomb.body.length <= 1024 * 1024 + 65536, `decompressed body ${bomb.body.length}`);
});

test("auth header only goes to the configured origin and path prefixes", async () => {
  loopbackFor({ "site.test": "127.0.0.1" });
  const seen: Record<string, string | undefined> = {};
  const s2 = await startSite({ "*": (q, r) => { seen[q.url ?? ""] = q.headers.authorization as string | undefined; send(r, 200, "text/plain", "ok"); } }, 8443);
  try {
    const auth = { headerName: "Authorization", value: "Bearer secret", pathPrefixes: ["/account/"], origin: "http://site.test:8443" };
    await safeFetch("http://site.test:8443/account/a", { timeoutMs: 3000, auth });
    await safeFetch("http://site.test:8443/public", { timeoutMs: 3000, auth });
    assert.equal(seen["/account/a"], "Bearer secret");
    assert.equal(seen["/public"], undefined);
  } finally { await s2.close(); }
});
