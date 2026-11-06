/** Pure helpers for announcing records (no browser or network dependencies, so they can be unit tested). */
export type NexusModule = "sales" | "marketing" | "corporate-strategy" | "business-diary" | "financial-intelligence";

export interface Announcement {
  module: NexusModule;
  entityType: string;
  entityId: string | number;
  title: string;
  action: "created" | "updated" | "deleted";
  /** Money in minor units when the record carries an amount (spend, order value, invoice). */
  amountMinor?: number;
  description?: string;
  /** Distinguishes successive edits of the same record. */
  stamp?: string;
}

export interface AnnouncedDetail { title: string; source: NexusModule; recommendations: Array<{ target: string; text: string }> }

export function labelOf(m: string): string {
  return ({ sales: "Sales", marketing: "Marketing", "corporate-strategy": "Corporate Strategy", "business-diary": "Business Diary", "financial-intelligence": "Financial Intelligence" } as Record<string, string>)[m] ?? m;
}


/** Map an API path to the tool that owns it. Finance is excluded: its server publishes its own events. */
export function moduleForPath(path: string): NexusModule | null {
  const p = path.replace(/^https?:\/\/[^/]+/, "");
  if (/^\/(api\/)?csi(\/|$)/.test(p)) return "corporate-strategy";
  if (/^\/(api\/)?diary(\/|$)/.test(p)) return "business-diary";
  if (/^\/(api\/)?fi(\/|$)/.test(p)) return "financial-intelligence";
  if (/^\/(api\/)?sales(\/|$)/.test(p) && !/^\/(api\/)?sales\/(research|public)/.test(p)) return "sales";
  return null;
}

/** Best-effort extraction of an id and title from a mutation response. */
export function describeResponse(path: string, method: string, body: any): Pick<Announcement, "entityType" | "entityId" | "title" | "amountMinor" | "stamp"> {
  const seg = path.split("?")[0]!.split("/").filter(Boolean).filter((s) => !/^(api|csi|diary|fi|sales)$/.test(s));
  const obj = body && typeof body === "object" ? (Object.values(body).find((v) => v && typeof v === "object" && !Array.isArray(v) && ("id" in (v as any) || "title" in (v as any) || "name" in (v as any))) as any) ?? body : {};
  const id = obj?.id ?? obj?.number ?? seg[seg.length - 1] ?? `${method}-${seg.join("-")}`;
  const title = String(obj?.title ?? obj?.name ?? obj?.subject ?? obj?.number ?? seg.join(" / ") ?? "record").slice(0, 160);
  const amount = Number(obj?.amountMinor ?? obj?.totalMinor ?? obj?.valueMinor);
  return { entityType: singular(seg[0] ?? "record"), entityId: id, title: title || "record", amountMinor: Number.isFinite(amount) && amount > 0 ? amount : undefined, stamp: String(obj?.updatedAt ?? obj?.updated_at ?? "") };
}

function singular(s: string): string {
  return s.replace(/ies$/, "y").replace(/s$/, "").replace(/-/g, "_");
}
