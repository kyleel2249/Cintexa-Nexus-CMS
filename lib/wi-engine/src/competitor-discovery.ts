/**
 * Competitor Discovery Agent.
 *
 * Inputs: a finished audit (its pages describe what the site is about), an approved search API (optional), and the competitor
 * records already stored for the site. Output: persisted, evidence-backed candidates plus a run report that states exactly which
 * capabilities were unavailable. Nothing is invented: a candidate exists only because a search provider returned it, a person
 * added it, or an earlier benchmark audit measured it. Candidate pages are fetched through the SSRF-guarded transport, robots.txt
 * is honoured, and the fetched content is treated as untrusted data (only title / description / H1 / lang are read, as text).
 */
import {
  DEFAULT_SELECTION, buildSiteProfile, canonicalDomain, classifyCandidate, deriveQueries, exclusionFor, competitorHostname, isDroppedExclusion, limitDiscovered, mergeCandidates,
  newCandidate, scoreCandidate, selectForComparison, sameSite, type CompetitorCandidate, type CompetitorEvidence, type DiscoverySource, type SelectionOptions, type SiteProfile,
} from "@workspace/wi-core";
import { ENGINE_USER_AGENT } from "./net-types";
import { extractPage } from "./page-data";
import { getPorts, type SearchHit } from "./ports";
import { isAllowed, parseRobots } from "./robots";
import type { CompetitorRunRow } from "./repo";

export interface DiscoveryOptions extends Partial<SelectionOptions> {
  /** Cap on candidate pages fetched in one run. */
  maxFetch?: number;
  perQueryResults?: number;
  signal?: AbortSignal;
  fetchTimeoutMs?: number;
}

export interface DiscoveryReport {
  runId: string;
  hostname: string;
  status: CompetitorRunRow["status"];
  provider: string | null;
  searchAvailable: boolean;
  profile: Pick<SiteProfile, "domain" | "terms" | "phrases" | "languages" | "pagesUsed" | "sufficient" | "insufficientReason">;
  queries: string[];
  hitsReceived: number;
  candidatesFound: number;
  candidatesFetched: number;
  candidatesUnverifiable: number;
  droppedExclusions: { domain: string; reason: string }[];
  selectedForComparison: string[];
  /** Plain-language reasons a capability was not used or produced nothing. Empty only when everything ran. */
  unavailable: string[];
  alternatives: string[];
}

/** Hard cap on stored competitors per audited site, so storage cannot grow without bound. */
export const MAX_COMPETITORS_PER_SITE = 100;

const nowIso = () => new Date().toISOString();

interface Seen { appearances: { query: string; rank: number }[]; evidence: CompetitorEvidence[]; urls: Set<string> }

async function fetchCandidatePage(url: string, o: DiscoveryOptions): Promise<{ texts: (string | null)[]; lang: string | null; name: string | null; https: boolean; finalDomain: string | null; error?: string; robotsBlocked?: boolean }> {
  const { net } = getPorts();
  const origin = new URL(url).origin;
  const timeoutMs = o.fetchTimeoutMs ?? 10_000;
  // robots.txt first: a disallowed home page is not fetched.
  const rb = await net.safeFetch(`${origin}/robots.txt`, { timeoutMs, maxBytes: 256 * 1024, userAgent: ENGINE_USER_AGENT, signal: o.signal });
  if (rb.ok && (rb.status ?? 0) === 200) {
    const robots = parseRobots(rb.body.toString("utf8"));
    if (!isAllowed(robots, "/", ENGINE_USER_AGENT)) return { texts: [], lang: null, name: null, https: origin.startsWith("https:"), finalDomain: null, robotsBlocked: true, error: "robots.txt disallows fetching the home page." };
  }
  const fetched = await net.safeFetch(origin + "/", { timeoutMs, maxBytes: 1024 * 1024, userAgent: ENGINE_USER_AGENT, signal: o.signal });
  if (!fetched.ok || (fetched.status ?? 0) >= 400 || !fetched.status) {
    return { texts: [], lang: null, name: null, https: origin.startsWith("https:"), finalDomain: null, error: fetched.error?.message ?? `HTTP ${fetched.status ?? "no response"}` };
  }
  const host = new URL(fetched.finalUrl).hostname;
  const page = extractPage({ requestedUrl: origin + "/", fetched, depth: 0, important: true, isHomepage: true, siteHost: host, permittedHosts: [host] });
  const h1 = page.headings.find((h) => h.level === 1)?.text ?? null;
  const desc = page.metaDescription;
  const segs = (page.title ?? "").split(/\s[|–—·:•]\s|\s-\s/).map((s) => s.trim()).filter(Boolean);
  const name = segs.length > 1 ? (segs.sort((a, b) => a.length - b.length)[0] ?? null) : null;
  return { texts: [page.title, desc, h1], lang: page.lang, name: name && name.length <= 60 ? name : null, https: fetched.finalUrl.startsWith("https:"), finalDomain: canonicalDomain(fetched.finalUrl) };
}

