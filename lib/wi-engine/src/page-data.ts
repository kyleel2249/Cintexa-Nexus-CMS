import { isInScope, normalizeUrl, type PageFacts } from "@workspace/wi-core";
import { byTag, countWords, fleschReadingEase, findAll, parseHtml, rawTextOf, textOf, walk, type HNode, type ParsedDoc } from "./html";
import { header, type RedirectHop, type SafeFetchResult } from "./net-types";
import { utf8Length } from "./ports";

export interface ImageInfo { src: string; alt: string | null; width: string | null; height: string | null; loading: string | null; srcset: string | null; inPicture: boolean; decorative: boolean; tiny: boolean }
export interface LinkInfo { href: string; text: string; rel: string; internal: boolean; ariaLabel: string | null; fragmentOnly: boolean; scheme: string }
export interface ScriptInfo { src: string | null; absolute: string | null; async: boolean; defer: boolean; module: boolean; type: string | null; inlineBytes: number; integrity: boolean; crossorigin: boolean; inHead: boolean; host: string | null }
export interface FormInfo { action: string | null; method: string; fields: { tag: string; type: string; id: string | null; name: string | null; labelled: boolean; hidden: boolean; autocomplete: string | null; onpaste: boolean }[]; hasSubmit: boolean; hasPassword: boolean; node: HNode }
export interface JsonLdBlock { raw: string; parsed: unknown | null; error: string | null }

export interface PageData {
  url: string;
  finalUrl: string;
  depth: number;
  important: boolean;
  isHomepage: boolean;
  discoveredFrom?: string;
  status: number | null;
  headers: SafeFetchResult["headers"];
  redirects: RedirectHop[];
  htmlBytes: number;
  transferBytes: number;
  ttfbMs: number | null;
  totalMs: number | null;
  contentEncoding: string | null;
  /** False when the transport could not observe the transfer encoding (so compression cannot be judged). */
  transferObservable: boolean;
  cacheControl: string | null;
  contentType: string | null;
  truncated: boolean;
  html: string;
  doc: ParsedDoc;
  head: HNode | null;
  body: HNode | null;
  title: string | null;
  metaDescription: string | null;
  meta: Record<string, string>;
  canonicals: string[];
  robotsMeta: string | null;
  xRobotsTag: string | null;
  lang: string | null;
  headings: { level: number; text: string }[];
  text: string;
  wordCount: number;
  readingEase: number | null;
  images: ImageInfo[];
  links: LinkInfo[];
  scripts: ScriptInfo[];
  stylesheets: { href: string; media: string | null; inHead: boolean; absolute: string | null }[];
  inlineCss: string;
  jsonld: JsonLdBlock[];
  schemaTypes: string[];
  forms: FormInfo[];
  hreflang: { lang: string; href: string }[];
  iframes: { src: string | null; title: string | null }[];
  ids: string[];
  thirdPartyHosts: string[];
  fonts: { href: string; preconnect: boolean; swap: boolean }[];
  preconnects: string[];
  favicon: string | null;
  siteHost: string;
}

export interface ExtractInput {
  requestedUrl: string;
  fetched: SafeFetchResult;
  depth: number;
  important: boolean;
  isHomepage: boolean;
  siteHost: string;
  permittedHosts: string[];
  discoveredFrom?: string;
}

function abs(href: string | null | undefined, base: string): string | null {
  if (!href) return null;
  try { return new URL(href.trim(), base).toString(); } catch { return null; }
}

const GENERIC_ANCHOR = /^(click here|here|read more|learn more|more|link|this|details|continue|go|view|see more|click)$/i;
export const isGenericAnchor = (t: string) => GENERIC_ANCHOR.test(t.trim());

export function extractSchemaTypes(parsed: unknown, out: Set<string>): void {
  const visit = (v: unknown, depth: number) => {
    if (depth > 8 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return; }
    const o = v as Record<string, unknown>;
    const t = o["@type"];
    if (typeof t === "string") out.add(t);
    else if (Array.isArray(t)) for (const x of t) if (typeof x === "string") out.add(x);
    for (const k of Object.keys(o)) if (k !== "@context") visit(o[k], depth + 1);
  };
  visit(parsed, 0);
}

