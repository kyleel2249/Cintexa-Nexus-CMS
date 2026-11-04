/**
 * Optional read-only bridge to Sales local store when present.
 * Never duplicates CRM records. No network.
 */
export type SalesBridgeStatus =
  | { available: true; leads: number; note: string }
  | { available: false; reason: string };

export async function probeSalesLocal(): Promise<SalesBridgeStatus> {
  try {
    // Sales local mode uses IndexedDB /pglite — detect without opening full engine if possible
    if (typeof indexedDB === "undefined") {
      return { available: false, reason: "IndexedDB unavailable in this environment." };
    }
    const dbs = await (indexedDB as any).databases?.();
    const names: string[] = Array.isArray(dbs) ? dbs.map((d: any) => d.name || "") : [];
    const hit = names.some((n) => /sales|pglite|cintexa-sales/i.test(n));
    if (hit) {
      return {
        available: true,
        leads: 0,
        note: "Sales local storage detected. Open Sales → Leads for canonical records. Marketing stores references only.",
      };
    }
    // Try dynamic import of sales local flag
    try {
      const mod = await import("@/lib/sales/api");
      const local = (mod as any).SALES_LOCAL_MODE;
      if (local) {
        return {
          available: true,
          leads: 0,
          note: "Sales local mode is enabled. Use Sales module for lead pipeline; Marketing Lead Generation is separate capture.",
        };
      }
    } catch {
      /* sales module path may differ */
    }
    return {
      available: false,
      reason: "Sales local store not detected. Marketing leads remain independent. No duplicate CRM created.",
    };
  } catch (e: any) {
    return { available: false, reason: e?.message || "Sales probe failed safely." };
  }
}
