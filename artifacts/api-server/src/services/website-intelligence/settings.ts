import { CATEGORY_IDS, DEFAULT_LIMITS, DEFAULT_WEIGHTS, validateWeights, type AuditLimits, type CategoryId } from "@workspace/wi-core";
import { getSetting, setSetting } from "../../lib/platform-settings";

export interface WiSettings {
  weights: Record<CategoryId, number>;
  limits: AuditLimits;
  /** When true, only administrators can create audits against hosts outside `allowedHosts` (empty = any public host). */
  allowedHosts: string[];
  blockedHosts: string[];
  aiExplanations: boolean;
  allowAuthenticatedScope: boolean;
  allowPublicShare: boolean;
}

export const DEFAULT_WI_SETTINGS: WiSettings = { weights: { ...DEFAULT_WEIGHTS }, limits: { ...DEFAULT_LIMITS }, allowedHosts: [], blockedHosts: [], aiExplanations: true, allowAuthenticatedScope: false, allowPublicShare: true };

const LIMIT_BOUNDS: Record<keyof AuditLimits, [number, number]> = {
  maxPages: [1, 1000], maxDepth: [0, 12], maxConcurrency: [1, 12], maxDurationMs: [30_000, 60 * 60 * 1000], requestTimeoutMs: [2000, 60_000], maxResponseBytes: [64 * 1024, 10 * 1024 * 1024],
  maxScreenshots: [0, 50], maxExternalLinks: [0, 200], maxAssetProbes: [0, 200], perHostDelayMs: [0, 5000], maxActiveAuditsPerUser: [1, 20], maxAuditsPerUserPerHour: [1, 200], maxGlobalConcurrentAudits: [1, 10], retentionDays: [7, 3650],
};

export function sanitizeLimits(input: Partial<AuditLimits> | undefined): AuditLimits {
  const out = { ...DEFAULT_LIMITS };
  for (const k of Object.keys(LIMIT_BOUNDS) as (keyof AuditLimits)[]) {
    const v = input?.[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.min(LIMIT_BOUNDS[k][1], Math.max(LIMIT_BOUNDS[k][0], Math.round(v)));
  }
  return out;
}

export async function loadWiSettings(): Promise<WiSettings> {
  const stored = await getSetting<Partial<WiSettings>>("website_intelligence", {});
  const weights = { ...DEFAULT_WEIGHTS };
  for (const id of CATEGORY_IDS) if (typeof stored.weights?.[id] === "number") weights[id] = stored.weights[id] as number;
  return {
    weights: validateWeights(weights).ok ? weights : { ...DEFAULT_WEIGHTS },
    limits: sanitizeLimits(stored.limits),
    allowedHosts: (stored.allowedHosts ?? []).map((h) => h.toLowerCase()),
    blockedHosts: (stored.blockedHosts ?? []).map((h) => h.toLowerCase()),
    aiExplanations: stored.aiExplanations ?? true,
    allowAuthenticatedScope: stored.allowAuthenticatedScope ?? false,
    allowPublicShare: stored.allowPublicShare ?? true,
  };
}

export async function saveWiSettings(patch: Partial<WiSettings>): Promise<{ ok: true; settings: WiSettings } | { ok: false; error: string }> {
  const cur = await loadWiSettings();
  const next: WiSettings = { ...cur, ...patch, weights: { ...cur.weights, ...(patch.weights ?? {}) }, limits: sanitizeLimits({ ...cur.limits, ...(patch.limits ?? {}) }) };
  const v = validateWeights(next.weights);
  if (!v.ok) return { ok: false, error: v.error ?? "Invalid weights" };
  next.allowedHosts = (next.allowedHosts ?? []).map((h) => String(h).toLowerCase().trim()).filter(Boolean);
  next.blockedHosts = (next.blockedHosts ?? []).map((h) => String(h).toLowerCase().trim()).filter(Boolean);
  await setSetting("website_intelligence", next);
  return { ok: true, settings: next };
}

export function hostAllowed(host: string, s: Pick<WiSettings, "allowedHosts" | "blockedHosts">): { ok: boolean; reason?: string } {
  const h = host.toLowerCase().replace(/^www\./, "");
  const matches = (list: string[]) => list.some((x) => { const y = x.replace(/^www\./, "").replace(/^\*\./, ""); return h === y || h.endsWith(`.${y}`); });
  if (matches(s.blockedHosts)) return { ok: false, reason: "This host is on the platform block list." };
  if (s.allowedHosts.length && !matches(s.allowedHosts)) return { ok: false, reason: "Audits are restricted to an approved host list and this host is not on it." };
  return { ok: true };
}
