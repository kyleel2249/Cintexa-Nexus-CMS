import { isInScope } from "@workspace/wi-core";
import { Collector, ev, inferred, measured, trunc } from "./check";
import type { AuditContext, PageSummary } from "./context";
import { detectTech } from "./detect";
import { header } from "./net-types";
import { safeFetch } from "./ports";
import type { InfraOutcome } from "./site-infra";
import { isLocalType } from "./analyze-seo";

interface Probe { url: string; kind: "script" | "style" | "image"; status: number | null; bytes: number | null; cache: string | null; type: string | null }

async function probeAsset(ctx: AuditContext, url: string, kind: Probe["kind"]): Promise<Probe> {
  ctx.count.requests++;
  let r = await safeFetch(url, { ...ctx.fetchOpts(), method: "HEAD", followRedirects: true, maxRedirects: 3, timeoutMs: 10_000 });
  if (!r.ok || r.status === 405 || r.status === 501 || (r.status === 200 && header(r, "content-length") === null)) {
    ctx.count.requests++;
    r = await safeFetch(url, { ...ctx.fetchOpts(), method: "GET", followRedirects: true, maxRedirects: 3, maxBytes: 4 * 1024 * 1024, timeoutMs: 15_000 });
    const size = r.truncated ? null : r.transferBytes || r.body.length;
    return { url, kind, status: r.status, bytes: size, cache: header(r, "cache-control"), type: header(r, "content-type") };
  }
  const cl = Number(header(r, "content-length"));
  return { url, kind, status: r.status, bytes: Number.isFinite(cl) ? cl : null, cache: header(r, "cache-control"), type: header(r, "content-type") };
}

const kb = (n: number) => `${Math.round(n / 1024)} KB`;

function maxAge(cc: string | null): number | null {
  if (!cc) return null;
  if (/no-store|no-cache/i.test(cc)) return 0;
  const m = /(?:s-maxage|max-age)=(\d+)/i.exec(cc);
  if (/immutable/i.test(cc)) return 31_536_000;
  return m ? Number(m[1]) : null;
}

