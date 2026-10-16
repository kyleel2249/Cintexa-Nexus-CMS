/**
 * Browser transport for local mode.
 *  - Page requests go through the stateless relay (Cloudflare Pages Function), which strips CORS and cannot reach private networks.
 *  - DNS is answered by DNS-over-HTTPS, so private-address answers are still refused.
 *  - TLS certificates cannot be inspected from a browser: probeTls reports `unsupported`, never a failure.
 *  - The relay's runtime decodes bodies, so transfer sizes are not observable (transferObservable=false).
 */
import type { NetPort } from "../ports";
import { classifyIp, isIpLiteral, screenHostname } from "@workspace/wi-core";
import { BlockedTargetError, ENGINE_USER_AGENT, type BodyBytes, type RedirectHop, type SafeFetchOptions, type SafeFetchResult, type TlsProbe } from "../net-types";

export const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

export interface RelayNetOptions {
  /** Absolute or same-origin URL of the relay, e.g. "/api/wi-relay". */
  relayUrl: string;
  /** Returns a fresh Firebase ID token. */
  getToken(): Promise<string | null>;
  fetchImpl?: typeof fetch;
  dohUrl?: string;
}

/** Uint8Array with a UTF-8 toString(), matching the Node Buffer surface the engine relies on. */
export class Bytes extends Uint8Array implements BodyBytes {
  override toString(encoding?: string): string {
    if (encoding === "hex") return Array.from(this, (b) => b.toString(16).padStart(2, "0")).join("");
    if (encoding === "base64") { let s = ""; for (const b of this) s += String.fromCharCode(b); return btoa(s); }
    return new TextDecoder("utf-8").decode(this);
  }
  static wrap(u: Uint8Array): Bytes { return new Bytes(u.buffer as ArrayBuffer, u.byteOffset, u.byteLength); }
}

function empty(url: string, error: SafeFetchResult["error"]): SafeFetchResult {
  return { ok: false, requestedUrl: url, finalUrl: url, status: null, headers: {}, body: new Bytes(0), transferBytes: 0, truncated: false, redirects: [], ttfbMs: null, totalMs: null, contentEncoding: null, remoteIp: null, tlsProtocol: null, transferObservable: false, error };
}

async function readCapped(res: Response, cap: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0; let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > cap) { chunks.push(value.subarray(0, cap - size)); size = cap; truncated = true; await reader.cancel().catch(() => undefined); break; }
    chunks.push(value); size += value.byteLength;
  }
  const out = new Uint8Array(size); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return { bytes: out, truncated };
}