export function extractPage(i: ExtractInput): PageData {
  const f = i.fetched;
  const finalUrl = f.finalUrl;
  const html = f.body.toString("utf8");
  const doc = parseHtml(html);
  const root = doc.root;
  const htmlEl = byTag(root, "html")[0] ?? null;
  const head = byTag(root, "head")[0] ?? null;
  const body = byTag(root, "body")[0] ?? null;
  const titleNode = byTag(root, "title")[0];
  const title = titleNode ? rawTextOf(titleNode).replace(/\s+/g, " ").trim() : null;

  const meta: Record<string, string> = {};
  for (const m of byTag(root, "meta")) {
    const key = (m.attrs.name ?? m.attrs.property ?? m.attrs["http-equiv"] ?? "").toLowerCase();
    if (key && m.attrs.content !== undefined && !(key in meta)) meta[key] = m.attrs.content.trim();
  }
  const links = byTag(root, "link");
  const relOf = (n: HNode) => (n.attrs.rel ?? "").toLowerCase().split(/\s+/);
  const canonicals = links.filter((l) => relOf(l).includes("canonical")).map((l) => abs(l.attrs.href, finalUrl)).filter((x): x is string => Boolean(x));
  const linkHeader = header(f, "link");
  if (linkHeader) {
    const m = /<([^>]+)>\s*;\s*rel="?canonical"?/i.exec(linkHeader);
    if (m) { const a = abs(m[1], finalUrl); if (a) canonicals.push(a); }
  }

  const headings: PageData["headings"] = [];
  walk(root, (n) => {
    if (n.tag === "script" || n.tag === "style") return false;
    if (/^h[1-6]$/.test(n.tag)) headings.push({ level: Number(n.tag[1]), text: textOf(n) });
    return undefined;
  });

  const main = byTag(root, "main")[0] ?? byTag(root, "article")[0] ?? body ?? root;
  const text = textOf(main);
  const wordCount = countWords(text);

  const images: ImageInfo[] = byTag(root, "img").map((n) => {
    const w = n.attrs.width ?? null;
    const h = n.attrs.height ?? null;
    const tiny = (w !== null && Number(w) <= 2) || (h !== null && Number(h) <= 2);
    return {
      src: abs(n.attrs.src ?? n.attrs["data-src"], finalUrl) ?? "",
      alt: n.attrs.alt === undefined ? null : n.attrs.alt,
      width: w,
      height: h,
      loading: n.attrs.loading ?? null,
      srcset: n.attrs.srcset ?? n.attrs["data-srcset"] ?? null,
      inPicture: n.parent?.tag === "picture",
      decorative: n.attrs.role === "presentation" || n.attrs.role === "none" || n.attrs["aria-hidden"] === "true",
      tiny,
    };
  }).filter((x) => x.src && !x.src.startsWith("data:"));

  const scopeOk = (host: string) => isInScope(host, i.siteHost, i.permittedHosts);
  const linkInfos: LinkInfo[] = [];
  for (const a of byTag(root, "a")) {
    const href = a.attrs.href;
    if (href === undefined) continue;
    const trimmed = href.trim();
    const fragmentOnly = trimmed.startsWith("#");
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase() ?? "http";
    const imgAlt = findAll(a, (n) => n.tag === "img").map((n) => n.attrs.alt ?? "").join(" ");
    const t = (textOf(a) || imgAlt || a.attrs["aria-label"] || a.attrs.title || "").trim();
    let resolved = trimmed;
    let internal = false;
    if (!fragmentOnly && (scheme === "http" || scheme === "https")) {
      const n = normalizeUrl(trimmed, finalUrl);
      if (!n) continue;
      resolved = n;
      try { internal = scopeOk(new URL(n).hostname); } catch { internal = false; }
    }
    linkInfos.push({ href: resolved, text: t, rel: (a.attrs.rel ?? "").toLowerCase(), internal, ariaLabel: a.attrs["aria-label"] ?? null, fragmentOnly, scheme });
  }

  const scripts: ScriptInfo[] = byTag(root, "script").map((n) => {
    const src = n.attrs.src ?? null;
    const a = abs(src, finalUrl);
    let host: string | null = null;
    try { host = a ? new URL(a).hostname : null; } catch { host = null; }
    return {
      src,
      absolute: a,
      async: n.attrs.async !== undefined,
      defer: n.attrs.defer !== undefined,
      module: (n.attrs.type ?? "").toLowerCase() === "module",
      type: n.attrs.type ?? null,
      inlineBytes: src ? 0 : utf8Length(rawTextOf(n)),
      integrity: Boolean(n.attrs.integrity),
      crossorigin: n.attrs.crossorigin !== undefined,
      inHead: head ? Boolean(findAll(head, (x) => x === n).length) : false,
      host,
    };
  });

  const styleLinks = links.filter((l) => relOf(l).includes("stylesheet"));
  const stylesheets = styleLinks.map((l) => ({ href: l.attrs.href ?? "", media: l.attrs.media ?? null, inHead: head ? head.children.includes(l) : false, absolute: abs(l.attrs.href, finalUrl) }));
  const inlineCss = byTag(root, "style").map((s) => rawTextOf(s)).join("\n");

  const jsonld: JsonLdBlock[] = byTag(root, "script").filter((s) => (s.attrs.type ?? "").toLowerCase().includes("ld+json")).map((s) => {
    const raw = rawTextOf(s).trim();
    try { return { raw, parsed: JSON.parse(raw) as unknown, error: null }; } catch (e) { return { raw, parsed: null, error: (e as Error).message }; }
  });
  const types = new Set<string>();
  for (const b of jsonld) if (b.parsed) extractSchemaTypes(b.parsed, types);
  // Microdata types
  for (const n of findAll(root, (x) => x.attrs.itemtype !== undefined)) {
    const t = (n.attrs.itemtype ?? "").split("/").pop();
    if (t) types.add(t);
  }

  const labelFor = new Set(byTag(root, "label").map((l) => l.attrs.for).filter(Boolean) as string[]);
  const forms: FormInfo[] = byTag(root, "form").map((fm) => {
    const fields = findAll(fm, (n) => n.tag === "input" || n.tag === "select" || n.tag === "textarea").map((n) => {
      const type = (n.attrs.type ?? (n.tag === "input" ? "text" : n.tag)).toLowerCase();
      const wrapped = Boolean(n.parent && (() => { let p: HNode | null = n.parent; while (p && p !== fm) { if (p.tag === "label") return true; p = p.parent; } return false; })());
      return {
        tag: n.tag, type, id: n.attrs.id ?? null, name: n.attrs.name ?? null,
        labelled: Boolean(n.attrs["aria-label"] || n.attrs["aria-labelledby"] || n.attrs.title || (n.attrs.id && labelFor.has(n.attrs.id)) || wrapped),
        hidden: type === "hidden", autocomplete: n.attrs.autocomplete ?? null, onpaste: n.attrs.onpaste !== undefined,
      };
    });
    const hasSubmit = findAll(fm, (n) => (n.tag === "button" && (n.attrs.type ?? "submit") === "submit") || (n.tag === "input" && ["submit", "image"].includes((n.attrs.type ?? "").toLowerCase()))).length > 0;
    return { action: n2(fm.attrs.action), method: (fm.attrs.method ?? "get").toLowerCase(), fields, hasSubmit, hasPassword: fields.some((x) => x.type === "password"), node: fm };
  });

  const hreflang = links.filter((l) => relOf(l).includes("alternate") && l.attrs.hreflang).map((l) => ({ lang: l.attrs.hreflang as string, href: l.attrs.href ?? "" }));
  const iframes = byTag(root, "iframe").map((n) => ({ src: n.attrs.src ? abs(n.attrs.src, finalUrl) : null, title: n.attrs.title ?? null }));
  const ids = findAll(root, (n) => n.attrs.id !== undefined && n.attrs.id !== "").map((n) => n.attrs.id as string);

  const tp = new Set<string>();
  const addHost = (u: string | null) => { if (!u) return; try { const h = new URL(u).hostname; if (!scopeOk(h)) tp.add(h); } catch { /* ignore */ } };
  for (const s of scripts) addHost(s.absolute);
  for (const s of stylesheets) addHost(s.absolute);
  for (const im of images) addHost(im.src);
  for (const fr of iframes) addHost(fr.src);

  const fonts = links.filter((l) => /fonts\.(googleapis|gstatic)\.com|use\.typekit\.net|fonts\.bunny\.net/i.test(l.attrs.href ?? "") && (relOf(l).includes("stylesheet") || relOf(l).includes("preload"))).map((l) => ({
    href: l.attrs.href ?? "", preconnect: false, swap: /display=swap/i.test(l.attrs.href ?? ""),
  }));
  const preconnects = links.filter((l) => relOf(l).includes("preconnect") || relOf(l).includes("dns-prefetch")).map((l) => l.attrs.href ?? "");
  const fontFace = /@font-face/i.test(inlineCss);
  if (fontFace && !fonts.length) fonts.push({ href: "inline @font-face", preconnect: false, swap: /font-display\s*:\s*(swap|optional|fallback)/i.test(inlineCss) });
  for (const fo of fonts) fo.preconnect = preconnects.some((p) => /fonts\.(googleapis|gstatic)\.com|typekit|bunny/i.test(p)) || fo.href === "inline @font-face";

  const iconLink = links.find((l) => relOf(l).some((r) => r === "icon" || r === "shortcut" || r === "apple-touch-icon"));
  const ct = header(f, "content-type");
  return {
    url: i.requestedUrl,
    finalUrl,
    depth: i.depth,
    important: i.important,
    isHomepage: i.isHomepage,
    discoveredFrom: i.discoveredFrom,
    status: f.status,
    headers: f.headers,
    redirects: f.redirects,
    htmlBytes: f.body.length,
    transferBytes: f.transferBytes,
    ttfbMs: f.ttfbMs,
    totalMs: f.totalMs,
    contentEncoding: f.contentEncoding,
    transferObservable: f.transferObservable !== false,
    cacheControl: header(f, "cache-control"),
    contentType: ct,
    truncated: f.truncated,
    html,
    doc,
    head,
    body,
    title,
    metaDescription: meta.description ?? null,
    meta,
    canonicals,
    robotsMeta: [meta.robots, meta.googlebot].filter(Boolean).join(", ") || null,
    xRobotsTag: header(f, "x-robots-tag"),
    lang: htmlEl?.attrs.lang ?? null,
    headings,
    text,
    wordCount,
    readingEase: fleschReadingEase(text),
    images,
    links: linkInfos,
    scripts,
    stylesheets,
    inlineCss,
    jsonld,
    schemaTypes: [...types],
    forms,
    hreflang,
    iframes,
    ids,
    thirdPartyHosts: [...tp],
    fonts,
    preconnects,
    favicon: iconLink ? abs(iconLink.attrs.href, finalUrl) : null,
    siteHost: i.siteHost,
  };
}

