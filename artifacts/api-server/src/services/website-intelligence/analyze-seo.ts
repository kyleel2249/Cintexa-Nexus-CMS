import { normalizeUrl } from "@workspace/wi-core";
import { Collector, ev, inferred, measured, trunc } from "./check";
import { isGenericAnchor, isIndexableFromSignals, type PageData } from "./page-data";
import { byTag, findAll } from "./html";

const DUP_PARAMS = /^(utm_[a-z]+|sessionid|sid|phpsessid|jsessionid|sort|order|orderby|filter|ref|fbclid|gclid|replytocom|share|print|view)$/i;
const STOP = new Set("that this with from have they will your what when where which their there about would could should these those been were into than then them also more most some such only other over very just like make made many much each both does doing being after before again because while until against between during through under above below".split(" "));

const REQUIRED: Record<string, { required: string[]; recommended: string[] }> = {
  Organization: { required: ["name"], recommended: ["url", "logo", "sameAs"] },
  LocalBusiness: { required: ["name", "address"], recommended: ["telephone", "openingHours", "geo", "url", "image"] },
  Product: { required: ["name"], recommended: ["image", "offers", "description", "brand", "aggregateRating", "review"] },
  Offer: { required: ["price", "priceCurrency"], recommended: ["availability", "url"] },
  Article: { required: ["headline"], recommended: ["author", "datePublished", "image", "dateModified"] },
  BlogPosting: { required: ["headline"], recommended: ["author", "datePublished", "image", "dateModified"] },
  NewsArticle: { required: ["headline"], recommended: ["author", "datePublished", "image", "dateModified"] },
  BreadcrumbList: { required: ["itemListElement"], recommended: [] },
  FAQPage: { required: ["mainEntity"], recommended: [] },
  WebSite: { required: ["name", "url"], recommended: ["potentialAction"] },
  Person: { required: ["name"], recommended: ["url", "sameAs"] },
  Event: { required: ["name", "startDate", "location"], recommended: ["endDate", "image", "description", "offers"] },
  JobPosting: { required: ["title", "description", "datePosted", "hiringOrganization"], recommended: ["validThrough", "jobLocation", "baseSalary"] },
  Recipe: { required: ["name", "image"], recommended: ["recipeIngredient", "recipeInstructions", "author"] },
  VideoObject: { required: ["name", "thumbnailUrl", "uploadDate"], recommended: ["description", "contentUrl", "embedUrl"] },
  Review: { required: ["itemReviewed", "reviewRating", "author"], recommended: [] },
  SoftwareApplication: { required: ["name"], recommended: ["offers", "applicationCategory", "operatingSystem", "aggregateRating"] },
  Course: { required: ["name", "description"], recommended: ["provider"] },
};

export function collectSchemaItems(p: PageData): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  const visit = (v: unknown, depth: number) => {
    if (depth > 6 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return; }
    const o = v as Record<string, unknown>;
    if (o["@type"]) items.push(o);
    for (const k of Object.keys(o)) if (k !== "@context") visit(o[k], depth + 1);
  };
  for (const b of p.jsonld) if (b.parsed) visit(b.parsed, 0);
  return items;
}

const typesOf = (o: Record<string, unknown>): string[] => (Array.isArray(o["@type"]) ? (o["@type"] as unknown[]) : [o["@type"]]).filter((x): x is string => typeof x === "string");
const LOCAL_SUBTYPES = /^(LocalBusiness|Restaurant|Store|Dentist|Physician|LegalService|RealEstateAgent|AutoRepair|HairSalon|BeautySalon|Hotel|ProfessionalService|FinancialService|HomeAndConstructionBusiness|MedicalBusiness|FoodEstablishment|CafeOrCoffeeShop|BarOrPub|Bakery|HealthAndBeautyBusiness|ChildCare|AccountingService|Plumber|Electrician|Locksmith|MovingCompany|RoofingContractor|TravelAgency|AutomotiveBusiness|EntertainmentBusiness|SportsActivityLocation|GymOrFitnessCenter)$/;
export const isLocalType = (t: string) => LOCAL_SUBTYPES.test(t);

