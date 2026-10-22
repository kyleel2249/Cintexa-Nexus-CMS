/** Competitor Discovery Agent against deterministic fixtures: fake search API, fake network, in-memory repo. No live websites. */
import { beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_WI_SETTINGS, MemoryRepo, addManualCompetitor, configureEngine, discoverCompetitors, type SafeFetchResult, type SearchHit, type SearchOutcome } from "../src/index";

const OWNER = "user-1";
const OTHER = "user-2";
let SITE = "acme-hosting.io";
let siteCounter = 0;

const html = (title: string, desc: string, h1: string, lang = "en") => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${desc}"></head><body><h1>${h1}</h1></body></html>`;
const SITES: Record<string, { html?: string; robots?: string; status?: number }> = {
  "rival-a.com": { html: html("RivalA | Managed cloud hosting for small business", "Managed cloud hosting with daily backups and uptime monitoring for small business websites.", "Cloud hosting for small business") },
  "rival-b.net": { html: html("RivalB - Hosting plans", "Affordable hosting plans, website backups and monitoring for small businesses.", "Hosting plans with backups") },
  "potterybarn.example": { html: html("Handmade ceramic mugs", "Pottery classes and handmade ceramic mugs and gifts.", "Ceramics studio") },
  "blocked-rival.com": { html: html("Blocked | Managed cloud hosting", "Managed cloud hosting backups for small business.", "Hosting"), robots: "User-agent: *\nDisallow: /\n" },
  "clutch.co": { html: html("Top hosting companies", "Directory of hosting companies.", "Directory") },
};
const fetched: string[] = [];

function fakeFetch(url: string): SafeFetchResult {
  const u = new URL(url);
  fetched.push(`${u.hostname}${u.pathname}`);
  const key = u.hostname.replace(/^www\./, "");
  const site = SITES[key];
  const base = { requestedUrl: url, finalUrl: url, headers: { "content-type": "text/html" }, transferBytes: 0, truncated: false, redirects: [], ttfbMs: 5, totalMs: 9, contentEncoding: null, remoteIp: "203.0.113.5", tlsProtocol: "TLSv1.3" };
  if (!site) return { ...base, ok: false, status: null, body: Buffer.from(""), error: { code: "ENOTFOUND", message: "could not resolve host", blocked: false } } as unknown as SafeFetchResult;
  if (u.pathname === "/robots.txt") return { ...base, ok: Boolean(site.robots), status: site.robots ? 200 : 404, body: Buffer.from(site.robots ?? "") } as unknown as SafeFetchResult;
  return { ...base, ok: true, status: site.status ?? 200, body: Buffer.from(site.html ?? "") } as unknown as SafeFetchResult;
}

let searchHits: Record<string, SearchHit[]> = {};
let searchFails = false;
let configured = true;
const queriesSeen: string[] = [];

const repo = new MemoryRepo();
const setup = () => configureEngine({
  net: { safeFetch: async (url) => fakeFetch(url), resolvePublic: async () => ({ addresses: [{ address: "203.0.113.5", family: 4 }] }), probeTls: async () => ({ reachable: true, authorized: true } as never), gunzip: async (b) => b },
  repo, settings: { load: async () => ({ ...DEFAULT_WI_SETTINGS }) },
  browser: { health: async () => ({ available: false, reason: "test" }), inspect: async () => ({ available: false, findings: [] }) },
  pagespeed: { configured: false, run: async () => { throw new Error("not used"); } },
  notifier: { finished: async () => undefined },
  runtime: { version: "bun-test", location: "test", browserWorkerConfigured: false },
  search: {
    get configured() { return configured; }, provider: "fixture-search",
    async search(q): Promise<SearchOutcome> {
      queriesSeen.push(q);
      if (searchFails) return { ok: false, hits: [], error: "HTTP 429" };
      return { ok: true, hits: searchHits[q] ?? searchHits["*"] ?? [] };
    },
  },
});

