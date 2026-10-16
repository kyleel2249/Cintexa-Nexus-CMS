import { Collector, ev, inferred, measured, trunc } from "./check";
import type { AuditContext } from "./context";
import { detectTech } from "./detect";
import { header } from "./net-types";
import { safeFetch } from "./ports";
import type { InfraOutcome } from "./site-infra";
import { byTag, findAll, textOf } from "./html";

const SENSITIVE_PROBES: { path: string; label: string; test: (body: string, ct: string) => boolean }[] = [
  { path: "/.git/HEAD", label: "Git repository metadata", test: (b) => /^ref:\s*refs\/heads\//m.test(b.slice(0, 200)) },
  { path: "/.git/config", label: "Git configuration", test: (b) => /\[core\]/.test(b.slice(0, 500)) && /repositoryformatversion/.test(b) },
  { path: "/.env", label: "Environment file", test: (b, ct) => !/html/i.test(ct) && /^[A-Z][A-Z0-9_]{2,}=.+$/m.test(b) && /(KEY|SECRET|PASSWORD|TOKEN|DB_|DATABASE|APP_)/i.test(b) },
  { path: "/.env.local", label: "Environment file", test: (b, ct) => !/html/i.test(ct) && /^[A-Z][A-Z0-9_]{2,}=.+$/m.test(b) && /(KEY|SECRET|PASSWORD|TOKEN|DB_|DATABASE)/i.test(b) },
  { path: "/.htpasswd", label: "Password file", test: (b, ct) => !/html/i.test(ct) && /^[^:\s]+:(\$apr1\$|\$2[aby]\$|\{SHA\}|[A-Za-z0-9./]{13})/m.test(b) },
  { path: "/.DS_Store", label: "macOS directory metadata", test: (b) => b.startsWith("\u0000\u0000\u0000\u0001Bud1") },
  { path: "/phpinfo.php", label: "PHP diagnostics page", test: (b) => /<title>phpinfo\(\)|PHP Version \d/i.test(b) },
  { path: "/info.php", label: "PHP diagnostics page", test: (b) => /<title>phpinfo\(\)|PHP Version \d/i.test(b) },
  { path: "/server-status", label: "Apache status page", test: (b) => /Apache Server Status for/i.test(b) },
  { path: "/wp-config.php.bak", label: "WordPress configuration backup", test: (b) => /DB_PASSWORD|DB_NAME/.test(b) },
  { path: "/backup.sql", label: "Database dump", test: (b, ct) => !/html/i.test(ct) && /(CREATE TABLE|INSERT INTO)/i.test(b.slice(0, 5000)) },
  { path: "/database.sql", label: "Database dump", test: (b, ct) => !/html/i.test(ct) && /(CREATE TABLE|INSERT INTO)/i.test(b.slice(0, 5000)) },
  { path: "/id_rsa", label: "Private key", test: (b) => /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(b) },
];

const DIRS = ["/images/", "/uploads/", "/assets/", "/static/", "/files/", "/wp-content/uploads/"];

const SECRET_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/, label: "Private key block" },
  { re: /\bsk_live_[0-9a-zA-Z]{20,}\b/, label: "Stripe live secret key" },
  { re: /\bghp_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/, label: "GitHub token" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, label: "Slack token" },
  { re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/, label: "SendGrid API key" },
  { re: /aws_secret_access_key["'\s:=]+[A-Za-z0-9/+=]{40}/i, label: "AWS secret access key" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: "AWS access key id" },
  { re: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql):\/\/[^\s:@'"]+:[^\s@'"]{3,}@[^\s'"]+/i, label: "Database connection string with credentials" },
  { re: /\bsk-[A-Za-z0-9]{32,}\b|\bsk-ant-[A-Za-z0-9_-]{30,}\b/, label: "AI provider secret key" },
];

const redact = (v: string) => `${v.slice(0, 4)}…(${v.length} characters, redacted)`;

