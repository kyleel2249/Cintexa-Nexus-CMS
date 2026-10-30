/** Dependency-free, defensive HTML reader. It only extracts facts; page text is never executed or treated as instructions. */
export interface ParsedPage {
  url: string;
  title: string | null;
  description: string | null;
  canonical: string | null;
  robotsMeta: string | null;
  lang: string | null;
  ogSiteName: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  h1: string[];
  h2: string[];
  h3: string[];
  links: { href: string; text: string }[];
  jsonLd: any[];
  emails: string[];
  phones: string[];
  imagesTotal: number;
  imagesWithoutAlt: number;
  wordCount: number;
  text: string;
  hasViewport: boolean;
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)));
const strip = (s: string) => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : null;
};
const metaContent = (html: string, key: string, by: "name" | "property" = "name") => {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    if ((attr(m[0], by) ?? "").toLowerCase() === key) return attr(m[0], "content")?.trim() || null;
  }
  return null;
};
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const BAD_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js)$|^(example|sentry|user|name|email)@|@(example|sentry|domain|email)\./i;

export function parsePage(html: string, url: string): ParsedPage {
  const h = html.slice(0, 1_500_000);
  const noScript = h.replace(/<script\b(?![^>]*ld\+json)[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const title = strip(noScript.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || null;
  const canonicalTag = [...noScript.matchAll(/<link\b[^>]*>/gi)].find((m) => (attr(m[0], "rel") ?? "").toLowerCase().split(/\s+/).includes("canonical"));
  const heads = (tag: string) => [...noScript.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map((m) => strip(m[1]!)).filter(Boolean).slice(0, 40);
  const links: ParsedPage["links"] = [];
  for (const m of noScript.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[0], "href");
    if (!href || href.startsWith("#") || /^javascript:/i.test(href)) continue;
    try { links.push({ href: /^(mailto|tel):/i.test(href) ? href : new URL(href, url).toString(), text: strip(m[1]!).slice(0, 120) }); } catch { /* ignore malformed */ }
    if (links.length >= 400) break;
  }
  const jsonLd: any[] = [];
  for (const m of h.matchAll(/<script\b[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const j = JSON.parse(m[1]!.trim()); Array.isArray(j) ? jsonLd.push(...j) : jsonLd.push(j); } catch { /* invalid JSON-LD is itself an SEO finding */ }
    if (jsonLd.length >= 30) break;
  }
  const text = strip(noScript.replace(/<(nav|footer|header)\b[\s\S]*?<\/\1>/gi, " ")).slice(0, 60_000);
  const emails = new Set<string>();
  for (const l of links) if (/^mailto:/i.test(l.href)) { const e = decodeURIComponent(l.href.slice(7).split("?")[0]!).trim().toLowerCase(); if (!BAD_EMAIL.test(e)) emails.add(e); }
  for (const m of text.matchAll(EMAIL)) { const e = m[0].toLowerCase(); if (!BAD_EMAIL.test(e)) emails.add(e); }
  const phones = new Set<string>();
  for (const l of links) if (/^tel:/i.test(l.href)) { const p = decodeURIComponent(l.href.slice(4)).replace(/[^\d+]/g, ""); if (p.replace(/\D/g, "").length >= 7) phones.add(p); }
  const imgs = [...noScript.matchAll(/<img\b[^>]*>/gi)];
  return {
    url, title, description: metaContent(noScript, "description"), canonical: canonicalTag ? attr(canonicalTag[0], "href") : null,
    robotsMeta: metaContent(noScript, "robots"), lang: attr(noScript.match(/<html\b[^>]*>/i)?.[0] ?? "", "lang"),
    ogSiteName: metaContent(noScript, "og:site_name", "property"), ogTitle: metaContent(noScript, "og:title", "property"), ogDescription: metaContent(noScript, "og:description", "property"),
    h1: heads("h1"), h2: heads("h2"), h3: heads("h3"), links, jsonLd, emails: [...emails].slice(0, 10), phones: [...phones].slice(0, 10),
    imagesTotal: imgs.length, imagesWithoutAlt: imgs.filter((m) => { const a = attr(m[0], "alt"); return a === null || a.trim() === ""; }).length,
    wordCount: text ? text.split(/\s+/).length : 0, text, hasViewport: metaContent(noScript, "viewport") !== null,
  };
}

/** Flatten JSON-LD (including @graph) into a list of typed nodes. */
export function jsonLdNodes(pages: ParsedPage[]): any[] {
  const out: any[] = [];
  const walk = (n: any, depth = 0) => {
    if (!n || typeof n !== "object" || depth > 4) return;
    if (Array.isArray(n)) return n.forEach((x) => walk(x, depth + 1));
    if (n["@type"]) out.push(n);
    if (n["@graph"]) walk(n["@graph"], depth + 1);
  };
  for (const p of pages) walk(p.jsonLd);
  return out;
}
export const typeOf = (n: any): string[] => (Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]]).map(String);
