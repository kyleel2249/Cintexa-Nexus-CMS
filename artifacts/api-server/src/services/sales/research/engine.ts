/**
 * Company research engine. Deterministic extraction from public pages (no model reads page text), with per-field evidence,
 * documented confidence, robots.txt compliance, bounded crawling and honest "not found". Cancellation is checked between steps.
 */
import { wrapUntrusted } from "@workspace/intelligence/ssrf";
import { fetchText, parseRobots, SsrfError, type FetchFn } from "./fetcher";
import type { Resolver } from "@workspace/intelligence/ssrf";
import { parsePage, jsonLdNodes, typeOf, type ParsedPage } from "./html";
import { scoreConfidence, type SourceType, type Verification } from "./confidence";
import { analyseSeoAeo, serviceFitHypotheses, type SeoAeoReport } from "./seo";
import { discoverWebsite, type SearchProvider } from "./search";

export interface ResearchInput { companyName?: string; website?: string; domain?: string; country?: string; industry?: string }
export type FieldKey = "company_name" | "website" | "domain" | "description" | "email" | "phone" | "address" | "city" | "region" | "country" | "postal_code" | "industry" | "tags" | "linkedin" | "facebook" | "twitter" | "instagram" | "youtube" | "founded_year" | "products_services" | "leadership" | "seo_title" | "meta_description" | "slug" | "source_note";
export interface Proposal { field: FieldKey; value: string; kind: "fact" | "estimate" | "hypothesis"; sourceUrl: string | null; sourceTitle: string | null; sourceDomain: string | null; excerpt: string | null; retrievedAt: string; confidence: number; confidenceBasis: Record<string, unknown>; verification: Verification; conflict?: { values: string[] } }
export interface ResearchResult { proposals: Proposal[]; seoAeo: SeoAeoReport | null; hypotheses: ReturnType<typeof serviceFitHypotheses>; sources: { url: string; title: string | null; fetchedAt: string }[]; skipped: { url: string; reason: string }[]; warnings: string[]; websiteDiscovery: { via: string; provider: string | null; url: string } | null; method: string }
export interface Hooks { onStage(status: "researching" | "extracting" | "validating", progress: number, detail: string): Promise<void> | void; isCancelled(): Promise<boolean> | boolean }
export class Cancelled extends Error { constructor() { super("cancelled"); } }
export class ResearchError extends Error { constructor(public code: string, msg: string) { super(msg); } }

export function normaliseWebsite(input: ResearchInput): URL | null {
  const raw = (input.website || input.domain || "").trim();
  if (!raw) return null;
  try { const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); if (!u.hostname.includes(".")) return null; u.hash = ""; u.search = ""; return new URL(u.origin + (u.pathname === "/" ? "" : u.pathname)); } catch { return null; }
}
export const registrable = (host: string) => host.toLowerCase().replace(/^www\./, "");
const sameSite = (a: string, b: string) => { const x = registrable(a), y = registrable(b); return x === y || x.endsWith("." + y) || y.endsWith("." + x); };

