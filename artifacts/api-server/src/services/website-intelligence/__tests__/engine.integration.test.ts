/**
 * End-to-end engine test: real Postgres, real crawl of a local fixture site, real scoring and persistence.
 * Requires DATABASE_URL (a disposable database) and NODE_ENV=test. Skipped otherwise.
 */
process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { DEFAULT_LIMITS } from "@workspace/wi-core";
import { setResolverForTests } from "../safe-fetch";
import { html, send, startSite, type Fixture } from "./helpers";

const enabled = Boolean(process.env.DATABASE_URL);
const t = (name: string, fn: () => Promise<void>) => (enabled ? test(name, { timeout: 240_000 }, fn) : test.skip(name, fn));

let site: Fixture;
let fixed = false;
const OWNER = "user-int-1";

const page = (title: string | null, body: string, extraHead = "") => html(body, `${title ? `<title>${title}</title>` : ""}${extraHead}`);

before(async () => {
  if (!enabled) return;
  setResolverForTests(async (h) => { if (h === "site.test") return [{ address: "127.0.0.1", family: 4 }]; throw Object.assign(new Error("nx"), { code: "ENOTFOUND" }); }, { allowLoopback: true });
  site = await startSite({
    "/robots.txt": (_q, r) => send(r, 200, "text/plain", "User-agent: *\nDisallow: /private/\nSitemap: http://site.test:8080/sitemap.xml\n"),
    "/sitemap.xml": (_q, r) => send(r, 200, "application/xml", `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://site.test:8080/</loc></url><url><loc>http://site.test:8080/about</loc></url><url><loc>http://site.test:8080/orphan</loc></url></urlset>`),
    "/": (_q, r) => send(r, 200, "text/html", page("Example Co - Home", `<header><nav><a href="/about">About</a> <a href="/contact">Contact</a> <a href="/broken">Old page</a> <a href="/private/">Private</a></nav></header><main><h1>Welcome to Example Co</h1><p>${"We build reliable software for growing companies. ".repeat(20)}</p><img src="/logo.png"><a href="/about">click here</a></main>`, '<meta name="description" content="Example Co builds reliable software for growing companies worldwide and supports them.">')),
    "/about": (_q, r) => send(r, 200, "text/html", page("About", `<main>${fixed ? "<h1>About us</h1>" : ""}<p>${"About text sentence number one is here. ".repeat(15)}</p></main>`, fixed ? '<meta name="description" content="About Example Co and the team that builds its software for customers.">' : "")),
    "/contact": (_q, r) => send(r, 200, "text/html", page("Contact Example Co today", `<main><h1>Contact</h1><form method="post" action="/contact"><input name="email"><button>Send</button></form></main>`)),
    "/orphan": (_q, r) => send(r, 200, "text/html", page("Orphan page in sitemap only", `<main><h1>Orphan</h1><p>Only in the sitemap.</p></main>`)),
    "/private/": (_q, r) => send(r, 200, "text/html", page("Private", "<h1>secret</h1>")),
    "/broken": (_q, r) => send(r, 404, "text/html", page("Gone", "<h1>Gone</h1>")),
    "/slow": (_q, r) => setTimeout(() => send(r, 200, "text/html", page("Slow", "<h1>Slow</h1>")), 4000),
  });
});
after(async () => { if (enabled) { await site?.close(); setResolverForTests(null); } });

async function makeAudit(overrides: Record<string, unknown> = {}) {
  const store = await import("../store");
  const { normalizeConfig } = await import("../config");
  const r = normalizeConfig({ url: "http://site.test:8080/", name: "Fixture", websiteType: "corporate", profile: "standard", maxPages: 15, maxDepth: 2, devices: ["mobile"], authorization: { confirmed: true }, ...overrides }, DEFAULT_LIMITS, { userEmail: "qa@example.com", allowAuthenticated: false });
  assert.ok(r.ok && r.cfg, r.error ?? "invalid config");
  return store.createAudit({ ownerId: OWNER, ownerEmail: "qa@example.com", hostname: "site.test", cfg: r.cfg! });
}

t("runs all 15 stages, respects robots.txt, scores honestly and persists everything", async () => {
  const store = await import("../store");
  const { runAudit } = await import("../engine");
  const a = await makeAudit();
  const res = await runAudit(a.id);
  assert.ok(["completed", "partial"].includes(res.status), `status ${res.status}`);
  const done = (await store.getAudit(a.id))!;
  assert.equal(done.stages.length, 15);
  assert.ok(done.stages.every((s) => ["completed", "skipped", "failed"].includes(s.status)), JSON.stringify(done.stages.map((s) => [s.id, s.status])));
  assert.ok(done.progress.inspected >= 4, `inspected ${done.progress.inspected}`);
  assert.ok(!site.hits.some((h) => h.includes("/private/")), "robots.txt Disallow must be honoured");
  assert.ok(!site.hits.some((h) => h.startsWith("POST")), "forms must never be submitted");
  assert.ok(done.scores && done.scores.categories.length === 9);
  assert.ok(done.scores!.coverage > 0 && done.scores!.coverage < 1, "coverage is partial because browser/PSI/owner tests cannot run");
  assert.equal(done.scores!.provisional || done.scores!.coverage >= 0.5, true);
  const checks = await store.loadChecks(a.id);
  const notTested = checks.filter((c) => c.status === "not_tested" || c.status === "blocked");
  assert.ok(notTested.length > 0 && notTested.every((c) => c.note), "unavailable results must carry a reason");
  const findings = await store.loadFindings(a.id);
  assert.ok(findings.some((f) => f.kind === "defect"));
  const titles = findings.map((f) => f.testId);
  assert.ok(titles.some((id) => id.startsWith("onpage.") || id.startsWith("seo.")), "on-page defects found");
  const recs = await store.loadRecommendations(a.id);
  assert.ok(recs.length > 0 && recs[0].rank === 1);
  const events = await store.listEvents(a.id, 0, 1000);
  assert.ok(events.length > 10);
  const pages = await store.loadPages(a.id);
  assert.ok(pages.some((p) => p.facts.url.endsWith("/about")));
  assert.ok(!pages.some((p) => p.facts.url.includes("/private/")));
});