interface LibRule { name: string; re: RegExp; vulnerable: (v: number[]) => string | null }
const ver = (s: string) => s.split(".").map((x) => parseInt(x, 10) || 0);
const lt = (a: number[], b: number[]) => { for (let i = 0; i < 3; i++) { if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0); } return false; };
const LIBS: LibRule[] = [
  { name: "jQuery", re: /jquery[-.@/]v?(\d+\.\d+(?:\.\d+)?)|jQuery v(\d+\.\d+(?:\.\d+)?)/i, vulnerable: (v) => (lt(v, [3, 5, 0]) ? "jQuery below 3.5.0 has known XSS issues (CVE-2020-11022, CVE-2020-11023)" : null) },
  { name: "Bootstrap", re: /bootstrap[-.@/]v?(\d+\.\d+(?:\.\d+)?)|Bootstrap v(\d+\.\d+(?:\.\d+)?)/i, vulnerable: (v) => ((v[0] === 3 && lt(v, [3, 4, 1])) || (v[0] === 4 && lt(v, [4, 3, 1])) || v[0] < 3 ? "Bootstrap below 3.4.1 / 4.3.1 has a known XSS issue (CVE-2019-8331)" : null) },
  { name: "lodash", re: /lodash[-.@/]v?(\d+\.\d+(?:\.\d+)?)|lodash (\d+\.\d+\.\d+)/i, vulnerable: (v) => (lt(v, [4, 17, 21]) ? "lodash below 4.17.21 has known prototype-pollution and command-injection issues (CVE-2021-23337)" : null) },
  { name: "AngularJS", re: /angular(?:\.min)?[-.@/]?v?(1\.\d+(?:\.\d+)?)|AngularJS v(1\.\d+\.\d+)/i, vulnerable: () => "AngularJS 1.x reached end of life in January 2022 and no longer receives security fixes" },
  { name: "Moment.js", re: /moment(?:\.min)?[-.@/]v?(\d+\.\d+(?:\.\d+)?)|moment\.js[^\d]{0,20}(\d+\.\d+\.\d+)/i, vulnerable: (v) => (lt(v, [2, 29, 4]) ? "Moment.js below 2.29.4 has a known ReDoS issue (CVE-2022-24785)" : null) },
];

