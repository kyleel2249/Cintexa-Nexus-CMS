import { PROFILE_PRESETS, WEBSITE_TYPES, defaultModules, parseAuditUrl, screenHostname, type AuditConfig, type AuditLimits, type AuditModules, type AuditProfile, type Device, type WebsiteType, MODULE_KEYS } from "@workspace/wi-core";

export interface ConfigResult { ok: boolean; cfg?: AuditConfig; credential?: string; error?: string; field?: string }

const str = (v: unknown, max = 500): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const int = (v: unknown, lo: number, hi: number, d: number): number => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };

/** Validates and normalises the body of POST /v1/website-audits. Pure: no network or database access. */
export function normalizeConfig(body: Record<string, any>, limits: AuditLimits, opts: { userEmail: string; allowAuthenticated: boolean }): ConfigResult {
  const parsed = parseAuditUrl(String(body?.url ?? ""));
  if (!parsed.ok || !parsed.url) return { ok: false, error: parsed.error, field: "url" };
  const a = body.authorization ?? {};
  if (a.confirmed !== true) return { ok: false, error: "You must confirm that you own the website or are authorised to audit it.", field: "authorization" };
  const profile: AuditProfile = (["standard", "comprehensive", "advanced"] as const).includes(body.profile) ? body.profile : "standard";
  const preset = PROFILE_PRESETS[profile];
  const websiteType: WebsiteType = (WEBSITE_TYPES as readonly string[]).includes(body.websiteType) ? body.websiteType : "corporate";
  const modules: AuditModules = { ...defaultModules() };
  if (body.modules && typeof body.modules === "object") for (const k of MODULE_KEYS) if (typeof body.modules[k] === "boolean") modules[k] = body.modules[k];
  if (!Object.values(modules).some(Boolean)) return { ok: false, error: "Enable at least one audit module.", field: "modules" };
  const devices: Device[] = Array.isArray(body.devices) ? ([...new Set(body.devices.filter((d: unknown) => d === "mobile" || d === "desktop"))] as Device[]) : preset.devices;
  const origin = parsed.url.origin;
  const important: string[] = [];
  for (const raw of Array.isArray(body.importantPages) ? body.importantPages.slice(0, 25) : []) {
    try { const u = new URL(String(raw), origin); if (u.hostname.replace(/^www\./, "") === parsed.url.hostname.replace(/^www\./, "")) important.push(u.toString()); } catch { /* ignore */ }
  }
  const permitted: string[] = [];
  for (const raw of Array.isArray(body.permittedHosts) ? body.permittedHosts.slice(0, 10) : []) {
    const h = String(raw).trim().toLowerCase();
    const v = screenHostname(h);
    if (!v.allowed) return { ok: false, error: `Permitted host "${h}" is not allowed (${v.reason}).`, field: "permittedHosts" };
    permitted.push(h);
  }
  const auth = body.authenticated ?? {};
  let credential: string | undefined;
  const authenticated = { enabled: false, confirmed: false, allowedPathPrefixes: [] as string[], headerName: "Authorization", credentialSupplied: false };
  if (auth.enabled === true) {
    if (!opts.allowAuthenticated) return { ok: false, error: "Authenticated testing is disabled by the platform administrator.", field: "authenticated" };
    if (auth.confirmed !== true) return { ok: false, error: "Authenticated testing needs a separate, explicit confirmation.", field: "authenticated" };
    const prefixes = (Array.isArray(auth.allowedPathPrefixes) ? auth.allowedPathPrefixes : []).map((p: unknown) => String(p).trim()).filter((p: string) => p.startsWith("/") && p.length > 1 && !p.includes(".."));
    if (!prefixes.length) return { ok: false, error: "List at least one allowed path prefix (for example /account/) for authenticated testing.", field: "authenticated" };
    const header = String(auth.headerName ?? "Authorization").trim();
    if (!/^[A-Za-z0-9-]{1,40}$/.test(header) || /^(host|content-length|transfer-encoding|connection)$/i.test(header)) return { ok: false, error: "Invalid credential header name.", field: "authenticated" };
    credential = str(auth.credential, 4000);
    if (!credential) return { ok: false, error: "Supply the credential to use for the authenticated scope. It is kept in memory only and never stored.", field: "authenticated" };
    Object.assign(authenticated, { enabled: true, confirmed: true, allowedPathPrefixes: prefixes.slice(0, 10), headerName: header, credentialSupplied: true });
  }
  const cfg: AuditConfig = {
    url: parsed.url.toString(),
    name: str(body.name, 120),
    websiteType,
    objective: str(body.objective, 500),
    market: str(body.market, 200),
    audience: str(body.audience, 300),
    language: str(body.language, 40),
    importantPages: important,
    maxDepth: Math.min(int(body.maxDepth, 0, 12, preset.maxDepth), limits.maxDepth),
    maxPages: Math.min(int(body.maxPages, 1, 1000, preset.maxPages), limits.maxPages),
    concurrency: Math.min(int(body.concurrency, 1, 12, 4), limits.maxConcurrency),
    devices: devices.length ? devices : preset.devices,
    profile,
    modules,
    externalLinkCheck: typeof body.externalLinkCheck === "boolean" ? body.externalLinkCheck : preset.externalLinkCheck,
    permittedHosts: permitted,
    authenticated,
    report: { language: str(body.report?.language, 20) ?? "en", brandName: str(body.report?.brandName, 120), confidentiality: str(body.report?.confidentiality, 200) },
    authorization: { confirmed: true, statement: str(a.statement, 400) ?? "I own this website or am authorised by its owner to audit it.", confirmedBy: opts.userEmail, confirmedAt: new Date().toISOString() },
  };
  return { ok: true, cfg, credential };
}
