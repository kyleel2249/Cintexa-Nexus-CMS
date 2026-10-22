/**
 * Competitor intelligence: pure, dependency-free logic shared by the API host and local mode.
 *
 * Nothing here performs I/O. The engine feeds it evidence (search results, fetched page facts, user input) and it returns
 * candidates, a transparent confidence breakdown and a classification. It never invents a competitor: every candidate must
 * carry at least one piece of evidence, and a candidate whose content has not been verified can never be classed as direct.
 */

export const COMPETITOR_FORMULA_VERSION = "competitors-1.0";

export const COMPETITOR_CLASSES = ["direct", "indirect", "search", "aspirational", "reference"] as const;
export type CompetitorClass = (typeof COMPETITOR_CLASSES)[number];

export const COMPETITOR_CLASS_LABELS: Record<CompetitorClass, string> = {
  direct: "Direct competitor",
  indirect: "Indirect competitor",
  search: "Search competitor",
  aspirational: "Aspirational benchmark",
  reference: "Industry reference",
};

export const COMPETITOR_CLASS_DESCRIPTIONS: Record<CompetitorClass, string> = {
  direct: "Offers a similar product or service and appears for the same searches.",
  indirect: "Overlaps with part of the offering but is not a like-for-like substitute.",
  search: "Competes for the same search results without clearly selling the same thing (directories, marketplaces, publishers).",
  aspirational: "A site you chose to measure yourself against. Never assigned automatically.",
  reference: "A neutral industry or standards reference, not a commercial rival.",
};

/** pending = discovered, not yet reviewed; approved/rejected = a person decided; unverifiable = could not be fetched. */
export const COMPETITOR_STATUSES = ["pending", "approved", "rejected", "unverifiable"] as const;
export type CompetitorStatus = (typeof COMPETITOR_STATUSES)[number];

export const DISCOVERY_SOURCES = ["search_provider", "ai_hypothesis", "user", "existing_benchmark", "site_link"] as const;
export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

export const DISCOVERY_SOURCE_LABELS: Record<DiscoverySource, string> = {
  search_provider: "Search provider results",
  ai_hypothesis: "AI suggestion (unverified hypothesis)",
  user: "Added by a person",
  existing_benchmark: "Earlier benchmark audit",
  site_link: "Linked from the audited site",
};

export interface CompetitorEvidence {
  kind: "search_result" | "fetched_page" | "user_input" | "existing_audit" | "ai_hypothesis" | "site_link";
  detail: string;
  url?: string;
  query?: string;
  rank?: number;
  provider?: string;
  at: string;
}

export interface ConfidenceBreakdown {
  version: string;
  searchOverlap: number | null;
  contentSimilarity: number | null;
  geographicOverlap: number | null;
  evidenceQuality: number;
  confidence: number;
  cap: number | null;
  capReason: string | null;
  notes: string[];
}

export interface CompetitorCandidate {
  domain: string;
  url: string;
  name: string | null;
  classification: CompetitorClass;
  classificationReason: string;
  status: CompetitorStatus;
  sources: DiscoverySource[];
  evidence: CompetitorEvidence[];
  confidence: number;
  breakdown: ConfidenceBreakdown;
  industry: string | null;
  market: string | null;
  /** Set when a person has confirmed or edited the record. Automatic discovery must not overwrite these fields. */
  userConfirmed: boolean;
  firstDiscoveredAt: string;
  lastVerifiedAt: string | null;
}

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

/** Second-level public suffixes where the registrable domain has three labels (not exhaustive; unknown suffixes fall back to two labels). */
const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "org.nz", "net.nz",
  "co.za", "org.za", "web.za",
  "com.gh", "org.gh", "edu.gh", "gov.gh",
  "com.ng", "org.ng", "gov.ng", "edu.ng",
  "co.ke", "or.ke", "go.ke",
  "co.in", "net.in", "org.in", "ac.in",
  "com.br", "net.br", "org.br",
  "com.mx", "com.ar", "com.co", "com.pe",
  "co.jp", "or.jp", "ne.jp", "ac.jp",
  "com.sg", "com.hk", "com.my", "com.ph", "com.pk", "com.bd", "com.eg", "com.sa", "com.tr", "com.cn", "com.tw", "com.ua", "co.il", "co.id", "co.th", "co.kr",
]);

