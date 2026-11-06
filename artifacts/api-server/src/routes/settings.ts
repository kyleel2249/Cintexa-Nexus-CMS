import { Router } from "express";
import { randomBytes } from "node:crypto";
import {
  getOpenRouterSettings,
  setOpenRouterSettings,
  maskApiKey,
  resolveOpenRouterApiKey,
  normalizeApiKey,
} from "../lib/openrouter";
import { validateProviderKey } from "../lib/providers";
import {
  DEFAULT_GENERAL,
  DEFAULT_SECURITY,
  getSetting,
  setSetting,
  type StoredWebhook,
} from "../lib/platform-settings";
import { requireAdmin, isIpAllowed } from "../lib/auth-middleware";
import {
  WEBHOOK_EVENTS,
  assertSafeWebhookUrl,
  deliverToHook,
  type WebhookDelivery,
} from "../lib/webhooks";

const router = Router();

const fail = (res: any, e: any, status = 500) => res.status(status).json({ error: e?.message || "Request failed" });


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
    res.json({
      platformName: g.platformName,
      maintenanceMode: g.maintenanceMode,
      aiFeatures: g.aiFeatures,
    });
  } catch (e) {
    fail(res, e);
  }
});

/** Who am I / which IP does the API see - used by the Security tab to avoid IP allow-list lock-outs. */
router.get("/whoami", (req, res) => {
  res.json({
    ip: (req.ip || req.socket.remoteAddress || "").replace(/^::ffff:/, ""),
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
      patch.apiKey = normalizeApiKey(body.apiKey);
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

/**
 * Test that the stored key is accepted by OpenRouter.
 * NOTE: GET /models is a public endpoint and answers 200 for ANY key (even invalid ones), so it cannot validate a key.
 * GET /auth/key requires a valid key and returns its label / limits, which makes it a real check.
 * Saving a key never depends on this test.
 */
router.post("/openrouter/test", requireAdmin, async (req, res) => {
  try {
    const body = req.body ?? {};
    // Prefer key from the request body so Test works before Save and across CF isolates.
    let key = typeof body.apiKey === "string" && body.apiKey.trim()
      ? normalizeApiKey(body.apiKey)
      : (await resolveOpenRouterApiKey()) || "";
    if (!key) {
      return res.status(400).json({
        ok: false,
        status: "not_configured",
        error: "No OpenRouter API key configured. Paste a key and click Test, or Save first.",
      });
    }
    const r = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 401 || r.status === 403) {
      return res.status(400).json({
        ok: false,
        status: "authentication_failed",
        error: `OpenRouter rejected the key (HTTP ${r.status}). Check that it was copied in full and has not been revoked.`,
        hint: "Create a new key at https://openrouter.ai/keys and paste it without a Bearer prefix.",
      });
    }
    if (r.status === 402) {
      return res.status(400).json({
        ok: false,
        status: "insufficient_credits",
        error: "OpenRouter account has insufficient credits.",
        hint: "Add credits at https://openrouter.ai/settings/credits",
      });
    }
    if (r.status === 429) {
      return res.status(400).json({
        ok: false,
        status: "rate_limited",
        error: "OpenRouter rate-limited the validation request. Try again shortly.",
      });
    }
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(502).json({
        ok: false,
        status: "provider_unavailable",
        error: `OpenRouter could not verify the key right now (HTTP ${r.status})`,
        detail: text.slice(0, 200),
      });
    }
    const info: any = await r.json().catch(() => null);
    const label = typeof info?.data?.label === "string" ? info.data.label : "";
    // Optionally persist a tested key when the client asks (Test-and-save UX)
    if (typeof body.apiKey === "string" && body.apiKey.trim() && body.persist === true) {
      await setOpenRouterSettings({ apiKey: key });
    }
    res.status(200).json({
      ok: true,
      status: "validated",
      message: label ? `OpenRouter API key is valid (${label})` : "OpenRouter API key is valid",
      ...maskApiKey(key),
    });
  } catch (e: any) {
    const network = e?.name === "TimeoutError" || e?.code === "ENOTFOUND" || e?.cause?.code === "ENOTFOUND";
    res.status(500).json({
      ok: false,
      status: network ? "network_error" : "error",
      error: e?.name === "TimeoutError" ? "OpenRouter did not answer in time" : e?.message || "Test failed",
    });
  }
});

export default router;
