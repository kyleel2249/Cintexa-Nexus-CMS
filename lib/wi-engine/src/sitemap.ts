import { normalizeUrl } from "@workspace/wi-core";
import { header, type SafeFetchOptions, type SafeFetchResult } from "./net-types";
import { gunzip, safeFetch } from "./ports";

export interface SitemapResult {
  found: boolean;
  sources: string[];
  urls: string[];
  validity: { valid: boolean; problems: string[] };
  indexFiles: number;
  contentType: string | null;
  checked: number;
}

const LIMIT_URLS = 50_000;
const utf8 = new TextDecoder("utf-8");
/** Wraps decompressed bytes so they offer the same toString() as a response body. */
function toBody(u: Uint8Array): SafeFetchResult["body"] { return Object.assign(u, { toString: () => utf8.decode(u) }) as SafeFetchResult["body"]; }

function locs(xml: string, tag: "url" | "sitemap"): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && out.length < LIMIT_URLS + 1) {
    const l = /<loc\b[^>]*>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/i.exec(m[1]);
    if (l) out.push(l[1].replace(/&amp;/g, "&").trim());
  }
  return out;
}

async function readXml(url: string, opts: SafeFetchOptions): Promise<{ xml: string | null; status: number | null; contentType: string | null; error?: string }> {
  const r = await safeFetch(url, { ...opts, maxBytes: 10 * 1024 * 1024, timeoutMs: 20_000 });
  if (!r.ok || r.status === null) return { xml: null, status: null, contentType: null, error: r.error?.message };
  if (r.status !== 200) return { xml: null, status: r.status, contentType: header(r, "content-type") };
  let body = r.body;
  if (body.length > 2 && body[0] === 0x1f && body[1] === 0x8b) {
    try { body = toBody(await gunzip(body, 50 * 1024 * 1024)); } catch { return { xml: null, status: r.status, contentType: header(r, "content-type"), error: "Could not decompress sitemap" }; }
  }
  const text = body.toString("utf8");
  return { xml: text, status: r.status, contentType: header(r, "content-type") };
}

export async function discoverSitemap(origin: string, declared: string[], host: string, opts: SafeFetchOptions, maxChildren = 10): Promise<SitemapResult> {
  const candidates = [...new Set([...declared, `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/sitemap-index.xml`, `${origin}/sitemap.xml.gz`])];
  const res: SitemapResult = { found: false, sources: [], urls: [], validity: { valid: true, problems: [] }, indexFiles: 0, contentType: null, checked: 0 };
  const seen = new Set<string>();
  const crossHost = new Set<string>();
  let relative = 0;
  const visit = async (u: string, depth: number): Promise<void> => {
    if (seen.has(u) || seen.size > maxChildren + 4) return;
    seen.add(u);
    res.checked++;
    const r = await readXml(u, opts);
    if (!r.xml) return;
    const isIndex = /<sitemapindex\b/i.test(r.xml);
    const isSet = /<urlset\b/i.test(r.xml);
    if (!isIndex && !isSet) { res.validity.problems.push(`${u} is not a urlset or sitemapindex document`); return; }
    res.found = true;
    res.sources.push(u);
    res.contentType ??= r.contentType;
    if (isIndex && depth < 2) {
      res.indexFiles++;
      for (const child of locs(r.xml, "sitemap").slice(0, maxChildren)) await visit(child, depth + 1);
      return;
    }
    const list = locs(r.xml, "url");
    if (list.length > LIMIT_URLS) res.validity.problems.push(`${u} lists more than ${LIMIT_URLS} URLs`);
    for (const l of list.slice(0, LIMIT_URLS)) {
      if (!/^https?:\/\//i.test(l)) { relative++; continue; }
      const n = normalizeUrl(l);
      if (!n) continue;
      try { const h = new URL(n).hostname.replace(/^www\./, ""); if (h !== host.replace(/^www\./, "")) crossHost.add(h); } catch { /* skip */ }
      res.urls.push(n);
    }
  };
  for (const c of candidates) { await visit(c, 0); if (res.found && c === candidates[0] && declared.length) { /* continue to merge declared */ } if (res.found && !declared.includes(c) && res.urls.length) break; }
  res.urls = [...new Set(res.urls)];
  if (relative) res.validity.problems.push(`${relative} relative URL(s) (sitemaps require absolute URLs)`);
  if (crossHost.size) res.validity.problems.push(`URLs on other hosts: ${[...crossHost].slice(0, 3).join(", ")}`);
  res.validity.valid = res.validity.problems.length === 0;
  return res;
}
