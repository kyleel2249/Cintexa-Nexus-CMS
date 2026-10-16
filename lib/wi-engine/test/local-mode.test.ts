/** End-to-end local mode: real engine, real crawl of a fixture site, MemoryRepo, relay protocol shim, no API server and no database. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MemoryRepo, createLocalRuntime, type StoredAudit } from "../src/index-local";

let server: ReturnType<typeof Bun.serve>;
const hits: string[] = [];
const PORT = 8080;
const page = (t: string, body: string, head = "") => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${t ? `<title>${t}</title>` : ""}${head}</head><body>${body}</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });

beforeAll(() => {
  server = Bun.serve({
    port: PORT, hostname: "127.0.0.1",
    fetch(req) {
      const u = new URL(req.url); hits.push(`${req.method} ${u.pathname}`);
      switch (u.pathname) {
        case "/robots.txt": return new Response(`User-agent: *\nDisallow: /private/\nSitemap: http://site.test:${PORT}/sitemap.xml\n`, { headers: { "content-type": "text/plain" } });
        case "/sitemap.xml": return new Response(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://site.test:${PORT}/</loc></url><url><loc>http://site.test:${PORT}/about</loc></url></urlset>`, { headers: { "content-type": "application/xml" } });
        case "/": return page("Example Co - Home", `<main><h1>Welcome</h1><p>${"We build reliable software for growing companies. ".repeat(20)}</p><a href="/about">About</a> <a href="/contact">Contact</a> <a href="/private/">Private</a> <a href="/old">Old</a></main>`, '<meta name="description" content="Example Co builds reliable software for growing companies worldwide and supports them.">');
        case "/about": return page("About", `<main><p>${"About text. ".repeat(40)}</p></main>`);
        case "/contact": return page("Contact Example Co today", `<main><h1>Contact</h1><form method="post" action="/contact"><input name="email"><button>Send</button></form></main>`);
        case "/old": return new Response(null, { status: 301, headers: { location: `http://site.test:${PORT}/about` } });
        case "/private/": return page("Private", "<h1>secret</h1>");
        default: return new Response("gone", { status: 404 });
      }
    },
  });
});
afterAll(() => server.stop(true));

/** Speaks the relay's wire protocol and DoH, backed by the local fixture. */
const relayShim: typeof fetch = async (input, init) => {
  const url = new URL(String(typeof input === "string" ? input : (input as Request).url), "https://app.test");
  if (url.hostname === "cloudflare-dns.com") {
    const name = url.searchParams.get("name"); const type = url.searchParams.get("type");
    if (name === "site.test") return Response.json({ Status: 0, Answer: type === "A" ? [{ type: 1, data: "93.184.216.34" }] : [] });
    return Response.json({ Status: 3 });
  }
  if (url.pathname === "/api/wi-relay") {
    const target = new URL(url.searchParams.get("url")!);
    const real = `http://127.0.0.1:${target.port}${target.pathname}${target.search}`;
    const up = await fetch(real, { method: init?.method ?? "GET", redirect: "manual" });
    const hdrs: Record<string, string[]> = {};
    up.headers.forEach((v, k) => { (hdrs[k] ??= []).push(v); });
    return new Response(up.status === 301 ? null : await up.arrayBuffer(), { status: 200, headers: { "x-wi-status": String(up.status), "x-wi-final-url": target.toString(), "x-wi-ttfb": "5", "x-wi-headers": encodeURIComponent(JSON.stringify(hdrs)) } });
  }
  throw new Error(`unexpected fetch ${url}`);
};

const memory = new Map<string, string>();
const repo = new MemoryRepo();
const rt = createLocalRuntime({
  user: { id: "local-user", email: "qa@example.com" },
  net: { relayUrl: "/api/wi-relay", getToken: async () => null, fetchImpl: relayShim, dohUrl: "https://cloudflare-dns.com/dns-query" },
  repo, settingsStore: { read: () => memory.get("s") ?? null, write: (v) => void memory.set("s", v) }, pageSpeedKey: () => null, runtimeVersion: "bun-test", fetchImpl: relayShim,
});
const call = async (method: string, path: string, body?: unknown) => { const r = await rt.handle({ method, path, body }); return { status: r.status, json: r.contentType.includes("json") && r.body ? JSON.parse(r.body) : null, text: r.body, headers: r.headers }; };

