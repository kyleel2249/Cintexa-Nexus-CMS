import { isInScope, looksLikeDocument, normalizeUrl } from "@workspace/wi-core";
import { isAllowed, type Robots } from "./robots";
import type { FetchAuth, SafeFetchResult } from "./net-types";
import { safeFetch } from "./ports";

export interface CrawlItem {
  url: string;
  depth: number;
  from?: string;
  important: boolean;
  source: "seed" | "link" | "sitemap";
}

export interface CrawlStats {
  discovered: number;
  fetched: number;
  failed: number;
  skippedRobots: number;
  skippedScope: number;
  skippedLimit: number;
  depthReached: number;
  limitHit: "pages" | "depth" | "duration" | null;
  skipped: { url: string; reason: string }[];
  cancelled: boolean;
  requests: number;
}

export interface CrawlOptions {
  startUrl: string;
  siteHost: string;
  permittedHosts: string[];
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  perHostDelayMs: number;
  timeoutMs: number;
  maxBytes: number;
  budgetMs: number;
  userAgent: string;
  robots: Robots | null;
  seeds: CrawlItem[];
  auth: FetchAuth | null;
  signal: AbortSignal;
  onPage: (item: CrawlItem, fetched: SafeFetchResult) => Promise<{ links: string[] }>;
  onProgress?: (s: CrawlStats, queued: number) => void;
}

class HostGate {
  private next = 0;
  constructor(private readonly delay: number) {}
  async wait(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.delay;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
}

export async function crawl(o: CrawlOptions): Promise<CrawlStats> {
  const stats: CrawlStats = { discovered: 0, fetched: 0, failed: 0, skippedRobots: 0, skippedScope: 0, skippedLimit: 0, depthReached: 0, limitHit: null, skipped: [], cancelled: false, requests: 0 };
  const seen = new Set<string>();
  const queue: CrawlItem[] = [];
  const gates = new Map<string, HostGate>();
  const started = Date.now();
  const skip = (url: string, reason: string) => { if (stats.skipped.length < 200) stats.skipped.push({ url, reason }); };

  const enqueue = (item: CrawlItem): void => {
    const n = normalizeUrl(item.url);
    if (!n || seen.has(n)) return;
    let host: string;
    try { host = new URL(n).hostname; } catch { return; }
    if (!isInScope(host, o.siteHost, o.permittedHosts)) { stats.skippedScope++; skip(n, "outside audit scope"); seen.add(n); return; }
    if (!looksLikeDocument(n)) { seen.add(n); return; }
    if (item.depth > o.maxDepth) { stats.skippedLimit++; stats.limitHit ??= "depth"; skip(n, "beyond maximum depth"); seen.add(n); return; }
    if (o.robots) {
      const u = new URL(n);
      if (!isAllowed(o.robots, `${u.pathname}${u.search}`, o.userAgent)) { stats.skippedRobots++; skip(n, "disallowed by robots.txt"); seen.add(n); return; }
    }
    seen.add(n);
    stats.discovered++;
    queue.push({ ...item, url: n });
  };

  // Seeds first (start page, important pages), then sitemap URLs.
  for (const s of o.seeds) enqueue(s);
  // Priority: important and shallow pages first.
  const take = (): CrawlItem | undefined => {
    if (!queue.length) return undefined;
    let best = 0;
    for (let i = 1; i < queue.length; i++) {
      const a = queue[i], b = queue[best];
      if ((a.important && !b.important) || (a.important === b.important && a.depth < b.depth)) best = i;
    }
    return queue.splice(best, 1)[0];
  };

  let active = 0;
  await new Promise<void>((resolve) => {
    const pump = (): void => {
      if (o.signal.aborted) { stats.cancelled = true; if (active === 0) resolve(); return; }
      while (active < o.concurrency && queue.length && stats.fetched + active < o.maxPages) {
        if (Date.now() - started > o.budgetMs) { stats.limitHit ??= "duration"; queue.length = 0; break; }
        const item = take() as CrawlItem;
        active++;
        void work(item).finally(() => { active--; pump(); });
      }
      if (active === 0 && (queue.length === 0 || stats.fetched >= o.maxPages || Date.now() - started > o.budgetMs)) {
        if (queue.length && stats.fetched >= o.maxPages) { stats.skippedLimit += queue.length; stats.limitHit ??= "pages"; for (const q of queue.slice(0, 50)) skip(q.url, "page limit reached"); queue.length = 0; }
        resolve();
      }
    };
    const work = async (item: CrawlItem): Promise<void> => {
      try {
        const host = new URL(item.url).hostname;
        let gate = gates.get(host);
        if (!gate) { gate = new HostGate(o.perHostDelayMs); gates.set(host, gate); }
        await gate.wait();
        if (o.signal.aborted) return;
        stats.requests++;
        const fetched = await safeFetch(item.url, {
          timeoutMs: o.timeoutMs, maxBytes: o.maxBytes, userAgent: o.userAgent, signal: o.signal, auth: o.auth,
          scope: (u) => isInScope(u.hostname, o.siteHost, o.permittedHosts),
        });
        stats.requests += fetched.redirects.length;
        stats.fetched++;
        stats.depthReached = Math.max(stats.depthReached, item.depth);
        if (!fetched.ok || (fetched.status ?? 0) >= 400) stats.failed++;
        const { links } = await o.onPage(item, fetched);
        for (const l of links) enqueue({ url: l, depth: item.depth + 1, from: item.url, important: false, source: "link" });
        o.onProgress?.(stats, queue.length);
      } catch {
        stats.failed++;
      }
    };
    pump();
  });
  return stats;
}
