/** HTTP surface of competitor management: authorization, validation, consent and tenant isolation, through the real shared route handlers. */
import { beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_WI_SETTINGS, MemoryRepo, addManualCompetitor, configureEngine } from "../src/index";
import { registerWiRoutes, type ReqLike, type ResLike, type RouterLike } from "../src/routes";

type H = (req: ReqLike, res: ResLike) => unknown;
const routes: { method: string; re: RegExp; keys: string[]; h: H }[] = [];
const router: RouterLike = {
  get: (p, h) => add("GET", p, h as H), post: (p, h) => add("POST", p, h as H), put: (p, h) => add("PUT", p, h as H), patch: (p, h) => add("PATCH", p, h as H), delete: (p, h) => add("DELETE", p, h as H),
};
function add(method: string, path: string, h: H) {
  const keys: string[] = [];
  const re = new RegExp("^" + path.replace(/:([a-zA-Z]+)/g, (_m, k) => { keys.push(k); return "([^/]+)"; }) + "$");
  routes.push({ method, re, keys, h });
}
async function call(user: { sub: string; role?: string } | null, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(path);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1] as string); });
    let status = 200; let payload: unknown;
    const res: ResLike = { status(c) { status = c; return res; }, json(b) { payload = b; return res; }, end() { return res; }, setHeader() { return undefined; }, type() { return res; }, send(b) { payload = b; return res; } };
    await r.h({ auth: user, params, query: {}, body: body ?? {}, headers: {} }, res);
    return { status, json: payload };
  }
  throw new Error(`no route ${method} ${path}`);
}

const repo = new MemoryRepo();
let searchConfigured = false;
const enqueued: string[] = [];
const A = { sub: "owner-a", email: "a@x.test" };
const B = { sub: "owner-b", email: "b@x.test" };
const ADMIN = { sub: "admin-1", role: "admin", email: "admin@x.test" };

const setup = () => {
  configureEngine({
    net: { safeFetch: async (url) => ({ ok: false, requestedUrl: url, finalUrl: url, status: null, headers: {}, body: Buffer.from(""), transferBytes: 0, truncated: false, redirects: [], ttfbMs: null, totalMs: null, contentEncoding: null, remoteIp: null, tlsProtocol: null, error: { code: "TEST", message: "offline fixture", blocked: false } }) as never, resolvePublic: async () => ({ addresses: [{ address: "203.0.113.5", family: 4 }] }), probeTls: async () => ({ reachable: true, authorized: true } as never), gunzip: async (b) => b },
    repo, settings: { load: async () => ({ ...DEFAULT_WI_SETTINGS }) },
    browser: { health: async () => ({ available: false }), inspect: async () => ({ available: false, findings: [] }) },
    pagespeed: { configured: false, run: async () => { throw new Error("unused"); } },
    notifier: { finished: async () => undefined }, runtime: { version: "t", location: "t", browserWorkerConfigured: false },
    search: { get configured() { return searchConfigured; }, provider: "fixture", search: async () => ({ ok: true, hits: [] }) },
  });
};
registerWiRoutes(router, {
  repo, settings: { load: async () => ({ ...DEFAULT_WI_SETTINGS }), save: async () => ({ ok: true, settings: DEFAULT_WI_SETTINGS }) },
  enqueue: (id) => void enqueued.push(id), cancel: async () => undefined, holdCredential: () => undefined, queueDepth: () => ({ pending: 0, active: 0 }),
  integrations: async () => [{ id: "search_provider", label: "Search", status: searchConfigured ? "available" : "not_configured", detail: searchConfigured ? "ok" : "Set BRAVE_SEARCH_API_KEY", envVars: ["BRAVE_SEARCH_API_KEY"] }],
  explain: async () => ({ text: "", source: "deterministic", disclaimer: "" }) as never,
});

