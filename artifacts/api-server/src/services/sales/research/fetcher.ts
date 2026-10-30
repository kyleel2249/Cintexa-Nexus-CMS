/**
 * Public-web retrieval. Every request goes through the SSRF guard (scheme, port, hostname, DNS result and every redirect hop are
 * validated; private, loopback, link-local and metadata addresses are refused). robots.txt is honoured. Limits: size, time, content type.
 */
import { safeFetch, SsrfError, type Resolver } from "@workspace/intelligence/ssrf";

export const BOT_NAME = "CintexaResearchBot";
const UA = `${BOT_NAME}/1.0 (+https://cintexa.com; business research on behalf of a signed-in user)`;
export { SsrfError };

export interface Fetched { finalUrl: string; status: number; contentType: string; body: string; fetchedAt: string }

const realFetch = (url: string, init: { redirect: "manual"; signal: AbortSignal; pinnedIps: string[] }) =>
  fetch(url, { redirect: init.redirect, signal: init.signal, headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain,application/xml;q=0.8", "accept-language": "en" } });

export type FetchFn = typeof realFetch;

export async function fetchText(url: string, opts: { fetchFn?: FetchFn; maxBytes?: number; timeoutMs?: number; allow?: RegExp; resolve?: Resolver } = {}): Promise<Fetched> {
  const r = await safeFetch(url, opts.fetchFn ?? realFetch, { maxBytes: opts.maxBytes ?? 1_500_000, timeoutMs: opts.timeoutMs ?? 12_000, ...(opts.resolve ? { resolve: opts.resolve } : {}) });
  const contentType = (r.headers.get("content-type") ?? "").toLowerCase();
  if (r.status >= 200 && r.status < 300 && !(opts.allow ?? /text\/|xml|json/).test(contentType)) throw new SsrfError("bad_content_type", `content type ${contentType || "unknown"} is not readable text`);
  return { finalUrl: r.finalUrl, status: r.status, contentType, body: new TextDecoder("utf-8", { fatal: false }).decode(r.body), fetchedAt: new Date().toISOString() };
}

export interface Robots { found: boolean; sitemaps: string[]; allows: (path: string) => boolean; raw: string | null }

export function parseRobots(raw: string | null): Robots {
  if (!raw) return { found: false, sitemaps: [], allows: () => true, raw: null };
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  const sitemaps: string[] = [];
  let cur: (typeof groups)[number] | null = null, lastWasAgent = false;
  for (const line of raw.split(/\r?\n/)) {
    const m = line.replace(/#.*/, "").match(/^\s*([a-z-]+)\s*:\s*(.*?)\s*$/i);
    if (!m) continue;
    const k = m[1]!.toLowerCase(), val = m[2]!;
    if (k === "sitemap") { sitemaps.push(val); continue; }
    if (k === "user-agent") { if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(val.toLowerCase()); lastWasAgent = true; continue; }
    lastWasAgent = false;
    if (cur && (k === "allow" || k === "disallow")) cur.rules.push({ allow: k === "allow", path: val });
  }
  const mine = groups.find((g) => g.agents.some((a) => BOT_NAME.toLowerCase().includes(a) && a !== "*")) ?? groups.find((g) => g.agents.includes("*"));
  return {
    found: true, sitemaps, raw,
    allows(path: string) {
      if (!mine) return true;
      let best: { allow: boolean; len: number } | null = null;
      for (const r of mine.rules) {
        if (r.path === "") continue;
        const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
        if (re.test(path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { allow: r.allow, len: r.path.length };
      }
      return best ? best.allow : true;
    },
  };
}
