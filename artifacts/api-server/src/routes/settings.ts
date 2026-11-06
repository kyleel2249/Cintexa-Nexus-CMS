import { Router } from "express";
import { randomBytes } from "node:crypto";
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

export default router;