/** Lowercase hostname without port, credentials, trailing dot or a leading "www.". Returns null when the input is not a plausible hostname. */
export function competitorHostname(input: string): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (!host || host.length > 253) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) return null; // needs a dot; excludes IP literals with brackets and bare words
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null; // IPv4 literals are never competitors
  return host;
}

/** Registrable domain (e.g. shop.example.co.uk -> example.co.uk). Heuristic: a built-in list of common multi-part suffixes. */
export function registrableDomain(host: string): string {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const last2 = parts.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(last2) && parts.length >= 3) return parts.slice(-3).join(".");
  return last2;
}

/** The canonical identity used to deduplicate competitors: the registrable domain. Subdomains of one site are one competitor. */
export function canonicalDomain(input: string): string | null {
  const host = competitorHostname(input);
  return host ? registrableDomain(host) : null;
}

export function sameSite(a: string, b: string): boolean {
  const x = canonicalDomain(a);
  const y = canonicalDomain(b);
  return x !== null && x === y;
}

export type ExclusionKind = "social" | "search_engine" | "video" | "code_host" | "marketplace" | "directory" | "aggregator" | "reference" | "infrastructure";
export interface Exclusion { kind: ExclusionKind; reason: string }

const EXCLUDED: Record<ExclusionKind, string[]> = {
  social: ["facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com", "tiktok.com", "pinterest.com", "reddit.com", "threads.net", "snapchat.com", "t.me", "whatsapp.com", "quora.com", "medium.com", "tumblr.com", "wa.me"],
  search_engine: ["google.com", "bing.com", "yahoo.com", "duckduckgo.com", "baidu.com", "yandex.com", "brave.com", "ecosia.org", "ask.com", "search.brave.com"],
  video: ["youtube.com", "youtu.be", "vimeo.com", "twitch.tv", "dailymotion.com"],
  code_host: ["github.com", "gitlab.com", "bitbucket.org", "stackoverflow.com", "npmjs.com"],
  marketplace: ["amazon.com", "ebay.com", "etsy.com", "alibaba.com", "aliexpress.com", "walmart.com", "jumia.com", "jiji.ng", "tonaton.com", "olx.com", "shopee.com", "mercadolibre.com", "temu.com", "flipkart.com", "upwork.com", "fiverr.com", "freelancer.com", "airbnb.com", "booking.com", "expedia.com", "tripadvisor.com"],
  directory: ["yelp.com", "yellowpages.com", "clutch.co", "goodfirms.co", "g2.com", "capterra.com", "trustpilot.com", "sortlist.com", "designrush.com", "themanifest.com", "crunchbase.com", "glassdoor.com", "indeed.com", "bbb.org", "foursquare.com", "mapquest.com", "ghanayello.com", "softwareadvice.com", "getapp.com", "producthunt.com"],
  aggregator: ["buzzfeed.com", "forbes.com", "businessinsider.com", "techcrunch.com", "wired.com", "cnet.com", "pcmag.com", "zdnet.com", "theverge.com", "nytimes.com", "bbc.com", "cnn.com", "entrepreneur.com", "inc.com", "hubspot.com", "semrush.com", "ahrefs.com", "moz.com"],
  reference: ["wikipedia.org", "wikimedia.org", "britannica.com", "w3.org", "mozilla.org", "schema.org", "archive.org"],
  infrastructure: ["cloudflare.com", "amazonaws.com", "azure.com", "googleusercontent.com", "gstatic.com", "wordpress.com", "wix.com", "squarespace.com", "shopify.com", "godaddy.com", "namecheap.com", "blogspot.com", "weebly.com"],
};