export async function runPerformanceSite(ctx: AuditContext, c: Collector): Promise<Probe[]> {
  const pages = [...ctx.summaries.values()].filter((p) => p.isHtml).sort((a, b) => b.weight - a.weight).slice(0, 4);
  const want = new Map<string, Probe["kind"]>();
  for (const p of pages) {
    for (const u of p.scriptUrls) want.set(u, "script");
    for (const u of p.styleUrls) want.set(u, "style");
    for (const u of p.imageUrls) if (!want.has(u)) want.set(u, "image");
  }
  const inScope = [...want].filter(([u]) => { try { return isInScope(new URL(u).hostname, ctx.host, ctx.cfg.permittedHosts); } catch { return false; } }).slice(0, ctx.limits.maxAssetProbes);
  const probes: Probe[] = [];
  for (const [u, k] of inScope) { if (ctx.signal.aborted) break; probes.push(await probeAsset(ctx, u, k)); await new Promise((r) => setTimeout(r, Math.min(ctx.limits.perHostDelayMs, 100))); }
  const ok = probes.filter((p) => p.status !== null && p.status < 400);
  const sampleNote = `Measured for ${probes.length} first-party resource(s) used by the key pages; third-party resources are not probed.`;

  const imgs = ok.filter((p) => p.kind === "image" && p.bytes !== null);
  if (!imgs.length) c.na("perf.images.size", "No measurable first-party images.");
  else {
    const big = imgs.filter((p) => (p.bytes as number) > 1024 * 1024);
    const mid = imgs.filter((p) => (p.bytes as number) > 300 * 1024);
    const worst = [...imgs].sort((a, b) => (b.bytes as number) - (a.bytes as number)).slice(0, 3);
    c.grade("perf.images.size", big.length ? "fail" : mid.length ? "warn" : "pass", { actual: `${imgs.length} image(s) sampled; largest ${kb(worst[0].bytes as number)}`, expected: "Each under 300 KB", evidence: worst.map((p) => ev("measurement", kb(p.bytes as number), p.url)), note: sampleNote, ...measured });
  }
  const js = ok.filter((p) => p.kind === "script" && p.bytes !== null);
  const jsTotal = js.reduce((s, p) => s + (p.bytes as number), 0);
  if (!js.length) c.na("perf.js_weight", "No measurable first-party JavaScript.");
  else c.grade("perf.js_weight", jsTotal < 500 * 1024 ? "pass" : jsTotal < 1024 * 1024 ? "warn" : "fail", { actual: `${kb(jsTotal)} of first-party JavaScript (transfer size)`, expected: "Under 500 KB", note: sampleNote, ...measured });

  const home = ctx.home;
  if (home) {
    const homeAssets = new Set([...home.scripts.map((s) => s.absolute), ...home.stylesheets.map((s) => s.absolute), ...home.images.map((i) => i.src)]);
    const sized = probes.filter((p) => homeAssets.has(p.url) && p.bytes !== null && (p.status ?? 500) < 400);
    const total = home.transferBytes + sized.reduce((s, p) => s + (p.bytes as number), 0);
    c.grade("perf.page_weight", total < 2.5 * 1024 * 1024 ? "pass" : total < 5 * 1024 * 1024 ? "warn" : "fail", { actual: `${(total / 1048576).toFixed(2)} MB (HTML plus ${sized.length} sampled first-party resource(s))`, expected: "Under 2.5 MB", note: "A lower bound: third-party resources and resources loaded by scripts are not included.", ...measured });
  }

  const static_ = ok.filter((p) => p.kind !== "image" || /\.(png|jpe?g|webp|avif|svg|gif|woff2?)(\?|$)/i.test(p.url));
  if (!static_.length) c.na("perf.cache.assets", "No static assets sampled.");
  else {
    const good = static_.filter((p) => (maxAge(p.cache) ?? 0) >= 7 * 86400).length;
    const none = static_.filter((p) => maxAge(p.cache) === null || maxAge(p.cache) === 0).length;
    const ratio = good / static_.length;
    c.grade("perf.cache.assets", ratio >= 0.8 ? "pass" : none / static_.length > 0.5 ? "fail" : "warn", { actual: `${good} of ${static_.length} asset(s) cached for 7 days or more`, expected: "max-age of at least 7 days (or immutable)", note: sampleNote, ...measured });
  }
  return probes;
}

const FILE_EXT = /\.(pdf|zip|docx?|xlsx?|pptx?|csv|rar|7z|dmg|exe)(\?|$)/i;

