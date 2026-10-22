/** Recommendation approval workflow: authorization, approvals, optimistic concurrency, retest/rescan verification and the Action Agent gate, through the real route handlers. */
import { beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_WI_SETTINGS, MemoryRepo, applyVerificationOutcome, configureEngine, executionGate, reconcileAfterAudit, transitionRecommendation, type WiSettings } from "../src/index";
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
let fourEyes = false;
const enqueued: string[] = [];
const A = { sub: "owner-a", email: "a@x.test" };
const B = { sub: "owner-b", email: "b@x.test" };
const ADMIN = { sub: "admin-1", role: "admin", email: "admin@x.test" };

const setup = () => {
  configureEngine({
    net: { safeFetch: async (url) => ({ ok: false, requestedUrl: url, finalUrl: url, status: null, headers: {}, body: Buffer.from(""), transferBytes: 0, truncated: false, redirects: [], ttfbMs: null, totalMs: null, contentEncoding: null, remoteIp: null, tlsProtocol: null, error: { code: "TEST", message: "offline fixture", blocked: false } }) as never, resolvePublic: async () => ({ addresses: [{ address: "203.0.113.5", family: 4 }] }), probeTls: async () => ({ reachable: true, authorized: true } as never), gunzip: async (b) => b },
    repo, settings: { load: async () => ({ ...DEFAULT_WI_SETTINGS, requireSeparateApprover: fourEyes }) },
    browser: { health: async () => ({ available: false }), inspect: async () => ({ available: false, findings: [] }) },
    pagespeed: { configured: false, run: async () => { throw new Error("unused"); } },
    notifier: { finished: async () => undefined }, runtime: { version: "t", location: "t", browserWorkerConfigured: false },
    search: { get configured() { return searchConfigured; }, provider: "fixture", search: async () => ({ ok: true, hits: [] }) },
  });
};
registerWiRoutes(router, {
  repo, settings: { load: async () => ({ ...DEFAULT_WI_SETTINGS, requireSeparateApprover: fourEyes }), save: async () => ({ ok: true, settings: DEFAULT_WI_SETTINGS }) },
  enqueue: (id) => void enqueued.push(id), cancel: async () => undefined, holdCredential: () => undefined, queueDepth: () => ({ pending: 0, active: 0 }),
  integrations: async () => [{ id: "search_provider", label: "Search", status: searchConfigured ? "available" : "not_configured", detail: searchConfigured ? "ok" : "Set BRAVE_SEARCH_API_KEY", envVars: ["BRAVE_SEARCH_API_KEY"] }],
  explain: async () => ({ text: "", source: "deterministic", disclaimer: "" }) as never,
});


let n = 0;
const FP = "fp-missing-title";
const finding = (fp: string, testId: string) => ({
  fingerprint: fp, testId, category: "seo", subcategory: "meta", tags: [], title: `Defect ${testId}`, kind: "defect", status: "failed", severity: "high", confidence: "high", provenance: "measured",
  verification: "verified", description: "d", affectedUrls: ["https://x.test/"], affectedCount: 1, applicableCount: 1, evidence: [], observedAt: new Date().toISOString(), impact: "i", measurementMethod: "m",
  rootCause: "r", fix: "f", implementation: "impl", effort: "low", verify: "v", refs: [], dependsOn: [], priorityScore: 80, horizon: "immediate",
}) as never;
const rec = (fp: string, testId: string) => ({
  fingerprint: fp, testId, rank: 1, title: `Fix ${testId}`, category: "seo", severity: "high", horizon: "immediate", priorityScore: 80, problem: "p", evidenceSummary: "e", affectedUrls: [], correction: "c",
  implementation: "i", expectedOutcome: "o", effort: "low", effortHours: [1, 2], dependencies: [], riskOfInaction: "r", verification: "v", refs: [], verification_state: "verified",
}) as never;
const result = (testId: string, status: string) => ({ testId, status, provenance: "measured", confidence: "high", observedAt: new Date().toISOString() }) as never;