const EXCLUSION_REASONS: Record<ExclusionKind, string> = {
  social: "a social network profile, not a company website",
  search_engine: "a search engine",
  video: "a video platform",
  code_host: "a code or Q&A host",
  marketplace: "a marketplace that hosts many sellers; it competes for the same searches but is not a like-for-like competitor",
  directory: "a review site or business directory; it competes for the same searches but does not sell the same thing",
  aggregator: "a publisher or aggregator; it ranks for the same searches but is not a commercial competitor",
  reference: "a neutral reference site",
  infrastructure: "a hosting or platform provider, not a competitor",
};

/** Returns the exclusion that applies to a hostname, or null. The match is on the registrable domain or any parent of the host. */
export function exclusionFor(input: string): Exclusion | null {
  const host = competitorHostname(input);
  if (!host) return null;
  for (const kind of Object.keys(EXCLUDED) as ExclusionKind[]) {
    for (const d of EXCLUDED[kind]) if (host === d || host.endsWith(`.${d}`)) return { kind, reason: EXCLUSION_REASONS[kind] };
  }
  return null;
}

/** Excluded kinds that are never shown as candidates at all, as opposed to kinds that may appear as search competitors or references. */
const DROPPED_KINDS: ReadonlySet<ExclusionKind> = new Set(["social", "search_engine", "video", "code_host", "infrastructure"]);
export const isDroppedExclusion = (e: Exclusion | null): boolean => e !== null && DROPPED_KINDS.has(e.kind);

// ---------------------------------------------------------------------------
// Site profile and queries
// ---------------------------------------------------------------------------

const STOPWORDS = new Set((
  "a an the and or but if then else for of to in on at by with from as is are was were be been being it its this that these those you your we our us they their i me my " +
  "not no yes can will just do does did done have has had having how what when where which who whom why all any both each few more most other some such only own same so than too very " +
  "home about contact us page pages site website web welcome new now get best top free online com www http https html php login log sign signin signup register cart checkout shop store " +
  "blog news read more learn click here view see all privacy policy terms conditions cookie cookies faq help support services service products product solutions solution company " +
  "official team careers jobs join read-more menu skip content main navigation search results per day week month year years one two three first last next previous " +
  "le la les de des du un une et en pour sur avec dans par au aux el los las del y para con por una"
).split(/\s+/));

export interface PageLite {
  url: string;
  title: string | null;
  metaDescription: string | null;
  lang?: string | null;
  important?: boolean;
  depth?: number;
  status?: number | null;
}

export interface SiteProfile {
  domain: string;
  brandTokens: string[];
  terms: { term: string; weight: number }[];
  phrases: string[];
  languages: string[];
  tld: string;
  pagesUsed: number;
  /** False when there was too little text to infer a niche. Discovery then reports the gap instead of guessing. */
  sufficient: boolean;
  insufficientReason: string | null;
}

export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length >= 3 && t.length <= 24 && !/^\d+$/.test(t) && !STOPWORDS.has(t));
}

/** Splits titles on common separators so the brand part ("Acme | Home") is not treated as topic text. */
function titleSegments(title: string): string[] {
  return title.split(/\s[|–—·:•]\s|\s-\s/).map((s) => s.trim()).filter(Boolean);
}

