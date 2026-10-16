import { describe, expect, test } from "bun:test";
// @ts-ignore PagesFunction is an ambient Cloudflare type, erased at runtime
import { onRequest, blockedHost, verifyFirebaseToken, rateLimited } from "../functions/api/wi-relay";

const PROJECT = "cintexa-nexus";
const enc = (o: unknown) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");

let n = 0;
async function mint(claims: Record<string, unknown> = {}, kid = `k${++n}`) {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid, alg: "RS256", use: "sig" };
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: "RS256", kid, typ: "JWT" });
  const body = enc({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: "u1", iat: now - 5, exp: now + 3600, email: "a@b.c", ...claims });
  const sig = Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${head}.${body}`))).toString("base64url");
  return { token: `${head}.${body}.${sig}`, jwk };
}

const realFetch = globalThis.fetch;
function stub(jwk: unknown, site?: (url: string) => Response) {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input);
    if (url.includes("securetoken@system")) return new Response(JSON.stringify({ keys: [jwk] }));
    if (site) return site(url);
    return realFetch(input, init);
  }) as typeof fetch;
}
const call = (qs: string, token?: string, method = "GET", extra: Record<string, string> = {}) =>
  (onRequest as any)({ request: new Request(`https://app.pages.dev/api/wi-relay?${qs}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra } }), env: {} });
const site = { "sec-fetch-site": "same-origin" };

describe("wi-relay", () => {
  test("blockedHost covers private space", () => {
    for (const h of ["localhost", "10.0.0.1", "127.0.0.1", "169.254.169.254", "192.168.1.1", "172.20.0.1", "[::1]", "fd00::1", "foo.internal", "2130706433", "0x7f000001", "::ffff:7f00:1"]) expect(blockedHost(h)).not.toBeNull();
    for (const h of ["example.com", "8.8.8.8", "sub.example.org"]) expect(blockedHost(h)).toBeNull();
  });
  test("anonymous use works only from this site's own pages", async () => {
    const a = await mint(); stub(a.jwk, () => new Response("<html></html>", { headers: { "content-type": "text/html" } }));
    expect((await call("url=https://example.com/")).status).toBe(403); // curl-style caller
    expect((await call("url=https://example.com/", undefined, "GET", { origin: "https://evil.example" })).status).toBe(403);
    const ok = await call("url=https://example.com/", undefined, "GET", site);
    expect(ok.status).toBe(200);
    // forged or wrong-audience tokens fall back to anonymous rules instead of granting anything
    expect((await call("url=https://example.com/", a.token.slice(0, -4) + "AAAA")).status).toBe(403);
    expect((await call("url=https://example.com/", a.token.slice(0, -4) + "AAAA", "GET", site)).status).toBe(200);
    const big = await call("url=https://example.com/&max=4000000", undefined, "GET", site);
    expect(big.status).toBe(200);
  });
  test("anonymous callers are rate limited per address", () => {
    const t = Date.now();
    let limited = 0;
    for (let i = 0; i < 130; i++) if (rateLimited("a:9.9.9.9", 120, t)) limited++;
    expect(limited).toBe(10);
    expect(rateLimited("a:9.9.9.9", 120, t + 61_000)).toBe(false);
  });
  test("tokens are verified", async () => {
    const wrong = await mint({ aud: "other" }); stub(wrong.jwk);
    expect(await verifyFirebaseToken(wrong.token, PROJECT)).toBeNull();
    const good = await mint(); stub(good.jwk);
    expect((await verifyFirebaseToken(good.token, PROJECT))?.uid).toBe("u1");
    const expired = await mint({ exp: Math.floor(Date.now() / 1000) - 600 }); stub(expired.jwk);
    expect(await verifyFirebaseToken(expired.token, PROJECT)).toBeNull();
  });
  test("refuses SSRF targets, bad schemes and ports", async () => {
    const a = await mint(); stub(a.jwk);
    for (const u of ["http://127.0.0.1/", "http://169.254.169.254/latest", "http://localhost/", "ftp://example.com/", "https://example.com:22/", "https://u:p@example.com/", "https://app.pages.dev/x"]) {
      const r = await call(`url=${encodeURIComponent(u)}`, a.token);
      expect([400, 403]).toContain(r.status);
    }
    expect((await call("url=https://example.com/", a.token, "POST")).status).toBe(405);
  });
  test("relays status, headers and a capped body without following redirects", async () => {
    const a = await mint();
    let seenRedirect: RequestRedirect | undefined;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(input?.url ?? input);
      if (url.includes("securetoken@system")) return new Response(JSON.stringify({ keys: [a.jwk] }));
      seenRedirect = init?.redirect;
      if (url.endsWith("/moved")) return new Response(null, { status: 301, headers: { location: "https://example.com/new" } });
      return new Response("x".repeat(5000), { status: 200, headers: { "content-type": "text/html", "x-test": "1" } });
    }) as typeof fetch;
    const ok = await call(`url=${encodeURIComponent("https://example.com/")}&max=2000`, a.token);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-wi-status")).toBe("200");
    expect(JSON.parse(decodeURIComponent(ok.headers.get("x-wi-headers")!))["x-test"]).toEqual(["1"]);
    expect((await ok.arrayBuffer()).byteLength).toBe(2000);
    expect(seenRedirect).toBe("manual");
    const mv = await call(`url=${encodeURIComponent("https://example.com/moved")}`, a.token);
    expect(mv.headers.get("x-wi-status")).toBe("301");
    expect(JSON.parse(decodeURIComponent(mv.headers.get("x-wi-headers")!)).location).toEqual(["https://example.com/new"]);
    globalThis.fetch = realFetch;
  });
});
