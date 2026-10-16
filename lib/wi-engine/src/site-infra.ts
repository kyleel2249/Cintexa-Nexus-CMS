import { isIpLiteral } from "@workspace/wi-core";
import { Collector, ev, measured } from "./check";
import type { AuditContext } from "./context";
import { header, type SafeFetchResult } from "./net-types";
import { probeTls, resolvePublic, safeFetch } from "./ports";

export interface InfraOutcome {
  reachable: boolean;
  startUrl: string;
  httpsAvailable: boolean;
  homeFetch: SafeFetchResult | null;
  cdn: string | null;
  errorBody: string;
  homeSetCookies: string[];
}

const CDN_RULES: [RegExp, string, string][] = [
  [/cloudflare/i, "server", "Cloudflare"], [/./, "cf-ray", "Cloudflare"], [/./, "x-amz-cf-id", "Amazon CloudFront"], [/./, "x-vercel-id", "Vercel"],
  [/./, "x-nf-request-id", "Netlify"], [/fastly/i, "x-served-by", "Fastly"], [/./, "x-fastly-request-id", "Fastly"], [/akamai/i, "server", "Akamai"], [/./, "x-akamai-transformed", "Akamai"],
  [/./, "x-azure-ref", "Azure Front Door"], [/./, "x-bunny-cache", "Bunny CDN"], [/bunnycdn/i, "server", "Bunny CDN"], [/./, "x-sucuri-id", "Sucuri"], [/imperva|incapsula/i, "x-cdn", "Imperva"], [/./, "x-github-request-id", "GitHub Pages"], [/./, "x-goog-generation", "Google Cloud CDN"], [/gws|gse|esf/i, "server", "Google"],
];

