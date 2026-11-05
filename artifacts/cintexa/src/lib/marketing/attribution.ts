/**
 * Lightweight local attribution summaries.
 * Uses marketing lead `source` strings only — not multi-touch journeys.
 * Never invents touchpoints that were not recorded.
 */
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
  share: number; // 0–100
};

/**
 * For first/last/linear without multi-touch data, each lead has a single source.
 * All models therefore collapse to the same distribution by source.
 * Callers must show this limitation.
 */
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
      "Single source field per lead only. First/last/linear multi-touch cannot differ without a touchpoint timeline. Treat as MANUAL source distribution.",
  };
}
