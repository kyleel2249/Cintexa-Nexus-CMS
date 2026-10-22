import assert from "node:assert/strict";
import { test } from "node:test";
import {
  benchmarkSampleNote, buildSiteProfile, canonicalDomain, classifyCandidate, contentSimilarity, deriveQueries, exclusionFor, geographicOverlap, competitorHostname, limitDiscovered, median,
  mergeCandidates, newCandidate, scoreCandidate, searchOverlap, selectForComparison, tokenize,
  type CompetitorCandidate, type ScoringInput,
} from "../competitors";

const pages = [
  { url: "https://acme.io/", title: "Acme | Managed cloud hosting for small businesses", metaDescription: "Managed cloud hosting and backups for small business websites.", lang: "en", important: true, depth: 0, status: 200 },
  { url: "https://acme.io/hosting", title: "Managed cloud hosting plans - Acme", metaDescription: "Cloud hosting plans with daily backups and uptime monitoring.", lang: "en", depth: 1, status: 200 },
  { url: "https://acme.io/backups", title: "Website backups - Acme", metaDescription: "Automatic website backups for small business owners.", lang: "en", depth: 1, status: 200 },
  { url: "https://acme.io/broken", title: "Not found", metaDescription: null, status: 404 },
];

test("competitorHostname / canonicalDomain normalise and deduplicate", () => {
  assert.equal(competitorHostname("HTTPS://www.Example.com:8443/path?x=1"), "example.com");
  assert.equal(competitorHostname("example"), null);
  assert.equal(competitorHostname("http://10.0.0.5/"), null);
  assert.equal(canonicalDomain("shop.example.co.uk"), "example.co.uk");
  assert.equal(canonicalDomain("blog.example.com"), "example.com");
  assert.equal(canonicalDomain("www.example.com.gh"), "example.com.gh");
  assert.equal(canonicalDomain("not a host"), null);
});

test("exclusions drop social/search and downgrade marketplaces and directories", () => {
  assert.equal(exclusionFor("https://www.facebook.com/acme")?.kind, "social");
  assert.equal(exclusionFor("m.youtube.com")?.kind, "video");
  assert.equal(exclusionFor("clutch.co")?.kind, "directory");
  assert.equal(exclusionFor("shop.etsy.com")?.kind, "marketplace");
  assert.equal(exclusionFor("rival-hosting.com"), null);
  const b = scoreCandidate(buildSiteProfile("acme.io", pages), { domain: "clutch.co", sources: ["search_provider"], evidence: [], appearances: [{ query: "q", rank: 1 }], queriesIssued: 1, fetchedTexts: [], fetched: false, https: true, userProvided: false });
  const c = classifyCandidate("clutch.co", b);
  assert.equal(c.classification, "search");
  assert.equal(c.dropped, false);
  assert.equal(classifyCandidate("facebook.com", b).dropped, true);
});

test("site profile ignores brand tokens and failed pages and reports insufficiency honestly", () => {
  const p = buildSiteProfile("www.acme.io", pages);
  assert.equal(p.sufficient, true);
  assert.equal(p.pagesUsed, 3);
  assert.ok(p.terms.some((t) => t.term === "hosting"));
  assert.ok(!p.terms.some((t) => t.term === "acme"));
  const empty = buildSiteProfile("x.com", [{ url: "https://x.com", title: null, metaDescription: null, status: 200 }]);
  assert.equal(empty.sufficient, false);
  assert.deepEqual(deriveQueries(empty), []);
  assert.ok(empty.insufficientReason);
});

test("queries come from the profile and never contain the brand", () => {
  const q = deriveQueries(buildSiteProfile("acme.io", pages));
  assert.ok(q.length >= 2 && q.length <= 4);
  for (const s of q) assert.ok(!/acme/.test(s), s);
});

test("contentSimilarity is higher for on-topic text than off-topic text and null without text", () => {
  const p = buildSiteProfile("acme.io", pages);
  const on = contentSimilarity(p, ["Managed cloud hosting with daily backups", "Hosting plans for small business websites"]);
  const off = contentSimilarity(p, ["Handmade ceramic mugs and pottery classes", "Gift cards for artisan ceramics"]);
  assert.ok(on !== null && off !== null && on > off + 0.2, `${on} vs ${off}`);
  assert.equal(contentSimilarity(p, ["ok"]), null);
});

test("searchOverlap uses the best rank per query and returns null with no queries", () => {
  assert.equal(searchOverlap([{ query: "a", rank: 1 }], 0), null);
  assert.equal(searchOverlap([{ query: "a", rank: 1 }, { query: "a", rank: 9 }], 2), 0.5);
  assert.equal(searchOverlap([], 3), 0);
});

test("geographicOverlap is null when there is no signal and 0 for different country TLDs", () => {
  const p = buildSiteProfile("acme.io", pages);
  assert.equal(geographicOverlap(p, "rival.com", null), 0.7 * 0 + (geographicOverlap(p, "rival.com", null) as number));
  const gh = buildSiteProfile("shop.com.gh", [{ url: "https://shop.com.gh", title: "Fresh farm produce delivery", metaDescription: "Farm produce delivery in Accra", lang: "en", status: 200 }]);
  assert.equal(geographicOverlap(gh, "farm.com.ng", "en"), 0);
  assert.equal(geographicOverlap(gh, "other.com.gh", "en"), 1);
});

