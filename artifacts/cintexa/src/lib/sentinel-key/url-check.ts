/**
 * Heuristic URL risk checks. All analysis is local; nothing is fetched or sent anywhere.
 * The result is a list of red flags. The checker never declares a website "safe".
 */
export type Severity = "info" | "low" | "medium" | "high";
export interface Finding { id: string; severity: Severity; title: string; detail: string }
export type Verdict = "invalid" | "high-risk" | "suspicious" | "no-red-flags";
export interface UrlReport {
  verdict: Verdict;
  input: string;
  normalized: string | null;
  hostname: string | null;
  unicodeHostname: string | null;
  registrableDomain: string | null;
  findings: Finding[];
}

const MAX_URL = 2048;
const BRANDS = ["paypal.com", "google.com", "microsoft.com", "apple.com", "amazon.com", "facebook.com", "instagram.com", "netflix.com", "github.com", "linkedin.com", "whatsapp.com", "dropbox.com", "docusign.com", "chase.com", "wellsfargo.com", "bankofamerica.com", "outlook.com", "office.com", "icloud.com", "twitter.com", "binance.com", "coinbase.com", "firebase.com", "cloudflare.com", "cintexa.com"];
const BRAND_WORDS = Array.from(new Set(BRANDS.map((b) => b.split(".")[0]!)));
const SHORTENERS = new Set(["bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "ow.ly", "cutt.ly", "rb.gy", "buff.ly", "shorturl.at"]);
const RISKY_TLDS = new Set(["zip", "mov", "tk", "ml", "ga", "cf", "gq", "top", "click", "country", "kim", "work", "support"]);
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu", "or", "ne", "go"]);
const LURE_WORDS = ["login", "signin", "verify", "secure", "update", "account", "wallet", "recover", "password", "confirm", "suspend", "billing"];

/** RFC 3492 punycode decoder for one label (without the xn-- prefix). */
export function punycodeDecode(input: string): string {
  const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
  const out: number[] = [];
  let n = 128, i = 0, bias = 72;
  let basic = input.lastIndexOf("-");
  if (basic < 0) basic = 0;
  for (let j = 0; j < basic; j++) out.push(input.charCodeAt(j));
  const adapt = (delta: number, num: number, first: boolean) => {
    let k = 0;
    delta = first ? Math.floor(delta / damp) : delta >> 1;
    delta += Math.floor(delta / num);
    for (; delta > ((base - tMin) * tMax) >> 1; k += base) delta = Math.floor(delta / (base - tMin));
    return Math.floor(k + ((base - tMin + 1) * delta) / (delta + skew));
  };
  for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length; ) {
    const oldi = i;
    for (let w = 1, k = base; ; k += base) {
      if (idx >= input.length) throw new Error("bad punycode");
      const c = input.charCodeAt(idx++);
      const digit = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base;
      if (digit >= base) throw new Error("bad punycode");
      i += digit * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (digit < t) break;
      w *= base - t;
    }
    const len = out.length + 1;
    bias = adapt(i - oldi, len, oldi === 0);
    n += Math.floor(i / len);
    i %= len;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}

export function toUnicodeHostname(host: string): string {
  return host.split(".").map((l) => { if (!l.startsWith("xn--")) return l; try { return punycodeDecode(l.slice(4)); } catch { return l; } }).join(".");
}

export function registrableDomain(host: string): string {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const tld = parts[parts.length - 1]!, sld = parts[parts.length - 2]!;
  return tld.length === 2 && SECOND_LEVEL.has(sld) && parts.length >= 3 ? parts.slice(-3).join(".") : parts.slice(-2).join(".");
}

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)] as number[]);
  for (let j = 1; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m]![n]!;
}

const unhomoglyph = (s: string) => s.replace(/rn/g, "m").replace(/vv/g, "w").replace(/[0]/g, "o").replace(/[1|]/g, "l").replace(/5/g, "s");

function scripts(label: string): Set<string> {
  const set = new Set<string>();
  for (const ch of label) {
    if (/[a-z0-9-]/i.test(ch)) set.add("Latin");
    else if (/\p{Script=Cyrillic}/u.test(ch)) set.add("Cyrillic");
    else if (/\p{Script=Greek}/u.test(ch)) set.add("Greek");
    else if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(ch)) set.add("CJK");
    else if (/\p{Script=Arabic}/u.test(ch)) set.add("Arabic");
    else set.add("Other");
  }
  return set;
}

export function parseUrl(input: string): URL | null {
  const t = input.trim();
  if (!t || t.length > MAX_URL || /[\u0000-\u001f\u007f\s]/.test(t)) return null;
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(javascript|data|file|vbscript|blob):/i.test(t) ? t : `https://${t}`); } catch { return null; }
}

