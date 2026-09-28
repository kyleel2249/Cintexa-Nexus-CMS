import { createHmac, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { getSetting, setSetting, type StoredWebhook } from "./platform-settings";
import { logger } from "./logger";

export const WEBHOOK_EVENTS = [
  "content.published",
  "content.scheduled",
  "form.submitted",
  "intake.submitted",
  "media.uploaded",
  "webhook.test",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export type WebhookDelivery = {
  id: string;
  webhookId: string;
  event: string;
  url: string;
  status: number | null;
  ok: boolean;
  durationMs: number;
  error?: string;
  at: string;
};

function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const v = ip.toLowerCase();
  return v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

/** Reject non-http(s) URLs and (by default) private/loopback targets - basic SSRF protection. */
export async function assertSafeWebhookUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Webhook URL is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Webhook URL must start with http:// or https://");
  }
  if (process.env.ALLOW_PRIVATE_WEBHOOKS === "1") return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Webhook URL may not point to a local/internal host");
  }
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error("Webhook host could not be resolved");
  if (addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error("Webhook URL resolves to a private network address");
  }
  return url;
}

export function signPayload(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

async function recordDelivery(d: WebhookDelivery) {
  const all = await getSetting<WebhookDelivery[]>("webhook_deliveries", []);
  all.unshift(d);
  await setSetting("webhook_deliveries", all.slice(0, 100));
}

export async function deliverToHook(hook: StoredWebhook, event: string, data: unknown): Promise<WebhookDelivery> {
  const started = Date.now();
  const at = new Date().toISOString();
  const base = { id: randomUUID(), webhookId: hook.id, event, url: hook.url, at };
  try {
    await assertSafeWebhookUrl(hook.url);
    const body = JSON.stringify({ id: base.id, event, createdAt: at, data });
    const ts = String(Math.floor(Date.now() / 1000));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(hook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "CintexaNexus-Webhooks/1.0",
        "x-cintexa-event": event,
        "x-cintexa-delivery": base.id,
        "x-cintexa-timestamp": ts,
        "x-cintexa-signature": `sha256=${signPayload(hook.secret, ts, body)}`,
      },
      body,
      signal: ctrl.signal,
      redirect: "manual",
    }).finally(() => clearTimeout(timer));
    return { ...base, status: res.status, ok: res.status >= 200 && res.status < 300, durationMs: Date.now() - started };
  } catch (err: any) {
    return { ...base, status: null, ok: false, durationMs: Date.now() - started, error: err?.message || "Delivery failed" };
  }
}

/** Fire-and-forget fan-out to every active webhook subscribed to `event`. Never throws. */
export function dispatchWebhook(event: WebhookEvent, data: unknown): void {
  void (async () => {
    try {
      const hooks = await getSetting<StoredWebhook[]>("webhooks", []);
      const targets = hooks.filter((h) => h.active && (h.events.includes(event) || h.events.includes("*")));
      if (!targets.length) return;
      const results = await Promise.all(targets.map((h) => deliverToHook(h, event, data)));
      const latest = await getSetting<StoredWebhook[]>("webhooks", []);
      for (const r of results) {
        await recordDelivery(r);
        const h = latest.find((x) => x.id === r.webhookId);
        if (h) {
          h.lastStatus = r.status;
          h.lastDeliveryAt = r.at;
          h.failureCount = r.ok ? 0 : (h.failureCount ?? 0) + 1;
          if ((h.failureCount ?? 0) >= 10) h.active = false; // circuit breaker
        }
      }
      await setSetting("webhooks", latest);
    } catch (err) {
      logger.warn({ err }, "webhook dispatch failed");
    }
  })();
}