export function createRelayNet(opts: RelayNetOptions): NetPort {
  const doFetch: typeof fetch = (...a) => (opts.fetchImpl ?? fetch)(...a);
  const doh = opts.dohUrl ?? "https://cloudflare-dns.com/dns-query";
  const dnsCache = new Map<string, { at: number; addresses: { address: string; family: 4 | 6 }[] }>();

  async function lookup(hostname: string): Promise<{ address: string; family: 4 | 6 }[]> {
    const hit = dnsCache.get(hostname);
    if (hit && Date.now() - hit.at < 60_000) return hit.addresses;
    const q = async (type: "A" | "AAAA") => {
      const res = await doFetch(`${doh}?name=${encodeURIComponent(hostname)}&type=${type}`, { headers: { accept: "application/dns-json" } });
      if (!res.ok) throw Object.assign(new Error(`DNS lookup failed (HTTP ${res.status})`), { code: "DNS_ERROR" });
      return (await res.json()) as { Status: number; Answer?: { type: number; data: string }[] };
    };
    const [a, aaaa] = await Promise.all([q("A"), q("AAAA").catch(() => ({ Status: 0, Answer: [] as { type: number; data: string }[] }))]);
    if (a.Status === 3 && aaaa.Status === 3) throw Object.assign(new Error("DNS lookup failed (ENOTFOUND)"), { code: "ENOTFOUND" });
    const addresses = [
      ...(a.Answer ?? []).filter((x) => x.type === 1).map((x) => ({ address: x.data, family: 4 as const })),
      ...(aaaa.Answer ?? []).filter((x) => x.type === 28).map((x) => ({ address: x.data, family: 6 as const })),
    ];
    if (!addresses.length) throw Object.assign(new Error("DNS lookup returned no addresses"), { code: "ENODATA" });
    dnsCache.set(hostname, { at: Date.now(), addresses });
    return addresses;
  }

  async function resolvePublic(hostname: string) {
    const clean = hostname.replace(/^\[|\]$/g, "");
    const screen = screenHostname(clean);
    if (!screen.allowed) throw new BlockedTargetError(`Blocked host: ${screen.reason}`);
    if (isIpLiteral(clean)) {
      const v = classifyIp(clean);
      if (!v.allowed) throw new BlockedTargetError(`Blocked address: ${v.reason}`);
      return { addresses: [{ address: clean, family: (clean.includes(":") ? 6 : 4) as 4 | 6 }] };
    }
    const addresses = await lookup(clean);
    for (const a of addresses) {
      const v = classifyIp(a.address);
      if (!v.allowed) throw new BlockedTargetError(`Blocked: ${clean} resolves to a non-public address (${v.reason})`);
    }
    return { addresses };
  }

  async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
    const method = options.method ?? "GET";
    const timeoutMs = options.timeoutMs ?? 15_000;
    const maxBytes = Math.min(options.maxBytes ?? 2 * 1024 * 1024, 5_000_000);
    const maxRedirects = options.followRedirects === false ? 0 : (options.maxRedirects ?? 8);
    const redirects: RedirectHop[] = [];
    const started = Date.now();
    let current = rawUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      let url: URL;
      try { url = new URL(current); } catch { return { ...empty(rawUrl, { code: "BAD_URL", message: "Invalid URL", blocked: true }), redirects }; }
      if (url.protocol !== "http:" && url.protocol !== "https:") return { ...empty(rawUrl, { code: "BLOCKED_TARGET", message: `Blocked scheme ${url.protocol}`, blocked: true }), redirects };
      if (url.username || url.password) return { ...empty(rawUrl, { code: "BLOCKED_TARGET", message: "Credentials in URL are not allowed", blocked: true }), redirects };
      const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
      if (!ALLOWED_PORTS.has(port)) return { ...empty(rawUrl, { code: "BLOCKED_TARGET", message: `Blocked port ${port}`, blocked: true }), redirects };
      if (hop > 0 && options.scope && !options.scope(url)) return { ...empty(rawUrl, { code: "OUT_OF_SCOPE", message: `Redirect to ${url.hostname} is outside the audit scope`, blocked: true }), finalUrl: current, redirects };
      if (options.signal?.aborted) return { ...empty(rawUrl, { code: "ECANCELLED", message: "The request was cancelled.", blocked: false }), redirects };
      if (Date.now() - started > timeoutMs * 2) return { ...empty(rawUrl, { code: "ETIMEDOUT", message: "The request timed out.", blocked: false }), redirects };
      try {
        await resolvePublic(url.hostname);
        const token = await opts.getToken();
        if (!token) return { ...empty(rawUrl, { code: "UNAUTHENTICATED", message: "Sign in to run audits.", blocked: false }), redirects };
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeoutMs);
        const onAbort = () => ctl.abort();
        options.signal?.addEventListener("abort", onAbort, { once: true });
        try {
          const qs = new URLSearchParams({ url: current, max: String(maxBytes) });
          const accept = options.headers && Object.entries(options.headers).find(([k]) => k.toLowerCase() === "accept")?.[1];
          if (accept) qs.set("accept", accept);
          const t0 = Date.now();
          const res = await doFetch(`${opts.relayUrl}?${qs}`, { method, headers: { authorization: `Bearer ${token}` }, signal: ctl.signal });
          if (!res.headers.has("x-wi-status")) {
            let msg = `Relay returned HTTP ${res.status}`;
            try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* keep default */ }
            const blocked = res.status === 403 || res.status === 400;
            return { ...empty(rawUrl, { code: res.status === 401 ? "UNAUTHENTICATED" : blocked ? "BLOCKED_TARGET" : "RELAY_ERROR", message: msg, blocked }), finalUrl: current, redirects };
          }
          const status = Number(res.headers.get("x-wi-status"));
          const headerObj = JSON.parse(decodeURIComponent(res.headers.get("x-wi-headers") ?? "{}")) as Record<string, string[]>;
          const headers: SafeFetchResult["headers"] = {};
          for (const [k, v] of Object.entries(headerObj)) headers[k] = k === "set-cookie" ? v : v.join(", ");
          const location = typeof headers.location === "string" ? headers.location : undefined;
          if (status >= 300 && status < 400 && location && options.followRedirects !== false) {
            const next = new URL(location, url).toString();
            redirects.push({ url: current, status, location: next });
            if (redirects.length > maxRedirects) return { ...empty(rawUrl, { code: "TOO_MANY_REDIRECTS", message: "Too many redirects", blocked: false }), redirects, finalUrl: next, status };
            if (redirects.some((h, i) => redirects.findIndex((x) => x.url === h.url) !== i)) return { ...empty(rawUrl, { code: "REDIRECT_LOOP", message: "Redirect loop detected", blocked: false }), redirects, finalUrl: next, status };
            await res.body?.cancel().catch(() => undefined);
            current = next;
            continue;
          }
          const { bytes, truncated } = method === "HEAD" ? { bytes: new Uint8Array(0), truncated: false } : await readCapped(res, maxBytes);
          return {
            ok: true, requestedUrl: rawUrl, finalUrl: current, status, headers, body: Bytes.wrap(bytes), transferBytes: bytes.byteLength, truncated, redirects,
            ttfbMs: Number(res.headers.get("x-wi-ttfb")) || null, totalMs: Date.now() - t0 + (t0 - started), contentEncoding: null, remoteIp: null, tlsProtocol: null, transferObservable: false,
          };
        } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort); }
      } catch (err) {
        if (err instanceof BlockedTargetError) return { ...empty(rawUrl, { code: "BLOCKED_TARGET", message: err.message, blocked: true }), finalUrl: current, redirects };
        const e = err as Error & { code?: string; name: string };
        if (options.signal?.aborted) return { ...empty(rawUrl, { code: "ECANCELLED", message: "The request was cancelled.", blocked: false }), finalUrl: current, redirects };
        if (e.name === "AbortError") return { ...empty(rawUrl, { code: "ETIMEDOUT", message: "The request timed out.", blocked: false }), finalUrl: current, redirects };
        return { ...empty(rawUrl, { code: e.code ?? "ERROR", message: e.message || "Request failed", blocked: false }), finalUrl: current, redirects };
      }
    }
    return { ...empty(rawUrl, { code: "TOO_MANY_REDIRECTS", message: "Too many redirects", blocked: false }), redirects };
  }

  async function probeTls(): Promise<TlsProbe> {
    return { reachable: false, authorized: false, authorizationError: null, protocol: null, cipher: null, validFrom: null, validTo: null, daysRemaining: null, subject: null, issuer: null, altNames: [], hostnameMatches: null, selfSigned: false, unsupported: true };
  }

  async function gunzip(bytes: Uint8Array, maxOutput: number): Promise<Uint8Array> {
    const ds = new DecompressionStream("gzip");
    const copy = new Uint8Array(bytes);
    const stream = new Blob([copy]).stream().pipeThrough(ds);
    const reader = stream.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxOutput) { await reader.cancel().catch(() => undefined); throw new Error("Decompressed payload is too large"); }
      chunks.push(value);
    }
    const out = new Uint8Array(size); let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.byteLength; }
    return out;
  }

  return { safeFetch, resolvePublic, probeTls, gunzip };
}

export { ENGINE_USER_AGENT };