const pageFacts = (url: string, title: string, desc: string, depth = 0) => ({ url, finalUrl: url, depth, status: 200, title, metaDescription: desc, lang: "en", important: depth === 0 }) as never;
async function seedAudit(owner = OWNER): Promise<string> {
  const a = await repo.createAudit({ ownerId: owner, ownerEmail: null, hostname: SITE, cfg: { url: `https://${SITE}/`, websiteType: "business", profile: "standard" } as never });
  await repo.savePage(a.id, pageFacts(`https://${SITE}/`, "Acme Hosting | Managed cloud hosting for small businesses", "Managed cloud hosting, daily backups and uptime monitoring for small business websites."), null);
  await repo.savePage(a.id, pageFacts(`https://${SITE}/plans`, "Cloud hosting plans - Acme Hosting", "Hosting plans with automatic website backups for small business owners.", 1), null);
  await repo.savePage(a.id, pageFacts(`https://${SITE}/backups`, "Website backups - Acme Hosting", "Daily managed backups and monitoring for small business sites.", 1), null);
  await repo.patchAudit(a.id, { status: "completed", completedAt: new Date() });
  return a.id;
}
const hit = (url: string, rank: number, title = "Result"): SearchHit => ({ url, title, snippet: "", rank });

beforeEach(() => { setup(); SITE = `acme-hosting${++siteCounter}.io`; searchHits = {}; searchFails = false; configured = true; queriesSeen.length = 0; fetched.length = 0; });