export async function discoverCompetitors(args: { ownerId: string; auditId: string; options?: DiscoveryOptions }): Promise<DiscoveryReport> {
  const ports = getPorts();
  const repo = ports.repo;
  const o = args.options ?? {};
  const sel = { ...DEFAULT_SELECTION, ...o };
  const audit = await repo.getAudit(args.auditId);
  if (!audit) throw new Error("Audit not found.");
  if (audit.ownerId !== args.ownerId) throw new Error("Audit not found.");
  const hostname = audit.hostname.toLowerCase();
  const ownDomain = canonicalDomain(hostname) ?? hostname;
  const rows = await repo.loadPages(audit.id);
  const profile = buildSiteProfile(hostname, rows.map((r) => ({ url: r.facts.url, title: r.facts.title, metaDescription: r.facts.metaDescription, lang: r.facts.lang, important: r.facts.important, depth: r.facts.depth, status: r.facts.status })));
  const queries = deriveQueries(profile);
  const search = ports.search;
  const searchAvailable = Boolean(search?.configured);
  const run = await repo.createCompetitorRun({ ownerId: args.ownerId, hostname, auditId: audit.id, provider: searchAvailable ? search!.provider : null, queries });
  const unavailable: string[] = [];
  const alternatives: string[] = [];
  const seen = new Map<string, Seen>();
  const dropped: { domain: string; reason: string }[] = [];
  let hits = 0;
  let status: CompetitorRunRow["status"] = "completed";

  try {
    // 1. Search provider discovery
    if (!profile.sufficient) {
      unavailable.push(profile.insufficientReason ?? "Not enough descriptive text to infer the site's niche.");
      alternatives.push("Add competitors manually, or run an audit that reaches more pages with titles and descriptions.");
    } else if (!searchAvailable) {
      unavailable.push("No search provider is configured (set BRAVE_SEARCH_API_KEY, or GOOGLE_CSE_API_KEY with GOOGLE_CSE_ID). Search-based discovery did not run, and results are never scraped from search pages.");
      alternatives.push("Configure an approved search API, or add competitors manually.");
    } else {
      let failedQueries = 0;
      for (const q of queries) {
        if (o.signal?.aborted) break;
        const r = await search!.search(q, o.signal ?? new AbortController().signal);
        if (!r.ok) { failedQueries++; unavailable.push(`Search query "${q}" failed: ${r.error ?? "unknown error"}.`); continue; }
        for (const h of r.hits.slice(0, o.perQueryResults ?? 10)) {
          hits++;
          consider(h, q);
        }
      }
      if (failedQueries > 0) status = failedQueries === queries.length ? "failed" : "partial";
    }

    function consider(h: SearchHit, query: string): void {
      const d = canonicalDomain(h.url);
      if (!d || d === ownDomain || sameSite(d, ownDomain)) return;
      const ex = exclusionFor(h.url);
      if (ex && isDroppedExclusion(ex)) { if (!dropped.some((x) => x.domain === d)) dropped.push({ domain: d, reason: ex.reason }); return; }
      const cur = seen.get(d) ?? { appearances: [], evidence: [], urls: new Set<string>() };
      cur.appearances.push({ query, rank: h.rank });
      cur.evidence.push({ kind: "search_result", detail: `Ranked #${h.rank} for "${query}": ${h.title.slice(0, 140)}`, url: h.url, query, rank: h.rank, provider: search?.provider, at: nowIso() });
      cur.urls.add(h.url);
      seen.set(d, cur);
    }

    // 2. Earlier benchmark audits of this site are verified evidence of interest.
    const prior = await repo.listAudits({ ownerId: args.ownerId, kind: "benchmark", limit: 100 });
    for (const b of prior.items.filter((x) => x.parentAuditId === audit.id || x.parentAuditId === audit.previousAuditId)) {
      const d = canonicalDomain(b.hostname);
      if (!d || d === ownDomain) continue;
      const cur = seen.get(d) ?? { appearances: [], evidence: [], urls: new Set<string>() };
      cur.evidence.push({ kind: "existing_audit", detail: `A benchmark audit of ${b.hostname} exists (${b.status}).`, url: b.url, at: nowIso() });
      cur.urls.add(b.url);
      seen.set(d, cur);
    }

    // 3. Existing records are re-verified, never dropped.
    const existing = await repo.listCompetitors(args.ownerId, hostname);
    const existingByDomain = new Map(existing.map((c) => [c.domain, c]));
    for (const c of existing) {
      if (c.status === "rejected") continue;
      if (!seen.has(c.domain)) seen.set(c.domain, { appearances: [], evidence: [], urls: new Set([c.url]) });
    }

    // 4. Fetch and score the best-supported candidates.
    const order = [...seen.entries()].sort((a, b) => b[1].appearances.length - a[1].appearances.length || a[0].localeCompare(b[0]));
    const maxFetch = o.maxFetch ?? Math.max(sel.maxDiscover, 20);
    const incoming: CompetitorCandidate[] = [];
    let fetchedCount = 0;
    let unverifiable = 0;
    for (const [domain, info] of order.slice(0, maxFetch)) {
      if (o.signal?.aborted) { status = "partial"; break; }
      const prev = existingByDomain.get(domain);
      const url = prev?.url ?? [...info.urls][0] ?? `https://${domain}/`;
      let origin = `https://${domain}/`;
      try { origin = new URL(url).origin + "/"; } catch { /* keep default */ }
      const page = await fetchCandidatePage(origin, o).catch((e: Error) => ({ texts: [] as (string | null)[], lang: null, name: null, https: true, finalDomain: null, error: e.message, robotsBlocked: false }));
      const fetched = page.texts.some(Boolean);
      if (fetched) fetchedCount++;
      const sources: DiscoverySource[] = [];
      if (info.appearances.length) sources.push("search_provider");
      if (info.evidence.some((e) => e.kind === "existing_audit")) sources.push("existing_benchmark");
      if (prev?.sources.includes("user")) sources.push("user");
      const evidence = [...info.evidence];
      if (fetched) evidence.push({ kind: "fetched_page", detail: `Fetched home page: ${(page.texts[0] ?? "").slice(0, 140)}`, url: origin, at: nowIso() });
      else evidence.push({ kind: "fetched_page", detail: `Home page not fetched: ${page.error ?? "no text"}`, url: origin, at: nowIso() });
      const canonicalFinal = page.finalDomain && page.finalDomain !== domain ? page.finalDomain : null;
      if (canonicalFinal) evidence.push({ kind: "fetched_page", detail: `Redirects to ${canonicalFinal}.`, url: origin, at: nowIso() });
      const breakdown = scoreCandidate(profile, {
        domain, sources, evidence, appearances: info.appearances, queriesIssued: searchAvailable ? queries.length : 0, fetchedTexts: page.texts, fetched, fetchedLang: page.lang,
        https: page.https, userProvided: Boolean(prev?.sources.includes("user")),
      });
      const cls = classifyCandidate(url, breakdown, { userClass: prev?.userConfirmed ? prev.classification : null });
      if (cls.dropped && !prev) continue;
      const c = newCandidate(domain, origin, nowIso());
      c.name = page.name;
      c.sources = sources;
      c.evidence = evidence;
      c.breakdown = breakdown;
      c.confidence = breakdown.confidence;
      c.classification = cls.classification;
      c.classificationReason = cls.reason;
      c.lastVerifiedAt = fetched ? nowIso() : null;
      c.status = !fetched && page.error && !info.appearances.length ? "unverifiable" : "pending";
      if (c.status === "unverifiable") unverifiable++;
      c.market = profile.tld.length === 2 ? profile.tld.toUpperCase() : null;
      incoming.push(c);
    }

    const merged = limitDiscovered(mergeCandidates(existing, incoming), sel.maxDiscover);
    await repo.upsertCompetitors(args.ownerId, hostname, merged);
    const selected = selectForComparison(merged, sel);
    if (merged.length === 0 && unavailable.length === 0) {
      unavailable.push("The search provider returned no usable competitor candidates for the queries derived from this site.");
      alternatives.push("Add competitors manually, or broaden the site's descriptive content so better queries can be derived.");
    }
    if (merged.length === 0) status = status === "failed" ? "failed" : "partial";

    const report: DiscoveryReport = {
      runId: run.id, hostname, status, provider: searchAvailable ? search!.provider : null, searchAvailable,
      profile: { domain: profile.domain, terms: profile.terms.slice(0, 12), phrases: profile.phrases, languages: profile.languages, pagesUsed: profile.pagesUsed, sufficient: profile.sufficient, insufficientReason: profile.insufficientReason },
      queries, hitsReceived: hits, candidatesFound: merged.length, candidatesFetched: fetchedCount, candidatesUnverifiable: unverifiable, droppedExclusions: dropped,
      selectedForComparison: selected.map((c) => c.domain), unavailable, alternatives,
    };
    await repo.finishCompetitorRun(run.id, { status, summary: report });
    return report;
  } catch (e) {
    const msg = (e as Error).message;
    await repo.finishCompetitorRun(run.id, { status: "failed", summary: { unavailable: [msg] }, error: msg });
    throw e;
  }
}

