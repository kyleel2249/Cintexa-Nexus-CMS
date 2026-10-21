import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

export class SsrfError extends Error { code: string; constructor(code: string, msg: string) { super(msg); this.name = 'SsrfError'; this.code = code; } }

function v4ToInt(ip: string): number { return ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0; }
const V4_BLOCKS: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

export function isPrivateIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) {
    const n = v4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => { const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0; return (n & mask) === (v4ToInt(base) & mask); });
  }
  if (fam === 6) {
    const l = ip.toLowerCase();
    const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    const mappedHex = l.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) { const a = parseInt(mappedHex[1], 16), b = parseInt(mappedHex[2], 16); return isPrivateIp(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`); }
    if (l === '::' || l === '::1') return true;
    const first = parseInt(l.split(':')[0] || '0', 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || l.startsWith('64:ff9b:') || l.startsWith('2001:db8');
  }
  return true; // unknown format: fail closed
}

const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal', 'metadata', 'instance-data']);
export type Resolver = (host: string) => Promise<string[]>;
export const systemResolver: Resolver = async (h) => (await lookup(h, { all: true })).map((a) => a.address);

export interface UrlPolicy { allowedPorts?: number[]; resolve?: Resolver }
export interface ValidatedTarget { url: URL; ips: string[] }

/** Validates scheme, credentials, port, hostname and every resolved IP. Returns the validated IPs so a worker can pin the connection (prevents DNS rebinding). */
export async function validateTarget(raw: string, policy: UrlPolicy = {}): Promise<ValidatedTarget> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new SsrfError('invalid_url', 'URL could not be parsed'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SsrfError('bad_scheme', `scheme ${url.protocol} not allowed`);
  if (url.username || url.password) throw new SsrfError('credentials_in_url', 'credentials in URL are not allowed');
  const ports = policy.allowedPorts ?? [80, 443];
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!ports.includes(port)) throw new SsrfError('bad_port', `port ${port} not allowed`);
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal'))
    throw new SsrfError('blocked_host', `host ${host} not allowed`);
  const ips = isIP(host) ? [host] : await (policy.resolve ?? systemResolver)(host).catch(() => { throw new SsrfError('dns_failure', 'DNS resolution failed'); });
  if (!ips.length) throw new SsrfError('dns_failure', 'no addresses resolved');
  for (const ip of ips) if (isPrivateIp(ip)) throw new SsrfError('private_address', `host resolves to non-public address`);
  return { url, ips };
}

export interface FetchLike { (url: string, init: { redirect: 'manual'; signal: AbortSignal; pinnedIps: string[] }): Promise<Response> }
export interface SafeFetchOptions extends UrlPolicy { maxRedirects?: number; maxBytes?: number; timeoutMs?: number }

/** Follows redirects manually, re-validating every hop (scheme, DNS, IP). Enforces size and time limits. */
export async function safeFetch(raw: string, fetchFn: FetchLike, opts: SafeFetchOptions = {}): Promise<{ finalUrl: string; status: number; body: Uint8Array; headers: Headers }> {
  const maxRedirects = opts.maxRedirects ?? 5, maxBytes = opts.maxBytes ?? 2_000_000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 15_000);
  try {
    let current = raw;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const target = await validateTarget(current, opts);
      const res = await fetchFn(target.url.toString(), { redirect: 'manual', signal: ac.signal, pinnedIps: target.ips });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location') as string, target.url).toString();
        continue;
      }
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > maxBytes) throw new SsrfError('too_large', 'response exceeds size limit');
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      if (reader) for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new SsrfError('too_large', 'response exceeds size limit'); }
        chunks.push(value);
      }
      const body = new Uint8Array(size); let off = 0;
      for (const c of chunks) { body.set(c, off); off += c.byteLength; }
      return { finalUrl: target.url.toString(), status: res.status, body, headers: res.headers };
    }
    throw new SsrfError('too_many_redirects', 'redirect limit exceeded');
  } finally { clearTimeout(timer); }
}

const INJECTION_PATTERNS = [/ignore (all |any )?(previous|prior|above) (instructions|prompts)/i, /system prompt/i, /you are now/i, /reveal.*(key|secret|password|token)/i, /<\/?(system|assistant|tool)>/i];

/** Wraps untrusted website text for any prompt. Flags (does not obey) injection attempts. Tool use is decided by code, never by page text. */
export function wrapUntrusted(text: string, maxChars = 8000): { wrapped: string; injectionSuspected: boolean } {
  const clipped = text.slice(0, maxChars).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const injectionSuspected = INJECTION_PATTERNS.some((p) => p.test(clipped));
  return { wrapped: `<untrusted_website_content>\n${clipped.replace(/<\/untrusted_website_content>/gi, '')}\n</untrusted_website_content>`, injectionSuspected };
}