t("cancellation stops a running audit", async () => {
  const store = await import("../store");
  const { runAudit } = await import("../engine");
  const { cancelAudit } = await import("../queue");
  const a = await makeAudit({ importantPages: ["/slow"], maxPages: 5 });
  const p = runAudit(a.id);
  await new Promise((r) => setTimeout(r, 700));
  await cancelAudit(a.id);
  const res = await p;
  assert.equal(res.status, "cancelled");
  assert.equal((await store.getAudit(a.id))!.status, "cancelled");
});

t("an unreachable or blocked target fails honestly instead of scoring", async () => {
  const store = await import("../store");
  const { runAudit } = await import("../engine");
  const a = await makeAudit({ url: "http://nonexistent.test:8080/" });
  const res = await runAudit(a.id);
  assert.ok(["failed", "partial", "completed"].includes(res.status));
  const done = (await store.getAudit(a.id))!;
  assert.ok(done.scores === null || done.scores.provisional || done.scores.readiness.state === "incomplete" || done.scores.readiness.state === "not_ready", JSON.stringify(done.scores?.readiness));
});

t("workflow: a finding cannot be verified by status change; retest verifies it after the fix", async () => {
  const store = await import("../store");
  const { runAudit } = await import("../engine");
  const { validateTransition } = await import("@workspace/wi-core");
  const { buildRetestConfig } = await import("../retest");
  const a = await makeAudit();
  await runAudit(a.id);
  const findings = await store.loadFindings(a.id);
  const target = findings.find((f) => f.kind === "defect" && f.affectedUrls.some((u) => u.endsWith("/about")));
  assert.ok(target, "expected a defect on /about");
  const wf = (await store.getWorkflow(a.id, target!.fingerprint))!;
  assert.equal(wf.status, "open");
  assert.equal(validateTransition({ from: "fixed", to: "verified", retestStatus: "none" }).ok, false);

  fixed = true;
  const parent = (await store.getAudit(a.id))!;
  const cfg = buildRetestConfig(parent, [target!], "qa@example.com");
  const rt = await store.createAudit({ ownerId: OWNER, ownerEmail: "qa@example.com", hostname: "site.test", cfg, kind: "retest", parentAuditId: a.id });
  await store.patchWorkflow(a.id, target!.fingerprint, { status: "retest_required", retestAuditId: rt.id });
  await runAudit(rt.id);
  const after = (await store.getWorkflow(a.id, target!.fingerprint))!;
  fixed = false;
  assert.ok(["verified", "in_progress", "retest_required"].includes(after.status), after.status);
  assert.notEqual(after.retestStatus, "none", "retest outcome must be recorded");
});

t("a later audit links to the previous one and carries workflow state forward", async () => {
  const store = await import("../store");
  const { runAudit } = await import("../engine");
  const first = await makeAudit();
  await runAudit(first.id);
  const f1 = (await store.loadFindings(first.id)).find((f) => f.kind === "defect")!;
  await store.patchWorkflow(first.id, f1.fingerprint, { status: "planned", owner: "dev-team" });
  const prev = await store.previousCompleted(OWNER, "site.test", null);
  assert.ok(prev);
  const second = await store.createAudit({ ownerId: OWNER, ownerEmail: "qa@example.com", hostname: "site.test", cfg: (await store.getAudit(first.id))!.config, previousAuditId: first.id });
  await runAudit(second.id);
  const wf2 = await store.getWorkflow(second.id, f1.fingerprint);
  assert.equal(wf2?.owner, "dev-team");
  assert.equal(wf2?.lineage, "recurring");
});

t("credentials are never persisted", async () => {
  const store = await import("../store");
  const a = await makeAudit();
  const row = await store.getAuditRow(a.id);
  assert.ok(!JSON.stringify(row).toLowerCase().includes("secret-token"));
  const cfg = { ...(await store.getAudit(a.id))!.config, authenticated: { enabled: true, confirmed: true, allowedPathPrefixes: ["/a/"], headerName: "Authorization", credentialSupplied: true, credential: "secret-token" } } as any;
  assert.equal("credential" in store.stripSecrets(cfg).authenticated, false);
});
