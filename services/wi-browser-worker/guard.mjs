/**
 * Egress guard for the browser worker. Every request the browser makes is checked before it leaves:
 * scheme, port, and the resolved address of the host must all be public. Anything else is aborted.
 */
import dns from "node:dns/promises";
import net from "node:net";

const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    const mapped = v.match(/^(?:0:0:0:0:0:ffff:|::ffff:)(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^(fc|fd|fe[89ab]|ff|64:ff9b|2002:|2001:0?:|2001:db8)/.test(v);
  }
  return true;
}

let lookup = (host) => dns.lookup(host, { all: true });
export function setLookupForTests(fn) { lookup = fn ?? ((host) => dns.lookup(host, { all: true })); }

/** Resolves to { ok, reason }. Fails closed. */
export async function checkUrl(raw, { allowLoopbackForTests = false, __skipPort = false } = {}) {
  let u;
  try { u = new URL(raw); } catch { return { ok: false, reason: "invalid URL" }; }
  if (u.protocol === "data:" || u.protocol === "blob:") return { ok: true };
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: `scheme ${u.protocol} refused` };
  if (u.username || u.password) return { ok: false, reason: "credentials in URL" };
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  if (!(__skipPort && allowLoopbackForTests && process.env.NODE_ENV === "test") && !ALLOWED_PORTS.has(port)) return { ok: false, reason: `port ${port} refused` };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return isPrivateIp(host) && !(allowLoopbackForTests && host === "127.0.0.1") ? { ok: false, reason: "private address" } : { ok: true };
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) return { ok: false, reason: "internal hostname" };
  try {
    const answers = await lookup(host);
    if (!answers.length) return { ok: false, reason: "no DNS answer" };
    for (const a of answers) if (isPrivateIp(a.address) && !(allowLoopbackForTests && a.address === "127.0.0.1")) return { ok: false, reason: `resolves to private address ${a.address}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `DNS failure: ${e.code ?? e.message}` };
  }
}
