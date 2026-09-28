import OpenAI from "openai";
import { pool } from "@workspace/db";

const SETTINGS_KEY = "openrouter";

let tableReady: Promise<void> | null = null;

async function ensureSettingsTable() {
  if (!tableReady) {
    tableReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS platform_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL DEFAULT '{}',
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
      `)
      .then(() => undefined)
      .catch((e) => {
        tableReady = null;
        throw e;
      });
  }
  return tableReady;
}

export type OpenRouterSettings = {
  apiKey: string;
  model: string;
  siteUrl: string;
  appName: string;
};

/** Process-local fallback when DATABASE_URL is unavailable */
let memoryFallback: OpenRouterSettings | null = null;

const defaults: OpenRouterSettings = {
  apiKey: "",
  model: "openai/gpt-4o-mini",
  siteUrl: "https://cintexa.com",
  appName: "CINTEXA Nexus CMS",
};

/** Resolve OpenRouter API key: Settings store first, then process.env. */
export async function resolveOpenRouterApiKey(): Promise<string | null> {
  try {
    await ensureSettingsTable();
    const r = await pool.query(`SELECT value FROM platform_settings WHERE key = $1`, [SETTINGS_KEY]);
    if (r.rows[0]?.value) {
      const parsed = JSON.parse(r.rows[0].value) as Partial<OpenRouterSettings>;
      const fromSettings = String(parsed.apiKey || "").trim();
      if (fromSettings) return fromSettings;
    }
  } catch (err) {
    console.warn("[openrouter] could not read settings key", err);
  }
  const fromEnv = String(process.env.OPENROUTER_API_KEY || "").trim();
  return fromEnv || null;
}

export async function getOpenRouterSettings(): Promise<OpenRouterSettings> {
  try {
    await ensureSettingsTable();
    const r = await pool.query(`SELECT value FROM platform_settings WHERE key = $1`, [SETTINGS_KEY]);
    if (r.rows[0]?.value) {
      const parsed = JSON.parse(r.rows[0].value) as Partial<OpenRouterSettings>;
      return {
        apiKey: String(parsed.apiKey || ""),
        model: String(parsed.model || defaults.model),
        siteUrl: String(parsed.siteUrl || defaults.siteUrl),
        appName: String(parsed.appName || defaults.appName),
      };
    }
  } catch {
    /* use defaults + env */
  }
  if (memoryFallback) return { ...memoryFallback };
  return {
    ...defaults,
    apiKey: String(process.env.OPENROUTER_API_KEY || ""),
  };
}

export async function setOpenRouterSettings(patch: Partial<OpenRouterSettings>) {
  const current = await getOpenRouterSettings();
  const next: OpenRouterSettings = {
    apiKey: patch.apiKey !== undefined ? String(patch.apiKey).trim() : current.apiKey,
    model: patch.model !== undefined ? String(patch.model).trim() || defaults.model : current.model,
    siteUrl: patch.siteUrl !== undefined ? String(patch.siteUrl).trim() || defaults.siteUrl : current.siteUrl,
    appName: patch.appName !== undefined ? String(patch.appName).trim() || defaults.appName : current.appName,
  };
  try {
    await ensureSettingsTable();
    await pool.query(
      `INSERT INTO platform_settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [SETTINGS_KEY, JSON.stringify(next)],
    );
  } catch (err) {
    console.warn("[openrouter] DB save failed, using process memory", err);
    memoryFallback = next;
  }
  memoryFallback = next;
  return next;
}

/** Public status only — never return the full secret. */
export function maskApiKey(key: string | null | undefined) {
  const k = String(key || "");
  if (!k) return { configured: false, prefix: null as string | null, length: 0 };
  return {
    configured: true,
    prefix: k.length > 8 ? `${k.slice(0, 4)}…${k.slice(-4)}` : "••••",
    length: k.length,
  };
}

export async function getOpenRouterClient(): Promise<OpenAI | null> {
  const settings = await getOpenRouterSettings();
  const apiKey = settings.apiKey || process.env.OPENROUTER_API_KEY || "";
  if (!apiKey.trim()) return null;
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: apiKey.trim(),
    defaultHeaders: {
      "HTTP-Referer": settings.siteUrl || "https://cintexa.com",
      "X-Title": settings.appName || "CINTEXA Nexus CMS",
    },
  });
}

export async function getOpenRouterModel(): Promise<string> {
  const s = await getOpenRouterSettings();
  return s.model || defaults.model;
}
