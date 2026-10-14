/**
 * Pure URL helpers shared by the crawler, the API validation layer and the dashboard.
 * Network-free: DNS resolution is done by the server and its results are passed to `classifyIp`.
 */

export interface IpVerdict {
  allowed: boolean;
  reason?: string;
}

function parseIPv4(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
}

/** Expands an IPv6 literal into eight 16-bit groups. Handles :: and embedded IPv4. */
export function parseIPv6(input: string): number[] | null {
  let ip = input.trim().toLowerCase();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  const zone = ip.indexOf("%");
  if (zone >= 0) ip = ip.slice(0, zone);
  if (!ip.includes(":")) return null;
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (v4) {
    const p = parseIPv4(v4[1]);
    if (!p) return null;
    ip = ip.slice(0, ip.length - v4[1].length) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && head.length !== 8) || missing < (halves.length === 2 ? 0 : 0)) return null;
  const groups = halves.length === 2 ? [...head, ...Array(Math.max(missing, 0)).fill("0"), ...tail] : head;
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

const V4_BLOCKS: { cidr: [number, number, number, number, number]; reason: string }[] = [
  { cidr: [0, 0, 0, 0, 8], reason: "unspecified/this-network address" },
  { cidr: [10, 0, 0, 0, 8], reason: "private network (10.0.0.0/8)" },
  { cidr: [100, 64, 0, 0, 10], reason: "carrier-grade NAT (100.64.0.0/10)" },
  { cidr: [127, 0, 0, 0, 8], reason: "loopback address" },
  { cidr: [169, 254, 0, 0, 16], reason: "link-local / cloud metadata address (169.254.0.0/16)" },
  { cidr: [172, 16, 0, 0, 12], reason: "private network (172.16.0.0/12)" },
  { cidr: [192, 0, 0, 0, 24], reason: "IETF protocol assignments (192.0.0.0/24)" },
  { cidr: [192, 0, 2, 0, 24], reason: "documentation range (TEST-NET-1)" },
  { cidr: [192, 88, 99, 0, 24], reason: "6to4 relay anycast" },
  { cidr: [192, 168, 0, 0, 16], reason: "private network (192.168.0.0/16)" },
  { cidr: [198, 18, 0, 0, 15], reason: "benchmarking range (198.18.0.0/15)" },
  { cidr: [198, 51, 100, 0, 24], reason: "documentation range (TEST-NET-2)" },
  { cidr: [203, 0, 113, 0, 24], reason: "documentation range (TEST-NET-3)" },
  { cidr: [224, 0, 0, 0, 4], reason: "multicast range" },
  { cidr: [240, 0, 0, 0, 4], reason: "reserved / broadcast range" },
];

function v4ToInt(p: number[]): number {
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

function classifyV4(p: number[]): IpVerdict {
  const n = v4ToInt(p);
  for (const b of V4_BLOCKS) {
    const base = v4ToInt(b.cidr.slice(0, 4));
    const bits = b.cidr[4];
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((n & mask) >>> 0 === (base & mask) >>> 0) return { allowed: false, reason: b.reason };
  }
  return { allowed: true };
}

/** Decides whether an IP literal may be contacted. Anything unparseable is refused. */
export function classifyIp(ip: string): IpVerdict {
  const raw = ip.trim();
  const v4 = parseIPv4(raw);
  if (v4) return classifyV4(v4);
  const g = parseIPv6(raw);
  if (!g) return { allowed: false, reason: "not a valid IP address" };
  const allZero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (allZero(0, 8)) return { allowed: false, reason: "unspecified IPv6 address" };
  if (allZero(0, 7) && g[7] === 1) return { allowed: false, reason: "IPv6 loopback address" };
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) addresses carry an IPv4 destination.
  if (allZero(0, 5) && (g[5] === 0xffff || g[5] === 0)) {
    const inner = classifyV4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255]);
    return inner.allowed ? inner : { allowed: false, reason: `IPv4-mapped address: ${inner.reason}` };
  }
  // 64:ff9b::/96 NAT64 embeds an IPv4 destination.
  if (g[0] === 0x64 && g[1] === 0xff9b && allZero(2, 6)) {
    const inner = classifyV4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255]);
    return inner.allowed ? inner : { allowed: false, reason: `NAT64 address: ${inner.reason}` };
  }
  if (g[0] === 0x2002) {
    // 6to4 embeds an IPv4 address in bits 16-47.
    const inner = classifyV4([g[1] >> 8, g[1] & 255, g[2] >> 8, g[2] & 255]);
    if (!inner.allowed) return { allowed: false, reason: `6to4 address: ${inner.reason}` };
  }
  if ((g[0] & 0xfe00) === 0xfc00) return { allowed: false, reason: "unique local address (fc00::/7)" };
  if ((g[0] & 0xffc0) === 0xfe80) return { allowed: false, reason: "link-local address (fe80::/10)" };
  if ((g[0] & 0xffc0) === 0xfec0) return { allowed: false, reason: "deprecated site-local address" };
  if ((g[0] & 0xff00) === 0xff00) return { allowed: false, reason: "multicast address" };
  if (g[0] === 0x2001 && g[1] === 0x0db8) return { allowed: false, reason: "documentation range (2001:db8::/32)" };
  if (g[0] === 0x2001 && g[1] === 0) return { allowed: false, reason: "Teredo tunnelling range" };
  if ((g[0] & 0xe000) !== 0x2000) return { allowed: false, reason: "outside global unicast space" };
  return { allowed: true };
}

