import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import zlib from "node:zlib";
import { classifyIp, isIpLiteral, screenHostname } from "@workspace/wi-core";
import { BlockedTargetError, ENGINE_USER_AGENT, header, type FetchAuth, type RedirectHop, type ResolvedHost, type SafeFetchOptions, type SafeFetchResult, type TlsProbe } from "@workspace/wi-engine/net-types";

export { BlockedTargetError, ENGINE_USER_AGENT, header };
export type { FetchAuth, RedirectHop, ResolvedHost, SafeFetchOptions, SafeFetchResult, TlsProbe };

/**
 * SSRF-safe HTTP client used by every network operation of the Website Intelligence engine.
 *
 *  - the hostname is screened by name, then resolved, and EVERY returned address must be public;
 *  - the validated address is pinned through a custom `lookup`, so DNS rebinding between the
 *    check and the connection is impossible;
 *  - redirects are followed manually and every hop is re-validated (scheme, port, host, scope);
 *  - response size, decompressed size, time and redirect count are bounded;
 *  - credentials are attached only to requests inside an explicitly authorised scope.
 */

export const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

export type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;

const defaultResolver: Resolver = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });
let resolver: Resolver = defaultResolver;
/** Test hook: lets the security tests simulate DNS rebinding and internal answers without network access. */
let testAllowLoopback = false;
export function setResolverForTests(r: Resolver | null, opts: { allowLoopback?: boolean } = {}): void {
  resolver = r ?? defaultResolver;
  // Only honoured under NODE_ENV=test so a loopback fixture server can be audited by the integration tests.
  testAllowLoopback = Boolean(r && opts.allowLoopback && process.env.NODE_ENV === "test");
}

/** Resolves a hostname and refuses it when any answer is non-public. */
export async function resolvePublic(hostname: string): Promise<ResolvedHost> {
  const clean = hostname.replace(/^\[|\]$/g, "");
  const screen = screenHostname(clean);
  if (!screen.allowed) throw new BlockedTargetError(`Blocked host: ${screen.reason}`);
  if (isIpLiteral(clean)) {
    const v = classifyIp(clean);
    if (!v.allowed) throw new BlockedTargetError(`Blocked address: ${v.reason}`);
    return { addresses: [{ address: clean, family: net.isIPv6(clean) ? 6 : 4 }] };
  }
  let answers: { address: string; family: number }[];
  try {
    answers = await resolver(clean);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    throw Object.assign(new Error(`DNS lookup failed (${e.code ?? "error"})`), { code: e.code ?? "DNS_ERROR" });
  }
  if (!answers.length) throw Object.assign(new Error("DNS lookup returned no addresses"), { code: "ENODATA" });
  for (const a of answers) {
    const v = classifyIp(a.address);
    if (!v.allowed && !(testAllowLoopback && (a.address === "127.0.0.1" || a.address === "::1"))) throw new BlockedTargetError(`Blocked: ${clean} resolves to a non-public address (${v.reason})`);
  }
  return { addresses: answers.map((a) => ({ address: a.address, family: (a.family === 6 ? 6 : 4) as 4 | 6 })) };
}

interface SingleResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  transferBytes: number;
  truncated: boolean;
  ttfbMs: number;
  totalMs: number;
  remoteIp: string | null;
  tlsProtocol: string | null;
}

function pinnedLookup(addresses: ResolvedHost["addresses"]) {
  return (_hostname: string, options: unknown, callback: (...args: any[]) => void) => {
    const wantsAll = typeof options === "object" && options !== null && (options as { all?: boolean }).all === true;
    if (wantsAll) callback(null, addresses.map((a) => ({ address: a.address, family: a.family })));
    else callback(null, addresses[0].address, addresses[0].family);
  };
}