describe("local mode", () => {
  let id = "";
  test("meta works without a server and reports local limits", async () => {
    const r = await call("GET", "/meta");
    expect(r.status).toBe(200);
    expect(r.json.totalTests).toBeGreaterThan(150);
    expect(r.json.allowAuthenticatedScope).toBe(false);
    expect(r.json.allowPublicShare).toBe(false);
  });
  test("runs a complete audit in-process", async () => {
    const c = await call("POST", "/", { url: `http://site.test:${PORT}/`, name: "Fixture", websiteType: "corporate", profile: "standard", maxPages: 10, maxDepth: 2, devices: ["mobile"], authorization: { confirmed: true } });
    expect(c.status).toBe(202);
    id = c.json.id;
    const deadline = Date.now() + 90_000;
    let st = "";
    while (Date.now() < deadline) { st = (await call("GET", `/${id}`)).json.status; if (!["queued", "running"].includes(st)) break; await Bun.sleep(150); }
    expect(["completed", "partial"]).toContain(st);
    const b = (await call("GET", `/${id}/bundle`)).json;
    expect(b.audit.stages.length).toBe(15);
    expect(b.pages.length).toBeGreaterThanOrEqual(3);
    expect(b.audit.scores.categories.length).toBe(9);
    expect(b.findings.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.includes("/private/"))).toBe(false);
    expect(hits.some((h) => h.startsWith("POST"))).toBe(false);
    expect(b.audit.environment.runtime ?? JSON.stringify(b.audit.environment)).toContain("browser");
  }, 120_000);
  test("browser-impossible checks are not tested, never failed", async () => {
    const f = (await call("GET", `/${id}/bundle`)).json.findings as { testId: string; status: string }[];
    for (const t of f.filter((x) => x.testId.startsWith("infra.tls."))) expect(["not_tested"]).toContain(t.status);
    expect(f.find((x) => x.testId === "perf.compression")?.status ?? "inconclusive").not.toBe("fail");
  });
  test("workflow, tasks, export, gate and explanation work locally", async () => {
    const b = (await call("GET", `/${id}/bundle`)).json;
    const fp = b.findings.find((x: { kind: string }) => x.kind === "defect").fingerprint;
    expect((await call("PATCH", `/${id}/findings/${fp}`, { status: "in_progress", owner: "me" })).status).toBe(200);
    const t = await call("POST", `/${id}/tasks`, { title: "Fix it", fingerprint: fp });
    expect(t.status).toBe(201);
    expect((await call("GET", `/${id}/tasks`)).json.tasks.length).toBe(1);
    const csv = await call("GET", `/${id}/export?format=csv`);
    expect(csv.status).toBe(200); expect(csv.text.split("\n").length).toBeGreaterThan(2);
    expect((await call("GET", `/${id}/gate?minScore=0`)).status).toBe(200);
    expect((await call("POST", `/${id}/findings/${fp}/explain`)).json.source).toBe("deterministic");
  });
  test("server-only features answer honestly", async () => {
    expect((await call("GET", "/monitors")).json.monitors).toEqual([]);
    expect((await call("POST", "/monitors", {})).status).toBe(501);
    expect((await call("GET", `/${id}/share`)).json.shared).toBe(false);
    expect((await call("POST", `/${id}/share`)).status).toBe(501);
    const auth = await call("POST", "/", { url: `http://site.test:${PORT}/`, websiteType: "corporate", profile: "quick", authorization: { confirmed: true }, authenticated: { enabled: true, confirmed: true, headerName: "X-Key", credential: "y", allowedPathPrefixes: ["/"] } });
    expect(auth.status).toBeGreaterThanOrEqual(400);
  });
  test("private targets are refused by the transport", async () => {
    const r = await call("POST", "/", { url: "http://127.0.0.1:8080/", websiteType: "corporate", profile: "quick", authorization: { confirmed: true } });
    if (r.status === 202) {
      for (let i = 0; i < 100; i++) { const s = (await call("GET", `/${r.json.id}`)).json.status; if (!["queued", "running"].includes(s)) { expect(["failed", "cancelled", "partial"]).toContain(s); return; } await Bun.sleep(100); }
      throw new Error("did not finish");
    }
    expect(r.status).toBeGreaterThanOrEqual(400);
  }, 30_000);
  test("history survives export/import (what IndexedDB persists)", async () => {
    const snap = JSON.parse(JSON.stringify(repo.exportAudit(id))) as StoredAudit;
    const fresh = new MemoryRepo(); fresh.importAudit(snap);
    expect((await fresh.getAudit(id))?.status).toMatch(/completed|partial/);
    expect((await fresh.loadFindings(id)).length).toBeGreaterThan(0);
    expect((await fresh.listTasks(id)).length).toBe(1);
  });
  test("retest carries workflow across audits", async () => {
    const c = await call("POST", "/", { url: `http://site.test:${PORT}/`, name: "Fixture", websiteType: "corporate", profile: "standard", maxPages: 10, maxDepth: 2, devices: ["mobile"], authorization: { confirmed: true } });
    const id2 = c.json.id; expect(c.json.previousAuditId).toBe(id);
    for (let i = 0; i < 600; i++) { const s = (await call("GET", `/${id2}`)).json.status; if (!["queued", "running"].includes(s)) break; await Bun.sleep(150); }
    const b2 = (await call("GET", `/${id2}/bundle`)).json;
    expect(b2.comparison).not.toBeNull();
    expect(b2.findings.some((f: { workflow: { owner: string | null } }) => f.workflow.owner === "me")).toBe(true);
  }, 120_000);
});