function n2(v: string | undefined): string | null { return v === undefined ? null : v; }

export function isIndexableFromSignals(p: Pick<PageData, "status" | "robotsMeta" | "xRobotsTag" | "canonicals" | "finalUrl">): { indexable: boolean | null; reason: string | null } {
  if (p.status === null) return { indexable: null, reason: "No response" };
  if (p.status >= 400) return { indexable: false, reason: `HTTP ${p.status}` };
  const directives = `${p.robotsMeta ?? ""},${p.xRobotsTag ?? ""}`.toLowerCase();
  if (/\bnoindex\b|\bnone\b/.test(directives)) return { indexable: false, reason: "noindex directive" };
  const c = p.canonicals[0];
  if (c) {
    const a = normalizeUrl(c);
    const b = normalizeUrl(p.finalUrl);
    if (a && b && a !== b) return { indexable: true, reason: `canonicalised to ${c}` };
  }
  return { indexable: true, reason: null };
}

export function toFacts(p: PageData): PageFacts {
  const idx = isIndexableFromSignals(p);
  const renderBlocking = p.scripts.filter((s) => s.src && s.inHead && !s.async && !s.defer && !s.module).length + p.stylesheets.filter((s) => (!s.media || /all|screen/.test(s.media))).length;
  return {
    url: p.url,
    finalUrl: p.finalUrl,
    depth: p.depth,
    status: p.status,
    redirects: p.redirects.length,
    contentType: p.contentType,
    htmlBytes: p.htmlBytes,
    transferBytes: p.transferBytes,
    ttfbMs: p.ttfbMs,
    totalMs: p.totalMs,
    compression: p.contentEncoding,
    cacheControl: p.cacheControl,
    title: p.title,
    titleLength: p.title?.length ?? 0,
    metaDescription: p.metaDescription,
    metaDescriptionLength: p.metaDescription?.length ?? 0,
    canonical: p.canonicals[0] ?? null,
    robotsMeta: p.robotsMeta,
    xRobotsTag: p.xRobotsTag,
    indexable: idx.indexable,
    indexabilityReason: idx.reason,
    lang: p.lang,
    h1Count: p.headings.filter((h) => h.level === 1).length,
    headingCount: p.headings.length,
    wordCount: p.wordCount,
    readingEase: p.readingEase,
    imagesTotal: p.images.length,
    imagesMissingAlt: p.images.filter((i) => i.alt === null && !i.decorative && !i.tiny).length,
    imagesMissingDimensions: p.images.filter((i) => !i.tiny && !(i.width && i.height)).length,
    internalLinks: p.links.filter((l) => l.internal).length,
    externalLinks: p.links.filter((l) => !l.internal && !l.fragmentOnly && (l.scheme === "http" || l.scheme === "https")).length,
    schemaTypes: p.schemaTypes,
    scriptCount: p.scripts.length,
    stylesheetCount: p.stylesheets.length,
    renderBlockingCount: renderBlocking,
    thirdPartyHosts: p.thirdPartyHosts,
    domNodes: p.doc.nodeCount,
    formCount: p.forms.length,
    important: p.important,
    discoveredFrom: p.discoveredFrom,
  };
}
