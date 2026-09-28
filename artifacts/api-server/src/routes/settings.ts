import { Router } from "express";
import { randomBytes } from "crypto";
import {
  getOpenRouterSettings,
  setOpenRouterSettings,
  maskApiKey,
  resolveOpenRouterApiKey,
} from "../lib/openrouter";
import {
  DEFAULT_GENERAL,
  DEFAULT_SECURITY,
  getSetting,
  setSetting,
  type StoredApiKey,
  type StoredWebhook,
} from "../lib/platform-settings";
import { requireAdmin, sha256, isIpAllowed } from "../lib/auth-middleware";
import {
  WEBHOOK_EVENTS,
  assertSafeWebhookUrl,
  deliverToHook,
  type WebhookDelivery,
} from "../lib/webhooks";

const router = Router();

const fail = (res: any, e: any, status = 500) => res.status(status).json({ error: e?.message || "Request failed" });

function publicKey(k: StoredApiKey) {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    scopes: k.scopes ?? ["read"],
    createdAt: k.createdAt,
    expiresAt: k.expiresAt ?? null,
    lastUsedAt: k.lastUsedAt ?? null,
    revokedAt: k.revokedAt ?? null,
    // the full secret / hash is never returned
  };
}

function publicHook(h: StoredWebhook, revealSecret = false) {
  return {
    ...h,
    secret: revealSecret ? h.secret : `${h.secret.slice(0, 10)}…`,
  };
}

/** Public (no auth): flags the login/register screens and public sites need. */
router.get("/public", async (_req, res) => {
  try {
    const g = { ...DEFAULT_GENERAL, ...(await getSetting<Partial<typeof DEFAULT_GENERAL>>("general", {})) };
    const s = { ...DEFAULT_SECURITY, ...(await getSetting<Partial<typeof DEFAULT_SECURITY>>("security", {})) };
    res.json({
      platformName: g.platformName,
      maintenanceMode: g.maintenanceMode,
      userRegistration: g.userRegistration,
      aiFeatures: g.aiFeatures,
      passwordMinLength: s.passwordMinLength,
      allowPasswordLogin: s.allowPasswordLogin,
      sessionTimeoutMinutes: s.sessionTimeoutMinutes,
    });
  } catch (e) {
    fail(res, e);
  }
});

/** Who am I / which IP does the API see - used by the Security tab to avoid IP allow-list lock-outs. */
router.get("/whoami", (req, res) => {
  res.json({
    ip: (req.ip || req.socket.remoteAddress || "").replace(/^::ffff:/, ""),
    role: req.auth?.role ?? null,
    email: req.auth?.email ?? null,
  });
});

router.get("/general", async (_req, res) => {
  try {
    res.json({ ...DEFAULT_GENERAL, ...(await getSetting<Partial<typeof DEFAULT_GENERAL>>("general", {})) });
  } catch (e) {
    fail(res, e);
  }
});

router.put("/general", requireAdmin, async (req, res) => {
  try {
    const b = req.body ?? {};
    const current = { ...DEFAULT_GENERAL, ...(await getSetting<Partial<typeof DEFAULT_GENERAL>>("general", {})) };
    const next = {
      platformName: typeof b.platformName === "string" && b.platformName.trim() ? b.platformName.trim().slice(0, 120) : current.platformName,
      supportEmail: typeof b.supportEmail === "string" ? b.supportEmail.trim().slice(0, 200) : current.supportEmail,
      maintenanceMode: typeof b.maintenanceMode === "boolean" ? b.maintenanceMode : current.maintenanceMode,
      userRegistration: typeof b.userRegistration === "boolean" ? b.userRegistration : current.userRegistration,
      aiFeatures: typeof b.aiFeatures === "boolean" ? b.aiFeatures : current.aiFeatures,
    };
    if (next.supportEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next.supportEmail)) {
      return res.status(400).json({ error: "Support email is not a valid e-mail address" });
    }
    await setSetting("general", next);
    res.json(next);
  } catch (e) {
    fail(res, e);
  }
});

router.get("/security", requireAdmin, async (_req, res) => {
  try {
    res.json({ ...DEFAULT_SECURITY, ...(await getSetting<Partial<typeof DEFAULT_SECURITY>>("security", {})) });
  } catch (e) {
    fail(res, e);
  }
});

