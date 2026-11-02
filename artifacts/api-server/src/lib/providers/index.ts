import type { ProviderAdapter, ProviderId, ProviderValidateResult } from "./types";
import { openRouterAdapter } from "./openrouter";
import { stripKeyNoise } from "./types";

export * from "./types";
export { openRouterAdapter } from "./openrouter";

const adapters: Record<ProviderId, ProviderAdapter> = {
  openrouter: openRouterAdapter,
  // Placeholders for future adapters — they must not reuse OpenRouter rules.
  openai: {
    id: "openai",
    displayName: "OpenAI",
    normalizeKey: stripKeyNoise,
    async validateKey(raw): Promise<ProviderValidateResult> {
      const key = stripKeyNoise(raw);
      if (!key) return { ok: false, status: "not_configured", message: "No OpenAI API key provided." };
      try {
        const r = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (r.status === 401 || r.status === 403) {
          return { ok: false, status: "authentication_failed", message: `OpenAI rejected the key (HTTP ${r.status}).` };
        }
        if (r.status === 429) return { ok: false, status: "rate_limited", message: "OpenAI rate-limited the request." };
        if (!r.ok) return { ok: false, status: "provider_unavailable", message: `OpenAI returned HTTP ${r.status}.` };
        return { ok: true, status: "validated", message: "OpenAI API key is valid" };
      } catch (e: any) {
        return { ok: false, status: "network_error", message: e?.message || "OpenAI validation failed" };
      }
    },
  },
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic",
    normalizeKey: stripKeyNoise,
    async validateKey(raw): Promise<ProviderValidateResult> {
      const key = stripKeyNoise(raw);
      if (!key) return { ok: false, status: "not_configured", message: "No Anthropic API key provided." };
      // Anthropic uses x-api-key, not Bearer — never apply OpenRouter headers here.
      try {
        const r = await fetch("https://api.anthropic.com/v1/models", {
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
          signal: AbortSignal.timeout(15_000),
        });
        if (r.status === 401 || r.status === 403) {
          return { ok: false, status: "authentication_failed", message: `Anthropic rejected the key (HTTP ${r.status}).` };
        }
        if (r.status === 429) return { ok: false, status: "rate_limited", message: "Anthropic rate-limited the request." };
        if (!r.ok) return { ok: false, status: "provider_unavailable", message: `Anthropic returned HTTP ${r.status}.` };
        return { ok: true, status: "validated", message: "Anthropic API key is valid" };
      } catch (e: any) {
        return { ok: false, status: "network_error", message: e?.message || "Anthropic validation failed" };
      }
    },
  },
  generic_openai_compatible: openRouterAdapter, // fallback shape only for OpenRouter-compatible gateways
};

export function getProviderAdapter(id: ProviderId): ProviderAdapter {
  return adapters[id] ?? openRouterAdapter;
}

export async function validateProviderKey(
  id: ProviderId,
  rawKey: string,
  opts?: { signal?: AbortSignal },
): Promise<ProviderValidateResult> {
  return getProviderAdapter(id).validateKey(rawKey, opts);
}