export function buildSiteProfile(domain: string, pages: PageLite[], maxTerms = 24): SiteProfile {
  const canonical = canonicalDomain(domain) ?? domain.toLowerCase();
  const label = canonical.split(".")[0] ?? "";
  const brandTokens = Array.from(new Set([label, ...label.split(/[-_]/)].filter((t) => t.length >= 3)));
  const brand = new Set(brandTokens);
  const usable = pages.filter((p) => (p.status === undefined || p.status === null || (p.status >= 200 && p.status < 300)) && (p.title || p.metaDescription));
  const tf = new Map<string, number>();
  const bigrams = new Map<string, number>();
  const langs = new Map<string, number>();
  for (const p of usable) {
    const w = (p.important ? 2 : 1) * (p.depth === 0 ? 2 : 1);
    if (p.lang) { const l = p.lang.toLowerCase().split("-")[0]; langs.set(l, (langs.get(l) ?? 0) + 1); }
    const texts: string[] = [];
    if (p.title) texts.push(...titleSegments(p.title));
    if (p.metaDescription) texts.push(p.metaDescription);
    for (const text of texts) {
      const toks = tokenize(text).filter((t) => !brand.has(t));
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + w);
      for (let i = 0; i + 1 < toks.length; i++) { const bg = `${toks[i]} ${toks[i + 1]}`; bigrams.set(bg, (bigrams.get(bg) ?? 0) + w); }
    }
  }
  const total = Array.from(tf.values()).reduce((a, b) => a + b, 0);
  const terms = Array.from(tf.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, maxTerms).map(([term, n]) => ({ term, weight: total ? Math.round((n / total) * 1000) / 1000 : 0 }));
  const phrases = Array.from(bigrams.entries()).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([p]) => p);
  const languages = Array.from(langs.entries()).sort((a, b) => b[1] - a[1]).map(([l]) => l);
  const tld = canonical.split(".").slice(-1)[0] ?? "";
  const sufficient = terms.length >= 4 && usable.length >= 1;
  return {
    domain: canonical, brandTokens, terms, phrases, languages, tld, pagesUsed: usable.length, sufficient,
    insufficientReason: sufficient ? null : usable.length === 0 ? "No audited page had a title or meta description to infer the site's subject from." : "The audited pages contain too little descriptive text to infer a niche reliably.",
  };
}

/** Builds search queries from the profile. Brand tokens are excluded so the queries find rivals, not the site itself. */
export function deriveQueries(profile: SiteProfile, max = 4): string[] {
  if (!profile.sufficient) return [];
  const out: string[] = [];
  const add = (q: string) => { const s = q.replace(/\s+/g, " ").trim(); if (s && !out.includes(s) && out.length < max) out.push(s); };
  for (const p of profile.phrases.slice(0, 2)) add(p);
  const top = profile.terms.slice(0, 6).map((t) => t.term);
  if (top.length >= 2) add(`${top[0]} ${top[1]}`);
  if (top.length >= 3) add(`${top[0]} ${top[2]}`);
  if (top.length >= 2 && profile.phrases[0]) add(`${profile.phrases[0]} alternatives`);
  if (top.length >= 4) add(`${top[1]} ${top[2]} ${top[3]}`);
  return out.slice(0, max);
}

// ---------------------------------------------------------------------------
// Similarity and confidence
// ---------------------------------------------------------------------------

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Weighted overlap of a candidate's term set with the profile's terms: the share of profile weight present in the candidate, with a small Jaccard term. */
export function contentSimilarity(profile: SiteProfile, candidateTexts: (string | null | undefined)[]): number | null {
  const cand = new Set<string>();
  for (const t of candidateTexts) for (const tok of tokenize(t)) cand.add(tok);
  if (cand.size < 3 || profile.terms.length === 0) return null;
  const brand = new Set(profile.brandTokens);
  let shared = 0;
  let totalWeight = 0;
  let sharedCount = 0;
  for (const { term, weight } of profile.terms) {
    totalWeight += weight;
    if (cand.has(term)) { shared += weight; sharedCount++; }
  }
  const coverage = totalWeight ? shared / totalWeight : 0;
  const union = new Set([...cand].filter((t) => !brand.has(t)));
  for (const { term } of profile.terms) union.add(term);
  const jaccard = union.size ? sharedCount / union.size : 0;
  return round3(clamp01(coverage * 0.75 + Math.min(1, jaccard * 4) * 0.25));
}

/** Overlap of the candidate with the issued queries: each query it appeared in contributes by rank (rank 1 = full credit, rank 10 = a tenth). */
export function searchOverlap(appearances: { query: string; rank: number }[], queriesIssued: number): number | null {
  if (queriesIssued <= 0) return null;
  const best = new Map<string, number>();
  for (const a of appearances) { const credit = clamp01((11 - Math.max(1, a.rank)) / 10); if (credit > (best.get(a.query) ?? 0)) best.set(a.query, credit); }
  let sum = 0;
  for (const v of best.values()) sum += v;
  return round3(clamp01(sum / queriesIssued));
}