export function isIpLiteral(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  return parseIPv4(h) !== null || parseIPv6(h) !== null;
}

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".corp", ".private", ".home.arpa", ".onion"];
const BLOCKED_HOSTS = new Set(["localhost", "metadata", "metadata.google.internal", "instance-data", "kubernetes", "kubernetes.default", "host.docker.internal"]);

export interface HostVerdict {
  allowed: boolean;
  reason?: string;
}

/** Name-level screening done before any DNS lookup. IP checks happen after resolution. */
export function screenHostname(rawHost: string): HostVerdict {
  const host = rawHost.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return { allowed: false, reason: "empty hostname" };
  if (isIpLiteral(host)) {
    const v = classifyIp(host.replace(/^\[|\]$/g, ""));
    return v.allowed ? { allowed: true } : { allowed: false, reason: v.reason };
  }
  // Decimal, octal or hex integer hosts (http://2130706433/) are parsed by some stacks as IPv4.
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) return { allowed: false, reason: "numeric host notation is not accepted" };
  if (/^[0-9a-fx.]+$/i.test(host) && /\d/.test(host) && !/[g-wyz]/i.test(host) && host.split(".").every((p) => /^(0x[0-9a-f]+|\d+)$/i.test(p))) {
    return { allowed: false, reason: "numeric host notation is not accepted" };
  }
  if (BLOCKED_HOSTS.has(host)) return { allowed: false, reason: "internal hostname" };
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return { allowed: false, reason: "internal domain suffix" };
  if (!host.includes(".")) return { allowed: false, reason: "single-label hostname" };
  if (host.length > 253 || host.split(".").some((l) => l.length === 0 || l.length > 63)) return { allowed: false, reason: "invalid hostname" };
  if (!/^[a-z0-9.-]+$/.test(host) && !host.startsWith("xn--") && !/^[a-z0-9.\-\u0080-￿]+$/.test(host)) return { allowed: false, reason: "invalid hostname characters" };
  return { allowed: true };
}

export interface UrlCheck {
  ok: boolean;
  url?: URL;
  error?: string;
}

/** Parses and screens a user-supplied URL. Adds https:// when no scheme is given. */
export function parseAuditUrl(input: string): UrlCheck {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, error: "Enter a website URL." };
  if (raw.length > 2048) return { ok: false, error: "The URL is too long." };
  let candidate = raw;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^/]+:\d+(\/|$)/.test(raw)) return { ok: false, error: "Only http and https URLs can be audited." };
    candidate = `https://${raw}`;
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: "That does not look like a valid URL." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "Only http and https URLs can be audited." };
  if (url.username || url.password) return { ok: false, error: "URLs containing credentials are not accepted." };
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (![80, 443, 8080, 8443].includes(port)) return { ok: false, error: `Port ${port} is not permitted. Allowed ports: 80, 443, 8080, 8443.` };
  const hv = screenHostname(url.hostname);
  if (!hv.allowed) return { ok: false, error: `That host cannot be audited (${hv.reason}).` };
  url.hash = "";
  return { ok: true, url };
}

const TRACKING_PARAMS = /^(utm_[a-z]+|gclid|fbclid|msclkid|mc_cid|mc_eid|_ga|_gl|yclid|igshid|ref_src)$/i;

/** Canonical crawl key: lowercase host, no fragment, default ports dropped, tracking parameters removed, sorted query. */
export function normalizeUrl(input: string | URL, base?: string | URL): string | null {
  let u: URL;
  try {
    u = typeof input === "string" ? new URL(input, base) : new URL(input.toString());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/\.$/, "");
  if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) u.port = "";
  const keep: [string, string][] = [];
  u.searchParams.forEach((v, k) => { if (!TRACKING_PARAMS.test(k)) keep.push([k, v]); });
  keep.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  u.search = "";
  for (const [k, v] of keep) u.searchParams.append(k, v);
  if (u.pathname === "") u.pathname = "/";
  return u.toString();
}

export function stripWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/** In scope when the host equals the audited host, its www/apex twin, or an explicitly permitted host. */
export function isInScope(candidateHost: string, auditedHost: string, permitted: readonly string[] = []): boolean {
  const c = candidateHost.toLowerCase().replace(/\.$/, "");
  if (stripWww(c) === stripWww(auditedHost)) return true;
  return permitted.some((p) => stripWww(p) === stripWww(c));
}

const SKIP_EXT = /\.(?:jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|mp4|webm|mov|avi|mkv|mp3|wav|ogg|flac|woff2?|ttf|otf|eot|zip|gz|tgz|rar|7z|tar|exe|dmg|pkg|apk|iso|docx?|xlsx?|pptx?|pdf|csv|json|xml|rss|atom|css|js|mjs|map|txt)$/i;

/** Heuristic: does this path look like an HTML document (as opposed to a static asset or download)? */
export function looksLikeDocument(url: string): boolean {
  try {
    return !SKIP_EXT.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function reportFileName(host: string, date: Date = new Date()): string {
  const safe = host.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "site";
  return `CINTEXA-NEXUS-Website-Audit-${safe}-${date.toISOString().slice(0, 10)}.pdf`;
}