function requestOnce(url: URL, resolved: ResolvedHost, opts: Required<Pick<SafeFetchOptions, "method" | "timeoutMs" | "maxBytes">> & { headers: Record<string, string>; signal?: AbortSignal }): Promise<SingleResponse> {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const ms = () => Number((process.hrtime.bigint() - started) / 1_000_000n);
    const isHttps = url.protocol === "https:";
    const mod = isHttps ? https : http;
    let settled = false;
    const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: opts.method,
        headers: opts.headers,
        agent: false,
        lookup: pinnedLookup(resolved.addresses) as any,
        servername: isIpLiteral(url.hostname) ? undefined : url.hostname.replace(/^\[|\]$/g, ""),
        rejectUnauthorized: true,
      },
      (res) => {
        const ttfb = ms();
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase().trim();
        let transfer = 0;
        let size = 0;
        let truncated = false;
        const chunks: Buffer[] = [];
        let stream: NodeJS.ReadableStream = res;
        const decoder = opts.method === "HEAD" ? null : encoding === "gzip" || encoding === "x-gzip" ? zlib.createGunzip() : encoding === "br" ? zlib.createBrotliDecompress() : encoding === "deflate" ? zlib.createInflate() : null;
        res.on("data", (c: Buffer) => { transfer += c.length; });
        if (decoder) {
          stream = res.pipe(decoder);
          decoder.on("error", () => finish(() => resolve(build())));
        }
        const build = (): SingleResponse => ({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
          transferBytes: transfer,
          truncated,
          ttfbMs: ttfb,
          totalMs: ms(),
          remoteIp: res.socket?.remoteAddress ?? null,
          tlsProtocol: isHttps ? ((res.socket as tls.TLSSocket).getProtocol?.() ?? null) : null,
        });
        stream.on("data", (c: Buffer) => {
          if (truncated) return;
          size += c.length;
          if (size > opts.maxBytes) {
            truncated = true;
            chunks.push(c.subarray(0, Math.max(0, c.length - (size - opts.maxBytes))));
            req.destroy();
            finish(() => resolve(build()));
            return;
          }
          chunks.push(c);
        });
        stream.on("end", () => finish(() => resolve(build())));
        stream.on("error", () => finish(() => resolve(build())));
        res.on("error", (e) => finish(() => reject(e)));
      },
    );
    const timer = setTimeout(() => { req.destroy(Object.assign(new Error("Request timed out"), { code: "ETIMEDOUT" })); }, opts.timeoutMs);
    const onAbort = () => req.destroy(Object.assign(new Error("Cancelled"), { code: "ECANCELLED" }));
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    req.on("error", (e) => finish(() => reject(e)));
    req.end();
  });
}

function emptyResult(url: string, error: SafeFetchResult["error"]): SafeFetchResult {
  return { ok: false, requestedUrl: url, finalUrl: url, status: null, headers: {}, body: Buffer.alloc(0), transferBytes: 0, truncated: false, redirects: [], ttfbMs: null, totalMs: null, contentEncoding: null, remoteIp: null, tlsProtocol: null, error };
}

function describeError(err: unknown): { code: string; message: string; blocked: boolean } {
  if (err instanceof BlockedTargetError) return { code: "BLOCKED_TARGET", message: err.message, blocked: true };
  const e = err as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
  const code = e.code ?? e.cause?.code ?? "ERROR";
  const map: Record<string, string> = {
    ENOTFOUND: "The hostname could not be resolved.",
    ENODATA: "The hostname has no address records.",
    ECONNREFUSED: "The connection was refused.",
    ECONNRESET: "The connection was reset.",
    ETIMEDOUT: "The request timed out.",
    ECANCELLED: "The request was cancelled.",
    CERT_HAS_EXPIRED: "The TLS certificate has expired.",
    DEPTH_ZERO_SELF_SIGNED_CERT: "The TLS certificate is self-signed.",
    SELF_SIGNED_CERT_IN_CHAIN: "The certificate chain contains a self-signed certificate.",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "The TLS certificate chain could not be verified.",
    ERR_TLS_CERT_ALTNAME_INVALID: "The TLS certificate does not match the hostname.",
  };
  return { code, message: map[code] ?? e.message ?? "Request failed", blocked: false };
}

