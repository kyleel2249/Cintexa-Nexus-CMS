/**
 * Optional read-only bridge to Sales local mode.
 * Never writes. Never duplicates CRM records.
 */
export type SalesBridgeResult =
  | {
      available: true;
      totalLeads?: number;
      note: string;
      salesLeadsPath: string;
    }
  | { available: false; reason: string };

export async function probeSalesLocal(): Promise<SalesBridgeResult> {
  try {
    // Prefer Sales API local transport when present
    try {
      const mod = await import("@/lib/sales/api");
      const localMode = (mod as { SALES_LOCAL_MODE?: boolean }).SALES_LOCAL_MODE;
      if (localMode) {
        let totalLeads: number | undefined;
        try {
          const salesApi = mod as { salesJson?: (path: string) => Promise<unknown> };
          if (typeof salesApi.salesJson === "function") {
            const data = await salesApi.salesJson("/leads?limit=1");
            const d = data as { total?: number; items?: unknown[] };
            if (typeof d?.total === "number") totalLeads = d.total;
          }
        } catch {
          /* counts optional */
        }
        return {
          available: true,
          totalLeads,
          note:
            totalLeads != null
              ? `Sales local mode: ${totalLeads} lead(s) reported by Sales (read-only). Marketing leads remain separate.`
              : "Sales local mode is enabled. Open Sales → Leads for canonical pipeline records. Marketing does not copy CRM data.",
          salesLeadsPath: "/sales/leads",
        };
      }
    } catch {
      /* sales module may be unavailable */
    }

    if (typeof indexedDB !== "undefined" && (indexedDB as any).databases) {
      const dbs = await (indexedDB as any).databases();
      const names: string[] = Array.isArray(dbs) ? dbs.map((d: any) => d.name || "") : [];
      if (names.some((n) => /sales|pglite|cintexa-sales/i.test(n))) {
        return {
          available: true,
          note: "Sales local storage detected. Use Sales for CRM; Marketing Lead Generation is separate capture.",
          salesLeadsPath: "/sales/leads",
        };
      }
    }

    return {
      available: false,
      reason: "Sales local store not detected. Marketing leads stay independent. No CRM duplication.",
    };
  } catch (e: any) {
    return { available: false, reason: e?.message || "Sales probe failed safely." };
  }
}
