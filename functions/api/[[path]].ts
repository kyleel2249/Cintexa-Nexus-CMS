/**
 * Cloudflare Pages Function for /api/*
 * - Proxies to API_ORIGIN when set to a valid http(s) URL (the Express API; AUTH_MODE=open there means no sign-in is needed)
 * - Otherwise (unset OR not a valid URL) provides working stubs for sites, OpenRouter settings and API keys
 *   so the SPA does not get empty/405/503 responses on POST/PUT in Settings.
 *   Stub data lives in the function isolate's memory only and is lost on redeploy/restart.
 */

type Env = { API_ORIGIN?: string };

const memorySites: any[] = [];
const memoryKeys: any[] = [];
let openRouterStore: {
  apiKey: string;
  model: string;
  siteUrl: string;
  appName: string;
} = {
  apiKey: "",
  model: "openai/gpt-4o-mini",
  siteUrl: "https://cintexa.com",
  appName: "CINTEXA Nexus CMS",
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,x-api-key",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data ?? {}), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

function randomHex(bytes: number) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function maskKey(key: string) {
  if (!key) return { configured: false, prefix: null as string | null, length: 0 };
  return {
    configured: true,
    prefix: key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : "••••",
    length: key.length,
  };
}

function openRouterPublic() {
  return {
    ...maskKey(openRouterStore.apiKey),
    model: openRouterStore.model,
    siteUrl: openRouterStore.siteUrl,
    appName: openRouterStore.appName,
    source: openRouterStore.apiKey ? "settings" : "none",
  };
}

async function readJson(request: Request): Promise<any> {
  try {
    const text = await request.text();
    if (!text || !text.trim()) return {};
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/**
 * API_ORIGIN must be the base URL of the Express API, e.g. https://api.example.com (no /api suffix).
 * A common mistake is pasting a secret (such as an OpenRouter key) into this variable. Anything that is not a valid
 * http(s) URL is ignored here and is never echoed back to the browser.
 */
function validOrigin(raw: string | undefined): string {
  const v = (raw || "").trim().replace(/\/+$/, "");
  if (!v) return "";
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? v.replace(/\/api$/i, "") : "";
  } catch {
    return "";
  }
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    return json({ ok: true });
  }

  const pathParts = (params.path as string[] | string | undefined) || [];
  const subpath = Array.isArray(pathParts) ? pathParts.join("/") : String(pathParts || "");
  const origin = validOrigin(env.API_ORIGIN);

  if (origin) {
    const target = `${origin}/api/${subpath}${new URL(request.url).search}`;
    const headers = new Headers(request.headers);
    headers.delete("host");
    // Let the Express API build correct public links (intake share links, sitemap, robots.txt)
    const incoming = new URL(request.url);
    headers.set("x-forwarded-host", incoming.host);
    headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));
    const init: RequestInit = { method, headers, redirect: "manual" };
    if (method !== "GET" && method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }
    try {
      const upstream = await fetch(target, init);
      // Ensure JSON body for the SPA even if upstream is empty
      const text = await upstream.text();
      if (!text || !text.trim()) {
        // 204 / empty success must not be turned into an error
        return json(
          upstream.ok ? { ok: true } : { error: `Upstream ${upstream.status}` },
          upstream.ok ? 200 : upstream.status || 502,
        );
      }
      return new Response(text, {
        status: upstream.status,
        headers: {
          "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
        },
      });
    } catch {
      return json({ error: "The API server set in API_ORIGIN could not be reached." }, 502);
    }
  }

  // --- Minimal always-available endpoints (no backend configured) ---
  if (method === "GET" && (subpath === "healthz" || subpath === "healthz/")) {
    return json({ status: "ok", backend: false });
  }
  if (method === "GET" && subpath === "settings/public") {
    return json({
      platformName: "CINTEXA CMS",
      maintenanceMode: false,
      userRegistration: true,
      aiFeatures: true,
      passwordMinLength: 8,
      allowPasswordLogin: true,
      sessionTimeoutMinutes: 60,
    });
  }
  if (method === "GET" && subpath === "settings/whoami") {
    return json({ ip: request.headers.get("cf-connecting-ip") || "", role: "admin", email: null });
  }

  // --- Sites stub ---
  if (subpath === "sites" || subpath === "sites/") {
    if (method === "GET") return json(memorySites);
    if (method === "POST") {
      const body = await readJson(request);
      if (!body.name || !body.domain) return json({ error: "name and domain required" }, 400);
      const now = new Date().toISOString();
      const site = {
        id: Date.now(),
        name: String(body.name),
        domain: String(body.domain).replace(/\/$/, ""),
        description: body.description || null,
        status: "active",
        language: body.language || "en",
        timezone: body.timezone || "UTC",
        createdAt: now,
        updatedAt: now,
      };
      memorySites.unshift(site);
      return json(site, 201);
    }
  }

  if (subpath.startsWith("sites/") && method === "DELETE") {
    const id = Number(subpath.split("/")[1]);
    const idx = memorySites.findIndex((s) => s.id === id);
    if (idx >= 0) memorySites.splice(idx, 1);
    return json({ ok: true }, 200);
  }

  // --- OpenRouter settings (secret stored in function memory for this isolate) ---
  if (subpath === "settings/openrouter" || subpath === "settings/openrouter/") {
    if (method === "GET") {
      return json(openRouterPublic());
    }
    if (method === "PUT" || method === "POST") {
      const body = await readJson(request);
      if (typeof body.apiKey === "string" && body.apiKey.trim()) {
        let k = body.apiKey.trim();
        if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1).trim();
        if (k.toLowerCase().startsWith("bearer ")) k = k.slice(7).trim();
        openRouterStore.apiKey = k;
      }
      if (body.clearKey === true) {
        openRouterStore.apiKey = "";
      }
      if (typeof body.model === "string" && body.model.trim()) {
        openRouterStore.model = body.model.trim();
      }
      if (typeof body.siteUrl === "string") openRouterStore.siteUrl = body.siteUrl;
      if (typeof body.appName === "string") openRouterStore.appName = body.appName;
      return json({
        ...openRouterPublic(),
        message: body.clearKey ? "OpenRouter key cleared" : "OpenRouter settings saved",
      });
    }
  }

  if (subpath === "settings/openrouter/test" && method === "POST") {
    const body = await readJson(request);
    let key = "";
    if (typeof body?.apiKey === "string" && body.apiKey.trim()) {
      key = body.apiKey.trim();
    } else {
      key = openRouterStore.apiKey || "";
    }
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1).trim();
    if (key.toLowerCase().startsWith("bearer ")) key = key.slice(7).trim();
    if (!key) {
      return json({ ok: false, status: "not_configured", error: "No OpenRouter API key configured. Paste a key and click Test, or Save first." }, 400);
    }
    try {
      const r = await fetch("https://openrouter.ai/api/v1/auth/key", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (r.status === 401 || r.status === 403) {
        return json({
          ok: false,
          status: "authentication_failed",
          error: `OpenRouter rejected the key (HTTP ${r.status}). Check that it was copied in full and has not been revoked.`,
          hint: "Create a new key at https://openrouter.ai/keys and paste it without a Bearer prefix.",
        }, 400);
      }
      if (r.status === 402) {
        return json({ ok: false, status: "insufficient_credits", error: "OpenRouter account has insufficient credits.", hint: "Add credits at https://openrouter.ai/settings/credits" }, 400);
      }
      if (r.status === 429) {
        return json({ ok: false, status: "rate_limited", error: "OpenRouter rate-limited the validation request. Try again shortly." }, 400);
      }
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        return json({ ok: false, status: "provider_unavailable", error: `OpenRouter could not verify the key (HTTP ${r.status})`, detail: text.slice(0, 200) }, 502);
      }
      const info: any = await r.json().catch(() => null);
      const label = typeof info?.data?.label === "string" ? info.data.label : "";
      // Keep successful key in this isolate so subsequent AI calls work without another Save
      openRouterStore.apiKey = key;
      return json({
        ok: true,
        status: "validated",
        message: label ? `OpenRouter API key is valid (${label})` : "OpenRouter API key is valid",
        ...maskKey(key),
      });
    } catch (e: any) {
      return json({ ok: false, status: "network_error", error: e?.message || "Test failed" }, 500);
    }
  }

  // --- Application API keys stub (in-memory; accepted without any authentication) ---
  if (subpath === "settings/api-keys" || subpath === "settings/api-keys/") {
    if (method === "GET") return json(memoryKeys);
    if (method === "POST") {
      const body = await readJson(request);
      const days = Number(body.expiresInDays);
      const secret = `cxk_${randomHex(24)}`;
      const entry = {
        id: randomHex(8),
        name: String(body.name || "API key").trim().slice(0, 80) || "API key",
        prefix: secret.slice(0, 12),
        scopes: Array.isArray(body.scopes) && body.scopes.includes("write") ? ["read", "write"] : ["read"],
        createdAt: new Date().toISOString(),
        expiresAt: Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
        lastUsedAt: null,
      };
      memoryKeys.unshift(entry);
      return json({ ...entry, secret }, 201);
    }
  }
  if (subpath.startsWith("settings/api-keys/") && method === "DELETE") {
    const id = subpath.split("/")[2];
    const idx = memoryKeys.findIndex((k) => k.id === id);
    if (idx >= 0) memoryKeys.splice(idx, 1);
    return json({ ok: true }, 200);
  }

  // Other settings GETs — empty safe defaults so UI does not crash
  if (method === "GET" && subpath === "settings/general") {
    return json({
      platformName: "CINTEXA CMS",
      supportEmail: "support@cintexa.com",
      maintenanceMode: false,
      userRegistration: true,
      aiFeatures: true,
    });
  }
  if (method === "GET" && subpath === "settings/security") {
    return json({
      require2fa: false,
      sessionTimeoutMinutes: 60,
      passwordMinLength: 8,
      allowPasswordLogin: true,
      ipAllowlist: "",
      apiRateLimitPerMinute: 240,
    });
  }
  if (method === "GET" && subpath === "settings/webhooks") return json([]);
  if (method === "GET" && subpath === "settings/webhooks/events") {
    return json(["content.published", "content.scheduled", "form.submitted", "intake.submitted", "media.uploaded"]);
  }
  if (method === "PUT" && (subpath === "settings/general" || subpath === "settings/security")) {
    const body = await readJson(request);
    return json({ ...body, saved: true });
  }

  return json(
    {
      error: "API backend not configured",
      hint:
        "Deploy the Express API (see docs/website-intelligence/api-host-setup.md, or the Dockerfile and render.yaml at the repo root) and set API_ORIGIN in Cloudflare Pages -> Settings -> Environment variables to its base URL (https://..., without /api). Content, media, forms, SEO, webhooks and intake share links all need it.",
      path: subpath,
      method,
    },
    503,
  );
};
