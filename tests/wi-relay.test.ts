import { describe, expect, test } from "bun:test";
// @ts-ignore PagesFunction is an ambient Cloudflare type, erased at runtime
import { onRequest, blockedHost, rateLimited } from "../functions/api/wi-relay";

const realFetch = globalThis.fetch;
function stub(site?: (url: string) => Response) {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input);
    if (site) return site(url);
    return realFetch(input, init);
  }) as typeof fetch;
}
const call = (qs: string, method = "GET", extra: Record<string, string> = {}) =>
  (onRequest as any)({ request: new Request(`https://app.pages.dev/api/wi-relay?${qs}`, { method, headers: { ...extra } }), env: {} });
const site = { "sec-fetch-site": "same-origin" };

describe("wi-relay", () => {
  test("blockedHost covers private space", () => {
    for (const h of ["localhost", "10.0.0.1", "127.0.0.1", "169.254.169.254", "192.168.1.1", "172.20.0.1", "[::1]", "fd00::1", "foo.internal", "2130706433", "0x7f000001", "::ffff:7f00:1"]) expect(blockedHost(h)).not.toBeNull();
    for (const h of ["example.com", "8.8.8.8", "sub.example.org"]) expect(blockedHost(h)).toBeNull();
  });
  test("only this site's own pages may use the relay", async () => {
    stub(() => new Response("<html></html>", { headers: { "content-type": "text/html" } }));
    expect((await call("url=https://example.com/")).status).toBe(403); // curl-style caller
    expect((await call("url=https://example.com/", "GET", { origin: "https://evil.example" })).status).toBe(403);
    // an Authorization header grants nothing: there is no token tier any more
    expect((await call("url=https://example.com/", "GET", { authorization: "Bearer forged.token.value" })).status).toBe(403);
    expect((await call("url=https://example.com/", "GET", site)).status).toBe(200);
    expect((await call("url=https://example.com/&max=4000000", "GET", site)).status).toBe(200);
    globalThis.fetch = realFetch;
  });
  test("callers are rate limited per address", () => {
    const t = Date.now();
    let limited = 0;
    for (let i = 0; i < 130; i++) if (rateLimited("a:9.9.9.9", 120, t)) limited++;
    expect(limited).toBe(10);
    expect(rateLimited("a:9.9.9.9", 120, t + 61_000)).toBe(false);
  });
  test("refuses SSRF targets, bad schemes and ports", async () => {
    stub();
    for (const u of ["http://127.0.0.1/", "http://169.254.169.254/latest", "http://localhost/", "ftp://example.com/", "https://example.com:22/", "https://u:p@example.com/", "https://app.pages.dev/x"]) {
      const r = await call(`url=${encodeURIComponent(u)}`, "GET", site);
      expect([400, 403]).toContain(r.status);
    }
    expect((await call("url=https://example.com/", "POST", site)).status).toBe(405);
    globalThis.fetch = realFetch;
  });
  test("relays status, headers and a capped body without following redirects", async () => {
    let seenRedirect: RequestRedirect | undefined;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(input?.url ?? input);
      seenRedirect = init?.redirect;
      if (url.endsWith("/moved")) return new Response(null, { status: 301, headers: { location: "https://example.com/new" } });
      return new Response("x".repeat(5000), { status: 200, headers: { "content-type": "text/html", "x-test": "1" } });
    }) as typeof fetch;
    const ok = await call(`url=${encodeURIComponent("https://example.com/")}&max=2000`, "GET", site);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-wi-status")).toBe("200");
    expect(JSON.parse(decodeURIComponent(ok.headers.get("x-wi-headers")!))["x-test"]).toEqual(["1"]);
    expect((await ok.arrayBuffer()).byteLength).toBe(2000);
    expect(seenRedirect).toBe("manual");
    const mv = await call(`url=${encodeURIComponent("https://example.com/moved")}`, "GET", site);
    expect(mv.headers.get("x-wi-status")).toBe("301");
    expect(JSON.parse(decodeURIComponent(mv.headers.get("x-wi-headers")!)).location).toEqual(["https://example.com/new"]);
    globalThis.fetch = realFetch;
  });
});