async function audit(owner: string, opts: { host?: string; fp?: string; testId?: string; kind?: "audit" | "retest"; parent?: string } = {}): Promise<{ id: string; host: string; fp: string; testId: string }> {
  const host = opts.host ?? `site${++n}.example.com`;
  const fp = opts.fp ?? FP; const testId = opts.testId ?? "seo.title";
  const a = await repo.createAudit({ ownerId: owner, ownerEmail: null, hostname: host, cfg: { url: `https://${host}/`, websiteType: "business", profile: "standard", modules: {} } as never, kind: opts.kind ?? "audit", parentAuditId: opts.parent ?? null });
  await repo.patchAudit(a.id, { status: "completed", completedAt: new Date() });
  await repo.replaceFindings(a.id, [finding(fp, testId)], new Map());
  await repo.saveRecommendations(a.id, [rec(fp, testId)]);
  return { id: a.id, host, fp, testId };
}
const T = (a: { id: string; fp: string }, to: string, extra: Record<string, unknown> = {}, who = A) => call(who, "POST", `/${a.id}/recommendations/${a.fp}/transition`, { to, ...extra });
const status = async (a: { id: string; fp: string }) => (await call(A, "GET", `/${a.id}/recommendations`)).json.recommendations[0].workflow.status;
/** Walks a recommendation to APPROVED through the real endpoints. */
async function approve(a: { id: string; fp: string }) {
  expect((await T(a, "READY")).status).toBe(200);
  expect((await T(a, "AWAITING_APPROVAL")).status).toBe(200);
  expect((await T(a, "APPROVED", { note: "ok" })).status).toBe(200);
}
beforeEach(() => { setup(); searchConfigured = false; fourEyes = false; enqueued.length = 0; });

describe("recommendation workflow: authorization", () => {
  test("listing starts at NEW with only the transitions this user may take, and counts every status", async () => {
    const a = await audit(A.sub);
    const r = await call(A, "GET", `/${a.id}/recommendations`);
    expect(r.status).toBe(200);
    expect(r.json.recommendations[0].workflow.status).toBe("NEW");
    expect(r.json.recommendations[0].execution.allowed).toBe(false);
    expect(r.json.counts.NEW).toBe(1);
    expect(r.json.statuses.length).toBe(11);
    expect(r.json.recommendations[0].allowed.map((x: any) => x.to)).toContain("READY");
  });

  test("another user gets 404 on every endpoint and nothing changes", async () => {
    const a = await audit(A.sub);
    for (const [m, p, b] of [["GET", `/${a.id}/recommendations`], ["POST", `/${a.id}/recommendations/${a.fp}/transition`, { to: "READY" }], ["PATCH", `/${a.id}/recommendations/${a.fp}`, { assignee: "x" }], ["GET", `/${a.id}/recommendations/${a.fp}/history`], ["POST", `/${a.id}/recommendations/${a.fp}/verify`]] as const) {
      expect((await call(B, m, p, b)).status).toBe(404);
    }
    expect(await status(a)).toBe("NEW");
  });

  test("rejects unknown statuses and impossible jumps, and 404s an unknown fingerprint", async () => {
    const a = await audit(A.sub);
    expect((await T(a, "NOPE")).status).toBe(400);
    expect((await T(a, "VERIFIED", { evidence: { method: "manual", note: "I looked at it carefully" } })).status).toBeGreaterThanOrEqual(400);
    expect((await T(a, "APPROVED")).status).toBeGreaterThanOrEqual(400);
    expect((await call(A, "POST", `/${a.id}/recommendations/unknown/transition`, { to: "READY" })).status).toBe(404);
    expect(await status(a)).toBe("NEW");
  });

  test("agents can propose but never approve, reject, defer or verify", async () => {
    const a = await audit(A.sub);
    const agent = { kind: "agent", id: "marketing-agent" } as const;
    expect((await transitionRecommendation({ auditId: a.id, fingerprint: a.fp, to: "READY", actor: agent })).ok).toBe(true);
    expect((await transitionRecommendation({ auditId: a.id, fingerprint: a.fp, to: "AWAITING_APPROVAL", actor: agent })).ok).toBe(true);
    for (const to of ["APPROVED", "REJECTED", "DEFERRED"] as const) {
      const r = await transitionRecommendation({ auditId: a.id, fingerprint: a.fp, to, actor: agent, note: "I decide" });
      expect(r.ok).toBe(false);
    }
    expect(await status(a)).toBe("AWAITING_APPROVAL");
    expect((await executionGate(a.id, a.fp)).allowed).toBe(false);
  });
});

