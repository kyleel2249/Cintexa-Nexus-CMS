/**
 * Unified Marketing Memory — in-process event bus + subscriptions.
 * All marketing modules read/write through local-store; this notifies listeners.
 * No network. Device/browser local.
 */
type Handler = (payload?: unknown) => void;
const listeners = new Map<string, Set<Handler>>();

export function marketingSubscribe(event: string, handler: Handler): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(handler);
  return () => listeners.get(event)?.delete(handler);
}

export function marketingEmit(event: string, payload?: unknown) {
  listeners.get(event)?.forEach((h) => {
    try { h(payload); } catch { /* isolate */ }
  });
  // Wildcard
  listeners.get("*")?.forEach((h) => {
    try { h({ event, payload }); } catch { /* isolate */ }
  });
}

export const MarketingEvents = {
  CHANGED: "marketing.changed",
  STRATEGY: "marketing.strategy",
  BRAND: "marketing.brand",
  PERSONA: "marketing.persona",
  SWOT: "marketing.swot",
  OKR: "marketing.okr",
  CAMPAIGN: "marketing.campaign",
  FUNNEL: "marketing.funnel",
  SETTINGS: "marketing.settings",
  ASSET: "marketing.asset",
  LEAD: "marketing.lead",
} as const;