/** Adds a competitor a person supplied. The record is user-confirmed from the start, so later automatic runs cannot overwrite it. */
export async function addManualCompetitor(args: { ownerId: string; hostname: string; url: string; name?: string | null; industry?: string | null }): Promise<{ ok: true; candidate: CompetitorCandidate } | { ok: false; error: string }> {
  const repo = getPorts().repo;
  const host = competitorHostname(args.url);
  const domain = host ? canonicalDomain(host) : null;
  if (!host || !domain) return { ok: false, error: "Enter a valid public website address, for example competitor.com." };
  const own = canonicalDomain(args.hostname);
  if (own && own === domain) return { ok: false, error: "That is the audited site itself." };
  const ex = exclusionFor(host);
  if (ex && isDroppedExclusion(ex)) return { ok: false, error: `That address is ${ex.reason}, not a company website.` };
  const all = await repo.listCompetitors(args.ownerId, args.hostname);
  const existing = all.find((c) => c.domain === domain);
  if (!existing && all.length >= MAX_COMPETITORS_PER_SITE) return { ok: false, error: `This site already has ${MAX_COMPETITORS_PER_SITE} competitors. Remove some before adding more.` };
  const now = nowIso();
  const c = existing ?? newCandidate(domain, `https://${domain}/`, now);
  c.name = args.name?.trim() || c.name;
  c.industry = args.industry?.trim() || c.industry;
  c.status = "approved";
  c.userConfirmed = true;
  if (!c.sources.includes("user")) c.sources.push("user");
  c.evidence.push({ kind: "user_input", detail: "Added by a person.", at: now });
  c.classification = ex ? "search" : c.classification === "search" && !existing ? "direct" : c.classification;
  c.classificationReason = existing ? c.classificationReason : "Added by a person; classification is theirs until measured evidence is collected.";
  await repo.upsertCompetitors(args.ownerId, args.hostname, [c]);
  return { ok: true, candidate: c };
}

