/**
 * Source distribution + multi-touch attribution when touchpoints exist.
 * Never fabricates touchpoints or revenue.
 */
import type { Touchpoint } from "./entities";

export type AttributionModel = "first_touch" | "last_touch" | "linear" | "manual";

export type LeadLike = {
  source?: string | null;
  status?: string;
  created_at?: string;
  updated_at?: string;
};

export type AttributionBucket = {
  source: string;
  count: number;
  share: number;
};

export function attributeLeadsBySource(
  leads: LeadLike[],
  _model: AttributionModel = "last_touch",
): { buckets: AttributionBucket[]; total: number; limitation: string } {
  const map = new Map<string, number>();
  for (const lead of leads) {
    const src = (lead.source && lead.source.trim()) || "Unspecified";
    map.set(src, (map.get(src) || 0) + 1);
  }
  const total = leads.length;
  const buckets = Array.from(map.entries())
    .map(([source, count]) => ({
      source,
      count,
      share: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    buckets,
    total,
    limitation:
      "Single source field per lead only. Use touchpoint timelines for multi-touch models.",
  };
}

export type TouchAttributionResult = {
  ok: boolean;
  model: AttributionModel;
  credits: { channel: string; touchpoint_id: string; credit: number }[];
  message: string;
};

/** Credit a conversion using eligible touchpoints for one lead. */
export function attributeConversionByTouchpoints(
  touchpoints: Touchpoint[],
  model: AttributionModel,
): TouchAttributionResult {
  const sorted = [...touchpoints].sort((a, b) => a.at.localeCompare(b.at));
  if (!sorted.length) {
    return { ok: false, model, credits: [], message: "INSUFFICIENT ATTRIBUTION DATA — no touchpoints" };
  }
  const hasConversion = sorted.some((t) => t.is_conversion);
  if (!hasConversion && model !== "manual") {
    return {
      ok: false,
      model,
      credits: [],
      message: "INSUFFICIENT ATTRIBUTION DATA — no conversion touchpoint recorded",
    };
  }
  if (model === "first_touch") {
    const t = sorted[0];
    return {
      ok: true,
      model,
      credits: [{ channel: t.channel, touchpoint_id: t.id, credit: 1 }],
      message: "100% credit to first eligible touchpoint",
    };
  }
  if (model === "last_touch") {
    const t = sorted[sorted.length - 1];
    return {
      ok: true,
      model,
      credits: [{ channel: t.channel, touchpoint_id: t.id, credit: 1 }],
      message: "100% credit to last eligible touchpoint",
    };
  }
  if (model === "linear") {
    const credit = 1 / sorted.length;
    return {
      ok: true,
      model,
      credits: sorted.map((t) => ({
        channel: t.channel,
        touchpoint_id: t.id,
        credit: Math.round(credit * 1000) / 1000,
      })),
      message: `Equal credit across ${sorted.length} touchpoints`,
    };
  }
  return { ok: false, model, credits: [], message: "Manual attribution — assign credit outside this calculator" };
}
