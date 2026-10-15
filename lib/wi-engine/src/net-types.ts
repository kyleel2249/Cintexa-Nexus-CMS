/** Network contract shared by the Node transport (API server) and the browser transport (relay). No runtime dependencies. */

export class BlockedTargetError extends Error {
  readonly code = "BLOCKED_TARGET";
  constructor(message: string) {
    super(message);
    this.name = "BlockedTargetError";
  }
}

export interface ResolvedHost {
  addresses: { address: string; family: 4 | 6 }[];
}

export interface RedirectHop {
  url: string;
  status: number;
  location: string;
}

export interface FetchAuth {
  headerName: string;
  value: string;
  pathPrefixes: string[];
  origin: string;
}

export interface SafeFetchOptions {
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Return false to refuse a redirect target (host scope). */
  scope?: (url: URL) => boolean;
  auth?: FetchAuth | null;
  userAgent?: string;
  signal?: AbortSignal;
  followRedirects?: boolean;
}

/** Response bytes. A Node Buffer satisfies this; the browser transport supplies a Uint8Array subclass with a UTF-8 toString(). */
export interface BodyBytes extends Uint8Array {
  toString(encoding?: string): string;
}

export interface SafeFetchResult {
  ok: boolean;
  requestedUrl: string;
  finalUrl: string;
  status: number | null;
  headers: Record<string, string | string[] | undefined>;
  body: BodyBytes;
  /** Bytes received on the wire (compressed). When transferObservable is false this equals the decoded size. */
  transferBytes: number;
  truncated: boolean;
  redirects: RedirectHop[];
  ttfbMs: number | null;
  totalMs: number | null;
  contentEncoding: string | null;
  remoteIp: string | null;
  tlsProtocol: string | null;
  /** False when the transport cannot see the transfer encoding (the relay's runtime decodes bodies), so compression must not be judged. */
  transferObservable?: boolean;
  error?: { code: string; message: string; blocked: boolean };
}

export interface TlsProbe {
  reachable: boolean;
  authorized: boolean;
  authorizationError: string | null;
  protocol: string | null;
  cipher: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysRemaining: number | null;
  subject: string | null;
  issuer: string | null;
  altNames: string[];
  hostnameMatches: boolean | null;
  selfSigned: boolean;
  /** True when this runtime cannot inspect certificates at all (browser local mode). Never reported as a failure. */
  unsupported?: boolean;
  error?: string;
}

export const ENGINE_USER_AGENT = "CINTEXA-NEXUS-WebsiteIntelligence/1.0 (+https://cintexa.com/website-intelligence; passive audit)";

export function header(r: Pick<SafeFetchResult, "headers">, name: string): string | null {
  const v = r.headers[name.toLowerCase()];
  if (Array.isArray(v)) return v.join(", ");
  return v ?? null;
}
