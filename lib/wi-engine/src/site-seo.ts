import { jaccard } from "./html";
import { Collector, ev, inferred, measured, trunc } from "./check";
import type { AuditContext, PageSummary } from "./context";
import { blockedAssetPaths, blocksEverything, isAllowed, parseRobots } from "./robots";
import { discoverSitemap } from "./sitemap";
import { header } from "./net-types";
import { safeFetch } from "./ports";
import { normalizeUrl } from "@workspace/wi-core";

/** robots.txt and sitemap: run before the crawl because the crawler must respect robots rules. */
export async function runRobotsAndSitemap(ctx: AuditContext, c: Collector): Promise<void> {
  ctx.count.requests++;
  const r = await safeFetch(`${ctx.origin}/robots.txt`, { ...ctx.fetchOpts(), maxBytes: 512 * 1024, timeoutMs: 10_000 });
  ctx.robotsFetch = r;
  const ct = header(r, "content-type") ?? "";
  const body = r.body.toString("utf8");
  const looksHtml = /<html|<!doctype/i.test(body.slice(0, 300));
  if (r.ok && r.status === 200 && !looksHtml && !/html/i.test(ct) && r.redirects.every((h) => new URL(h.location).pathname.includes("robots"))) {
    ctx.robots = parseRobots(body);
    c.pass("seo.robots.present", { actual: `${ctx.robots.groups.length} group(s), ${ctx.robots.sitemaps.length} sitemap directive(s)`, ...measured });
    if (blocksEverything(ctx.robots)) c.fail("seo.robots.blocks_all", { actual: "Disallow: / applies to all user agents", expected: "Public content crawlable", evidence: [ev("text", "robots.txt", trunc(body, 400))], ...measured });
    else c.pass("seo.robots.blocks_all", { actual: "No blanket disallow", ...measured });
    c.check("seo.robots.sitemap_declared", ctx.robots.sitemaps.length > 0, { actual: ctx.robots.sitemaps.length ? ctx.robots.sitemaps.join(", ") : "No Sitemap directive", ...measured });
    const blocked = blockedAssetPaths(ctx.robots);
    c.check("seo.robots.blocks_assets", blocked.length === 0, { actual: blocked.length ? `Blocked: ${blocked.join(", ")}` : "No asset directories blocked", ...measured });
  } else {
    const why = !r.ok ? r.error?.message ?? "request failed" : r.status !== 200 ? `HTTP ${r.status}` : "response is HTML or redirects to another page";
    if (r.ok && r.status !== null && r.status >= 400 && r.status < 500) {
      // A missing robots.txt means "everything allowed" per RFC 9309; still reported.
      c.fail("seo.robots.present", { actual: `robots.txt: ${why}`, expected: "A plain-text robots.txt", ...measured });
      c.pass("seo.robots.blocks_all", { actual: "No robots.txt: crawling is unrestricted", ...measured });
    } else {
      c.fail("seo.robots.present", { actual: `robots.txt: ${why}`, expected: "A plain-text robots.txt", ...measured });
      c.inconclusive("seo.robots.blocks_all", `robots.txt could not be read (${why}).`);
    }
    c.fail("seo.robots.sitemap_declared", { actual: "No Sitemap directive (no robots.txt)", ...measured });
    c.na("seo.robots.blocks_assets", "No robots.txt rules to evaluate.");
  }
  ctx.sitemap = await discoverSitemap(ctx.origin, ctx.robots?.sitemaps.filter((u) => /^https?:/i.test(u)) ?? [], ctx.host, ctx.fetchOpts());
  ctx.count.requests += ctx.sitemap.checked;
  const sm = ctx.sitemap;
  if (!sm.found) {
    c.fail("seo.sitemap.present", { actual: `No sitemap found (${sm.checked} location(s) tried)`, expected: "An XML sitemap", ...measured });
    for (const id of ["seo.sitemap.valid", "seo.sitemap.entries", "seo.sitemap.coverage", "seo.sitemap.canonical_mismatch", "seo.orphans"]) c.na(id, "No sitemap.");
  } else {
    c.pass("seo.sitemap.present", { actual: `${sm.sources.length} file(s), ${sm.urls.length} URL(s)`, evidence: sm.sources.slice(0, 3).map((u) => ev("url", "sitemap", u)), ...measured });
    c.check("seo.sitemap.valid", sm.validity.valid, { actual: sm.validity.valid ? "Valid structure" : sm.validity.problems.join("; "), ...measured });
  }
}