describe("competitor discovery", () => {
  test("finds, fetches, classifies and persists evidence-backed candidates; drops social and self; downgrades directories", async () => {
    searchHits["*"] = [hit("https://rival-a.com/", 1), hit("https://www.facebook.com/acme", 2), hit(`https://${SITE}/plans`, 3), hit("https://clutch.co/web-hosting", 4), hit("https://rival-b.net/plans", 5), hit("https://potterybarn.example/", 6)];
    const id = await seedAudit();
    const r = await discoverCompetitors({ ownerId: OWNER, auditId: id });
    expect(r.searchAvailable).toBe(true);
    expect(r.queries.length).toBeGreaterThanOrEqual(2);
    expect(r.queries.every((q) => !/acme/i.test(q))).toBe(true);
    expect(r.droppedExclusions.map((d) => d.domain)).toContain("facebook.com");
    const list = await repo.listCompetitors(OWNER, SITE);
    const by = Object.fromEntries(list.map((c) => [c.domain, c]));
    expect(by[SITE]).toBeUndefined();
    expect(by["facebook.com"]).toBeUndefined();
    expect(by["rival-a.com"]?.classification).toBe("direct");
    expect(by["rival-a.com"]?.evidence.some((e) => e.kind === "search_result")).toBe(true);
    expect(by["rival-a.com"]?.evidence.some((e) => e.kind === "fetched_page")).toBe(true);
    expect(by["rival-a.com"]?.breakdown.version).toBe("competitors-1.0");
    expect(by["clutch.co"]?.classification).toBe("search");
    expect(by["potterybarn.example"]?.classification).not.toBe("direct");
    expect(r.selectedForComparison).toContain("rival-a.com");
    expect(r.selectedForComparison).not.toContain("clutch.co");
    const runs = await repo.listCompetitorRuns(OWNER, SITE);
    expect(runs[0]?.status).toBe("completed");
    expect(runs[0]?.provider).toBe("fixture-search");
  });

  test("without a search provider it reports the gap, invents nothing, and manual competitors still work", async () => {
    configured = false;
    const id = await seedAudit();
    const r = await discoverCompetitors({ ownerId: OWNER, auditId: id });
    expect(r.searchAvailable).toBe(false);
    expect(r.candidatesFound).toBe(0);
    expect(r.unavailable.join(" ")).toMatch(/search provider/i);
    expect(r.alternatives.length).toBeGreaterThan(0);
    expect(queriesSeen.length).toBe(0);
    expect(await repo.listCompetitors(OWNER, SITE)).toEqual([]);
    const add = await addManualCompetitor({ ownerId: OWNER, hostname: SITE, url: "https://www.Rival-A.com/pricing", name: "Rival A" });
    expect(add.ok).toBe(true);
    const bad = await addManualCompetitor({ ownerId: OWNER, hostname: SITE, url: "https://facebook.com/x" });
    expect(bad.ok).toBe(false);
    const self = await addManualCompetitor({ ownerId: OWNER, hostname: SITE, url: `https://blog.${SITE}` });
    expect(self.ok).toBe(false);
    const list = await repo.listCompetitors(OWNER, SITE);
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({ domain: "rival-a.com", status: "approved", userConfirmed: true, name: "Rival A" });
  });

  test("a rerun never overrides a person's decisions and deduplicates by domain", async () => {
    searchHits["*"] = [hit("https://rival-a.com/", 1), hit("https://rival-b.net/", 2)];
    const id = await seedAudit();
    await discoverCompetitors({ ownerId: OWNER, auditId: id });
    await repo.patchCompetitor(OWNER, SITE, "rival-a.com", { status: "rejected" });
    await repo.patchCompetitor(OWNER, SITE, "rival-b.net", { status: "approved", name: "Rival B (confirmed)", classification: "indirect" });
    searchHits["*"] = [hit("https://www.rival-a.com/x", 1), hit("https://shop.rival-b.net/", 1), hit("https://rival-a.com/y", 2)];
    await discoverCompetitors({ ownerId: OWNER, auditId: id });
    const list = await repo.listCompetitors(OWNER, SITE);
    expect(list.filter((c) => c.domain === "rival-a.com").length).toBe(1);
    expect(list.find((c) => c.domain === "rival-a.com")?.status).toBe("rejected");
    const b = list.find((c) => c.domain === "rival-b.net")!;
    expect(b).toMatchObject({ status: "approved", name: "Rival B (confirmed)", classification: "indirect", userConfirmed: true });
  });

  test("robots.txt is honoured: a disallowed home page is not fetched and confidence stays capped", async () => {
    searchHits["*"] = [hit("https://blocked-rival.com/", 1)];
    const id = await seedAudit();
    await discoverCompetitors({ ownerId: OWNER, auditId: id });
    expect(fetched).toContain("blocked-rival.com/robots.txt");
    expect(fetched).not.toContain("blocked-rival.com/");
    const c = (await repo.listCompetitors(OWNER, SITE)).find((x) => x.domain === "blocked-rival.com")!;
    expect(c.confidence).toBeLessThanOrEqual(0.55);
    expect(c.classification).not.toBe("direct");
    expect(c.lastVerifiedAt).toBeNull();
  });

  test("a failing search provider yields a failed run with the reason and keeps earlier data", async () => {
    searchHits["*"] = [hit("https://rival-a.com/", 1)];
    const id = await seedAudit();
    await discoverCompetitors({ ownerId: OWNER, auditId: id });
    const before = (await repo.listCompetitors(OWNER, SITE)).length;
    searchFails = true;
    const r = await discoverCompetitors({ ownerId: OWNER, auditId: id });
    expect(r.status).not.toBe("completed");
    expect(r.unavailable.join(" ")).toMatch(/HTTP 429/);
    expect((await repo.listCompetitors(OWNER, SITE)).length).toBe(before);
  });

  test("tenant isolation: another user cannot run discovery on, or read, this site's competitors", async () => {
    searchHits["*"] = [hit("https://rival-a.com/", 1)];
    const id = await seedAudit();
    await discoverCompetitors({ ownerId: OWNER, auditId: id });
    await expect(discoverCompetitors({ ownerId: OTHER, auditId: id })).rejects.toThrow(/not found/i);
    expect(await repo.listCompetitors(OTHER, SITE)).toEqual([]);
    expect(await repo.patchCompetitor(OTHER, SITE, "rival-a.com", { status: "approved" })).toBeNull();
    expect(await repo.deleteCompetitor(OTHER, SITE, "rival-a.com")).toBe(false);
  });

  test("discovery limits are respected", async () => {
    searchHits["*"] = Array.from({ length: 10 }, (_, i) => hit(`https://unknown-${i}.example/`, i + 1));
    const id = await seedAudit();
    const r = await discoverCompetitors({ ownerId: OWNER, auditId: id, options: { maxDiscover: 3, maxCompare: 2 } });
    expect(r.candidatesFound).toBeLessThanOrEqual(3);
    expect(r.selectedForComparison.length).toBeLessThanOrEqual(2);
  });
});