/** Fetches a URL with full SSRF protection and bounded resource use. Never throws: failures are returned in `error`. */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const maxRedirects = options.followRedirects === false ? 0 : (options.maxRedirects ?? 8);
  const redirects: RedirectHop[] = [];
  let current = rawUrl;
  let totalStart = Date.now();
  const deadline = totalStart + timeoutMs * 2;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      return { ...emptyResult(rawUrl, { code: "BAD_URL", message: "Invalid URL", blocked: true }), redirects };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return { ...emptyResult(rawUrl, { code: "BLOCKED_TARGET", message: `Blocked scheme ${url.protocol}`, blocked: true }), redirects };
    if (url.username || url.password) return { ...emptyResult(rawUrl, { code: "BLOCKED_TARGET", message: "Credentials in URL are not allowed", blocked: true }), redirects };
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    if (!ALLOWED_PORTS.has(port)) return { ...emptyResult(rawUrl, { code: "BLOCKED_TARGET", message: `Blocked port ${port}`, blocked: true }), redirects };
    if (hop > 0 && options.scope && !options.scope(url)) {
      return { ...emptyResult(rawUrl, { code: "OUT_OF_SCOPE", message: `Redirect to ${url.hostname} is outside the audit scope`, blocked: true }), finalUrl: current, redirects };
    }
    if (Date.now() > deadline) return { ...emptyResult(rawUrl, { code: "ETIMEDOUT", message: "Request timed out", blocked: false }), redirects };
    try {
      const resolved = await resolvePublic(url.hostname);
      const headers: Record<string, string> = {
        "user-agent": options.userAgent ?? ENGINE_USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        "accept-encoding": "gzip, deflate, br",
        "accept-language": "en",
        ...Object.fromEntries(Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
      };
      const a = options.auth;
      if (a && url.origin === a.origin && a.pathPrefixes.some((p) => url.pathname.startsWith(p))) headers[a.headerName.toLowerCase()] = a.value;
      const r = await requestOnce(url, resolved, { method, timeoutMs, maxBytes, headers, signal: options.signal });
      const location = r.headers.location;
      if (r.status >= 300 && r.status < 400 && location && options.followRedirects !== false) {
        const next = new URL(location, url).toString();
        redirects.push({ url: current, status: r.status, location: next });
        if (redirects.length > maxRedirects) return { ...emptyResult(rawUrl, { code: "TOO_MANY_REDIRECTS", message: "Too many redirects", blocked: false }), redirects, finalUrl: next, status: r.status };
        if (redirects.some((h, i) => redirects.findIndex((x) => x.url === h.url) !== i)) return { ...emptyResult(rawUrl, { code: "REDIRECT_LOOP", message: "Redirect loop detected", blocked: false }), redirects, finalUrl: next, status: r.status };
        current = next;
        continue;
      }
      const enc = String(r.headers["content-encoding"] ?? "").toLowerCase().trim() || null;
      return {
        ok: true,
        requestedUrl: rawUrl,
        finalUrl: current,
        status: r.status,
        headers: r.headers as SafeFetchResult["headers"],
        body: r.body,
        transferBytes: r.transferBytes,
        truncated: r.truncated,
        redirects,
        ttfbMs: r.ttfbMs,
        totalMs: Date.now() - totalStart,
        contentEncoding: enc,
        remoteIp: r.remoteIp,
        tlsProtocol: r.tlsProtocol,
      };
    } catch (err) {
      return { ...emptyResult(rawUrl, describeError(err)), finalUrl: current, redirects };
    }
  }
  return { ...emptyResult(rawUrl, { code: "TOO_MANY_REDIRECTS", message: "Too many redirects", blocked: false }), redirects };
}

/** Inspects the TLS handshake without sending an HTTP request. The address is validated before connecting. */
export async function probeTls(hostname: string, port = 443, timeoutMs = 10_000): Promise<TlsProbe> {
  const empty: TlsProbe = { reachable: false, authorized: false, authorizationError: null, protocol: null, cipher: null, validFrom: null, validTo: null, daysRemaining: null, subject: null, issuer: null, altNames: [], hostnameMatches: null, selfSigned: false };
  let resolved: ResolvedHost;
  try {
    resolved = await resolvePublic(hostname);
  } catch (err) {
    return { ...empty, error: (err as Error).message };
  }
  return new Promise((resolve) => {
    const socket = tls.connect({
      host: hostname,
      port,
      servername: isIpLiteral(hostname) ? undefined : hostname,
      rejectUnauthorized: false,
      lookup: pinnedLookup(resolved.addresses) as any,
      timeout: timeoutMs,
    });
    const done = (r: TlsProbe) => { socket.destroy(); resolve(r); };
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      const validTo = cert?.valid_to ? new Date(cert.valid_to) : null;
      const validFrom = cert?.valid_from ? new Date(cert.valid_from) : null;
      const alt = String(cert?.subjectaltname ?? "").split(",").map((s) => s.trim().replace(/^DNS:/, "")).filter(Boolean);
      let match: boolean | null = null;
      try { match = cert && Object.keys(cert).length ? tls.checkServerIdentity(hostname, cert) === undefined : null; } catch { match = null; }
      const subject = cert?.subject?.CN ? String(cert.subject.CN) : null;
      const issuer = cert?.issuer?.CN ? String(cert.issuer.CN) : cert?.issuer?.O ? String(cert.issuer.O) : null;
      done({
        reachable: true,
        authorized: socket.authorized,
        authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
        protocol: socket.getProtocol(),
        cipher: socket.getCipher()?.name ?? null,
        validFrom: validFrom?.toISOString() ?? null,
        validTo: validTo?.toISOString() ?? null,
        daysRemaining: validTo ? Math.floor((validTo.getTime() - Date.now()) / 86_400_000) : null,
        subject,
        issuer,
        altNames: alt.slice(0, 20),
        hostnameMatches: match,
        selfSigned: (() => {
          const issuerCert = (cert as unknown as { issuerCertificate?: { fingerprint256?: string } }).issuerCertificate;
          const err = socket.authorizationError as unknown;
          return Boolean(issuerCert?.fingerprint256 && cert.fingerprint256 === issuerCert.fingerprint256) || String(err) === "DEPTH_ZERO_SELF_SIGNED_CERT";
        })(),
      });
    });
    socket.once("error", (e) => done({ ...empty, error: describeError(e).message }));
    socket.once("timeout", () => done({ ...empty, error: "TLS handshake timed out" }));
  });
}