export async function runFunctionalitySite(ctx: AuditContext, infra: InfraOutcome, probes: Probe[], pageCollectors: Map<string, Collector>, c: Collector): Promise<void> {
  const status = new Map<string, number | null>();
  for (const s of ctx.summaries.values()) { status.set(s.url, s.facts.status); status.set(s.facts.finalUrl, s.facts.status); }
  for (const s of ctx.summaries.values()) {
    const pc = pageCollectors.get(s.url);
    if (!pc || !s.isHtml) continue;
    const seen = new Set<string>();
    const broken: string[] = [];
    for (const l of s.links) {
      if (!l.internal || seen.has(l.href)) continue;
      seen.add(l.href);
      const st = status.get(l.href);
      if (st !== undefined && (st === null || st >= 400)) broken.push(`${l.href} (${st ?? "no response"})`);
    }
    pc.check("func.links.internal_broken", broken.length === 0, { actual: broken.length ? `${broken.length} broken internal link(s)` : `${seen.size} internal link(s) checked against crawled targets`, expected: "All internal links resolve", evidence: broken.slice(0, 5).map((b) => ev("url", "broken link", b)), note: "Only targets that were crawled can be confirmed.", ...measured });
  }

  // outbound links
  const externals = new Map<string, string>();
  for (const s of ctx.summaries.values()) for (const l of s.links) if (!l.internal && (l.scheme === "http" || l.scheme === "https") && !externals.has(l.href)) externals.set(l.href, s.url);
  if (!ctx.cfg.externalLinkCheck) c.notTested("func.links.external_broken", "Outbound link verification is switched off for this audit profile because it contacts third-party hosts.");
  else if (!externals.size) c.na("func.links.external_broken", "No outbound links.");
  else {
    const sample = [...externals].slice(0, ctx.limits.maxExternalLinks);
    const dead: string[] = [];
    let blocked = 0;
    for (const [u, from] of sample) {
      if (ctx.signal.aborted) break;
      ctx.count.requests++;
      let r = await safeFetch(u, { ...ctx.fetchOpts(), method: "HEAD", maxRedirects: 4, timeoutMs: 8000, scope: undefined });
      if (r.ok && (r.status === 405 || r.status === 403 || r.status === 501)) r = await safeFetch(u, { ...ctx.fetchOpts(), method: "GET", maxRedirects: 4, timeoutMs: 8000, maxBytes: 64 * 1024, scope: undefined });
      if (!r.ok) { if (r.error?.code === "ENOTFOUND" || r.error?.code === "ENODATA") dead.push(`${u} (host not found; linked from ${from})`); else blocked++; }
      else if (r.status === 404 || r.status === 410 || (r.status ?? 0) >= 500) dead.push(`${u} (HTTP ${r.status}; linked from ${from})`);
      else if ([401, 403, 429, 999].includes(r.status ?? 0)) blocked++;
      await new Promise((r2) => setTimeout(r2, 150));
    }
    c.check("func.links.external_broken", dead.length === 0, { actual: dead.length ? `${dead.length} of ${sample.length} sampled outbound link(s) are broken` : `${sample.length} sampled outbound link(s) resolve`, evidence: dead.slice(0, 5).map((d) => ev("url", "broken", d)), note: blocked ? `${blocked} link(s) refused automated requests and are reported as inconclusive, not broken.` : undefined, ...measured });
  }

  const brokenImgs = probes.filter((p) => p.kind === "image" && (p.status === null || p.status >= 400));
  const imgSample = probes.filter((p) => p.kind === "image");
  if (!imgSample.length) c.na("func.images.broken", "No first-party images sampled.");
  else c.check("func.images.broken", brokenImgs.length === 0, { actual: brokenImgs.length ? `${brokenImgs.length} of ${imgSample.length} sampled image(s) fail` : `${imgSample.length} sampled image(s) load`, evidence: brokenImgs.slice(0, 4).map((p) => ev("url", `HTTP ${p.status ?? "error"}`, p.url)), ...measured });

  const downloads = [...new Set([...ctx.summaries.values()].flatMap((s) => s.downloadUrls))].filter((u) => { try { return isInScope(new URL(u).hostname, ctx.host, ctx.cfg.permittedHosts); } catch { return false; } }).sort((a, b) => Number(FILE_EXT.test(b)) - Number(FILE_EXT.test(a))).slice(0, 10);
  if (!downloads.length) c.na("func.downloads", "No downloadable files linked on the same host.");
  else {
    const bad: string[] = [];
    for (const u of downloads) { ctx.count.requests++; const r = await safeFetch(u, { ...ctx.fetchOpts(), method: "HEAD", maxRedirects: 3, timeoutMs: 10_000 }); if (!r.ok || (r.status ?? 500) >= 400) bad.push(`${u} (${r.status ?? r.error?.code})`); }
    c.check("func.downloads", bad.length === 0, { actual: bad.length ? `${bad.length} of ${downloads.length} download(s) fail` : `${downloads.length} download(s) respond`, evidence: bad.slice(0, 3).map((b) => ev("url", "failed", b)), ...measured });
  }

  if (!infra.errorBody) c.inconclusive("func.errorpage.navigation", "No error page content was captured.");
  else c.check("func.errorpage.navigation", /<a\s[^>]*href=["'][^"']+["']/i.test(infra.errorBody), { actual: /<a\s/i.test(infra.errorBody) ? "The error page links back into the site" : "The error page is a dead end", ...measured });

  const home = ctx.home;
  if (home) {
    const search = /role=["']search["']|type=["']search["']|name=["'](q|s|search|query|keyword)["']/i.test(home.html);
    c.check("func.search", search, { actual: search ? "Search found" : "No search detected", ...inferred });
  }
}