/** Geography is inferred only from the country-code TLD and the page language, and is reported null when neither is informative. */
export function geographicOverlap(profile: SiteProfile, candidateDomain: string, candidateLang?: string | null): number | null {
  const ctld = (d: string): string | null => { const t = d.split(".").slice(-1)[0] ?? ""; return t.length === 2 ? t : null; };
  const a = ctld(profile.domain);
  const b = ctld(candidateDomain);
  const lang = candidateLang ? candidateLang.toLowerCase().split("-")[0] : null;
  const langKnown = lang !== null && profile.languages.length > 0;
  const langMatch = langKnown ? profile.languages.includes(lang as string) : null;
  if (a && b) return a === b ? (langMatch === false ? 0.6 : 1) : 0;
  if (langMatch === false) return 0;
  if (a && !b) return langMatch === true ? 0.6 : 0.5; // a generic-TLD rival of a country-specific site: possible, not confirmed
  if (!a && b) return langMatch === true ? 0.6 : 0.5;
  return langMatch === true ? 0.7 : null; // both on generic TLDs: no geographic signal
}

export interface ScoringInput {
  domain: string;
  sources: DiscoverySource[];
  evidence: CompetitorEvidence[];
  appearances: { query: string; rank: number }[];
  queriesIssued: number;
  /** Texts from the candidate's own page (title, meta description, H1). Empty when the page could not be fetched. */
  fetchedTexts: (string | null | undefined)[];
  fetched: boolean;
  fetchedLang?: string | null;
  https: boolean;
  userProvided: boolean;
}