function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function isArticleLike(p: PageData): boolean {
  if (p.meta["og:type"] === "article") return true;
  if (p.schemaTypes.some((t) => /^(Article|BlogPosting|NewsArticle)$/.test(t))) return true;
  return byTag(p.doc.root, "article").length > 0 && p.wordCount > 250;
}

export function isProductLike(p: PageData): boolean {
  if (p.schemaTypes.includes("Product")) return true;
  if (p.meta["og:type"] === "product") return true;
  const html = p.html.toLowerCase();
  return /add[\s_-]*to[\s_-]*(cart|bag|basket)|data-product-id|class="[^"]*product[-_]?(price|form)/.test(html);
}

export function analyzeSeoPage(p: PageData, c: Collector): void {
  const html = p.contentType === null || /html|xml/i.test(p.contentType);
  const ok2xx = p.status !== null && p.status >= 200 && p.status < 300;

  // ---- technical SEO
  if (p.status !== null && p.status >= 200 && p.status < 400) c.pass("seo.http.status", { actual: `HTTP ${p.status}`, expected: "2xx", ...measured });
  else c.fail("seo.http.status", { actual: p.status === null ? "No response" : `HTTP ${p.status}`, expected: "2xx", ...measured });

  const idx = isIndexableFromSignals(p);
  const noindex = idx.indexable === false && idx.reason === "noindex directive";
  if (noindex) {
    const ex = { actual: `noindex via ${p.xRobotsTag && /noindex/i.test(p.xRobotsTag) ? "X-Robots-Tag" : "meta robots"} (${p.robotsMeta ?? p.xRobotsTag})`, expected: "indexable", evidence: [ev("html", "robots directives", `meta: ${p.robotsMeta ?? "-"} | header: ${p.xRobotsTag ?? "-"}`)] };
    if (p.isHomepage || p.important) c.fail("seo.index.noindex", ex);
    else c.warn("seo.index.noindex", { ...ex, note: "Confirm this is intentional." });
  } else c.pass("seo.index.noindex", { actual: "No noindex directive" });

  if (!ok2xx || !html || noindex) {
    c.na("seo.canonical.present", "Page is not an indexable HTML document.");
    c.na("seo.canonical.valid", "Page is not an indexable HTML document.");
  } else if (!p.canonicals.length) c.fail("seo.canonical.present", { actual: "No canonical", expected: "A self-referencing canonical URL" });
  else {
    c.pass("seo.canonical.present", { actual: p.canonicals[0] });
    const distinct = [...new Set(p.canonicals.map((x) => normalizeUrl(x) ?? x))];
    const self = normalizeUrl(p.finalUrl);
    const target = normalizeUrl(p.canonicals[0]);
    let targetUrl: URL | null = null;
    try { targetUrl = new URL(p.canonicals[0]); } catch { targetUrl = null; }
    const finalU = new URL(p.finalUrl);
    if (distinct.length > 1) c.fail("seo.canonical.valid", { actual: `${distinct.length} different canonicals`, expected: "One canonical", evidence: distinct.slice(0, 4).map((d) => ev("url", "canonical", d)) });
    else if (!targetUrl) c.fail("seo.canonical.valid", { actual: p.canonicals[0], expected: "A valid absolute URL" });
    else if (finalU.protocol === "https:" && targetUrl.protocol === "http:") c.fail("seo.canonical.valid", { actual: p.canonicals[0], expected: "https canonical" });
    else if (targetUrl.hostname.replace(/^www\./, "") !== finalU.hostname.replace(/^www\./, "")) c.fail("seo.canonical.valid", { actual: `Canonical points to another host: ${targetUrl.hostname}`, expected: `Host ${finalU.hostname}` });
    else if (target !== self) c.warn("seo.canonical.valid", { actual: `Canonical differs: ${p.canonicals[0]}`, expected: p.finalUrl, note: "Confirm the canonicalisation is intentional." });
    else c.pass("seo.canonical.valid", { actual: p.canonicals[0] });
  }

  if (p.discoveredFrom) {
    if (p.redirects.length > 0) c.fail("seo.redirect.internal", { actual: `${p.redirects.length} redirect(s): ${p.redirects.map((r) => r.status).join(" > ")} to ${p.finalUrl}`, expected: "Linked URL answers directly", evidence: [ev("url", "linked from", p.discoveredFrom), ...p.redirects.slice(0, 3).map((r) => ev("status", `${r.status}`, `${r.url} -> ${r.location}`))], ...measured });
    else c.pass("seo.redirect.internal", { actual: "No redirect", ...measured });
  } else c.na("seo.redirect.internal", "Seed URL.");

  try {
    const u = new URL(p.url);
    const dup = [...u.searchParams.keys()].filter((k) => DUP_PARAMS.test(k));
    if (p.discoveredFrom && dup.length) c.fail("seo.url.parameters", { actual: `Internally linked with parameters: ${dup.join(", ")}`, expected: "Clean URL", evidence: [ev("url", "linked from", p.discoveredFrom)] });
    else c.pass("seo.url.parameters", { actual: u.search ? `Parameters: ${[...u.searchParams.keys()].join(", ")}` : "No parameters" });
    const path = u.pathname;
    const issues: string[] = [];
    if (u.toString().length > 115) issues.push(`${u.toString().length} characters`);
    if (/[A-Z]/.test(path)) issues.push("uppercase letters");
    if (/_/.test(path)) issues.push("underscores");
    if ((path.match(/%[0-9a-f]{2}/gi) ?? []).length > 3) issues.push("heavy percent-encoding");
    if (issues.length) c.fail("seo.url.readability", { actual: issues.join(", "), expected: "Lowercase, hyphen-separated, under 115 characters" });
    else c.pass("seo.url.readability", { actual: trunc(path, 100) });
  } catch { /* url already validated */ }

  if (p.depth > 4) c.fail("seo.crawl.depth", { actual: `${p.depth} clicks from the start page`, expected: "4 or fewer", ...measured });
  else c.pass("seo.crawl.depth", { actual: `${p.depth} click(s)`, ...measured });

  if (!p.hreflang.length) c.na("seo.hreflang.valid", "No hreflang annotations.");
  else {
    const problems: string[] = [];
    for (const h of p.hreflang) {
      if (!/^(x-default|[a-z]{2,3}(-[a-z0-9]{2,8})*)$/i.test(h.lang)) problems.push(`invalid code "${h.lang}"`);
      if (!/^https?:\/\//i.test(h.href)) problems.push(`relative or invalid URL "${trunc(h.href, 60)}"`);
    }
    const selfN = normalizeUrl(p.finalUrl);
    if (!p.hreflang.some((h) => normalizeUrl(h.href, p.finalUrl) === selfN)) problems.push("no self-referencing entry");
    if (problems.length) c.fail("seo.hreflang.valid", { actual: problems.slice(0, 4).join("; "), expected: "Valid codes, absolute URLs, self-reference" });
    else c.pass("seo.hreflang.valid", { actual: `${p.hreflang.length} annotations` });
  }

  if (!html || !ok2xx) c.na("seo.js.rendered", "Not an HTML 2xx response.");
  else {
    const spa = /id=["'](root|app|__next|__nuxt|svelte)["']|window\.__(NEXT_DATA|NUXT)__|<noscript[^>]*>[^<]*(enable|requires?)[^<]*javascript/i.test(p.html);
    if (p.wordCount >= 50 && p.links.length >= 3) c.pass("seo.js.rendered", { actual: `${p.wordCount} words and ${p.links.length} links in the initial HTML`, ...measured });
    else if (spa && p.scripts.length > 0) c.warn("seo.js.rendered", { actual: `Only ${p.wordCount} words and ${p.links.length} links in the initial HTML; client-side rendering markers found`, expected: "Primary content and links in the HTML response", ...inferred, note: "Rendered content could not be compared because no browser worker is connected." });
    else c.na("seo.js.rendered", "Initial HTML is short but shows no client-side rendering markers.");
  }

  if (p.depth < 2) c.na("seo.breadcrumbs", "Breadcrumbs are expected on deeper pages only.");
  else {
    const has = p.schemaTypes.includes("BreadcrumbList") || findAll(p.doc.root, (n) => /breadcrumb/i.test(`${n.attrs["aria-label"] ?? ""} ${n.attrs.class ?? ""} ${n.attrs.id ?? ""}`)).length > 0;
    c.check("seo.breadcrumbs", has, { actual: has ? "Breadcrumbs found" : "No breadcrumbs", ...inferred });
  }

  try {
    const u = new URL(p.finalUrl);
    const paged = /[?&](page|paged|p)=\d+/i.test(u.search) || /\/page\/\d+\/?$/i.test(u.pathname);
    if (!paged) c.na("seo.pagination.canonical", "Not a paginated URL.");
    else {
      const self = normalizeUrl(p.finalUrl);
      const target = p.canonicals[0] ? normalizeUrl(p.canonicals[0]) : null;
      if (!target) c.warn("seo.pagination.canonical", { actual: "Paginated page without canonical", expected: "Self-referencing canonical" });
      else c.check("seo.pagination.canonical", target === self, { actual: p.canonicals[0], expected: p.finalUrl });
    }
  } catch { /* ignore */ }

  if (!ok2xx || !html) {
    for (const id of ["onpage.title.present", "onpage.title.length", "onpage.description.present", "onpage.description.length", "onpage.h1.present", "onpage.h1.single", "onpage.headings.hierarchy", "onpage.links.anchor_text", "onpage.links.internal", "onpage.social.open_graph", "onpage.social.twitter_card", "onpage.keyword_stuffing", "onpage.images.dimensions", "onpage.article.dates", "onpage.article.author"]) c.na(id, "Page did not return an HTML 2xx response.");
    return;
  }

  // ---- on-page SEO
  const title = p.title ?? "";
  if (!title) c.fail("onpage.title.present", { actual: "Missing or empty <title>", expected: "A unique descriptive title" });
  else c.pass("onpage.title.present", { actual: trunc(title) });
  if (!title) c.na("onpage.title.length", "No title.");
  else if (title.length < 15 || title.length > 70) c.fail("onpage.title.length", { actual: `${title.length} characters`, expected: "15 to 70", evidence: [ev("text", "title", title)], ...measured });
  else c.pass("onpage.title.length", { actual: `${title.length} characters`, ...measured });

  const desc = p.metaDescription ?? "";
  if (!desc.trim()) c.fail("onpage.description.present", { actual: "Missing or empty meta description", expected: "A unique summary of the page" });
  else c.pass("onpage.description.present", { actual: trunc(desc) });
  if (!desc.trim()) c.na("onpage.description.length", "No description.");
  else if (desc.length < 70 || desc.length > 170) c.fail("onpage.description.length", { actual: `${desc.length} characters`, expected: "70 to 170", evidence: [ev("text", "description", trunc(desc, 300))], ...measured });
  else c.pass("onpage.description.length", { actual: `${desc.length} characters`, ...measured });

  const h1s = p.headings.filter((h) => h.level === 1 && h.text);
  c.check("onpage.h1.present", h1s.length >= 1, { actual: `${h1s.length} H1`, expected: "At least one H1" });
  if (h1s.length === 0) c.na("onpage.h1.single", "No H1.");
  else c.check("onpage.h1.single", h1s.length === 1, { actual: `${h1s.length} H1 elements`, expected: "Exactly one", evidence: h1s.slice(0, 3).map((h) => ev("text", "H1", trunc(h.text))) });

  if (p.headings.length === 0) c.na("onpage.headings.hierarchy", "No headings.");
  else {
    const skips: string[] = [];
    let prev = 0;
    for (const h of p.headings) { if (prev && h.level > prev + 1) skips.push(`H${prev} to H${h.level}`); prev = h.level; }
    c.check("onpage.headings.hierarchy", skips.length === 0, { actual: skips.length ? `Skipped levels: ${[...new Set(skips)].slice(0, 4).join(", ")}` : "Sequential", expected: "No skipped levels" });
  }

  const dimMissing = p.images.filter((i) => !i.tiny && !(i.width && i.height));
  if (!p.images.length) c.na("onpage.images.dimensions", "No images.");
  else c.check("onpage.images.dimensions", dimMissing.length === 0, { actual: `${dimMissing.length} of ${p.images.length} images without width and height`, expected: "Width and height on every content image", evidence: dimMissing.slice(0, 3).map((i) => ev("url", "image", i.src)), ...measured });

  const internalLinks = p.links.filter((l) => l.internal);
  const generic = p.links.filter((l) => (l.scheme === "http" || l.scheme === "https") && l.text && isGenericAnchor(l.text));
  c.check("onpage.links.anchor_text", generic.length < 3, { actual: `${generic.length} link(s) with generic text`, expected: "Descriptive anchor text", evidence: generic.slice(0, 3).map((l) => ev("text", l.text, l.href)) });
  c.check("onpage.links.internal", internalLinks.length > 0, { actual: `${internalLinks.length} internal link(s)`, expected: "At least one", ...measured });

  const og = ["og:title", "og:description", "og:image"].filter((k) => p.meta[k]);
  if (og.length === 3) c.pass("onpage.social.open_graph", { actual: "og:title, og:description, og:image" });
  else if (og.length > 0) c.warn("onpage.social.open_graph", { actual: `Present: ${og.join(", ")}`, expected: "og:title, og:description, og:image" });
  else c.fail("onpage.social.open_graph", { actual: "No Open Graph metadata", expected: "og:title, og:description, og:image" });
  if (p.meta["twitter:card"]) c.pass("onpage.social.twitter_card", { actual: p.meta["twitter:card"] });
  else c.info("onpage.social.twitter_card", { actual: "No twitter:card" });

  if (p.wordCount < 150) c.na("onpage.keyword_stuffing", "Too little text to evaluate.");
  else {
    const counts = new Map<string, number>();
    const words = p.text.toLowerCase().match(/[\p{L}]{4,}/gu) ?? [];
    for (const w of words) if (!STOP.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
    let top = ["", 0] as [string, number];
    for (const e of counts) if (e[1] > top[1]) top = e;
    const share = top[1] / p.wordCount;
    c.check("onpage.keyword_stuffing", share <= 0.06, { actual: `"${top[0]}" is ${(share * 100).toFixed(1)}% of ${p.wordCount} words`, expected: "No term above 6%", ...inferred });
  }

  if (!isArticleLike(p)) { c.na("onpage.article.dates", "Not an article-like page."); c.na("onpage.article.author", "Not an article-like page."); }
  else {
    const hasDate = Boolean(p.meta["article:published_time"] || p.meta["date"] || byTag(p.doc.root, "time").length || collectSchemaItems(p).some((o) => hasValue(o.datePublished)));
    c.check("onpage.article.dates", hasDate, { actual: hasDate ? "Date present" : "No publication date", ...inferred });
    const hasAuthor = Boolean(p.meta.author || p.meta["article:author"] || collectSchemaItems(p).some((o) => hasValue(o.author)) || findAll(p.doc.root, (n) => /author|byline/i.test(`${n.attrs.class ?? ""} ${n.attrs.rel ?? ""} ${n.attrs.itemprop ?? ""}`)).length);
    c.check("onpage.article.author", hasAuthor, { actual: hasAuthor ? "Author identified" : "No author", ...inferred });
  }
}

export function analyzeSchemaPage(p: PageData, c: Collector): void {
  if (!p.jsonld.length) {
    for (const id of ["schema.syntax", "schema.properties", "schema.urls", "schema.content_alignment"]) c.na(id, "No JSON-LD on this page.");
    return;
  }
  const bad = p.jsonld.filter((b) => b.error);
  if (bad.length) c.fail("schema.syntax", { actual: `${bad.length} of ${p.jsonld.length} JSON-LD block(s) invalid: ${bad[0].error}`, expected: "Valid JSON", evidence: [ev("json", "invalid block", trunc(bad[0].raw, 300))] });
  else c.pass("schema.syntax", { actual: `${p.jsonld.length} valid block(s)`, ...measured });

  const items = collectSchemaItems(p);
  const missingReq: string[] = [];
  const missingRec: string[] = [];
  for (const it of items) {
    for (const t of typesOf(it)) {
      const rule = REQUIRED[isLocalType(t) ? "LocalBusiness" : t];
      if (!rule) continue;
      for (const r of rule.required) if (!hasValue(it[r])) missingReq.push(`${t}.${r}`);
      for (const r of rule.recommended) if (!hasValue(it[r])) missingRec.push(`${t}.${r}`);
    }
  }
  if (!items.length) c.na("schema.properties", "No typed items could be read.");
  else if (missingReq.length) c.fail("schema.properties", { actual: `Missing required: ${[...new Set(missingReq)].slice(0, 6).join(", ")}`, expected: "All required properties", note: "Syntax validity is reported separately from Google rich-result eligibility.", ...inferred });
  else if (missingRec.length) c.warn("schema.properties", { actual: `Missing recommended: ${[...new Set(missingRec)].slice(0, 6).join(", ")}`, ...inferred });
  else c.pass("schema.properties", { actual: "Required and recommended properties present", ...inferred });

  const badUrls: string[] = [];
  for (const it of items) for (const k of ["url", "logo", "image", "sameAs", "thumbnailUrl", "contentUrl"]) {
    const vals = Array.isArray(it[k]) ? (it[k] as unknown[]) : [it[k]];
    for (const v of vals) {
      const s = typeof v === "string" ? v : v && typeof v === "object" ? ((v as Record<string, unknown>).url as string | undefined) : undefined;
      if (typeof s === "string" && s && !/^https?:\/\/[^\s]+$/i.test(s)) badUrls.push(`${k}=${trunc(s, 50)}`);
    }
  }
  c.check("schema.urls", badUrls.length === 0, { actual: badUrls.length ? `Invalid URL values: ${badUrls.slice(0, 4).join("; ")}` : "All URL properties are absolute http(s) URLs", expected: "Absolute http(s) URLs" });

  const text = `${p.title ?? ""} ${p.text}`.toLowerCase();
  const probes: string[] = [];
  for (const it of items) for (const k of ["name", "headline"]) if (typeof it[k] === "string" && (it[k] as string).trim().length > 3 && !typesOf(it).some((t) => ["Organization", "WebSite", "BreadcrumbList", "ListItem"].includes(t))) probes.push((it[k] as string).toLowerCase().trim());
  if (!probes.length) c.na("schema.content_alignment", "No page-specific name or headline to compare.");
  else {
    const missing = probes.filter((s) => !text.includes(s));
    if (!missing.length) c.pass("schema.content_alignment", { actual: "Marked-up values appear in the page", ...inferred });
    else if (missing.length < probes.length) c.warn("schema.content_alignment", { actual: `Not found on the page: ${missing.slice(0, 3).map((m) => trunc(m, 50)).join("; ")}`, ...inferred });
    else c.fail("schema.content_alignment", { actual: `Marked-up values absent from the page: ${missing.slice(0, 3).map((m) => trunc(m, 50)).join("; ")}`, ...inferred });
  }
}

export function analyzePerfPage(p: PageData, c: Collector): void {
  const ok = p.status !== null && p.status >= 200 && p.status < 300 && (p.contentType === null || /html/i.test(p.contentType));
  if (!ok) { for (const id of ["perf.ttfb", "perf.compression", "perf.html_size", "perf.render_blocking", "perf.images.format", "perf.images.lazy", "perf.images.responsive", "perf.third_party", "perf.css_delivery", "perf.fonts", "perf.dom_size"]) c.na(id, "Not an HTML 2xx response."); return; }
  if (p.ttfbMs === null) c.inconclusive("perf.ttfb", "No timing available.");
  else c.grade("perf.ttfb", p.ttfbMs <= 800 ? "pass" : p.ttfbMs <= 1800 ? "warn" : "fail", { actual: `${p.ttfbMs} ms`, expected: "800 ms or less", note: "Measured from the audit server; real-user latency varies by location.", ...measured });
  if (p.htmlBytes <= 2048) c.na("perf.compression", "Response is under 2 KB.");
  else c.check("perf.compression", Boolean(p.contentEncoding && /gzip|br|zstd|deflate/.test(p.contentEncoding)), { actual: p.contentEncoding ? `Content-Encoding: ${p.contentEncoding}` : `${Math.round(p.htmlBytes / 1024)} KB sent uncompressed`, expected: "gzip, br or zstd", ...measured });
  c.grade("perf.html_size", p.htmlBytes < 500 * 1024 ? "pass" : p.htmlBytes < 1024 * 1024 ? "warn" : "fail", { actual: `${Math.round(p.htmlBytes / 1024)} KB${p.truncated ? " (truncated at the size limit)" : ""}`, expected: "Under 500 KB", ...measured });

  const blockingScripts = p.scripts.filter((s) => s.src && s.inHead && !s.async && !s.defer && !s.module).length;
  const sheets = p.stylesheets.filter((s) => !s.media || /all|screen/i.test(s.media)).length;
  const rb = blockingScripts >= 3 || sheets >= 7 ? "fail" : blockingScripts >= 1 || sheets >= 5 ? "warn" : "pass";
  c.grade("perf.render_blocking", rb, { actual: `${blockingScripts} blocking script(s), ${sheets} stylesheet(s) in the head`, expected: "No blocking scripts and at most four stylesheets", ...measured });

  const content = p.images.filter((i) => !i.tiny);
  if (!content.length) { c.na("perf.images.format", "No images."); c.na("perf.images.lazy", "No images."); c.na("perf.images.responsive", "No images."); }
  else {
    const legacy = content.filter((i) => /\.(jpe?g|png|gif|bmp)(\?|$)/i.test(i.src) && !i.inPicture);
    c.check("perf.images.format", legacy.length <= 3, { actual: `${legacy.length} image(s) in legacy formats`, expected: "WebP/AVIF/SVG where possible", evidence: legacy.slice(0, 3).map((i) => ev("url", "image", i.src)), ...inferred });
    const lazy = content.filter((i) => i.loading === "lazy" || i.srcset?.length === 0).length;
    c.check("perf.images.lazy", content.length < 7 || lazy > 0, { actual: `${content.length} images, ${lazy} lazy-loaded`, expected: "Lazy-load below-the-fold images", ...measured });
    const large = content.filter((i) => Number(i.width ?? 0) >= 600 && !i.srcset && !i.inPicture);
    c.check("perf.images.responsive", large.length < 3, { actual: `${large.length} large image(s) without srcset`, expected: "srcset/sizes on large images", ...inferred });
  }
  const tp = p.thirdPartyHosts.length;
  c.grade("perf.third_party", tp <= 8 ? "pass" : tp <= 14 ? "warn" : "fail", { actual: `${tp} third-party host(s)`, expected: "Eight or fewer", evidence: p.thirdPartyHosts.slice(0, 6).map((h) => ev("text", "host", h)), ...measured });
  const cssBytes = Buffer.byteLength(p.inlineCss);
  c.check("perf.css_delivery", p.stylesheets.length <= 6 && cssBytes < 100 * 1024, { actual: `${p.stylesheets.length} stylesheet(s), ${Math.round(cssBytes / 1024)} KB inline CSS`, expected: "At most six stylesheets and under 100 KB inline CSS", ...measured });
  if (!p.fonts.length) c.pass("perf.fonts", { actual: "No web fonts detected" });
  else c.check("perf.fonts", p.fonts.every((f) => f.swap && f.preconnect), { actual: p.fonts.map((f) => `${trunc(f.href, 50)} (swap: ${f.swap ? "yes" : "no"}, preconnect: ${f.preconnect ? "yes" : "no"})`).join("; "), expected: "display=swap and preconnect", ...inferred });
  c.grade("perf.dom_size", p.doc.nodeCount <= 1500 ? "pass" : p.doc.nodeCount <= 3000 ? "warn" : "fail", { actual: `${p.doc.nodeCount} elements`, expected: "1,500 or fewer", ...measured });
}