const rx = {
  about: /about|company|who-we-are|our-story|team|mission/i, terms: /terms|conditions|legal|impressum|disclaimer|tos\b/i, support: /support|help|faq|docs|documentation|contact|knowledge/i,
  pricing: /pricing|plans|price|packages|subscribe|rates/i, cases: /case[- ]stud|portfolio|our[- ]work|success[- ]stor|customers|projects|clients/i,
  cta: /get started|sign up|start (free|now|today|trial)|book|schedule|request|get (a )?(quote|demo|estimate|in touch)|contact (us|sales)|buy|shop now|order|subscribe|try|download|join|call (us|now)/i,
  lead: /newsletter|subscribe|book|schedule|quote|enquir|inquir|request|demo|sign[- ]?up|get started|contact/i,
  hours: /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b[^<]{0,40}\b\d{1,2}(:\d{2})?\s?(am|pm)?\b|opening hours|business hours|hours of operation|open (daily|24)/i,
  address: /\b\d{1,5}\s+[A-Za-z0-9.' -]{3,40}\s+(street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|way|court|ct\.?|place|pl\.?|square|highway|hwy)\b/i,
  trust: { testimonial: /testimonial|what (our )?(clients|customers) say/i, review: /reviews?|rated|\d(\.\d)?\/5|stars?/i, logos: /trusted by|our (clients|partners)|as seen (in|on)|featured (in|on)/i, cert: /certified|accredited|iso\s?\d{4,5}|award|guarantee|warranty|secure checkout|ssl/i, press: /press|media coverage|in the news/i },
  payment: /visa|mastercard|american express|amex|paypal|apple pay|google pay|stripe|klarna|afterpay|shop pay|mobile money|momo|mpesa|paystack|flutterwave/i,
};

export async function runBusinessSite(ctx: AuditContext, c: Collector): Promise<void> {
  const home = ctx.home;
  if (!home) return;
  const sums = [...ctx.summaries.values()].filter((s) => s.isHtml);
  const allLinks = [...home.links, ...sums.flatMap((s) => s.links)];
  const hasLink = (re: RegExp) => allLinks.some((l) => l.internal && re.test(`${new URL(l.href, ctx.origin).pathname} ${l.text}`));
  const text = `${home.text} ${sums.map((s) => s.textSample).join(" ")}`;
  const tech = detectTech(home);

  // content & trust
  const h1 = home.headings.find((h) => h.level === 1)?.text ?? "";
  const lead = home.text.slice(0, 1500);
  c.check("content.value_proposition", h1.length >= 8 && h1.length <= 140 && lead.split(/\s+/).length >= 20, { actual: h1 ? `H1: "${trunc(h1, 120)}"` : "No H1 on the homepage", expected: "A clear headline and supporting description", ...inferred });
  c.check("content.company_info", hasLink(rx.about) || /©|copyright/i.test(home.text) && /ltd|llc|inc\b|gmbh|limited|corporation|company/i.test(home.text), { actual: hasLink(rx.about) ? "About/company page linked" : "No About page link found", ...inferred });
  const phones = new Set(sums.flatMap((s) => s.phones));
  const emails = new Set(sums.flatMap((s) => s.emails));
  const hasContactPage = hasLink(/contact/i) || allLinks.some((l) => l.scheme === "tel" || l.scheme === "mailto");
  c.check("content.contact_info", hasContactPage || phones.size > 0 || emails.size > 0, { actual: hasContactPage ? "Contact route found" : phones.size || emails.size ? "Contact details in text" : "No contact information found", ...inferred });
  c.check("content.policies", hasLink(rx.terms), { actual: hasLink(rx.terms) ? "Terms/legal page linked" : "No terms or legal page link found", ...inferred });
  const yr = /(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/i.exec(home.text);
  if (!yr) c.na("content.outdated", "No copyright year found.");
  else { const y = Number(yr[1]); const now = new Date().getFullYear(); c.check("content.outdated", y >= now - 1, { actual: `Copyright year ${y}`, expected: `${now - 1} or ${now}`, ...inferred }); }
  if (phones.size > 2 || emails.size > 3) c.fail("content.inconsistent_details", { actual: `${phones.size} different phone numbers and ${emails.size} email addresses across pages`, expected: "Consistent contact details", ...inferred });
  else c.pass("content.inconsistent_details", { actual: `${phones.size} phone number(s), ${emails.size} email address(es)`, ...inferred });
  c.notTested("content.spelling", "Spelling and grammar need a language-model or dictionary integration, which is not configured.");
  c.notTested("content.accuracy", "The accuracy of factual claims cannot be verified automatically; it needs owner or editorial review.");

  // business
  const ctas = [...home.links.filter((l) => rx.cta.test(l.text)).map((l) => l.text), ...(home.body ? [] : [])];
  const btnCtas = home.html.match(/<button[^>]*>([^<]{3,40})<\/button>/gi)?.filter((b) => rx.cta.test(b)) ?? [];
  c.check("biz.cta.primary", ctas.length + btnCtas.length > 0, { actual: ctas.length + btnCtas.length ? `Calls to action: ${[...new Set(ctas)].slice(0, 4).join(", ")}` : "No clear call to action on the homepage", note: "Conversion rates are not measured; this reports design opportunities only.", ...inferred });
  c.check("biz.pricing", hasLink(rx.pricing) || /[$€£]\s?\d/.test(home.text), { actual: hasLink(rx.pricing) ? "Pricing/plans linked" : "No pricing information found", ...inferred });
  const trust = Object.entries(rx.trust).filter(([, re]) => re.test(text)).map(([k]) => k);
  c.check("biz.trust_signals", trust.length >= 2, { actual: trust.length ? `Signals: ${trust.join(", ")}` : "No trust signals found", expected: "Two or more", note: "Authenticity of the signals is not verified.", ...inferred });
  c.check("biz.case_studies", hasLink(rx.cases), { actual: hasLink(rx.cases) ? "Case studies or portfolio linked" : "None found", ...inferred });
  c.check("biz.support", hasLink(rx.support), { actual: hasLink(rx.support) ? "Support/help linked" : "None found", ...inferred });
  const leadForm = sums.some((s) => s.facts.formCount > 0) || hasLink(rx.lead);
  c.check("biz.lead_capture", leadForm, { actual: leadForm ? "A lead or subscription path exists" : "None found", ...inferred });

  // local SEO
  const items = sums.flatMap((s) => s.schemaItems);
  const localItems = items.filter((o) => (Array.isArray(o["@type"]) ? (o["@type"] as string[]) : [o["@type"] as string]).some((t) => typeof t === "string" && isLocalType(t)));
  if (!localItems.length) c.fail("local.schema", { actual: "No LocalBusiness markup", expected: "LocalBusiness JSON-LD with name, address and telephone", ...measured });
  else {
    const o = localItems[0];
    const miss = ["name", "address", "telephone", "openingHours", "geo"].filter((k) => !o[k] && !(k === "openingHours" && o.openingHoursSpecification));
    const required = ["name", "address"].filter((k) => miss.includes(k));
    if (required.length) c.fail("local.schema", { actual: `Missing ${required.join(", ")}`, ...measured });
    else if (miss.length) c.warn("local.schema", { actual: `Missing recommended: ${miss.join(", ")}`, ...measured });
    else c.pass("local.schema", { actual: "Complete LocalBusiness markup", ...measured });
  }
  const napPhone = phones.size > 0 || allLinks.some((l) => l.scheme === "tel");
  const napAddr = rx.address.test(text) || localItems.some((o) => Boolean(o.address));
  if (napPhone && napAddr && phones.size <= 2) c.pass("local.nap", { actual: "Phone and address present", ...inferred });
  else if (napPhone || napAddr) c.warn("local.nap", { actual: `${napPhone ? "Phone" : "Address"} found; ${napPhone ? "address" : "phone"} missing${phones.size > 2 ? "; several different phone numbers" : ""}`, ...inferred });
  else c.fail("local.nap", { actual: "No phone number or address found", ...inferred });
  c.check("local.hours", rx.hours.test(text) || localItems.some((o) => Boolean(o.openingHours || o.openingHoursSpecification)), { actual: "Opening hours " + (rx.hours.test(text) ? "found" : "not found"), ...inferred });
  c.check("local.map", sums.some((s) => s.iframeUrls.some((u) => /google\.[a-z.]+\/maps|maps\.google|openstreetmap|mapbox|bing\.com\/maps/i.test(u))) || allLinks.some((l) => /google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|maps\.apple/i.test(l.href)), { actual: "Map or directions link check complete", ...inferred });
  c.check("local.pages", hasLink(/locations?|service-area|areas?-(we-)?serve|branches|stores|near-me/i), { actual: "Location/service-area pages " + (hasLink(/locations?|service-area|areas?-(we-)?serve|branches|stores|near-me/i) ? "found" : "not found"), ...inferred });
  c.check("local.reviews", /reviews?|testimonial/i.test(text) || items.some((o) => Boolean(o.aggregateRating || o.review)), { actual: "Reviews " + (/reviews?|testimonial/i.test(text) ? "found" : "not found"), ...inferred });
  c.notTested("local.gbp", "Google Business Profile data is read only through an authorised connection, which is not configured.");
  c.notTested("local.directories", "External directory listings are not collected; this needs owner verification.");

  // e-commerce
  const ship = hasLink(/shipping|delivery/i), ret = hasLink(/return|refund|exchange/i);
  c.grade("ecom.policies", ship && ret ? "pass" : ship || ret ? "warn" : "fail", { actual: `Shipping ${ship ? "found" : "missing"}; returns ${ret ? "found" : "missing"}`, ...inferred });
  const cart = hasLink(/cart|basket|bag/i), checkout = hasLink(/checkout|\/pay/i);
  c.check("ecom.cart_checkout", cart || checkout, { actual: `Cart ${cart ? "linked" : "not linked"}; checkout ${checkout ? "linked" : "not linked"}`, note: "Checkout is never completed during passive audits.", ...inferred });
  c.check("ecom.payment_methods", rx.payment.test(text) || rx.payment.test(home.html), { actual: rx.payment.test(home.html) ? "Payment methods mentioned" : "None mentioned", ...inferred });
  c.check("ecom.navigation", home.links.filter((l) => l.internal).length >= 5 && hasLink(/categor|collections?|shop|products?|store/i), { actual: "Category navigation " + (hasLink(/categor|collections?|shop|products?|store/i) ? "found" : "not found"), ...inferred });
  c.notTested("ecom.checkout_flow", "Payment, refund and order-confirmation flows need a sandbox or an authorised test environment; no live transaction is attempted.");
  const offers = items.flatMap((o) => (o.offers ? (Array.isArray(o.offers) ? o.offers : [o.offers]) : [])) as Record<string, unknown>[];
  if (!offers.length) c.na("ecom.stock_handling", "No Offer markup found.");
  else c.check("ecom.stock_handling", offers.some((o) => Boolean(o.availability)), { actual: offers.some((o) => Boolean(o.availability)) ? "Availability declared" : "No availability in Offer markup", ...measured });

  // analytics
  c.check("analytics.installed", tech.analytics.length + tech.tagManagers.length > 0, { actual: [...tech.analytics, ...tech.tagManagers].join(", ") || "None detected", note: "Server-side or consent-gated tracking cannot be seen from the public site.", ...inferred });
  const gsc = home.meta["google-site-verification"];
  if (gsc) c.inconclusive("analytics.search_console", "A Search Console verification tag is present, but the connection itself can only be confirmed through an authorised integration.");
  else c.notTested("analytics.search_console", "Search Console access is confirmed only through an authorised integration, which is not configured.");
  c.notTested("analytics.conversion_events", "Conversion event configuration lives in the analytics account and needs an authorised integration.");
  c.check("analytics.error_monitoring", tech.errorMonitoring.length > 0, { actual: tech.errorMonitoring.join(", ") || "No client error-monitoring script detected", ...inferred });
  const statusLink = allLinks.some((l) => /^status\.|statuspage|status\.io|\/status\b|uptimerobot/i.test(`${new URL(l.href, ctx.origin).hostname} ${new URL(l.href, ctx.origin).pathname}`));
  c.check("analytics.status_page", statusLink, { actual: statusLink ? "Status page linked" : "No status page link", ...inferred });
  for (const id of ["analytics.uptime", "analytics.backups", "analytics.deploy_workflow", "analytics.incident_response", "analytics.content_review"]) c.notTested(id, "This practice cannot be observed from outside; it needs owner-supplied evidence.");
}

export type { PageSummary };
