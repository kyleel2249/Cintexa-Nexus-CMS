/**
 * Cloudflare Pages Function for /api/*
 * - Proxies to API_ORIGIN when set to a valid http(s) URL (the Express API; Nexus has no sign-in)
 * - Otherwise (unset OR not a valid URL) provides working stubs for sites and general settings
 *   so the SPA does not get empty/405/503 responses on POST/PUT in Settings.
 *   Stub data lives in the function isolate's memory only and is lost on redeploy/restart.
 */

type Env = { API_ORIGIN?: string };

const memorySites: any[] = [];
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data ?? {}), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
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
 * A common mistake is pasting a secret (such as an API key) into this variable. Anything that is not a valid
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
      aiFeatures: true,
    });
  }
  if (method === "GET" && subpath === "settings/whoami") {
    return json({ ip: request.headers.get("cf-connecting-ip") || "" });
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

  // Other settings GETs — empty safe defaults so UI does not crash
  if (method === "GET" && subpath === "settings/general") {
    return json({
      platformName: "CINTEXA CMS",
      supportEmail: "support@cintexa.com",
      maintenanceMode: false,
      aiFeatures: true,
    });
  }
  if (method === "GET" && subpath === "settings/security") {
    return json({
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
