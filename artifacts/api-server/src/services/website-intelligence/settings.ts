import { getSetting, setSetting } from "../../lib/platform-settings";
import { mergeSettings, normalizeStoredSettings, type WiSettings } from "@workspace/wi-engine/settings";

export { DEFAULT_WI_SETTINGS, hostAllowed, sanitizeLimits, type WiSettings } from "@workspace/wi-engine/settings";

export async function loadWiSettings(): Promise<WiSettings> {
  return normalizeStoredSettings(await getSetting<Partial<WiSettings>>("website_intelligence", {}));
}

export async function saveWiSettings(patch: Partial<WiSettings>): Promise<{ ok: true; settings: WiSettings } | { ok: false; error: string }> {
  const merged = mergeSettings(await loadWiSettings(), patch);
  if (!merged.ok) return merged;
  await setSetting("website_intelligence", merged.settings);
  return merged;
}
