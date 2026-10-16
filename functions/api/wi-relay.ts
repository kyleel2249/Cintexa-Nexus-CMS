/**
 * Website Intelligence fetch relay (Cloudflare Pages Function).
 * Stateless: no database, no storage. Lets the in-browser audit engine read other sites despite CORS.
 *
 *   GET /api/wi-relay?url=<https://target/>   Authorization: Bearer <Firebase ID token>
 *
 * - Requires a valid Firebase ID token (RS256 verified against Google's securetoken keys).
 * - GET/HEAD only; http/https; ports 80/443/8080/8443; literal private/loopback/link-local IPs and internal hostnames refused.
 * - Redirects are NOT followed: the client revalidates every hop through this same relay.
 * - Body is streamed through a size cap. Metadata is returned in x-wi-* response headers.
 * Env: FIREBASE_PROJECT_ID (default "cintexa-nexus"), WI_RELAY_ALLOWED_ORIGINS (optional, comma separated).
 */

type Env = { FIREBASE_PROJECT_ID?: string; WI_RELAY_ALLOWED_ORIGINS?: string };

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const UA = "CintexaWebsiteIntelligence/1.0 (+audit; read-only)";
const DEFAULT_MAX = 2_500_000;
const HARD_MAX = 5_000_000;
const TIMEOUT_MS = 20_000;
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

let jwksCache: { at: number; keys: Array<JsonWebKey & { kid: string }> } | null = null;

const b64u = (s: string): Uint8Array => {
  const p = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(p);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function loadKeys(force = false) {
  if (!force && jwksCache && Date.now() - jwksCache.at < 3_600_000) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error("jwks");
  const body = (await res.json()) as { keys: Array<JsonWebKey & { kid: string }> };
  jwksCache = { at: Date.now(), keys: body.keys };
  return body.keys;
}

export async function verifyFirebaseToken(token: string, projectId: string): Promise<{ uid: string; email?: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64u(parts[0]!))) as { alg?: string; kid?: string };
    const payload = JSON.parse(new TextDecoder().decode(b64u(parts[1]!))) as { aud?: string; iss?: string; sub?: string; exp?: number; iat?: number; email?: string };
    if (header.alg !== "RS256" || !header.kid) return null;
    const now = Math.floor(Date.now() / 1000);
    if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (!payload.sub || typeof payload.exp !== "number" || payload.exp < now - 30 || (payload.iat ?? 0) > now + 300) return null;
    let keys = await loadKeys();
    let jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) { keys = await loadKeys(true); jwk = keys.find((k) => k.kid === header.kid); }
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(parts[2]!), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    return ok ? { uid: payload.sub, email: payload.email } : null;
  } catch {
    return null;
  }
}

/** Literal-IP and internal-name guard. DNS names resolving to private space are not reachable from Cloudflare's edge. */
export function blockedHost(hostname: string): string | null {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h) return "empty host";
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan") || h.endsWith(".home.arpa")) return "internal hostname";
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0)) return "private address";
  }
  if (/^\d+$/.test(h) || /^0x[0-9a-f]+$/i.test(h)) return "numeric host";
  if (h.includes(":")) {
    if (h === "::" || h === "::1" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith("::ffff:") || h.startsWith("64:ff9b")) return "private address";
  }
  return null;
}

function cors(env: Env, request: Request): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  const allowed = (env.WI_RELAY_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const self = new URL(request.url).origin;
  const ok = !origin || origin === self || allowed.includes(origin);
  return {
    "access-control-allow-origin": ok && origin ? origin : self,
    "access-control-allow-headers": "authorization,content-type",
    "access-control-allow-methods": "GET,HEAD,OPTIONS",
    "access-control-expose-headers": "x-wi-status,x-wi-status-text,x-wi-final-url,x-wi-headers,x-wi-ttfb,x-wi-truncated,x-wi-bytes",
    vary: "origin",
  };
}

function fail(status: number, message: string, base: Record<string, string>) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...base, "content-type": "application/json", "cache-control": "no-store" } });
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const base = cors(env, request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: base });
  if (request.method !== "GET" && request.method !== "HEAD") return fail(405, "Only GET and HEAD are supported.", base);

  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return fail(401, "Sign in to run audits.", base);
  const user = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID || "cintexa-nexus");
  if (!user) return fail(401, "Your session is not valid. Sign in again.", base);

  const reqUrl = new URL(request.url);
  let target: URL;
  try { target = new URL(reqUrl.searchParams.get("url") ?? ""); } catch { return fail(400, "A valid url parameter is required.", base); }
  if (target.protocol !== "http:" && target.protocol !== "https:") return fail(400, "Only http and https targets are supported.", base);
  if (target.username || target.password) return fail(400, "Credentials in URLs are not allowed.", base);
  if (!ALLOWED_PORTS.has(target.port)) return fail(400, "That port is not allowed.", base);
  const why = blockedHost(target.hostname);
  if (why) return fail(403, `Target refused (${why}).`, base);
  if (target.hostname === reqUrl.hostname) return fail(403, "Target refused (relay loop).", base);

  const cap = Math.min(Math.max(Number(reqUrl.searchParams.get("max")) || DEFAULT_MAX, 1_000), HARD_MAX);
  const accept = reqUrl.searchParams.get("accept");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const started = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      method: request.method,
      redirect: "manual",
      signal: ctl.signal,
      headers: { "user-agent": UA, accept: accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5", "accept-language": "en" },
    });
  } catch (e) {
    clearTimeout(timer);
    return fail(502, ctl.signal.aborted ? "The target did not respond in time." : `Could not reach the target (${(e as Error).message.slice(0, 120)}).`, base);
  }
  const ttfb = Date.now() - started;

  const hdrs: Record<string, string[]> = {};
  upstream.headers.forEach((v, k) => { if (k !== "set-cookie") (hdrs[k] ??= []).push(v); });
  const sc = (upstream.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.();
  if (sc && sc.length) hdrs["set-cookie"] = sc;

  const out = new Headers(base);
  out.set("content-type", "application/octet-stream");
  out.set("cache-control", "no-store");
  out.set("x-wi-status", String(upstream.status));
  out.set("x-wi-status-text", encodeURIComponent(upstream.statusText || ""));
  out.set("x-wi-final-url", target.toString());
  out.set("x-wi-ttfb", String(ttfb));
  out.set("x-wi-headers", encodeURIComponent(JSON.stringify(hdrs)).slice(0, 16_000));

  if (request.method === "HEAD" || !upstream.body) { clearTimeout(timer); return new Response(null, { status: 200, headers: out }); }

  let seen = 0;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (seen >= cap) return;
      const room = cap - seen;
      controller.enqueue(chunk.byteLength > room ? chunk.slice(0, room) : chunk);
      seen += Math.min(chunk.byteLength, room);
      if (seen >= cap) { controller.terminate(); }
    },
    flush() { clearTimeout(timer); },
  });
  return new Response(upstream.body.pipeThrough(limiter), { status: 200, headers: out });
};
