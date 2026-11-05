/**
 * Subscribe to unified marketing memory events and refresh React Query caches.
 * No network — only local invalidation of marketing query keys.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { marketingSubscribe, MarketingEvents } from "./memory";

const EVENT_TO_KEYS: Record<string, string[][]> = {
  [MarketingEvents.CHANGED]: [["mkt"], ["marketing"]],
  [MarketingEvents.STRATEGY]: [["mkt", "strategies"], ["mkt"]],
  [MarketingEvents.BRAND]: [["mkt", "brands"], ["mkt", "claims"], ["mkt"]],
  [MarketingEvents.PERSONA]: [["mkt", "personas"], ["mkt"]],
  [MarketingEvents.SWOT]: [["mkt", "swot"], ["mkt"]],
  [MarketingEvents.OKR]: [["mkt", "objectives"], ["mkt"]],
  [MarketingEvents.CAMPAIGN]: [["marketing", "campaigns"], ["marketing", "overview"], ["marketing"]],
  [MarketingEvents.FUNNEL]: [["mkt", "funnels"], ["mkt"]],
  [MarketingEvents.SETTINGS]: [["mkt", "settings"], ["mkt"]],
};

export function useMarketingSubscription(events?: string[]) {
  const qc = useQueryClient();
  useEffect(() => {
    const list = events?.length ? events : [MarketingEvents.CHANGED, "*"];
    const unsubs = list.map((ev) =>
      marketingSubscribe(ev, (payload) => {
        const eventName =
          ev === "*" && payload && typeof payload === "object" && "event" in (payload as object)
            ? String((payload as { event: string }).event)
            : ev;
        const keys = EVENT_TO_KEYS[eventName] || EVENT_TO_KEYS[MarketingEvents.CHANGED];
        for (const k of keys) {
          qc.invalidateQueries({ queryKey: k });
        }
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [qc, events?.join("|")]);
}

/** Mount once near marketing shell so all marketing routes stay in sync. */
export function MarketingMemoryBridge() {
  useMarketingSubscription();
  return null;
}
