import { pool, ensureSchema } from "@workspace/db";

/**
 * Tiny JSON key/value store on top of the `platform_settings` table.
 * Used for general/security settings, API keys, webhooks and webhook deliveries.
 * A short in-process cache keeps the auth/security middleware cheap.
 *
 * If the database is unreachable (DATABASE_URL missing, cold start, outage) the store falls back to process memory so that
 * saving settings and API keys never fails outright. Memory-only values are lost on restart; a warning is logged.
 */

const CACHE_MS = 5_000;
const cache = new Map<string, { at: number; value: unknown }>();
/** Values written while the database was unavailable (source of truth until the DB answers again). */
const memoryStore = new Map<string, unknown>();

function warnOnce(msg: string, err: unknown) {
  // eslint-disable-next-line no-console
  console.warn(`[platform-settings] ${msg}`, err instanceof Error ? err.message : err);
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  let value: unknown = fallback;
  try {
    await ensureSchema(pool);
    const r = await pool.query(`SELECT value FROM platform_settings WHERE key = $1`, [key]);
    if (r.rows[0]) {
      try {
        value = JSON.parse(r.rows[0].value);
      } catch {
        value = fallback;
      }
      memoryStore.delete(key);
    } else if (memoryStore.has(key)) {
      value = memoryStore.get(key);
    }
  } catch (err) {
    warnOnce(`database unavailable, reading "${key}" from memory`, err);
    if (memoryStore.has(key)) value = memoryStore.get(key);
  }
  cache.set(key, { at: Date.now(), value });
  return value as T;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  cache.set(key, { at: Date.now(), value });
  try {
    await ensureSchema(pool);
    await pool.query(
      `INSERT INTO platform_settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(value)],
    );
    memoryStore.delete(key);
  } catch (err) {
    warnOnce(`database unavailable, "${key}" kept in memory only`, err);
    memoryStore.set(key, value);
  }
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