let n = 0;
async function audit(owner: string, status: "completed" | "queued" = "completed"): Promise<{ id: string; host: string }> {
  const host = `site${++n}.example.com`;
  const a = await repo.createAudit({ ownerId: owner, ownerEmail: null, hostname: host, cfg: { url: `https://${host}/`, websiteType: "business", profile: "standard", modules: {} } as never });
  await repo.patchAudit(a.id, { status, completedAt: status === "completed" ? new Date() : null });
  return { id: a.id, host };
}
beforeEach(() => { setup(); searchConfigured = false; enqueued.length = 0; });

describe("competitor routes", () => {
  test("GET reports search-provider status honestly and starts empty", async () => {
    const a = await audit(A.sub);
    const r = await call(A, "GET", `/${a.id}/competitors`);
    expect(r.status).toBe(200);
    expect(r.json.competitors).toEqual([]);
    expect(r.json.searchProvider.status).toBe("not_configured");
    expect(r.json.defaults).toMatchObject({ maxDiscover: 20, maxCompare: 10 });
    expect(r.json.classes.map((c: any) => c.id)).toEqual(["direct", "indirect", "search", "aspirational", "reference"]);
  });

  test("another user gets 404 for every competitor endpoint, and an admin can read", async () => {
    const a = await audit(A.sub);
    await addManualCompetitor({ ownerId: A.sub, hostname: a.host, url: "rival.com" });
    for (const [m, p, b] of [["GET", `/${a.id}/competitors`], ["POST", `/${a.id}/competitors`, { url: "x.com" }], ["PATCH", `/${a.id}/competitors/rival.com`, { status: "rejected" }], ["DELETE", `/${a.id}/competitors/rival.com`], ["POST", `/${a.id}/competitors/discover`], ["POST", `/${a.id}/competitors/benchmark`, { authorization: { confirmed: true } }]] as const) {
      expect((await call(B, m, p, b)).status).toBe(404);
    }
    expect((await repo.listCompetitors(A.sub, a.host))[0]?.status).toBe("approved");
    expect((await call(null, "GET", `/${a.id}/competitors`)).status).toBe(404);
    expect((await call(ADMIN, "GET", `/${a.id}/competitors`)).json.competitors.length).toBe(1);
  });

  test("add validates input and never accepts social profiles or the site itself", async () => {
    const a = await audit(A.sub);
    expect((await call(A, "POST", `/${a.id}/competitors`, { url: "not a url" })).status).toBe(400);
    expect((await call(A, "POST", `/${a.id}/competitors`, { url: "https://facebook.com/someone" })).status).toBe(400);
    expect((await call(A, "POST", `/${a.id}/competitors`, { url: `https://www.${a.host}/` })).status).toBe(400);
    const ok = await call(A, "POST", `/${a.id}/competitors`, { url: "https://www.Rival.com/about", name: "Rival" });
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ domain: "rival.com", status: "approved", userConfirmed: true });
    expect((await call(A, "POST", `/${a.id}/competitors`, { url: "rival.com" })).status).toBe(201);
    expect((await call(A, "GET", `/${a.id}/competitors`)).json.competitors.length).toBe(1);
  });

  test("the number of stored competitors per site is capped", async () => {
    const a = await audit(A.sub);
    for (let i = 0; i < 100; i++) expect((await call(A, "POST", `/${a.id}/competitors`, { url: `cap-${i}-rival.com` })).status).toBe(201);
    const over = await call(A, "POST", `/${a.id}/competitors`, { url: "one-too-many-rival.com" });
    expect(over.status).toBe(400);
    expect(over.json.error).toMatch(/100 competitors/);
    expect((await call(A, "POST", `/${a.id}/competitors`, { url: "cap-5-rival.com", name: "existing still editable" })).status).toBe(201);
  });

  test("PATCH accepts only valid status and classification and records an audit event; DELETE removes", async () => {
    const a = await audit(A.sub);
    await addManualCompetitor({ ownerId: A.sub, hostname: a.host, url: "rival.com" });
    expect((await call(A, "PATCH", `/${a.id}/competitors/rival.com`, { status: "unverifiable" })).status).toBe(400);
    expect((await call(A, "PATCH", `/${a.id}/competitors/rival.com`, { status: "bogus" })).status).toBe(400);
    expect((await call(A, "PATCH", `/${a.id}/competitors/rival.com`, { classification: "enemy" })).status).toBe(400);
    expect((await call(A, "PATCH", `/${a.id}/competitors/nobody.com`, { status: "approved" })).status).toBe(404);
    const ok = await call(A, "PATCH", `/${a.id}/competitors/rival.com`, { status: "rejected", classification: "aspirational", name: "  Big Rival " });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ status: "rejected", classification: "aspirational", name: "Big Rival", classificationLabel: "Aspirational benchmark" });
    expect((await repo.listEvents(a.id)).some((e) => /rival\.com updated/.test(e.message))).toBe(true);
    expect((await call(A, "DELETE", `/${a.id}/competitors/rival.com`)).status).toBe(204);
    expect((await call(A, "DELETE", `/${a.id}/competitors/rival.com`)).status).toBe(404);
  });

  test("discover refuses unfinished audits and benchmark audits, and runs in the background otherwise", async () => {
    const queued = await audit(A.sub, "queued");
    expect((await call(A, "POST", `/${queued.id}/competitors/discover`)).status).toBe(409);
    const done = await audit(A.sub);
    const started = await call(A, "POST", `/${done.id}/competitors/discover`);
    expect(started.status).toBe(202);
    expect(started.json).toEqual({ started: true });
    const bench = await repo.createAudit({ ownerId: A.sub, ownerEmail: null, hostname: "rival.com", kind: "benchmark", parentAuditId: done.id, cfg: { url: "https://rival.com/", websiteType: "business", profile: "standard" } as never });
    await repo.patchAudit(bench.id, { status: "completed", completedAt: new Date() });
    expect((await call(A, "POST", `/${bench.id}/competitors/discover`)).status).toBe(400);
  });

  test("benchmarking requires explicit consent and at least one eligible competitor", async () => {
    const a = await audit(A.sub);
    expect((await call(A, "POST", `/${a.id}/competitors/benchmark`, {})).status).toBe(400);
    expect((await call(A, "POST", `/${a.id}/competitors/benchmark`, { authorization: { confirmed: true } })).status).toBe(409);
    expect(enqueued.length).toBe(0);
  });

  test("benchmark starts only for approved competitors, is idempotent, and never touches rejected ones", async () => {
    const a = await audit(A.sub);
    await addManualCompetitor({ ownerId: A.sub, hostname: a.host, url: "rival-one.com" });
    await addManualCompetitor({ ownerId: A.sub, hostname: a.host, url: "rival-two.com" });
    await call(A, "PATCH", `/${a.id}/competitors/rival-two.com`, { status: "rejected" });
    const body = { authorization: { confirmed: true, confirmedBy: "a@x.test" } };
    const first = await call(A, "POST", `/${a.id}/competitors/benchmark`, body);
    expect(first.status).toBe(202);
    expect(first.json.started).toEqual(["rival-one.com"]);
    expect(enqueued.length).toBe(1);
    const second = await call(A, "POST", `/${a.id}/competitors/benchmark`, body);
    expect(second.json.started).toEqual([]);
    expect(second.json.skipped[0]).toMatchObject({ domain: "rival-one.com", reason: "Already benchmarked." });
    expect(enqueued.length).toBe(1);
    const view = await call(A, "GET", `/${a.id}/competitors`);
    expect(view.json.competitors.find((c: any) => c.domain === "rival-one.com").benchmark).toMatchObject({ status: "queued" });
  });

  test("benchmarks response never calls a tiny sample an industry average", async () => {
    const a = await audit(A.sub);
    const r = await call(A, "GET", `/${a.id}/benchmarks`);
    expect(r.json.sample.level).toBe("none");
    expect(r.json.peerMedian).toBeNull();
  });
});