router.put("/security", requireAdmin, async (req, res) => {
  try {
    const b = req.body ?? {};
    const current = { ...DEFAULT_SECURITY, ...(await getSetting<Partial<typeof DEFAULT_SECURITY>>("security", {})) };
    const clamp = (v: unknown, min: number, max: number, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
    };
    const next = {
      require2fa: typeof b.require2fa === "boolean" ? b.require2fa : current.require2fa,
      sessionTimeoutMinutes: clamp(b.sessionTimeoutMinutes ?? current.sessionTimeoutMinutes, 5, 10_080, 60),
      passwordMinLength: clamp(b.passwordMinLength ?? current.passwordMinLength, 6, 64, 8),
      allowPasswordLogin: typeof b.allowPasswordLogin === "boolean" ? b.allowPasswordLogin : current.allowPasswordLogin,
      ipAllowlist: typeof b.ipAllowlist === "string" ? b.ipAllowlist.trim() : current.ipAllowlist,
      apiRateLimitPerMinute: clamp(b.apiRateLimitPerMinute ?? current.apiRateLimitPerMinute, 30, 10_000, 240),
    };
    // Never let an admin lock themselves out with a list that excludes their own IP.
    const myIp = req.ip || req.socket.remoteAddress || "";
    if (next.ipAllowlist && !isIpAllowed(myIp, next.ipAllowlist)) {
      return res.status(400).json({
        error: `Your current IP (${myIp || "unknown"}) is not in the allow-list, saving would lock you out. Add it first.`,
      });
    }
    await setSetting("security", next);
    res.json(next);
  } catch (e) {
    fail(res, e);
  }
});

// ---------------------------------------------------------------------------
// API keys (hashed at rest, scoped, optional expiry)
// ---------------------------------------------------------------------------

router.get("/api-keys", requireAdmin, async (_req, res) => {
  try {
    const keys = await getSetting<StoredApiKey[]>("api_keys", []);
    res.json(keys.filter((k) => !k.revokedAt).map(publicKey));
  } catch (e) {
    fail(res, e);
  }
});

router.post("/api-keys", requireAdmin, async (req, res) => {
  try {
    const name = String(req.body?.name || "API key").trim().slice(0, 80) || "API key";
    const scopes: Array<"read" | "write"> = Array.isArray(req.body?.scopes) && req.body.scopes.includes("write") ? ["read", "write"] : ["read"];
    const days = Number(req.body?.expiresInDays);
    const expiresAt = Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
    const secret = `cxk_${randomBytes(24).toString("hex")}`;
    const entry: StoredApiKey = {
      id: randomBytes(8).toString("hex"),
      name,
      prefix: secret.slice(0, 12),
      hash: sha256(secret),
      scopes,
      createdAt: new Date().toISOString(),
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
    };
    const keys = await getSetting<StoredApiKey[]>("api_keys", []);
    keys.unshift(entry);
    await setSetting("api_keys", keys);
    res.status(201).json({ ...publicKey(entry), secret }); // secret is shown exactly once
  } catch (e) {
    fail(res, e);
  }
});

router.delete("/api-keys/:id", requireAdmin, async (req, res) => {
  try {
    const keys = await getSetting<StoredApiKey[]>("api_keys", []);
    const key = keys.find((k) => k.id === req.params.id);
    if (!key) return res.status(404).json({ error: "API key not found" });
    key.revokedAt = new Date().toISOString();
    await setSetting("api_keys", keys);
    res.status(204).send();
  } catch (e) {
    fail(res, e);
  }
});

// ---------------------------------------------------------------------------
// Webhooks (HMAC signed, delivery log, test ping, enable/disable)
// ---------------------------------------------------------------------------

router.get("/webhooks/events", requireAdmin, (_req, res) => {
  res.json(WEBHOOK_EVENTS);
});

router.get("/webhooks", requireAdmin, async (_req, res) => {
  try {
    const hooks = await getSetting<StoredWebhook[]>("webhooks", []);
    res.json(hooks.map((h) => publicHook(h)));
  } catch (e) {
    fail(res, e);
  }
});

router.get("/webhooks/deliveries", requireAdmin, async (req, res) => {
  try {
    const all = await getSetting<WebhookDelivery[]>("webhook_deliveries", []);
    const id = typeof req.query.webhookId === "string" ? req.query.webhookId : "";
    res.json((id ? all.filter((d) => d.webhookId === id) : all).slice(0, 50));
  } catch (e) {
    fail(res, e);
  }
});

router.post("/webhooks", requireAdmin, async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim();
    if (!url) return res.status(400).json({ error: "url required" });
    await assertSafeWebhookUrl(url).catch((e) => {
      throw Object.assign(e, { status: 400 });
    });
    const events = (Array.isArray(req.body?.events) ? req.body.events : ["content.published"]).filter((e: unknown) =>
      typeof e === "string" && ((WEBHOOK_EVENTS as readonly string[]).includes(e) || e === "*"),
    );
    const hooks = await getSetting<StoredWebhook[]>("webhooks", []);
    const entry: StoredWebhook = {
      id: randomBytes(8).toString("hex"),
      url,
      events: events.length ? events : ["content.published"],
      active: true,
      secret: `whsec_${randomBytes(20).toString("hex")}`,
      description: typeof req.body?.description === "string" ? req.body.description.slice(0, 200) : undefined,
      createdAt: new Date().toISOString(),
      lastStatus: null,
      lastDeliveryAt: null,
      failureCount: 0,
    };
    hooks.unshift(entry);
    await setSetting("webhooks", hooks);
    res.status(201).json(publicHook(entry, true)); // full signing secret shown once
  } catch (e: any) {
    fail(res, e, e?.status ?? 500);
  }
});

