/**
 * Approved search APIs for competitor discovery. Only documented, keyed APIs are used; search result pages are never scraped.
 * Provider order: Brave Search API, then Google Programmable Search (Custom Search JSON API). Neither configured = unavailable.
 */
import type { SearchHit, SearchOutcome, SearchPort } from "@workspace/wi-engine";
import { safeFetch } from "./safe-fetch";

const clean = (s: unknown, max: number): string => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function parseBrave(text: string): SearchHit[] {
  const j = JSON.parse(text) as { web?: { results?: { url?: string; title?: string; description?: string }[] } };
  return (j.web?.results ?? []).filter((r) => typeof r.url === "string").map((r, i) => ({ url: r.url as string, title: clean(r.title, 200), snippet: clean(r.description, 400), rank: i + 1 }));
}

export function parseGoogleCse(text: string): SearchHit[] {
  const j = JSON.parse(text) as { items?: { link?: string; title?: string; snippet?: string }[] };
  return (j.items ?? []).filter((r) => typeof r.link === "string").map((r, i) => ({ url: r.link as string, title: clean(r.title, 200), snippet: clean(r.snippet, 400), rank: i + 1 }));
}

async function call(url: string, headers: Record<string, string>, parse: (t: string) => SearchHit[], signal: AbortSignal): Promise<SearchOutcome> {
  const r = await safeFetch(url, { timeoutMs: 15_000, maxBytes: 1024 * 1024, signal, headers: { accept: "application/json", ...headers }, followRedirects: false });
  if (!r.ok || r.status !== 200) return { ok: false, hits: [], error: r.error?.message ?? `HTTP ${r.status ?? "no response"}` };
  try { return { ok: true, hits: parse(r.body.toString("utf8")) }; } catch { return { ok: false, hits: [], error: "The provider returned a response that could not be read." }; }
}

export function searchProviderName(env: NodeJS.ProcessEnv = process.env): "brave" | "google_cse" | null {
  if (env.BRAVE_SEARCH_API_KEY) return "brave";
  if (env.GOOGLE_CSE_API_KEY && env.GOOGLE_CSE_ID) return "google_cse";
  return null;
}

export const searchPort: SearchPort = {
  get configured() { return searchProviderName() !== null; },
  get provider() { return searchProviderName() ?? "none"; },
  async search(query, signal) {
    const p = searchProviderName();
    if (p === "brave") return call(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&safesearch=moderate`, { "x-subscription-token": process.env.BRAVE_SEARCH_API_KEY as string }, parseBrave, signal);
    if (p === "google_cse") return call(`https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(process.env.GOOGLE_CSE_API_KEY as string)}&cx=${encodeURIComponent(process.env.GOOGLE_CSE_ID as string)}&q=${encodeURIComponent(query)}&num=10`, {}, parseGoogleCse, signal);
    return { ok: false, hits: [], error: "No search provider is configured." };
  },
};
