/** SEO / AEO analysis. `observed` findings come from fetched HTML; `hypotheses` are labelled sales ideas and never presented as facts. No rankings, traffic or volume figures are produced. */
import { jsonLdNodes, typeOf, type ParsedPage } from "./html";

export interface Finding { id: string; area: "seo" | "aeo"; severity: "info" | "low" | "medium" | "high"; observed: string; why: string; url: string | null }
export interface SeoAeoReport {
  observed: Finding[];
  metrics: { pagesAnalysed: number; hasSitemap: boolean; robotsFound: boolean; structuredDataTypes: string[]; questionHeadings: number; imagesTotal: number; imagesWithoutAlt: number; titleLength: number | null; descriptionLength: number | null; h1Count: number | null; noindex: boolean };
  aeoQuestions: { question: string; basis: string }[];
  suggestions: { seoTitle: string | null; metaDescription: string | null; slug: string | null };
  note: string;
}
const QUESTION = /^(what|why|how|when|where|who|which|can|do|does|is|are|should)\b|\?$/i;

export function analyseSeoAeo(pages: ParsedPage[], opts: { hasSitemap: boolean; robotsFound: boolean; companyName?: string | null }): SeoAeoReport {
  const home = pages[0]; const f: Finding[] = [];
  const add = (x: Finding) => f.push(x);
  if (!home) return { observed: [], metrics: { pagesAnalysed: 0, hasSitemap: opts.hasSitemap, robotsFound: opts.robotsFound, structuredDataTypes: [], questionHeadings: 0, imagesTotal: 0, imagesWithoutAlt: 0, titleLength: null, descriptionLength: null, h1Count: null, noindex: false }, aeoQuestions: [], suggestions: { seoTitle: null, metaDescription: null, slug: null }, note: "No page could be read." };
  const nodes = jsonLdNodes(pages); const types = [...new Set(nodes.flatMap(typeOf))];
  if (!home.title) add({ id: "title_missing", area: "seo", severity: "high", observed: "The home page has no <title>.", why: "Titles are the main label shown for a page in search results.", url: home.url });
  else if (home.title.length > 65) add({ id: "title_long", area: "seo", severity: "low", observed: `The home page title is ${home.title.length} characters.`, why: "Long titles are often truncated in results (about 60 characters is a common guide).", url: home.url });
  else if (home.title.length < 15) add({ id: "title_short", area: "seo", severity: "low", observed: `The home page title is only ${home.title.length} characters.`, why: "Very short titles rarely describe what the business does.", url: home.url });
  if (!home.description) add({ id: "meta_desc_missing", area: "seo", severity: "medium", observed: "The home page has no meta description.", why: "Without one, search engines pick their own snippet from the page.", url: home.url });
  else if (home.description.length > 170 || home.description.length < 50) add({ id: "meta_desc_length", area: "seo", severity: "low", observed: `The meta description is ${home.description.length} characters.`, why: "Roughly 70-160 characters usually displays in full.", url: home.url });
  if (home.h1.length === 0) add({ id: "h1_missing", area: "seo", severity: "medium", observed: "The home page has no <h1> heading.", why: "The h1 states the page's main topic to readers and crawlers.", url: home.url });
  else if (home.h1.length > 1) add({ id: "h1_multiple", area: "seo", severity: "low", observed: `The home page has ${home.h1.length} <h1> headings.`, why: "One clear main heading per page is the usual convention.", url: home.url });
  if (!home.canonical) add({ id: "canonical_missing", area: "seo", severity: "low", observed: "No canonical URL is declared on the home page.", why: "A canonical link tells search engines which address is the preferred one.", url: home.url });
  const noindex = /noindex/i.test(home.robotsMeta ?? "");
  if (noindex) add({ id: "noindex", area: "seo", severity: "high", observed: "The home page carries a noindex directive.", why: "Pages marked noindex are asked to stay out of search results.", url: home.url });
  if (!opts.hasSitemap) add({ id: "sitemap_missing", area: "seo", severity: "medium", observed: "No sitemap was found (robots.txt lists none and /sitemap.xml did not respond).", why: "A sitemap helps crawlers discover every page.", url: null });
  if (!opts.robotsFound) add({ id: "robots_missing", area: "seo", severity: "info", observed: "No robots.txt file was found.", why: "It is optional, but it is where crawl rules and sitemap links normally live.", url: null });
  if (!home.hasViewport) add({ id: "viewport_missing", area: "seo", severity: "medium", observed: "No mobile viewport meta tag on the home page.", why: "Without it pages usually render poorly on phones.", url: home.url });
  const imgs = pages.reduce((a, p) => a + p.imagesTotal, 0), noAlt = pages.reduce((a, p) => a + p.imagesWithoutAlt, 0);
  if (imgs > 0 && noAlt / imgs > 0.3) add({ id: "alt_missing", area: "seo", severity: "low", observed: `${noAlt} of ${imgs} images across ${pages.length} page(s) have no alt text.`, why: "Alt text describes images to screen-reader users and to search engines.", url: null });
  if (pages.some((p) => p.wordCount > 0 && p.wordCount < 150)) add({ id: "thin_content", area: "seo", severity: "low", observed: `${pages.filter((p) => p.wordCount < 150).length} page(s) have under 150 words of text.`, why: "Very short pages may not answer what visitors came to learn.", url: pages.find((p) => p.wordCount < 150)!.url });
  if (!types.length) add({ id: "no_structured_data", area: "aeo", severity: "medium", observed: "No schema.org structured data (JSON-LD) was found.", why: "Structured data states facts (who, what, where) in a form machines read directly, which answer engines rely on.", url: home.url });
  else if (!types.some((t) => /Organization|LocalBusiness|Corporation/.test(t))) add({ id: "no_org_schema", area: "aeo", severity: "low", observed: `Structured data exists (${types.slice(0, 4).join(", ")}) but none describes the organisation.`, why: "An Organization entity helps engines name and describe the business consistently.", url: home.url });
  const qHeads = pages.flatMap((p) => [...p.h2, ...p.h3]).filter((h) => QUESTION.test(h));
  if (qHeads.length === 0) add({ id: "no_question_headings", area: "aeo", severity: "low", observed: "No headings are phrased as customer questions.", why: "Question-style headings with a short direct answer are easy for answer engines to quote.", url: null });
  if (!types.includes("FAQPage") && qHeads.length >= 3) add({ id: "faq_without_schema", area: "aeo", severity: "info", observed: `${qHeads.length} question-style headings but no FAQPage markup.`, why: "FAQ markup should only be added where the page really shows questions and answers.", url: null });
  const services = pages.slice(1).flatMap((p) => p.h2.slice(0, 4)).concat(home.h2.slice(0, 4)).filter((h) => h.length > 3 && h.length < 60 && !QUESTION.test(h));
  const aeoQuestions = [...new Set(services)].slice(0, 6).map((s) => ({ question: `What is ${s.toLowerCase()} and who is it for?`, basis: `Suggested from the heading "${s}" found on the site (a content idea, not a measured search query).` }));
  const slugBase = (home.h1[0] ?? home.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || null;
  return {
    observed: f,
    metrics: { pagesAnalysed: pages.length, hasSitemap: opts.hasSitemap, robotsFound: opts.robotsFound, structuredDataTypes: types.slice(0, 12), questionHeadings: qHeads.length, imagesTotal: imgs, imagesWithoutAlt: noAlt, titleLength: home.title?.length ?? null, descriptionLength: home.description?.length ?? null, h1Count: home.h1.length, noindex },
    aeoQuestions,
    suggestions: { seoTitle: home.title ? (home.title.length > 60 ? home.title.slice(0, 57).trimEnd() + "…" : null) : (opts.companyName && home.h1[0] ? `${home.h1[0]} | ${opts.companyName}`.slice(0, 60) : null), metaDescription: !home.description && home.text ? home.text.slice(0, 155).replace(/\s+\S*$/, "").trim() + "…" : null, slug: slugBase },
    note: "Observed items come from the pages that were fetched. Rankings, search volume, backlinks, traffic and keyword difficulty are not measured here and are never estimated.",
  };
}

/** Sales hypotheses linked to observed findings. Always labelled as hypotheses. */
export function serviceFitHypotheses(report: SeoAeoReport): { service: string; hypothesis: string; because: string[] }[] {
  const ids = new Set(report.observed.map((o) => o.id));
  const out: { service: string; hypothesis: string; because: string[] }[] = [];
  const seo = ["title_missing", "meta_desc_missing", "h1_missing", "sitemap_missing", "canonical_missing", "alt_missing", "thin_content"].filter((i) => ids.has(i));
  if (seo.length >= 2) out.push({ service: "SEO growth and optimization", hypothesis: "The site may benefit from on-page SEO work.", because: seo });
  const aeo = ["no_structured_data", "no_org_schema", "no_question_headings"].filter((i) => ids.has(i));
  if (aeo.length) out.push({ service: "SEO growth and optimization (AEO)", hypothesis: "Content may be hard for answer engines to quote accurately.", because: aeo });
  if (ids.has("viewport_missing")) out.push({ service: "Website development", hypothesis: "The site may not be mobile-friendly.", because: ["viewport_missing"] });
  if (ids.has("noindex")) out.push({ service: "Website development / SEO", hypothesis: "The home page asks search engines not to index it - confirm whether that is intended.", because: ["noindex"] });
  return out;
}