const ERROR_LEAKS: RegExp[] = [/Traceback \(most recent call last\)/, /\bat [\w.$<>]+ \((?:\/|[A-Z]:\\)[^)]*\.(?:js|ts|java|cs|py|php):\d+/, /Fatal error:.{0,120} on line \d+/i, /Stack trace:/i, /(?:\/var\/www|\/home\/[a-z0-9_-]+\/|C:\\inetpub|C:\\Users\\)[^\s<"]{3,}/i, /SQLSTATE\[/i, /Whoops! There was an error/i, /Exception in thread/i, /Warning: .{0,120} in \/[^\s]+ on line \d+/i, /ASP\.NET.{0,40}Version:/i];

export interface SecurityOutcome { privacyUrl: string | null }

export async function runSecurity(ctx: AuditContext, infra: InfraOutcome, c: Collector): Promise<SecurityOutcome> {
  const home = ctx.homeFetch;
  const page = ctx.home;
  const httpsOk = infra.httpsAvailable && Boolean(home?.finalUrl.startsWith("https://"));
  if (!home || !page) return { privacyUrl: null };
  const h = (n: string) => header(home, n);
  const hdrEvidence = (n: string) => [ev("header", n, h(n) ?? "(absent)")];

  // HSTS
  const hsts = h("strict-transport-security");
  if (!httpsOk) c.na("sec.hsts", "HTTPS is not available.");
  else if (!hsts) c.fail("sec.hsts", { actual: "Header missing", expected: "Strict-Transport-Security with max-age of at least 180 days", evidence: hdrEvidence("strict-transport-security"), ...measured });
  else {
    const age = Number(/max-age=(\d+)/i.exec(hsts)?.[1] ?? 0);
    c.grade("sec.hsts", age >= 15_552_000 ? "pass" : "warn", { actual: hsts, expected: "max-age of at least 15552000 (180 days)", evidence: hdrEvidence("strict-transport-security"), ...measured });
  }

  // CSP
  const csp = h("content-security-policy") ?? page.meta["content-security-policy"] ?? null;
  const cspRo = h("content-security-policy-report-only");
  if (!csp) c.fail("sec.csp", { actual: cspRo ? "Only a report-only policy is set" : "No Content-Security-Policy", expected: "An enforced policy", evidence: hdrEvidence("content-security-policy"), ...measured });
  else {
    const script = /(?:^|;)\s*script-src[^;]*|(?:^|;)\s*default-src[^;]*/i.exec(csp)?.[0] ?? "";
    const weak = /'unsafe-inline'|'unsafe-eval'|(?:^|\s)\*(?:\s|$)|\bhttps?:(?:\s|$)|data:/i.test(script) && !/'nonce-|'strict-dynamic'/.test(script);
    c.grade("sec.csp", weak ? "warn" : "pass", { actual: trunc(csp, 280), expected: "No unsafe-inline, unsafe-eval or wildcard script sources", evidence: [ev("header", "content-security-policy", trunc(csp, 400))], ...measured });
  }

  const xfo = h("x-frame-options");
  const fa = csp ? /frame-ancestors\s+[^;]+/i.exec(csp)?.[0] : null;
  c.check("sec.frame", Boolean(xfo || fa), { actual: fa ?? xfo ?? "No framing restriction", expected: "frame-ancestors or X-Frame-Options", evidence: hdrEvidence("x-frame-options"), ...measured });
  c.check("sec.nosniff", /nosniff/i.test(h("x-content-type-options") ?? ""), { actual: h("x-content-type-options") ?? "Header missing", expected: "nosniff", evidence: hdrEvidence("x-content-type-options"), ...measured });
  const refMeta = page.meta.referrer;
  c.check("sec.referrer", Boolean(h("referrer-policy") || refMeta), { actual: h("referrer-policy") ?? refMeta ?? "No policy", expected: "e.g. strict-origin-when-cross-origin", evidence: hdrEvidence("referrer-policy"), ...measured });
  c.check("sec.permissions", Boolean(h("permissions-policy") || h("feature-policy")), { actual: trunc(h("permissions-policy") ?? h("feature-policy") ?? "No policy", 200), expected: "A Permissions-Policy header", evidence: hdrEvidence("permissions-policy"), ...measured });

  // Cookies
  if (!infra.homeSetCookies.length) c.na("sec.cookies", "The homepage response sets no cookies.");
  else {
    const hard: string[] = [];
    const soft: string[] = [];
    for (const raw of infra.homeSetCookies) {
      const [pair, ...attrs] = raw.split(";").map((x) => x.trim());
      const name = pair.split("=")[0];
      const flags = attrs.map((a) => a.toLowerCase());
      const session = /sess|sid|auth|token|jwt|login|csrf|xsrf/i.test(name);
      if (httpsOk && !flags.includes("secure")) hard.push(`${name}: no Secure`);
      if (session && !flags.includes("httponly")) hard.push(`${name}: session-like cookie without HttpOnly`);
      if (!flags.some((f) => f.startsWith("samesite"))) soft.push(`${name}: no SameSite`);
    }
    const evd = infra.homeSetCookies.slice(0, 4).map((x) => ev("header", "set-cookie", x.replace(/=[^;]*/, "=<redacted>")));
    if (hard.length) c.fail("sec.cookies", { actual: hard.slice(0, 4).join("; "), expected: "Secure, HttpOnly (session cookies) and SameSite", evidence: evd, ...measured });
    else if (soft.length) c.warn("sec.cookies", { actual: soft.slice(0, 4).join("; "), expected: "SameSite on every cookie", evidence: evd, ...measured });
    else c.pass("sec.cookies", { actual: `${infra.homeSetCookies.length} cookie(s) with security attributes`, evidence: evd, ...measured });
  }

  // Server disclosure
  const disclose = [["server", h("server")], ["x-powered-by", h("x-powered-by")], ["x-aspnet-version", h("x-aspnet-version")], ["x-generator", h("x-generator")]].filter(([, v]) => v && /\d+\.\d+/.test(String(v)));
  c.check("sec.server_disclosure", disclose.length === 0, { actual: disclose.length ? disclose.map(([k, v]) => `${k}: ${v}`).join("; ") : "No version banners", expected: "No product versions in headers", evidence: disclose.map(([k, v]) => ev("header", String(k), String(v))), ...measured });

  // Error pages
  const leak = ERROR_LEAKS.find((re) => re.test(infra.errorBody));
  if (!infra.errorBody) c.inconclusive("sec.error_disclosure", "No error page content was captured.");
  else c.check("sec.error_disclosure", !leak, { actual: leak ? `Error page matches a debug-output pattern (${leak.source.slice(0, 40)})` : "Generic error page", expected: "No stack traces, paths or framework banners", ...measured });

  // Exposed files
  const found: { path: string; label: string }[] = [];
  let probed = 0;
  for (const probe of SENSITIVE_PROBES) {
    if (ctx.signal.aborted) break;
    probed++;
    ctx.count.requests++;
    const r = await safeFetch(`${ctx.origin}${probe.path}`, { ...ctx.fetchOpts(), followRedirects: false, maxBytes: 64 * 1024, timeoutMs: 8000 });
    if (r.ok && r.status === 200 && probe.test(r.body.toString("utf8"), header(r, "content-type") ?? "")) found.push({ path: probe.path, label: probe.label });
    await new Promise((r2) => setTimeout(r2, ctx.limits.perHostDelayMs));
  }
  c.check("sec.exposed_files", found.length === 0, { actual: found.length ? found.map((f) => `${f.path} (${f.label})`).join("; ") : `${probed} well-known sensitive paths probed; none exposed`, expected: "None readable", evidence: found.map((f) => ev("url", f.label, `${ctx.origin}${f.path}`)), note: found.length ? "File contents are not stored." : undefined, ...measured });

  // Directory listing
  const listed: string[] = [];
  for (const d of DIRS) {
    if (ctx.signal.aborted) break;
    ctx.count.requests++;
    const r = await safeFetch(`${ctx.origin}${d}`, { ...ctx.fetchOpts(), followRedirects: false, maxBytes: 32 * 1024, timeoutMs: 8000 });
    if (r.ok && r.status === 200 && /<title>\s*Index of \/|Directory listing for|<h1>Index of/i.test(r.body.toString("utf8"))) listed.push(d);
    await new Promise((r2) => setTimeout(r2, ctx.limits.perHostDelayMs));
  }
  c.check("sec.directory_listing", listed.length === 0, { actual: listed.length ? `Listings enabled at ${listed.join(", ")}` : `${DIRS.length} common directories probed; no listings`, ...measured });

  // First-party scripts: source maps, secrets, libraries
  const firstParty = [...new Set(page.scripts.filter((s) => s.absolute && s.host && !page.thirdPartyHosts.includes(s.host)).map((s) => s.absolute as string))].slice(0, 8);
  const texts: { url: string; text: string }[] = [{ url: home.finalUrl, text: page.html }];
  const mapHits: string[] = [];
  for (const u of firstParty) {
    if (ctx.signal.aborted) break;
    ctx.count.requests++;
    const r = await safeFetch(u, { ...ctx.fetchOpts(), maxBytes: 1.5 * 1024 * 1024, timeoutMs: 10_000 });
    if (!r.ok || r.status !== 200) continue;
    const body = r.body.toString("utf8");
    texts.push({ url: u, text: body });
    const m = /\/\/[#@]\s*sourceMappingURL=([^\s'"]+)/.exec(body.slice(-2000));
    if (m && !m[1].startsWith("data:")) {
      try {
        const mapUrl = new URL(m[1], u).toString();
        ctx.count.requests++;
        const mr = await safeFetch(mapUrl, { ...ctx.fetchOpts(), maxBytes: 4096, timeoutMs: 8000, followRedirects: false });
        if (mr.ok && mr.status === 200 && /"mappings"|"sources"/.test(mr.body.toString("utf8"))) mapHits.push(mapUrl);
      } catch { /* ignore */ }
    }
  }
  if (!firstParty.length) c.na("sec.source_maps", "No first-party scripts.");
  else c.check("sec.source_maps", mapHits.length === 0, { actual: mapHits.length ? `${mapHits.length} public source map(s)` : `${firstParty.length} script(s) checked; no public source maps`, evidence: mapHits.slice(0, 3).map((u) => ev("url", "source map", u)), ...measured });

  const secretHits: { label: string; where: string; shown: string }[] = [];
  for (const t of texts) for (const p of SECRET_PATTERNS) { const m = p.re.exec(t.text); if (m) secretHits.push({ label: p.label, where: t.url, shown: redact(m[0]) }); }
  c.check("sec.secrets", secretHits.length === 0, { actual: secretHits.length ? secretHits.slice(0, 3).map((s) => `${s.label} in ${trunc(s.where, 80)}`).join("; ") : `${texts.length} public asset(s) scanned; no secret-like values`, expected: "No credentials in public assets", evidence: secretHits.slice(0, 3).map((s) => ev("text", s.label, `${s.where} -> ${s.shown}`)), note: secretHits.length ? "Values are redacted and not stored. Confirm manually, then rotate the credential." : undefined, ...inferred });

  // Libraries
  const libHits: string[] = [];
  const seen = new Set<string>();
  const sources = [...page.scripts.map((s) => ({ url: s.absolute ?? "", text: s.absolute ?? "" })), ...texts.map((t) => ({ url: t.url, text: `${t.url} ${t.text.slice(0, 600)}` }))];
  for (const s of sources) for (const lib of LIBS) {
    const m = lib.re.exec(s.text);
    if (!m) continue;
    const v = m[1] ?? m[2];
    if (!v) continue;
    const key = `${lib.name}@${v}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const why = lib.vulnerable(ver(v));
    if (why) libHits.push(`${lib.name} ${v}: ${why}`);
  }
  c.check("sec.outdated_libraries", libHits.length === 0, { actual: libHits.length ? libHits.slice(0, 3).join("; ") : `${seen.size} library version(s) identified; none on the vulnerable list`, expected: "Patched versions", evidence: libHits.slice(0, 3).map((x) => ev("text", "library", x)), note: "Detection uses file names and banners; bundled libraries cannot be identified. A vulnerable version is not necessarily exploitable.", ...inferred });

  // security.txt
  let secTxt = false;
  for (const p of ["/.well-known/security.txt", "/security.txt"]) {
    ctx.count.requests++;
    const r = await safeFetch(`${ctx.origin}${p}`, { ...ctx.fetchOpts(), maxBytes: 32 * 1024, timeoutMs: 8000 });
    if (r.ok && r.status === 200 && /^contact:/im.test(r.body.toString("utf8")) && !/html/i.test(header(r, "content-type") ?? "")) { secTxt = true; break; }
  }
  c.check("sec.contact", secTxt, { actual: secTxt ? "security.txt with Contact found" : "No security.txt", ...measured });

  // Privacy
  const allLinks = [...page.links, ...[...ctx.summaries.values()].flatMap((s) => s.links)];
  const privacyLink = allLinks.find((l) => l.internal && /privacy|datenschutz|privacidad|confidentialit|privacidade|gdpr|data-protection/i.test(`${l.href} ${l.text}`));
  c.check("sec.privacy.policy", Boolean(privacyLink), { actual: privacyLink ? `Found: ${privacyLink.href}` : "No privacy policy link found", ...inferred });

  const tech = detectTech(page);
  const trackers = [...new Set([...tech.trackers, ...tech.analytics.filter((a) => /Google Analytics/.test(a))])];
  const consentText = /cookie|consent/i.test(textOf(byTag(page.doc.root, "body")[0] ?? page.doc.root).slice(0, 5000)) && findAll(page.doc.root, (n) => /cookie|consent/i.test(`${n.attrs.class ?? ""} ${n.attrs.id ?? ""}`)).length > 0;
  const consent = tech.consent.length > 0 || consentText;
  const consentExtra = { actual: trackers.length ? `Trackers: ${trackers.join(", ")}${consent ? `; consent: ${tech.consent.join(", ") || "cookie notice markup"}` : "; no consent mechanism found"}` : "No third-party trackers detected", ...inferred };
  c.check("sec.privacy.cookies", trackers.length === 0 || consent, consentExtra);
  c.check("analytics.consent_aware", trackers.length === 0 || consent, consentExtra);

  if (!privacyLink) c.na("sec.privacy.retention", "No privacy policy page was found.");
  else {
    ctx.count.requests++;
    const r = await safeFetch(privacyLink.href, { ...ctx.fetchOpts(), maxBytes: 600 * 1024 });
    if (!r.ok || r.status !== 200) c.inconclusive("sec.privacy.retention", `The privacy page could not be read (${r.error?.message ?? `HTTP ${r.status}`}).`);
    else {
      const t = r.body.toString("utf8").toLowerCase();
      const retention = /retain|retention|stored for|keep your (data|information)|period of time/.test(t);
      const deletion = /delet|erasure|erase|right to be forgotten|remove your (data|information)/.test(t);
      c.check("sec.privacy.retention", retention && deletion, { actual: `Retention ${retention ? "mentioned" : "not mentioned"}; deletion ${deletion ? "mentioned" : "not mentioned"}`, ...inferred });
    }
  }
  return { privacyUrl: privacyLink?.href ?? null };
}