export function detectCdn(r: Pick<SafeFetchResult, "headers">): string | null {
  for (const [re, name, label] of CDN_RULES) {
    const v = header(r, name);
    if (v !== null && re.test(v)) return label;
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runInfra(ctx: AuditContext, c: Collector): Promise<InfraOutcome> {
  const host = ctx.host;
  const out: InfraOutcome = { reachable: false, startUrl: ctx.cfg.url, httpsAvailable: false, homeFetch: null, cdn: null, errorBody: "", homeSetCookies: [] };
  const stageFail = (msg: string) => ctx.log("error", "reachability", msg);

  // DNS
  try {
    const r = await resolvePublic(host);
    c.pass("infra.dns.resolves", { actual: r.addresses.map((a) => a.address).join(", "), expected: "Public address(es)", evidence: [ev("text", "addresses", r.addresses.map((a) => a.address).join(", "))], ...measured });
  } catch (err) {
    const msg = (err as Error).message;
    c.fail("infra.dns.resolves", { actual: msg, expected: "Public address(es)", ...measured });
    stageFail(msg);
    return out;
  }

  const httpsOrigin = `https://${new URL(ctx.cfg.url).host}`;
  const httpOrigin = `http://${new URL(ctx.cfg.url).host}`;
  const scope = (u: URL) => ctx.cfg && (u.hostname.replace(/^www\./, "") === host.replace(/^www\./, "") || ctx.cfg.permittedHosts.some((h) => h === u.hostname));
  const opts = () => ({ ...ctx.fetchOpts(), scope });

  // HTTPS
  ctx.count.requests++;
  const https = await safeFetch(`${httpsOrigin}/`, { ...opts(), followRedirects: false });
  if (https.ok && https.status !== null) {
    out.httpsAvailable = true;
    c.pass("infra.https.available", { actual: `HTTPS responded with ${https.status}`, ...measured });
  } else {
    c.fail("infra.https.available", { actual: https.error?.message ?? "HTTPS request failed", expected: "A successful HTTPS response", ...measured });
  }

  // Follow the homepage fully (starting from the URL the user supplied)
  ctx.count.requests++;
  const home = await safeFetch(ctx.cfg.url, opts());
  out.homeFetch = home;
  if (!home.ok || home.status === null) {
    c.fail("infra.response.availability", { actual: home.error?.message ?? "No response", expected: "2xx or 3xx", ...measured });
    stageFail(home.error?.message ?? "No response");
    // still try the TLS probe: an expired certificate is the most common reason
    await tlsChecks(ctx, c);
    return out;
  }
  out.reachable = true;
  out.startUrl = home.finalUrl;
  out.cdn = detectCdn(home);
  { const sc = home.headers["set-cookie"]; out.homeSetCookies = Array.isArray(sc) ? sc : sc ? [sc] : []; }

  // redirect chain
  const hops = home.redirects.length;
  const insecureHop = home.redirects.some((h, i) => h.location.startsWith("http://") && (i > 0 || ctx.cfg.url.startsWith("https://")));
  const chainEv = home.redirects.slice(0, 5).map((h) => ev("status", String(h.status), `${h.url} -> ${h.location}`));
  if (insecureHop || hops >= 3) c.fail("infra.redirects.chain", { actual: `${hops} hop(s)${insecureHop ? ", includes an insecure URL" : ""}`, expected: "At most one hop", evidence: chainEv, ...measured });
  else if (hops === 2) c.warn("infra.redirects.chain", { actual: "2 hops", expected: "At most one hop", evidence: chainEv, ...measured });
  else c.pass("infra.redirects.chain", { actual: `${hops} hop(s)`, ...measured });
  if (home.redirects.some((h) => h.location.startsWith("http://") && h.url.startsWith("https://"))) c.fail("sec.insecure_redirect", { actual: "A redirect moves from https:// to http://", evidence: chainEv, ...measured });
  else c.pass("sec.insecure_redirect", { actual: "No https to http redirects", ...measured });

  // HTTP -> HTTPS
  ctx.count.requests++;
  const http = await safeFetch(`${httpOrigin}/`, { ...opts(), followRedirects: false, timeoutMs: 8000 });
  if (!out.httpsAvailable) c.na("infra.https.redirect", "HTTPS is not available.");
  else if (!http.ok || http.status === null) c.warn("infra.https.redirect", { actual: `http:// could not be reached (${http.error?.message ?? "no response"})`, expected: "301/308 redirect to https://", note: "Visitors who type the http:// address may not reach the site.", ...measured });
  else if (http.status >= 300 && http.status < 400 && /^https:\/\//i.test(header(http, "location") ?? "")) {
    if (http.status === 301 || http.status === 308) {
      ctx.count.requests++;
      const chain = await safeFetch(`${httpOrigin}/`, { ...opts(), maxRedirects: 4 });
      if (chain.redirects.length > 1) c.warn("infra.https.redirect", { actual: `Permanent redirect, but ${chain.redirects.length} hops`, expected: "One hop", ...measured });
      else c.pass("infra.https.redirect", { actual: `${http.status} to ${header(http, "location")}`, ...measured });
    } else c.warn("infra.https.redirect", { actual: `Temporary redirect (${http.status})`, expected: "301 or 308", ...measured });
  } else c.fail("infra.https.redirect", { actual: http.status >= 300 && http.status < 400 ? `Redirects to ${header(http, "location")}` : `http:// answers ${http.status} without redirecting`, expected: "301/308 redirect to https://", ...measured });

  // www vs apex
  const isWww = host.startsWith("www.");
  const other = isWww ? host.slice(4) : `www.${host}`;
  if (isIpLiteral(host) || host.split(".").length > (isWww ? 3 : 2) + 1) c.na("infra.host.canonical", "Host is a subdomain or an IP address.");
  else {
    try {
      await resolvePublic(other);
      ctx.count.requests++;
      const o = await safeFetch(`https://${other}/`, { ...ctx.fetchOpts(), followRedirects: false, timeoutMs: 8000, scope: () => true });
      if (!o.ok || o.status === null) c.pass("infra.host.canonical", { actual: `${other} does not serve content`, note: "Only one hostname variant responds.", ...measured });
      else if (o.status >= 300 && o.status < 400) c.pass("infra.host.canonical", { actual: `${other} redirects (${o.status}) to ${header(o, "location")}`, ...measured });
      else c.fail("infra.host.canonical", { actual: `${other} serves content (${o.status}) without redirecting`, expected: "Redirect to one canonical host", ...measured });
    } catch {
      c.pass("infra.host.canonical", { actual: `${other} does not resolve`, note: "Only one hostname variant exists.", ...measured });
    }
  }

  // availability / consistency (3 requests)
  const samples: { ok: boolean; ms: number }[] = [{ ok: home.status < 500, ms: home.totalMs ?? 0 }];
  for (let i = 0; i < 2; i++) {
    await sleep(350);
    ctx.count.requests++;
    const r = await safeFetch(home.finalUrl, { ...opts(), maxRedirects: 3 });
    samples.push({ ok: r.ok && r.status !== null && r.status < 500, ms: r.totalMs ?? 0 });
  }
  const okCount = samples.filter((s) => s.ok).length;
  const avail = { actual: `${okCount} of 3 requests succeeded`, expected: "All succeed", evidence: [ev("measurement", "response times", samples.map((s) => `${s.ms} ms`).join(", "))], ...measured };
  if (okCount === 3) c.pass("infra.response.availability", avail);
  else if (okCount === 2) c.warn("infra.response.availability", avail);
  else c.fail("infra.response.availability", avail);
  const times = samples.filter((s) => s.ok).map((s) => s.ms).filter((n) => n > 0);
  if (times.length < 2) c.inconclusive("infra.response.consistency", "Fewer than two successful timed responses.");
  else {
    const mx = Math.max(...times), mn = Math.min(...times);
    c.check("infra.response.consistency", mx < 1800 && mx / Math.max(mn, 1) < 2.5, { actual: `Fastest ${mn} ms, slowest ${mx} ms`, expected: "Slowest under 1.8 s and under 2.5x the fastest", ...measured });
  }

  // custom error page
  ctx.count.requests++;
  const probe = `${new URL(home.finalUrl).origin}/cintexa-nx-audit-${Math.random().toString(36).slice(2, 10)}`;
  const nf = await safeFetch(probe, { ...opts(), maxRedirects: 3 });
  out.errorBody = nf.body.toString("utf8").slice(0, 30_000);
  if (!nf.ok || nf.status === null) c.inconclusive("infra.errorpage.status", `The probe request failed (${nf.error?.message ?? "no response"}).`);
  else if (nf.status === 404 || nf.status === 410) c.pass("infra.errorpage.status", { actual: `HTTP ${nf.status}`, ...measured });
  else if (nf.status === 200 || (nf.redirects.length && new URL(nf.finalUrl).pathname === "/")) c.fail("infra.errorpage.status", { actual: nf.redirects.length ? "Unknown URLs redirect to the homepage" : "Unknown URLs return 200 (soft 404)", expected: "404 or 410", evidence: [ev("url", "probe", probe)], ...measured });
  else c.inconclusive("infra.errorpage.status", `Unknown URL returned ${nf.status}, which may be an access-control response.`);

  if (out.cdn) c.pass("infra.cdn.detected", { actual: out.cdn, ...measured });
  else c.fail("infra.cdn.detected", { actual: "No CDN response headers observed", note: "A CDN may exist without exposing identifying headers.", provenance: "inferred", confidence: "low" });

  await tlsChecks(ctx, c);
  return out;
}

async function tlsChecks(ctx: AuditContext, c: Collector): Promise<void> {
  const probe = await probeTls(ctx.host, 443, 10_000);
  if (probe.unsupported) {
    const why = "Certificate inspection is not possible from a browser; run the audit from the API server to test the TLS certificate, expiry and protocol.";
    c.notTested("infra.tls.certificate", why);
    c.notTested("infra.tls.expiry", why);
    c.notTested("infra.tls.protocol", why);
    return;
  }
  if (!probe.reachable) {
    const msg = probe.error ?? "The TLS handshake did not complete.";
    c.fail("infra.tls.certificate", { actual: msg, expected: "A trusted, valid certificate", ...measured });
    c.inconclusive("infra.tls.expiry", `Certificate details unavailable: ${msg}`);
    c.inconclusive("infra.tls.protocol", `Protocol unavailable: ${msg}`);
    return;
  }
  const evid = [ev("text", "subject", probe.subject ?? "-"), ev("text", "issuer", probe.issuer ?? "-"), ev("text", "valid to", probe.validTo ?? "-")];
  if (probe.authorized && probe.hostnameMatches !== false) c.pass("infra.tls.certificate", { actual: `Trusted certificate for ${probe.subject ?? ctx.host}, issued by ${probe.issuer ?? "unknown"}`, evidence: evid, ...measured });
  else c.fail("infra.tls.certificate", { actual: probe.authorizationError ?? (probe.hostnameMatches === false ? "Certificate does not match the hostname" : "Certificate not trusted"), expected: "A trusted certificate valid for this hostname", evidence: evid, ...measured });
  if (probe.daysRemaining === null) c.inconclusive("infra.tls.expiry", "Expiry date not provided by the server.");
  else if (probe.daysRemaining > 30) c.pass("infra.tls.expiry", { actual: `${probe.daysRemaining} days remain`, evidence: evid, ...measured });
  else if (probe.daysRemaining > 7) c.warn("infra.tls.expiry", { actual: `${probe.daysRemaining} days remain`, expected: "More than 30 days", evidence: evid, ...measured });
  else c.fail("infra.tls.expiry", { actual: probe.daysRemaining < 0 ? `Expired ${-probe.daysRemaining} day(s) ago` : `${probe.daysRemaining} days remain`, expected: "More than 30 days", evidence: evid, ...measured });
  c.check("infra.tls.protocol", probe.protocol === "TLSv1.2" || probe.protocol === "TLSv1.3", { actual: probe.protocol ?? "unknown", expected: "TLS 1.2 or 1.3", ...measured });
}