const inflight = new Set<string>();
export const isDiscoveryRunning = (ownerId: string, hostname: string): boolean => inflight.has(`${ownerId}\u0000${hostname.toLowerCase()}`);

/** Runs discovery in the background without holding any request open. Returns false when a run for the same site is already in progress. */
export function startDiscoveryInBackground(args: { ownerId: string; auditId: string; hostname: string; options?: DiscoveryOptions; onError?: (e: Error) => void }): boolean {
  const key = `${args.ownerId}\u0000${args.hostname.toLowerCase()}`;
  if (inflight.has(key)) return false;
  inflight.add(key);
  void discoverCompetitors({ ownerId: args.ownerId, auditId: args.auditId, options: args.options })
    .catch((e: Error) => args.onError?.(e))
    .finally(() => inflight.delete(key));
  return true;
}

/** Called when an audit finishes. Starts discovery only for a primary audit with enough evidence and a configured search provider. */
export async function maybeAutoDiscover(auditId: string, onError?: (e: Error) => void): Promise<boolean> {
  const ports = getPorts();
  if (!ports.search?.configured) return false;
  const [audit, settings] = await Promise.all([ports.repo.getAudit(auditId), ports.settings.load()]);
  if (!audit || audit.kind !== "audit" || !settings.autoDiscoverCompetitors) return false;
  if (audit.status !== "completed" && audit.status !== "partial") return false;
  return startDiscoveryInBackground({ ownerId: audit.ownerId, auditId, hostname: audit.hostname, onError });
}