describe("recommendation workflow: approval and the Action Agent gate", () => {
  test("approval is recorded with who and when, and only then may the Action Agent run", async () => {
    const a = await audit(A.sub);
    expect((await executionGate(a.id, a.fp)).allowed).toBe(false);
    await approve(a);
    const gate = await executionGate(a.id, a.fp);
    expect(gate.allowed).toBe(true);
    const h = await call(A, "GET", `/${a.id}/recommendations/${a.fp}/history`);
    expect(h.json.approvals.length).toBe(1);
    expect(h.json.approvals[0]).toMatchObject({ decision: "approved", decidedBy: "a@x.test" });
    expect(h.json.events.map((e: any) => e.to)).toEqual(expect.arrayContaining(["READY", "AWAITING_APPROVAL", "APPROVED"]));
  });

  test("rejected and deferred recommendations are not executable", async () => {
    const a = await audit(A.sub);
    await T(a, "READY"); await T(a, "AWAITING_APPROVAL");
    expect((await T(a, "REJECTED", { note: "not now, wrong priority" })).status).toBe(200);
    expect((await executionGate(a.id, a.fp)).allowed).toBe(false);
    const b = await audit(A.sub);
    await T(b, "READY"); await T(b, "AWAITING_APPROVAL");
    expect((await T(b, "DEFERRED", { note: "next quarter" })).status).toBe(200);
    expect((await executionGate(b.id, b.fp)).allowed).toBe(false);
  });

  test("an approval older than the 30 day window stops authorizing execution", async () => {
    const a = await audit(A.sub);
    await approve(a);
    const later = new Date(Date.now() + 31 * 86400_000);
    expect((await executionGate(a.id, a.fp, later)).allowed).toBe(false);
  });

  test("four-eyes: when enabled the requester cannot approve their own request, but another owner/admin can", async () => {
    fourEyes = true;
    const a = await audit(A.sub);
    await T(a, "READY"); await T(a, "AWAITING_APPROVAL");
    expect((await T(a, "APPROVED", { note: "self approve" })).status).toBe(403);
    expect((await T(a, "APPROVED", { note: "second person" }, ADMIN)).status).toBe(200);
    expect((await executionGate(a.id, a.fp)).allowed).toBe(true);
  });

  test("stale writes are refused: a second change based on an old version gets 409 and the current state", async () => {
    const a = await audit(A.sub);
    const first = await T(a, "READY");
    const v = first.json.workflow.version;
    expect((await T(a, "AWAITING_APPROVAL", { expectedVersion: v })).status).toBe(200);
    const stale = await T(a, "DEFERRED", { expectedVersion: v, note: "based on stale view" });
    expect(stale.status).toBe(409);
    expect(await status(a)).toBe("AWAITING_APPROVAL");
  });

  test("assignment is recorded in history and is tenant-isolated", async () => {
    const a = await audit(A.sub);
    expect((await call(A, "PATCH", `/${a.id}/recommendations/${a.fp}`, { assignee: "dev@x.test" })).json.workflow.assignee).toBe("dev@x.test");
    expect((await call(A, "PATCH", `/${a.id}/recommendations/${a.fp}`, { assignee: 5 })).status).toBe(400);
    const h = await call(A, "GET", `/${a.id}/recommendations/${a.fp}/history`);
    expect(h.json.events.some((e: any) => e.action === "assigned")).toBe(true);
  });
});