/** Cross-page and site-level SEO analysis, run once the crawl has finished. */
export async function runSeoCrosspage(ctx: AuditContext, c: Collector, pageCollectors: Map<string, Collector>): Promise<void> {
  const pages = [...ctx.summaries.values()].filter((s) => s.isHtml && s.facts.status !== null && s.facts.status >= 200 && s.facts.status < 300);
  const indexable = pages.filter((p) => !p.noindex);

  // unique titles / descriptions
  const tally = (key: (p: PageSummary) => string | null) => {
    const m = new Map<string, string[]>();
    for (const p of pages) { const k = key(p)?.trim().toLowerCase(); if (k) m.set(k, [...(m.get(k) ?? []), p.url]); }
    return m;
  };
  const titles = tally((p) => p.facts.title);
  const descs = tally((p) => p.facts.metaDescription);
  for (const p of pages) {
    const pc = pageCollectors.get(p.url);
    if (!pc) continue;
    const t = p.facts.title?.trim().toLowerCase();
    if (!t) pc.na("onpage.title.unique", "No title.");
    else { const dup = titles.get(t) ?? []; pc.check("onpage.title.unique", dup.length <= 1, { actual: dup.length > 1 ? `Shared with ${dup.length - 1} other page(s)` : "Unique", evidence: dup.filter((u) => u !== p.url).slice(0, 3).map((u) => ev("url", "same title", u)), ...measured }); }
    const d = p.facts.metaDescription?.trim().toLowerCase();
    if (!d) pc.na("onpage.description.unique", "No description.");
    else { const dup = descs.get(d) ?? []; pc.check("onpage.description.unique", dup.length <= 1, { actual: dup.length > 1 ? `Shared with ${dup.length - 1} other page(s)` : "Unique", evidence: dup.filter((u) => u !== p.url).slice(0, 3).map((u) => ev("url", "same description", u)), ...measured }); }
  }

  // near-duplicate content
  const withShingles = pages.filter((p) => p.shingles && p.shingles.size >= 40).slice(0, 120);
  const dupPairs: [string, string, number][] = [];
  for (let i = 0; i < withShingles.length; i++) for (let j = i + 1; j < withShingles.length; j++) {
    const sim = jaccard(withShingles[i].shingles as Set<string>, withShingles[j].shingles as Set<string>);
    if (sim >= 0.9) dupPairs.push([withShingles[i].url, withShingles[j].url, sim]);
  }
  if (withShingles.length < 2) c.na("content.duplicate", "Fewer than two pages with enough text to compare.");
  else c.check("content.duplicate", dupPairs.length === 0, { actual: dupPairs.length ? `${dupPairs.length} near-duplicate pair(s), e.g. ${dupPairs[0][0]} and ${dupPairs[0][1]} (${Math.round(dupPairs[0][2] * 100)}% similar)` : `${withShingles.length} pages compared; none 90% or more similar`, evidence: dupPairs.slice(0, 3).map(([a, b, s]) => ev("text", `${Math.round(s * 100)}% similar`, `${a} | ${b}`)), ...measured });

  // sitemap relations
  const sm = ctx.sitemap;
  if (sm?.found && sm.urls.length) {
    const smSet = new Set(sm.urls);
    const sample = sm.urls.slice(0, 10);
    const bad: string[] = [];
    for (const u of sample) {
      const s = ctx.summaries.get(u);
      if (s) { if ((s.facts.status ?? 0) >= 300 || s.noindex) bad.push(`${u} (${s.noindex ? "noindex" : `HTTP ${s.facts.status}`})`); continue; }
      ctx.count.requests++;
      const r = await safeFetch(u, { ...ctx.fetchOpts(), followRedirects: false, method: "GET", maxBytes: 200 * 1024, timeoutMs: 10_000 });
      if (!r.ok || r.status === null || r.status >= 300) bad.push(`${u} (${r.status ?? r.error?.code ?? "error"})`);
      else if (/noindex/i.test(header(r, "x-robots-tag") ?? "") || /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(r.body.toString("utf8"))) bad.push(`${u} (noindex)`);
    }
    c.check("seo.sitemap.entries", bad.length === 0, { actual: bad.length ? `${bad.length} of ${sample.length} sampled URL(s) are not clean 200 pages: ${bad.slice(0, 3).join("; ")}` : `${sample.length} sampled URL(s) returned 200 and are indexable`, ...measured });
    const crawledIdx = indexable.filter((p) => p.facts.indexable !== false);
    const covered = crawledIdx.filter((p) => smSet.has(normalizeUrl(p.facts.finalUrl) ?? p.url) || smSet.has(p.url)).length;
    const ratio = crawledIdx.length ? covered / crawledIdx.length : 1;
    c.check("seo.sitemap.coverage", ratio >= 0.9, { actual: `${Math.round(ratio * 100)}% of ${crawledIdx.length} crawled indexable page(s) are in the sitemap`, expected: "At least 90%", note: ctx.cfg.maxPages <= crawledIdx.length ? "The crawl hit its page limit; coverage reflects the sampled pages only." : undefined, ...measured });
    const mism = pages.filter((p) => smSet.has(p.url) && p.canonicalNorm && p.canonicalNorm !== (normalizeUrl(p.facts.finalUrl) ?? ""));
    c.check("seo.sitemap.canonical_mismatch", mism.length === 0, { actual: mism.length ? `${mism.length} sitemap URL(s) canonicalise elsewhere` : "Sitemap URLs are self-canonical", evidence: mism.slice(0, 3).map((p) => ev("url", "sitemap URL", `${p.url} -> ${p.canonicalNorm}`)), ...measured });
    // orphans: sitemap URLs never linked from a crawled page
    const linked = new Set<string>();
    for (const p of ctx.summaries.values()) for (const l of p.links) if (l.internal) linked.add(l.href);
    const fullCrawl = ctx.summaries.size < ctx.cfg.maxPages;
    const orphans = sm.urls.filter((u) => !linked.has(u) && u !== ctx.startUrl);
    if (!fullCrawl) c.inconclusive("seo.orphans", "The crawl stopped at its page limit, so unreachable pages cannot be distinguished from pages not yet reached.");
    else c.check("seo.orphans", orphans.length / Math.max(sm.urls.length, 1) <= 0.1, { actual: `${orphans.length} of ${sm.urls.length} sitemap URL(s) have no internal link from a crawled page`, evidence: orphans.slice(0, 4).map((u) => ev("url", "no inbound link", u)), ...measured });
  }

  // staging
  const looksStaging = /(^|[.-])(staging|stage|stg|dev|uat|qa|preview|test|sandbox|demo)([.-]|$)/i.test(ctx.host);
  if (!looksStaging) c.pass("seo.staging.exposed", { actual: "Host does not look like a staging environment", ...inferred });
  else {
    const home = ctx.summaries.get(ctx.startUrl) ?? [...ctx.summaries.values()][0];
    const protectedFromIndex = Boolean(home?.noindex) || (ctx.robots ? !isAllowed(ctx.robots, "/", "Googlebot") : false);
    c.check("seo.staging.exposed", protectedFromIndex, { actual: protectedFromIndex ? "Staging-like host is protected from indexing" : `${ctx.host} looks like a staging environment and is indexable`, ...inferred });
  }

  // favicon
  const home = ctx.home;
  if (home) {
    if (home.favicon) c.pass("onpage.favicon", { actual: home.favicon, ...measured });
    else {
      ctx.count.requests++;
      const r = await safeFetch(`${ctx.origin}/favicon.ico`, { ...ctx.fetchOpts(), maxBytes: 64 * 1024, timeoutMs: 8000 });
      c.check("onpage.favicon", r.ok && r.status === 200 && !/html/i.test(header(r, "content-type") ?? ""), { actual: r.status === 200 ? "/favicon.ico found" : "No favicon declared or found", ...measured });
    }
    const wanted = ["Organization", "LocalBusiness", "WebSite", "Person", "Corporation", "OnlineStore", "Store", "NGO", "EducationalOrganization"];
    const types = home.schemaTypes;
    c.check("schema.homepage.entity", types.some((t) => wanted.includes(t) || /Business|Store|Service$/.test(t)), { actual: types.length ? `Types: ${types.slice(0, 6).join(", ")}` : "No structured data on the homepage", expected: "Organization, LocalBusiness or WebSite markup", ...measured });
  }
  c.notTested("schema.eligibility", "Google rich-result eligibility can only be confirmed through an authorised Search Console connection or the Rich Results Test; syntax validity is reported separately.");
}