router.patch("/webhooks/:id", requireAdmin, async (req, res) => {
  try {
    const hooks = await getSetting<StoredWebhook[]>("webhooks", []);
    const hook = hooks.find((h) => h.id === req.params.id);
    if (!hook) return res.status(404).json({ error: "Webhook not found" });
    if (typeof req.body?.active === "boolean") {
      hook.active = req.body.active;
      if (hook.active) hook.failureCount = 0;
    }
    if (Array.isArray(req.body?.events)) {
      const ev = req.body.events.filter((e: unknown) => typeof e === "string" && ((WEBHOOK_EVENTS as readonly string[]).includes(e) || e === "*"));
      if (ev.length) hook.events = ev;
    }
    if (typeof req.body?.url === "string" && req.body.url.trim()) {
      await assertSafeWebhookUrl(req.body.url.trim()).catch((e) => {
        throw Object.assign(e, { status: 400 });
      });
      hook.url = req.body.url.trim();
    }
    await setSetting("webhooks", hooks);
    res.json(publicHook(hook));
  } catch (e: any) {
    fail(res, e, e?.status ?? 500);
  }
});

router.post("/webhooks/:id/test", requireAdmin, async (req, res) => {
  try {
    const hooks = await getSetting<StoredWebhook[]>("webhooks", []);
    const hook = hooks.find((h) => h.id === req.params.id);
    if (!hook) return res.status(404).json({ error: "Webhook not found" });
    const delivery = await deliverToHook(hook, "webhook.test", { message: "Test ping from CINTEXA Nexus", webhookId: hook.id });
    hook.lastStatus = delivery.status;
    hook.lastDeliveryAt = delivery.at;
    const log = await getSetting<WebhookDelivery[]>("webhook_deliveries", []);
    log.unshift(delivery);
    await setSetting("webhook_deliveries", log.slice(0, 100));
    await setSetting("webhooks", hooks);
    res.status(delivery.ok ? 200 : 502).json(delivery);
  } catch (e) {
    fail(res, e);
  }
});

router.delete("/webhooks/:id", requireAdmin, async (req, res) => {
  try {
    const hooks = await getSetting<StoredWebhook[]>("webhooks", []);
    if (!hooks.some((h) => h.id === req.params.id)) return res.status(404).json({ error: "Webhook not found" });
    await setSetting("webhooks", hooks.filter((h) => h.id !== req.params.id));
    res.status(204).send();
  } catch (e) {
    fail(res, e);
  }
});

/** OpenRouter (AI) key — used by AI Studio, comments, images, diagnostics */
router.get("/openrouter", requireAdmin, async (_req, res) => {
  try {
    const s = await getOpenRouterSettings();
    const envFallback = Boolean(process.env.OPENROUTER_API_KEY);
    res.status(200).json({
      ...maskApiKey(s.apiKey || (envFallback ? process.env.OPENROUTER_API_KEY : "")),
      model: s.model,
      siteUrl: s.siteUrl,
      appName: s.appName,
      source: s.apiKey ? "settings" : envFallback ? "environment" : "none",
    });
  } catch (e: any) {
    console.error("[settings] openrouter get", e);
    res.status(500).json({ error: e?.message || "Failed" });
  }
});

async function saveOpenRouterHandler(req: any, res: any) {
  try {
    const body = req.body ?? {};
    const patch: Record<string, string> = {};
    if (typeof body.apiKey === "string" && body.apiKey.trim()) {
      patch.apiKey = body.apiKey.trim();
    }
    if (body.clearKey === true) {
      patch.apiKey = "";
    }
    if (typeof body.model === "string") patch.model = body.model;
    if (typeof body.siteUrl === "string") patch.siteUrl = body.siteUrl;
    if (typeof body.appName === "string") patch.appName = body.appName;
    const next = await setOpenRouterSettings(patch);
    res.status(200).json({
      ...maskApiKey(next.apiKey),
      model: next.model,
      siteUrl: next.siteUrl,
      appName: next.appName,
      source: next.apiKey ? "settings" : "none",
      message: body.clearKey ? "OpenRouter key cleared" : "OpenRouter settings saved",
    });
  } catch (e: any) {
    console.error("[settings] openrouter save", e);
    res.status(500).json({ error: e?.message || "Failed" });
  }
}

// POST preferred (static hosts and some proxies reject PUT with 405)
router.post("/openrouter", requireAdmin, saveOpenRouterHandler);
router.put("/openrouter", requireAdmin, saveOpenRouterHandler);

/** Test that the stored key can reach OpenRouter */
router.post("/openrouter/test", requireAdmin, async (_req, res) => {
  try {
    const key = await resolveOpenRouterApiKey();
    if (!key) {
      return res.status(400).json({ ok: false, error: "No OpenRouter API key configured" });
    }
    const r = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(400).json({
        ok: false,
        error: `OpenRouter rejected the key (${r.status})`,
        detail: text.slice(0, 200),
      });
    }
    res.status(200).json({ ok: true, message: "OpenRouter API key is valid" });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "Test failed" });
  }
});

export default router;