describe("recommendation workflow: independent verification", () => {
  test("implemented -> verify starts a targeted retest and moves to VERIFYING; the requester cannot mark it verified without evidence", async () => {
    const a = await audit(A.sub);
    await approve(a);
    expect((await T(a, "IN_PROGRESS")).status).toBe(200);
    expect((await T(a, "IMPLEMENTED", { note: "deployed" })).status).toBe(200);
    expect((await T(a, "VERIFIED")).status).toBe(400);
    expect((await T(a, "VERIFIED", { evidence: { method: "manual", note: "short" } })).status).toBeGreaterThanOrEqual(400);
    const v = await call(A, "POST", `/${a.id}/recommendations/${a.fp}/verify`);
    expect(v.status).toBe(202);
    expect(enqueued).toContain(v.json.id);
    expect(await status(a)).toBe("VERIFYING");
  });

  test("verify is refused for a recommendation that has not been implemented", async () => {
    const a = await audit(A.sub);
    expect((await call(A, "POST", `/${a.id}/recommendations/${a.fp}/verify`)).status).toBe(409);
  });

  test("a passing retest verifies; a failing retest marks FAILED; an inconclusive one changes nothing", async () => {
    for (const [outcome, expected] of [["passed", "VERIFIED"], ["failed", "FAILED"], ["inconclusive", "VERIFYING"]] as const) {
      const a = await audit(A.sub);
      await approve(a); await T(a, "IN_PROGRESS"); await T(a, "IMPLEMENTED", { note: "deployed" });
      const v = await call(A, "POST", `/${a.id}/recommendations/${a.fp}/verify`);
      await applyVerificationOutcome(a.id, a.fp, outcome, { method: "retest", auditId: v.json.id, testId: a.testId });
      expect(await status(a)).toBe(expected);
    }
  });

  test("manual verification by the owner needs a documented note and is recorded as manual evidence", async () => {
    const a = await audit(A.sub);
    await approve(a); await T(a, "IN_PROGRESS"); await T(a, "IMPLEMENTED", { note: "deployed" });
    expect((await T(a, "VERIFYING")).status).toBe(200);
    const ok = await T(a, "VERIFIED", { note: "Checked live page source and Search Console on 22 Oct", evidence: { method: "manual" } });
    expect(ok.status).toBe(200);
    expect(ok.json.workflow.verification).toMatchObject({ method: "manual", outcome: "passed" });
  });

  test("a user cannot cite someone else's audit, an unfinished audit, or a retest where the test did not pass", async () => {
    const a = await audit(A.sub);
    await approve(a); await T(a, "IN_PROGRESS"); await T(a, "IMPLEMENTED", { note: "deployed" });
    expect((await T(a, "VERIFYING")).status).toBe(200);
    const foreign = await audit(B.sub);
    expect((await T(a, "VERIFIED", { evidence: { method: "retest", auditId: foreign.id } })).status).toBe(400);
    expect((await T(a, "VERIFIED", { evidence: { method: "retest", auditId: "nonexistent" } })).status).toBe(400);
    const own = await audit(A.sub, { host: a.host, kind: "retest", parent: a.id });
    await repo.saveChecks(own.id, "https://x.test/", [result(a.testId, "failed")]);
    expect((await T(a, "VERIFIED", { evidence: { method: "retest", auditId: own.id } })).status).toBe(400);
    await repo.saveChecks(own.id, "https://x.test/", [result(a.testId, "passed")]);
    expect((await T(a, "VERIFIED", { evidence: { method: "retest", auditId: own.id } })).status).toBe(200);
  });

  test("a later audit verifies only when the test actually ran and passed; a defect that merely vanished is not treated as fixed", async () => {
    const a = await audit(A.sub);
    await approve(a); await T(a, "IN_PROGRESS"); await T(a, "IMPLEMENTED", { note: "deployed" });
    const silent = await audit(A.sub, { host: a.host, fp: "other-fp", testId: "seo.other" });
    const r1 = await reconcileAfterAudit(silent.id, a.id, [result("seo.other", "failed")]);
    expect(r1.verified).toBe(0);
    expect(await status(a)).toBe("IMPLEMENTED");
    const clean = await audit(A.sub, { host: a.host, fp: "other-fp", testId: "seo.other" });
    const r2 = await reconcileAfterAudit(clean.id, a.id, [result(a.testId, "passed")]);
    expect(r2.verified).toBe(1);
    expect(await status(a)).toBe("VERIFIED");
  });

  test("a fix that did not hold is FAILED; a verified item that comes back is a regression returning to READY; an approved item stays approved", async () => {
    const f = await audit(A.sub);
    await approve(f); await T(f, "IN_PROGRESS"); await T(f, "IMPLEMENTED", { note: "deployed" });
    const again = await audit(A.sub, { host: f.host, fp: f.fp, testId: f.testId });
    const r = await reconcileAfterAudit(again.id, f.id, [result(f.testId, "failed")]);
    expect(r.failed).toBe(1);
    expect(await status(f)).toBe("FAILED");

    const g = await audit(A.sub);
    await approve(g); await T(g, "IN_PROGRESS"); await T(g, "IMPLEMENTED", { note: "deployed" });
    await T(g, "VERIFYING");
    await T(g, "VERIFIED", { note: "Confirmed in production by manual review", evidence: { method: "manual" } });
    const back = await audit(A.sub, { host: g.host, fp: g.fp, testId: g.testId });
    const rg = await reconcileAfterAudit(back.id, g.id, [result(g.testId, "failed")]);
    expect(rg.regressed).toBe(1);
    const wf = (await repo.getRecWorkflow(back.id, g.fp))!;
    expect(wf.status).toBe("READY");

    const h = await audit(A.sub);
    await approve(h);
    const next = await audit(A.sub, { host: h.host, fp: h.fp, testId: h.testId });
    await reconcileAfterAudit(next.id, h.id, [result(h.testId, "failed")]);
    expect((await repo.getRecWorkflow(next.id, h.fp))!.status).toBe("APPROVED");
  });
});
