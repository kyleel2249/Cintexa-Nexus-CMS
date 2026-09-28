/**
 * Cloudflare Pages Function for /api/*
 * - Proxies to API_ORIGIN when set
 * - Otherwise provides working stubs for sites + OpenRouter settings
 *   so the SPA does not get empty/405 responses on POST/PUT
 */

type Env = { API_ORIGIN?: string };

const memorySites: any[] = [];
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

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data ?? {}), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
    },
  });
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

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    return json({ ok: true });
  }

  const pathParts = (params.path as string[] | string | undefined) || [];
  const subpath = Array.isArray(pathParts) ? pathParts.join("/") : String(pathParts || "");
  const origin = (env.API_ORIGIN || "").replace(/\/$/, "");

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
        return json(
          upstream.ok ? { ok: true } : { error: `Upstream ${upstream.status}` },
          upstream.status || 502,
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
    } catch (e: any) {
      return json({ error: e?.message || "Upstream API unreachable" }, 502);
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
        openRouterStore.apiKey = body.apiKey.trim();
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
    if (!openRouterStore.apiKey) {
      return json({ ok: false, error: "No OpenRouter API key configured" }, 400);
    }
    try {
      const r = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${openRouterStore.apiKey}` },
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        return json(
          { ok: false, error: `OpenRouter rejected the key (${r.status})`, detail: text.slice(0, 200) },
          400,
        );
      }
      return json({ ok: true, message: "OpenRouter API key is valid" });
    } catch (e: any) {
      return json({ ok: false, error: e?.message || "Test failed" }, 500);
    }
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
    });
  }
  if (method === "GET" && subpath === "settings/api-keys") return json([]);
  if (method === "GET" && subpath === "settings/webhooks") return json([]);
  if (method === "PUT" && (subpath === "settings/general" || subpath === "settings/security")) {
    const body = await readJson(request);
    return json({ ...body, saved: true });
  }

  return json(
    {
      error: "API backend not configured",
      hint:
        "Deploy the Express API (see DEPLOYMENT.md) and set API_ORIGIN in Cloudflare Pages -> Settings -> Environment variables to its base URL, without /api. Content, media, forms, SEO, API keys, webhooks and intake share links all need it.",
      path: subpath,
      method,
    },
    503,
  );
};
