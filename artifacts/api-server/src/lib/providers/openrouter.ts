import type { ProviderAdapter, ProviderValidateResult } from "./types";
import { maskKey, stripKeyNoise } from "./types";

/**
 * OpenRouter adapter.
 * Auth: Authorization: Bearer <key>
 * Validation: GET https://openrouter.ai/api/v1/auth/key  (NOT /models — that endpoint is public).
 */
export const openRouterAdapter: ProviderAdapter = {
  id: "openrouter",
  displayName: "OpenRouter",

  normalizeKey(raw: string) {
    return stripKeyNoise(raw);
  },

  async validateKey(raw: string, opts?: { signal?: AbortSignal }): Promise<ProviderValidateResult> {
    const key = stripKeyNoise(raw);
    if (!key) {
      return {
        ok: false,
        status: "not_configured",
        message: "No OpenRouter API key provided.",
        hint: "Paste a key from https://openrouter.ai/keys",
      };
    }
    try {
      const r = await fetch("https://openrouter.ai/api/v1/auth/key", {
        headers: { Authorization: `Bearer ${key}` },
        signal: opts?.signal ?? AbortSignal.timeout(15_000),
      });
      if (r.status === 401 || r.status === 403) {
        return {
          ok: false,
          status: "authentication_failed",
          message: `OpenRouter rejected the key (HTTP ${r.status}).`,
          hint: "Check the key was copied in full and has not been revoked. Do not include a Bearer prefix.",
          ...maskKey(key),
        };
      }
      if (r.status === 402) {
        return {
          ok: false,
          status: "insufficient_credits",
          message: "OpenRouter account has insufficient credits.",
          hint: "Add credits at https://openrouter.ai/settings/credits",
          ...maskKey(key),
        };
      }
      if (r.status === 429) {
        return {
          ok: false,
          status: "rate_limited",
          message: "OpenRouter rate-limited the validation request.",
          hint: "Wait a minute and try again.",
          ...maskKey(key),
        };
      }
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        return {
          ok: false,
          status: "provider_unavailable",
          message: `OpenRouter could not verify the key (HTTP ${r.status}).`,
          detail: text.slice(0, 200),
          ...maskKey(key),
        };
      }
      const info: any = await r.json().catch(() => null);
      const label = typeof info?.data?.label === "string" ? info.data.label : "";
      return {
        ok: true,
        status: "validated",
        message: label ? `OpenRouter API key is valid (${label})` : "OpenRouter API key is valid",
        ...maskKey(key),
      };
    } catch (e: any) {
      const network =
        e?.name === "TimeoutError" ||
        e?.code === "ENOTFOUND" ||
        e?.cause?.code === "ENOTFOUND" ||
        e?.message === "fetch failed";
      return {
        ok: false,
        status: network ? "network_error" : "error",
        message: e?.name === "TimeoutError" ? "OpenRouter did not answer in time" : e?.message || "Validation failed",
      };
    }
  },
};
