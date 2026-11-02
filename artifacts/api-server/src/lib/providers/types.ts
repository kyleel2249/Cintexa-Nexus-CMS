/** Shared types for AI / LLM provider adapters. */

export type ProviderId = "openrouter" | "openai" | "anthropic" | "generic_openai_compatible";

export type ConnectionStatus =
  | "not_configured"
  | "configured"
  | "validated"
  | "connected"
  | "authentication_failed"
  | "insufficient_credits"
  | "rate_limited"
  | "provider_unavailable"
  | "model_unavailable"
  | "network_error"
  | "error";

export interface ProviderValidateResult {
  ok: boolean;
  status: ConnectionStatus;
  message: string;
  detail?: string;
  hint?: string;
  /** Never the full secret — only a safe mask. */
  prefix?: string | null;
  length?: number;
}

export interface ProviderAdapter {
  id: ProviderId;
  displayName: string;
  /** Normalize a raw user-supplied key (strip Bearer / quotes / whitespace). */
  normalizeKey(raw: string): string;
  /** Perform a real, minimal auth check against the provider. Never reports success from format alone. */
  validateKey(key: string, opts?: { signal?: AbortSignal }): Promise<ProviderValidateResult>;
}

export function maskKey(key: string): { prefix: string | null; length: number; configured: boolean } {
  const k = String(key || "");
  if (!k) return { configured: false, prefix: null, length: 0 };
  return {
    configured: true,
    prefix: k.length > 8 ? `${k.slice(0, 4)}…${k.slice(-4)}` : "••••",
    length: k.length,
  };
}

export function stripKeyNoise(raw: string): string {
  let k = String(raw ?? "").trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1).trim();
  }
  if (k.toLowerCase().startsWith("bearer ")) k = k.slice(7).trim();
  return k;
}