export function analyzeUrl(input: string, expectedOrigin?: string): UrlReport {
  const base: UrlReport = { verdict: "invalid", input, normalized: null, hostname: null, unicodeHostname: null, registrableDomain: null, findings: [] };
  const f: Finding[] = base.findings;
  const add = (id: string, severity: Severity, title: string, detail: string) => f.push({ id, severity, title, detail });
  const url = parseUrl(input);
  if (!url) { add("invalid", "high", "Not a valid web address", "The value is empty, too long, contains spaces or control characters, or cannot be parsed as a URL."); return base; }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    add("scheme", "high", `Unsupported scheme "${url.protocol}"`, "Only http and https addresses are web pages. Other schemes can run code or open local files.");
    base.normalized = null; return { ...base, verdict: "high-risk" };
  }
  const host = url.hostname.toLowerCase();
  const uni = toUnicodeHostname(host);
  const reg = registrableDomain(host);
  Object.assign(base, { normalized: url.origin + url.pathname + url.search, hostname: host, unicodeHostname: uni, registrableDomain: reg });

  if (url.protocol === "https:") add("https", "info", "HTTPS is used", "The connection is encrypted. HTTPS does not prove the site is genuine: phishing sites commonly use it too.");
  else add("http", "medium", "Connection is not encrypted (HTTP)", "Anything you type can be read or changed in transit. Do not enter credentials.");

  if (url.username || url.password) add("userinfo", "high", "Credentials embedded in the address", "Everything before the @ sign is ignored by the browser. Attackers use this to make a link look like a trusted site.");
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
  if (isIp) add("ip", "medium", "Address uses an IP number instead of a domain", "Legitimate sign-in pages rarely use raw IP addresses.");
  if (url.port && !["80", "443"].includes(url.port)) add("port", "medium", `Unusual port ${url.port}`, "Public sign-in pages normally use the default web ports.");

  if (!isIp) {
    const labels = host.split(".");
    if (labels.some((l) => l.startsWith("xn--"))) {
      add("punycode", "medium", "Internationalised (punycode) domain", `The address is displayed as "${uni}". Look-alike letters from other alphabets can imitate well-known names.`);
      for (const l of toUnicodeHostname(host).split(".")) {
        const sc = scripts(l);
        if (sc.size > 1) { add("mixed-script", "high", "Mixed alphabets in one domain label", `The label "${l}" mixes ${Array.from(sc).join(" and ")} characters, a classic homograph trick.`); break; }
      }
    }
    if (labels.length > 5) add("deep-subdomain", "low", "Unusually many subdomains", "Long chains of subdomains can hide the real domain at the end.");
    if ((host.match(/-/g) ?? []).length >= 4) add("hyphens", "low", "Many hyphens in the domain", "Throwaway phishing domains often chain words with hyphens.");
    if (SHORTENERS.has(reg)) add("shortener", "medium", "Link shortener", "The real destination is hidden. Expand the link with a trusted tool before signing in.");
    if (RISKY_TLDS.has(labels[labels.length - 1]!)) add("tld", "low", `".${labels[labels.length - 1]}" is often abused`, "This is not proof of harm; many legitimate sites exist here. Treat it with extra care.");

    const regName = reg.split(".")[0]!;
    const sub = host.slice(0, Math.max(0, host.length - reg.length));
    for (const brand of BRANDS) {
      const bName = brand.split(".")[0]!;
      if (reg === brand) break;
      const cand = unhomoglyph(regName);
      const sameName = regName === bName && reg !== brand;
      if (!sameName && (cand === bName || levenshtein(regName, bName) === 1) && bName.length >= 5) {
        add("lookalike", "high", `Looks like ${brand}`, `"${reg}" is very close to "${brand}" but is a different domain.`); break;
      }
      if (sub.includes(bName)) {
        add("brand-misuse", "high", `Uses the name "${bName}" in a subdomain of another domain`, `The real domain here is "${reg}". The brand name only appears before it.`); break;
      }
      if (bName.length >= 5 && regName.includes(bName) && regName !== bName) {
        add("brand-misuse", "medium", `Domain contains the name "${bName}"`, `"${reg}" is a different domain from "${brand}". Confirm who owns it before signing in.`); break;
      }
    }
    if (BRAND_WORDS.some((b) => url.pathname.toLowerCase().includes(b)) && !BRANDS.includes(reg)) add("brand-path", "low", "A well-known brand name appears in the path", "The path can say anything; only the domain shows who runs the site.");
    const lure = LURE_WORDS.filter((w) => host.includes(w) || url.pathname.toLowerCase().includes(w));
    if (lure.length >= 2) add("lure-words", "low", "Account-themed wording", `The address contains: ${lure.join(", ")}. Common in phishing but also in real pages.`);
  }
  if (url.href.length > 200) add("long", "low", "Very long address", "Long, noisy URLs are sometimes used to hide the part that matters.");

  if (expectedOrigin?.trim()) {
    const exp = parseUrl(expectedOrigin);
    if (!exp || !/^https?:$/.test(exp.protocol)) add("expected-invalid", "low", "Expected website is not a valid address", "Enter the exact site you intended to visit, for example https://example.com.");
    else if (exp.origin !== url.origin) add("origin-mismatch", "high", "Does not match the expected website", `Expected ${exp.origin} but this address is ${url.origin}. Do not enter the saved credentials here.`);
    else add("origin-match", "info", "Matches the expected website origin", "Scheme, domain and port are identical to the saved origin.");
  }

  const rank: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3 };
  const worst = f.reduce((m, x) => Math.max(m, rank[x.severity]), 0);
  f.sort((a, b) => rank[b.severity] - rank[a.severity]);
  base.verdict = worst >= 3 ? "high-risk" : worst >= 2 || f.filter((x) => x.severity === "low").length >= 2 ? "suspicious" : "no-red-flags";
  return base;
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  invalid: "Not a valid address",
  "high-risk": "High-risk indicators found",
  suspicious: "Some warning signs found",
  "no-red-flags": "No red flags found by these checks",
};