export function scoreCandidate(profile: SiteProfile, input: ScoringInput): ConfidenceBreakdown {
  const notes: string[] = [];
  const so = searchOverlap(input.appearances, input.queriesIssued);
  const cs = input.fetched ? contentSimilarity(profile, input.fetchedTexts) : null;
  const geo = geographicOverlap(profile, input.domain, input.fetchedLang);
  const ev = round3(clamp01(
    (input.appearances.length > 0 ? 0.35 : 0) + (input.fetched ? 0.3 : 0) + (cs !== null ? 0.15 : 0) + (input.https ? 0.05 : 0) + (input.userProvided ? 0.15 : 0),
  ));
  const parts: { w: number; v: number | null }[] = [{ w: 0.4, v: so }, { w: 0.35, v: cs }, { w: 0.1, v: geo }, { w: 0.15, v: ev }];
  const known = parts.filter((p) => p.v !== null);
  const wsum = known.reduce((a, p) => a + p.w, 0);
  let confidence = wsum ? known.reduce((a, p) => a + p.w * (p.v as number), 0) / wsum : 0;
  if (so === null) notes.push("No search provider results were available, so search overlap was not measured.");
  if (cs === null) notes.push(input.fetched ? "The candidate page had too little text to measure content similarity." : "The candidate page was not fetched, so content similarity was not measured.");
  if (geo === null) notes.push("Geography could not be inferred from the domain or page language.");
  let cap: number | null = null;
  let capReason: string | null = null;
  const only = (s: DiscoverySource) => input.sources.length > 0 && input.sources.every((x) => x === s);
  if (only("ai_hypothesis") && !input.fetched) { cap = 0.4; capReason = "An AI suggestion that has not been verified against the live site is capped as a hypothesis."; }
  else if (!input.fetched && !input.userProvided) { cap = 0.55; capReason = "The candidate page was not fetched, so the maximum confidence is limited."; }
  else if (cs === null && !input.userProvided) { cap = 0.6; capReason = "Content similarity could not be measured."; }
  if (cap !== null && confidence > cap) confidence = cap;
  if (input.userProvided && confidence < 0.5) { notes.push("Added by a person; confidence reflects the measured evidence only."); }
  return { version: COMPETITOR_FORMULA_VERSION, searchOverlap: so, contentSimilarity: cs, geographicOverlap: geo, evidenceQuality: ev, confidence: round3(clamp01(confidence)), cap, capReason, notes };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export interface ClassificationResult { classification: CompetitorClass; reason: string; dropped: boolean }

export const CLASSIFY_THRESHOLDS = { directContent: 0.25, directSearch: 0.2, indirectContent: 0.12, searchOverlap: 0.2, minConfidence: 0.15 } as const;

export function classifyCandidate(domainOrUrl: string, b: ConfidenceBreakdown, opts: { userClass?: CompetitorClass | null } = {}): ClassificationResult {
  if (opts.userClass) return { classification: opts.userClass, reason: "Classification set by a person.", dropped: false };
  const ex = exclusionFor(domainOrUrl);
  if (ex && isDroppedExclusion(ex)) return { classification: "reference", reason: `Not a competitor: ${ex.reason}.`, dropped: true };
  if (ex?.kind === "reference") return { classification: "reference", reason: `Industry reference: ${ex.reason}.`, dropped: false };
  if (ex) return { classification: "search", reason: `Search competitor only: ${ex.reason}.`, dropped: false };
  const T = CLASSIFY_THRESHOLDS;
  const cs = b.contentSimilarity;
  const so = b.searchOverlap;
  if (cs !== null && cs >= T.directContent && (so === null || so >= T.directSearch) && b.confidence >= 0.3) {
    return { classification: "direct", reason: so === null ? `Page content overlaps strongly with the audited site (similarity ${cs}); search overlap was not measured.` : `Page content overlaps with the audited site (similarity ${cs}) and it appears for the same searches (overlap ${so}).`, dropped: false };
  }
  if (cs !== null && cs >= T.indirectContent) return { classification: "indirect", reason: `Some content overlap (similarity ${cs}) without strong overlap in search results.`, dropped: false };
  if (so !== null && so >= T.searchOverlap) return { classification: "search", reason: cs === null ? `Appears for the same searches (overlap ${so}); content similarity could not be measured, so it cannot be treated as a direct competitor.` : `Appears for the same searches (overlap ${so}) but its content differs (similarity ${cs}).`, dropped: false };
  return { classification: "search", reason: "Weak evidence of relevance; kept as a low-confidence candidate for review.", dropped: b.confidence < T.minConfidence };
}

// ---------------------------------------------------------------------------
// Merge, dedupe, select
// ---------------------------------------------------------------------------

const CLASS_ORDER: Record<CompetitorClass, number> = { direct: 0, indirect: 1, search: 2, aspirational: 3, reference: 4 };

function uniqueEvidence(list: CompetitorEvidence[]): CompetitorEvidence[] {
  const seen = new Set<string>();
  const out: CompetitorEvidence[] = [];
  for (const e of list) { const k = `${e.kind}|${e.url ?? ""}|${e.query ?? ""}|${e.detail}`; if (!seen.has(k)) { seen.add(k); out.push(e); } }
  return out.slice(0, 40);
}

/**
 * Merges a fresh discovery run into the stored list, keyed by canonical domain.
 * A person's decision always wins: approved/rejected status, a user-set classification, a name or an industry are never replaced.
 * Rejected candidates stay rejected, so a rerun cannot silently resurrect them.
 */
export function mergeCandidates(existing: CompetitorCandidate[], incoming: CompetitorCandidate[]): CompetitorCandidate[] {
  const byDomain = new Map<string, CompetitorCandidate>();
  for (const c of existing) byDomain.set(c.domain, c);
  for (const n of incoming) {
    const cur = byDomain.get(n.domain);
    if (!cur) { byDomain.set(n.domain, n); continue; }
    const sources = Array.from(new Set([...cur.sources, ...n.sources]));
    const evidence = uniqueEvidence([...cur.evidence, ...n.evidence]);
    if (cur.userConfirmed) {
      byDomain.set(n.domain, { ...cur, sources, evidence, lastVerifiedAt: n.lastVerifiedAt ?? cur.lastVerifiedAt, breakdown: n.breakdown, confidence: n.confidence });
      continue;
    }
    const keepStatus = cur.status === "approved" || cur.status === "rejected" ? cur.status : n.status;
    byDomain.set(n.domain, {
      ...n, sources, evidence, status: keepStatus, firstDiscoveredAt: cur.firstDiscoveredAt,
      name: cur.name ?? n.name, industry: cur.industry ?? n.industry, market: cur.market ?? n.market,
      lastVerifiedAt: n.lastVerifiedAt ?? cur.lastVerifiedAt, userConfirmed: false,
    });
  }
  return Array.from(byDomain.values());
}

export interface SelectionOptions { maxDiscover: number; maxCompare: number; minConfidence: number }
export const DEFAULT_SELECTION: SelectionOptions = { maxDiscover: 20, maxCompare: 10, minConfidence: 0.3 };

export function rankCandidates(list: CompetitorCandidate[]): CompetitorCandidate[] {
  return [...list].sort((a, b) => {
    const st = (c: CompetitorCandidate) => (c.status === "approved" ? 0 : c.status === "pending" ? 1 : c.status === "unverifiable" ? 2 : 3);
    return st(a) - st(b) || CLASS_ORDER[a.classification] - CLASS_ORDER[b.classification] || b.confidence - a.confidence || a.domain.localeCompare(b.domain);
  });
}

/** Chooses the initial comparison set: approved competitors first, then the best-supported pending ones. Rejected and unverifiable ones are never selected. */
export function selectForComparison(list: CompetitorCandidate[], opts: Partial<SelectionOptions> = {}): CompetitorCandidate[] {
  const o = { ...DEFAULT_SELECTION, ...opts };
  const eligible = list.filter((c) => c.status === "approved" || (c.status === "pending" && c.confidence >= o.minConfidence && (c.classification === "direct" || c.classification === "indirect")));
  return rankCandidates(eligible).slice(0, o.maxCompare);
}

export function limitDiscovered(list: CompetitorCandidate[], maxDiscover = DEFAULT_SELECTION.maxDiscover): CompetitorCandidate[] {
  const kept = rankCandidates(list);
  const protectedOnes = kept.filter((c) => c.userConfirmed || c.status === "approved");
  const rest = kept.filter((c) => !(c.userConfirmed || c.status === "approved"));
  return [...protectedOnes, ...rest.slice(0, Math.max(0, maxDiscover - protectedOnes.length))];
}

export function newCandidate(domain: string, url: string, now: string): CompetitorCandidate {
  const breakdown: ConfidenceBreakdown = { version: COMPETITOR_FORMULA_VERSION, searchOverlap: null, contentSimilarity: null, geographicOverlap: null, evidenceQuality: 0, confidence: 0, cap: null, capReason: null, notes: [] };
  return { domain, url, name: null, classification: "search", classificationReason: "Not yet classified.", status: "pending", sources: [], evidence: [], confidence: 0, breakdown, industry: null, market: null, userConfirmed: false, firstDiscoveredAt: now, lastVerifiedAt: null };
}

// ---------------------------------------------------------------------------
// Benchmark comparability (used by the benchmarking views)
// ---------------------------------------------------------------------------

export interface BenchmarkRowLike { id: string; hostname: string; overall: number | null; provisional: boolean | null; coverage: number | null; pagesSampled: number }

/**
 * Decides whether competitor-derived benchmark numbers may be summarised, and how. A small sample is never described as an industry average.
 */
export function benchmarkSampleNote(rows: BenchmarkRowLike[]): { level: "none" | "insufficient" | "provisional" | "indicative"; note: string } {
  const scored = rows.filter((r) => r.overall !== null);
  if (scored.length === 0) return { level: "none", note: "No competitor has been benchmarked yet." };
  const incompatible = scored.some((r) => r.provisional === true || (r.coverage !== null && r.coverage < 0.5));
  if (scored.length < 3) return { level: "insufficient", note: `Only ${scored.length} competitor${scored.length === 1 ? "" : "s"} measured. This is a comparison with specific sites, not an industry average.` };
  if (incompatible) return { level: "provisional", note: `${scored.length} competitors measured, but some scores are provisional because coverage was incomplete. Treat the spread as provisional.` };
  return { level: "indicative", note: `${scored.length} selected competitors measured with a small passive sample each. The median describes this peer set only, not the whole industry.` };
}

export function median(values: number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] as number : Math.round((((v[mid - 1] as number) + (v[mid] as number)) / 2) * 10) / 10;
}