const base = (over: Partial<ScoringInput>): ScoringInput => ({ domain: "rival.com", sources: ["search_provider"], evidence: [], appearances: [{ query: "managed cloud hosting", rank: 2 }], queriesIssued: 2, fetchedTexts: ["Managed cloud hosting and daily backups for small business sites", "Cloud hosting plans"], fetched: true, https: true, userProvided: false, ...over });

test("a fetched, on-topic, search-visible rival is direct with a transparent breakdown", () => {
  const p = buildSiteProfile("acme.io", pages);
  const b = scoreCandidate(p, base({}));
  assert.ok(b.confidence > 0.3);
  assert.equal(b.version, "competitors-1.0");
  const c = classifyCandidate("rival.com", b);
  assert.equal(c.classification, "direct");
});

test("an unverified AI hypothesis is capped and can never be direct", () => {
  const p = buildSiteProfile("acme.io", pages);
  const b = scoreCandidate(p, base({ sources: ["ai_hypothesis"], appearances: [], fetched: false, fetchedTexts: [] }));
  assert.ok(b.confidence <= 0.4);
  assert.ok(b.capReason);
  assert.notEqual(classifyCandidate("rival.com", b).classification, "direct");
});

test("search-only candidates whose page was not fetched are not treated as direct", () => {
  const p = buildSiteProfile("acme.io", pages);
  const b = scoreCandidate(p, base({ fetched: false, fetchedTexts: [] }));
  assert.ok(b.confidence <= 0.55);
  assert.equal(classifyCandidate("rival.com", b).classification, "search");
});

const cand = (domain: string, over: Partial<CompetitorCandidate> = {}): CompetitorCandidate => ({ ...newCandidate(domain, `https://${domain}/`, "2026-01-01T00:00:00Z"), ...over });

test("mergeCandidates deduplicates by domain, merges evidence and never overrides a person's decision", () => {
  const rejected = cand("a.com", { status: "rejected", classification: "search", evidence: [{ kind: "search_result", detail: "x", at: "t" }] });
  const confirmed = cand("b.com", { status: "approved", userConfirmed: true, name: "B Corp", classification: "direct", industry: "hosting" });
  const incomingA = cand("a.com", { status: "pending", classification: "direct", confidence: 0.9, evidence: [{ kind: "fetched_page", detail: "y", at: "t" }], sources: ["search_provider"] });
  const incomingB = cand("b.com", { status: "pending", classification: "indirect", name: "Other", confidence: 0.2, industry: "x" });
  const out = mergeCandidates([rejected, confirmed], [incomingA, incomingB, cand("c.com")]);
  assert.equal(out.length, 3);
  const a = out.find((c) => c.domain === "a.com")!;
  assert.equal(a.status, "rejected");
  assert.equal(a.evidence.length, 2);
  const b = out.find((c) => c.domain === "b.com")!;
  assert.equal(b.name, "B Corp");
  assert.equal(b.classification, "direct");
  assert.equal(b.status, "approved");
  assert.equal(b.firstDiscoveredAt, "2026-01-01T00:00:00Z");
});

test("selectForComparison honours defaults, excludes rejected/unverifiable and respects limits", () => {
  const list: CompetitorCandidate[] = [];
  for (let i = 0; i < 14; i++) list.push(cand(`d${i}.com`, { classification: "direct", confidence: 0.9 - i * 0.01 }));
  list.push(cand("rej.com", { status: "rejected", classification: "direct", confidence: 0.99 }));
  list.push(cand("unv.com", { status: "unverifiable", classification: "direct", confidence: 0.99 }));
  list.push(cand("weak.com", { classification: "direct", confidence: 0.1 }));
  list.push(cand("srch.com", { classification: "search", confidence: 0.8 }));
  list.push(cand("appr.com", { status: "approved", classification: "aspirational", confidence: 0.1 }));
  const sel = selectForComparison(list);
  assert.equal(sel.length, 10);
  assert.equal(sel[0]!.domain, "appr.com");
  assert.ok(!sel.some((c) => ["rej.com", "unv.com", "weak.com", "srch.com"].includes(c.domain)));
  assert.equal(selectForComparison(list, { maxCompare: 3 }).length, 3);
  assert.equal(limitDiscovered(list, 5).filter((c) => c.status === "approved").length, 1);
  assert.equal(limitDiscovered(list, 5).length, 5);
});

test("benchmark sample notes never call a small sample an industry average", () => {
  const r = (id: string, overall: number | null, provisional = false, coverage = 0.9) => ({ id, hostname: id, overall, provisional, coverage, pagesSampled: 10 });
  assert.equal(benchmarkSampleNote([]).level, "none");
  assert.equal(benchmarkSampleNote([r("a", 80)]).level, "insufficient");
  assert.equal(benchmarkSampleNote([r("a", 80), r("b", 70), r("c", 60, true)]).level, "provisional");
  const ok = benchmarkSampleNote([r("a", 80), r("b", 70), r("c", 60)]);
  assert.equal(ok.level, "indicative");
  assert.ok(/not the whole industry/.test(ok.note));
  assert.equal(median([1, 3, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

test("tokenize drops stopwords, numbers and accents", () => {
  assert.deepEqual(tokenize("The Best café 2024 for hosting!"), ["cafe", "hosting"]);
});
