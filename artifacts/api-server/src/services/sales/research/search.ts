/** Search-provider abstraction. Providers are configured only through server environment variables; nothing is simulated when none is set. */
import { safeFetch } from "@workspace/intelligence/ssrf";

export interface SearchHit { url: string; title: string; snippet: string }
export interface SearchProvider { id: string; label: string; search(query: string, limit: number): Promise<SearchHit[]> }

const get = (env: NodeJS.ProcessEnv, k: string) => (env[k] && env[k]!.trim() ? env[k]!.trim() : null);
async function json(url: string, init: RequestInit, timeoutMs = 10_000): Promise<any> {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try { const r = await fetch(url, { ...init, signal: ac.signal }); if (!r.ok) throw new Error(`search provider returned HTTP ${r.status}`); return await r.json(); } finally { clearTimeout(t); }
}

export function configuredProviders(env: NodeJS.ProcessEnv = process.env): SearchProvider[] {
  const out: SearchProvider[] = [];
  const brave = get(env, "BRAVE_SEARCH_API_KEY");
  if (brave) out.push({ id: "brave", label: "Brave Search API", async search(q, n) {
    const j = await json(`https://api.search.brave.com/res/v1/web/search?count=${n}&q=${encodeURIComponent(q)}`, { headers: { accept: "application/json", "x-subscription-token": brave } });
    return (j.web?.results ?? []).map((r: any) => ({ url: String(r.url), title: String(r.title ?? ""), snippet: String(r.description ?? "") }));
  } });
  const serper = get(env, "SERPER_API_KEY");
  if (serper) out.push({ id: "serper", label: "Serper (Google results)", async search(q, n) {
    const j = await json("https://google.serper.dev/search", { method: "POST", headers: { "content-type": "application/json", "x-api-key": serper }, body: JSON.stringify({ q, num: n }) });
    return (j.organic ?? []).map((r: any) => ({ url: String(r.link), title: String(r.title ?? ""), snippet: String(r.snippet ?? "") }));
  } });
  const tavily = get(env, "TAVILY_API_KEY");
  if (tavily) out.push({ id: "tavily", label: "Tavily Search", async search(q, n) {
    const j = await json("https://api.tavily.com/search", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tavily}` }, body: JSON.stringify({ query: q, max_results: n }) });
    return (j.results ?? []).map((r: any) => ({ url: String(r.url), title: String(r.title ?? ""), snippet: String(r.content ?? "").slice(0, 300) }));
  } });
  return out;
}

const NOT_OFFICIAL = /(^|\.)(facebook|linkedin|instagram|twitter|x|youtube|tiktok|wikipedia|crunchbase|yelp|glassdoor|indeed|bloomberg|reuters|pinterest|reddit|zoominfo|dnb|bbb|trustpilot|yellowpages|alibaba|amazon|ebay)\.[a-z.]+$/i;
/** Try each configured provider in order (graceful fallback). Returns the first plausible official-site hit. */
export async function discoverWebsite(company: string, hint: { country?: string }, providers: SearchProvider[]): Promise<{ hit: SearchHit | null; providerId: string | null; errors: string[]; considered: SearchHit[] }> {
  const errors: string[] = [];
  for (const p of providers) {
    try {
      const hits = await p.search(`${company} official website${hint.country ? " " + hint.country : ""}`, 8);
      const usable = hits.filter((h) => { try { return !NOT_OFFICIAL.test(new URL(h.url).hostname); } catch { return false; } });
      const tokens = company.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
      const scored = usable.map((h) => { const host = new URL(h.url).hostname.toLowerCase(); return { h, s: tokens.filter((t) => host.includes(t)).length * 2 + tokens.filter((t) => h.title.toLowerCase().includes(t)).length }; }).sort((a, b) => b.s - a.s);
      if (scored[0] && scored[0].s > 0) return { hit: scored[0].h, providerId: p.id, errors, considered: hits };
    } catch (e) { errors.push(`${p.id}: ${e instanceof Error ? e.message : "failed"}`); }
  }
  return { hit: null, providerId: null, errors, considered: [] };
}
void safeFetch;