const INDUSTRY_RULES: [string, RegExp][] = [
  ["Software & IT services", /\b(software|saas|app development|it services|cloud|cyber ?security|managed services|devops)\b/i],
  ["Marketing & advertising", /\b(marketing agency|advertising|branding|digital marketing|public relations|seo agency)\b/i],
  ["Construction & engineering", /\b(construction|civil engineering|contractor|building|architecture|infrastructure)\b/i],
  ["Retail & e-commerce", /\b(online store|e-?commerce|retail|shop|boutique|fashion|wholesale)\b/i],
  ["Healthcare", /\b(hospital|clinic|pharmacy|healthcare|medical|dental|diagnostic)\b/i],
  ["Education & training", /\b(school|university|college|training|academy|tuition|e-?learning)\b/i],
  ["Financial services", /\b(bank|insurance|microfinance|fintech|investment|lending|savings)\b/i],
  ["Hospitality & tourism", /\b(hotel|restaurant|catering|tourism|travel agency|resort|lodge)\b/i],
  ["Logistics & transport", /\b(logistics|freight|shipping|courier|transport|haulage|supply chain)\b/i],
  ["Agriculture & food", /\b(agriculture|farm|agribusiness|food processing|cocoa|produce)\b/i],
  ["Energy & mining", /\b(energy|solar|oil and gas|mining|power|renewable)\b/i],
  ["Manufacturing", /\b(manufactur|factory|production plant|industrial)\b/i],
  ["Real estate", /\b(real estate|property|estate agent|housing|realtor)\b/i],
  ["Professional services", /\b(consulting|consultancy|legal|law firm|accounting|audit|recruitment)\b/i],
];
const SOCIAL: [FieldKey, RegExp][] = [["linkedin", /^https?:\/\/([a-z]+\.)?linkedin\.com\/(company|school|showcase)\/[^/?#]+/i], ["facebook", /^https?:\/\/([a-z]+\.)?facebook\.com\/(?!sharer|share|dialog|tr\b|plugins)[^/?#]+/i], ["twitter", /^https?:\/\/(www\.)?(twitter|x)\.com\/(?!intent|share|home)[^/?#]+/i], ["instagram", /^https?:\/\/(www\.)?instagram\.com\/[^/?#]+/i], ["youtube", /^https?:\/\/(www\.)?youtube\.com\/(@|channel\/|c\/|user\/)[^/?#]+/i]];
const PAGE_HINTS = /(about|who-we-are|company|contact|services|solutions|products|what-we-do|team|leadership|management)/i;

interface Raw { field: FieldKey; value: string; url: string; title: string | null; excerpt: string | null; sourceType: SourceType; reliability?: number; contactLink?: boolean; kind?: Proposal["kind"] }

export async function researchCompany(input: ResearchInput, hooks: Hooks, deps: { fetchFn?: FetchFn; resolve?: Resolver; providers: SearchProvider[]; now?: () => Date; maxPages?: number }): Promise<ResearchResult> {
  const now = deps.now ?? (() => new Date());
  const warnings: string[] = [], skipped: ResearchResult["skipped"] = [], sources: ResearchResult["sources"] = [];
  const check = async () => { if (await hooks.isCancelled()) throw new Cancelled(); };
  await hooks.onStage("researching", 5, "Normalising the input");
  if ((input.website || input.domain || "").trim() && !normaliseWebsite(input)) throw new ResearchError("invalid_website", "That does not look like a valid public website address (for example acme.com or https://acme.com).");
  let site = normaliseWebsite(input), discovery: ResearchResult["websiteDiscovery"] = null;
  if (!site) {
    if (!input.companyName?.trim()) throw new ResearchError("input_required", "Enter a company name or a website.");
    if (!deps.providers.length) throw new ResearchError("no_search_provider", "No search provider is configured, so a company cannot be found from its name alone. Enter the website, or ask an administrator to set BRAVE_SEARCH_API_KEY, SERPER_API_KEY or TAVILY_API_KEY on the server.");
    await hooks.onStage("researching", 10, "Searching the public web for the official website");
    const d = await discoverWebsite(input.companyName.trim(), { country: input.country }, deps.providers);
    warnings.push(...d.errors.map((e) => `Search provider problem - ${e}`));
    if (!d.hit) throw new ResearchError("website_not_found", "No official website could be identified with confidence. Enter the website to continue.");
    site = normaliseWebsite({ website: d.hit.url })!; discovery = { via: "search", provider: d.providerId, url: site.toString() };
    warnings.push(`The website was chosen from a search result (${d.providerId}); confirm it is the right company.`);
  }
  await check();
  const host = site.hostname;
  const pages: ParsedPage[] = [];
  const readPage = async (url: string): Promise<ParsedPage | null> => {
    try {
      const f = await fetchText(url, { fetchFn: deps.fetchFn, resolve: deps.resolve });
      if (f.status >= 400) { skipped.push({ url, reason: `HTTP ${f.status}` }); return null; }
      const p = parsePage(f.body, f.finalUrl); pages.push(p); sources.push({ url: f.finalUrl, title: p.title, fetchedAt: f.fetchedAt });
      if (wrapUntrusted(p.text.slice(0, 20_000)).injectionSuspected) warnings.push(`The page ${f.finalUrl} contains text that looks like an instruction to an AI. It was ignored; only facts were extracted.`);
      return p;
    } catch (e) { skipped.push({ url, reason: e instanceof SsrfError ? `blocked: ${e.message}` : e instanceof Error ? e.message : "failed" }); return null; }
  };
  await hooks.onStage("researching", 20, "Reading robots.txt");
  let robots = parseRobots(null);
  try { const r = await fetchText(new URL("/robots.txt", site).toString(), { fetchFn: deps.fetchFn, resolve: deps.resolve, maxBytes: 200_000, timeoutMs: 6000, allow: /text\// }); if (r.status === 200) robots = parseRobots(r.body); } catch { /* optional file */ }
  const allowed = (u: string) => { try { return robots.allows(new URL(u).pathname); } catch { return false; } };
  if (!allowed(site.toString())) throw new ResearchError("robots_disallow", "The website's robots.txt asks automated tools not to read the home page, so it was not researched.");
  await hooks.onStage("researching", 30, "Reading the home page");
  const home = await readPage(site.toString());
  if (!home) throw new ResearchError("website_unreachable", `The website could not be read (${skipped[0]?.reason ?? "no response"}).`);
  await check();
  const maxPages = deps.maxPages ?? 6;
  const candidates = [...new Map(home.links.filter((l) => /^https?:/i.test(l.href)).filter((l) => { try { const u = new URL(l.href); return sameSite(u.hostname, host) && PAGE_HINTS.test(u.pathname + " " + l.text) && u.pathname !== "/" ; } catch { return false; } }).map((l) => [l.href.split("#")[0]!, l])).values()].slice(0, 12);
  const rank = (u: string) => (/contact/i.test(u) ? 0 : /about|who-we-are|company/i.test(u) ? 1 : /service|solution|product|what-we-do/i.test(u) ? 2 : 3);
  candidates.sort((a, b) => rank(a.href) - rank(b.href));
  for (const c of candidates) {
    if (pages.length >= maxPages) break;
    if (!allowed(c.href)) { skipped.push({ url: c.href, reason: "disallowed by robots.txt" }); continue; }
    await hooks.onStage("researching", 35 + Math.round((pages.length / maxPages) * 25), `Reading ${new URL(c.href).pathname}`);
    await readPage(c.href); await check();
  }
  let hasSitemap = robots.sitemaps.length > 0;
  if (!hasSitemap) { try { const s = await fetchText(new URL("/sitemap.xml", site).toString(), { fetchFn: deps.fetchFn, resolve: deps.resolve, maxBytes: 300_000, timeoutMs: 6000, allow: /xml|text\// }); hasSitemap = s.status === 200 && /<(urlset|sitemapindex)/i.test(s.body); } catch { /* none */ } }

  await hooks.onStage("extracting", 65, "Extracting facts and evidence");
  const raws: Raw[] = [];
  const nodes = jsonLdNodes(pages);
  const org = nodes.find((n) => typeOf(n).some((t) => /^(Organization|Corporation|LocalBusiness|ProfessionalService|.*Business|.*Store)$/i.test(t)));
  const orgUrl = home.url;
  const add = (r: Raw) => { const v = r.value.replace(/\s+/g, " ").trim(); if (v) raws.push({ ...r, value: v }); };
  add({ field: "website", value: site.origin, url: home.url, title: home.title, excerpt: "Address of the page that was read", sourceType: "official_page" });
  add({ field: "domain", value: registrable(host), url: home.url, title: home.title, excerpt: null, sourceType: "official_page" });
  if (org?.name) add({ field: "company_name", value: String(org.name), url: orgUrl, title: home.title, excerpt: `schema.org name: ${org.name}`, sourceType: "structured_data" });
  if (home.ogSiteName) add({ field: "company_name", value: home.ogSiteName, url: home.url, title: home.title, excerpt: `og:site_name: ${home.ogSiteName}`, sourceType: "official_page" });
  if (home.title) { const part = home.title.split(/\s[|\-–—:·]\s/).map((s) => s.trim()).filter(Boolean).sort((a, b) => a.length - b.length)[0]; if (part && part.length < 60) add({ field: "company_name", value: part, url: home.url, title: home.title, excerpt: `page title: ${home.title}`, sourceType: "official_page", reliability: 0.8 }); }
  const desc = org?.description ? { v: String(org.description), t: "structured_data" as SourceType, ex: "schema.org description" } : home.description ? { v: home.description, t: "official_page" as SourceType, ex: "meta description" } : home.ogDescription ? { v: home.ogDescription, t: "official_page" as SourceType, ex: "og:description" } : null;
  if (desc) add({ field: "description", value: desc.v.slice(0, 600), url: home.url, title: home.title, excerpt: desc.ex, sourceType: desc.t });
  for (const p of pages) {
    const contactPage = /contact/i.test(p.url);
    for (const e of p.emails) { const d = e.split("@")[1]!; add({ field: "email", value: e, url: p.url, title: p.title, excerpt: "Public email address on the page", sourceType: "official_page", contactLink: sameSite(d, host), reliability: /^(info|contact|hello|sales|enquir|support|admin|office)/i.test(e) || contactPage ? 1 : 0.85 }); }
    for (const ph of p.phones) add({ field: "phone", value: ph, url: p.url, title: p.title, excerpt: "tel: link on the page", sourceType: "official_page", contactLink: true });
    for (const l of p.links) for (const [k, re] of SOCIAL) if (re.test(l.href)) add({ field: k, value: l.href.split("?")[0]!, url: p.url, title: p.title, excerpt: "Social profile linked from the site", sourceType: "official_page" });
  }
  if (org) {
    const a = Array.isArray(org.address) ? org.address[0] : org.address;
    if (a && typeof a === "object") {
      const line = [a.streetAddress].filter(Boolean).join(", ");
      if (line) add({ field: "address", value: String(line), url: orgUrl, title: home.title, excerpt: "schema.org postalAddress", sourceType: "structured_data" });
      if (a.addressLocality) add({ field: "city", value: String(a.addressLocality), url: orgUrl, title: home.title, excerpt: "schema.org postalAddress", sourceType: "structured_data" });
      if (a.addressRegion) add({ field: "region", value: String(a.addressRegion), url: orgUrl, title: home.title, excerpt: "schema.org postalAddress", sourceType: "structured_data" });
      if (a.postalCode) add({ field: "postal_code", value: String(a.postalCode), url: orgUrl, title: home.title, excerpt: "schema.org postalAddress", sourceType: "structured_data" });
      const c = typeof a.addressCountry === "object" ? a.addressCountry?.name : a.addressCountry; if (c) add({ field: "country", value: String(c), url: orgUrl, title: home.title, excerpt: "schema.org postalAddress", sourceType: "structured_data" });
    }
    if (org.email) add({ field: "email", value: String(org.email).toLowerCase(), url: orgUrl, title: home.title, excerpt: "schema.org email", sourceType: "structured_data" });
    if (org.telephone) add({ field: "phone", value: String(org.telephone).replace(/[^\d+]/g, ""), url: orgUrl, title: home.title, excerpt: "schema.org telephone", sourceType: "structured_data" });
    const yr = String(org.foundingDate ?? "").match(/\b(1[89]\d\d|20\d\d)\b/); if (yr) add({ field: "founded_year", value: yr[1]!, url: orgUrl, title: home.title, excerpt: `schema.org foundingDate: ${org.foundingDate}`, sourceType: "structured_data" });
    for (const s of ([] as any[]).concat(org.sameAs ?? [])) for (const [k, re] of SOCIAL) if (typeof s === "string" && re.test(s)) add({ field: k, value: s, url: orgUrl, title: home.title, excerpt: "schema.org sameAs", sourceType: "structured_data" });
    const people = ([] as any[]).concat(org.founder ?? [], org.employee ?? [], org.member ?? []).filter((x) => x && typeof x === "object" && x.name);
    for (const x of people.slice(0, 5)) add({ field: "leadership", value: x.jobTitle ? `${x.name} - ${x.jobTitle}` : String(x.name), url: orgUrl, title: home.title, excerpt: "schema.org person listed by the company", sourceType: "structured_data" });
  }
  const svc = pages.filter((p) => /service|solution|product|what-we-do/i.test(p.url)).flatMap((p) => p.h2.concat(p.h3).map((h) => ({ h, url: p.url, title: p.title }))).concat(home.h2.slice(0, 6).map((h) => ({ h, url: home.url, title: home.title }))).filter((x) => x.h.length > 3 && x.h.length < 70 && !/^(contact|about|home|menu|follow|subscribe|newsletter|get in touch|our (team|story))/i.test(x.h));
  const svcUnique = [...new Map(svc.map((x) => [x.h.toLowerCase(), x])).values()].slice(0, 8);
  if (svcUnique.length) add({ field: "products_services", value: svcUnique.map((x) => x.h).join("; "), url: svcUnique[0]!.url, title: svcUnique[0]!.title, excerpt: "Headings on the services/products pages", sourceType: "official_page", reliability: 0.8 });
  const corpus = [home.title, home.description, ...pages.flatMap((p) => p.h1.concat(p.h2)), home.text.slice(0, 4000)].filter(Boolean).join(" . ");
  const hits = INDUSTRY_RULES.map(([name, re]) => ({ name, n: (corpus.match(new RegExp(re.source, "gi")) ?? []).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  if (hits[0]) { add({ field: "industry", value: hits[0].name, url: home.url, title: home.title, excerpt: `Keyword match (${hits[0].n} mentions) in the site text`, sourceType: "derived", kind: "estimate" }); hits.slice(0, 3).forEach((h) => add({ field: "tags", value: h.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), url: home.url, title: home.title, excerpt: "Keyword match in the site text", sourceType: "derived", kind: "estimate" })); }
  else if (input.industry) warnings.push("The site text did not clearly indicate an industry; the existing value was left alone.");

  await hooks.onStage("validating", 80, "Scoring and validating");
  const seo = analyseSeoAeo(pages, { hasSitemap, robotsFound: robots.found, companyName: raws.find((r) => r.field === "company_name")?.value ?? input.companyName });
  const hypotheses = serviceFitHypotheses(seo);
  if (seo.suggestions.seoTitle) add({ field: "seo_title", value: seo.suggestions.seoTitle, url: home.url, title: home.title, excerpt: "Suggested shorter title", sourceType: "derived", kind: "hypothesis" });
  if (seo.suggestions.metaDescription) add({ field: "meta_description", value: seo.suggestions.metaDescription, url: home.url, title: home.title, excerpt: "Suggested from the opening page text", sourceType: "derived", kind: "hypothesis" });
  if (seo.suggestions.slug) add({ field: "slug", value: seo.suggestions.slug, url: home.url, title: home.title, excerpt: "Suggested from the main heading", sourceType: "derived", kind: "hypothesis" });
  if (discovery) add({ field: "source_note", value: `Website found by ${discovery.provider} search on ${now().toISOString().slice(0, 10)}`, url: site.toString(), title: home.title, excerpt: null, sourceType: "search_snippet", kind: "fact" });

  const byField = new Map<FieldKey, Raw[]>();
  for (const r of raws) byField.set(r.field, [...(byField.get(r.field) ?? []), r]);
  const proposals: Proposal[] = [];
  const MULTI: FieldKey[] = ["email", "phone", "leadership", "tags"];
  for (const [field, list] of byField) {
    const groups = new Map<string, Raw[]>();
    for (const r of list) { const k = r.value.toLowerCase(); groups.set(k, [...(groups.get(k) ?? []), r]); }
    const ranked = [...groups.values()].map((g) => ({ g, urls: new Set(g.map((x) => x.url)).size, best: g.slice().sort((a, b) => (b.sourceType === "structured_data" ? 1 : 0) - (a.sourceType === "structured_data" ? 1 : 0))[0]! })).sort((a, b) => b.urls - a.urls || (b.best.sourceType === "structured_data" ? 1 : 0) - (a.best.sourceType === "structured_data" ? 1 : 0));
    const take = MULTI.includes(field) ? (field === "tags" ? 3 : 2) : 1;
    const conflicting = !MULTI.includes(field) && ranked.length > 1 && field !== "company_name" && field !== "website" && field !== "domain";
    for (const rk of ranked.slice(0, take)) {
      const b = rk.best, vdomain = b.field === "email" ? b.value.split("@")[1]! : null;
      const c = scoreConfidence({ sourceType: b.sourceType, pagesAgreeing: rk.urls, domainMatchesSite: vdomain ? sameSite(vdomain, host) : null, ageDays: 0, extractionReliability: b.reliability, conflicting, contactLink: b.contactLink });
      let sd: string | null = null; try { sd = new URL(b.url).hostname; } catch { /* none */ }
      proposals.push({ field, value: b.value, kind: b.kind ?? (b.sourceType === "derived" ? "estimate" : "fact"), sourceUrl: b.url, sourceTitle: b.title, sourceDomain: sd, excerpt: b.excerpt, retrievedAt: now().toISOString(), confidence: c.score, confidenceBasis: c.basis, verification: c.verification, ...(conflicting ? { conflict: { values: ranked.slice(1, 4).map((x) => x.best.value) } } : {}) });
    }
  }
  proposals.sort((a, b) => b.confidence - a.confidence);
  await hooks.onStage("validating", 95, "Finishing");
  return { proposals, seoAeo: seo, hypotheses, sources, skipped, warnings, websiteDiscovery: discovery, method: "cintexa-research-v1: public pages only, robots.txt honoured, deterministic extraction, no AI reads page text" };
}
