import { pool, ensureSchema } from "@workspace/db";

/**
 * Tiny JSON key/value store on top of the `platform_settings` table.
 * Used for general/security settings, API keys, webhooks and webhook deliveries.
 * A short in-process cache keeps the auth/security middleware cheap.
 */

const CACHE_MS = 5_000;
const cache = new Map<string, { at: number; value: unknown }>();

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  await ensureSchema(pool);
  const r = await pool.query(`SELECT value FROM platform_settings WHERE key = $1`, [key]);
  let value: unknown = fallback;
  if (r.rows[0]) {
    try {
      value = JSON.parse(r.rows[0].value);
    } catch {
      value = fallback;
    }
  }
  cache.set(key, { at: Date.now(), value });
  return value as T;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await ensureSchema(pool);
  await pool.query(
    `INSERT INTO platform_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)],
  );
  cache.set(key, { at: Date.now(), value });
}

export const DEFAULT_GENERAL = {
  platformName: "CINTEXA CMS",
  supportEmail: "support@cintexa.com",
  maintenanceMode: false,
  userRegistration: true,
  aiFeatures: true,
};

export const DEFAULT_SECURITY = {
  require2fa: false,
  sessionTimeoutMinutes: 60,
  passwordMinLength: 8,
  allowPasswordLogin: true,
  ipAllowlist: "",
  apiRateLimitPerMinute: 240,
};

export type GeneralSettings = typeof DEFAULT_GENERAL;
export type SecuritySettings = typeof DEFAULT_SECURITY;

export type StoredApiKey = {
  id: string;
  name: string;
  prefix: string;
  hash: string; // sha256 of the secret - the plaintext secret is never stored
  scopes: Array<"read" | "write">;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt?: string | null;
};

export type StoredWebhook = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  secret: string;
  description?: string;
  createdAt: string;
  lastStatus?: number | null;
  lastDeliveryAt?: string | null;
  failureCount?: number;
};
