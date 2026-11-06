/**
 * Announce a record entered in any tool to every other tool (reciprocal sync).
 *
 * Sales, Marketing, Corporate Strategy, Business Diary and Financial Intelligence call this when data is saved.
 * Finance publishes its own events on the server, so it is skipped here. Failures never block the user's save.
 * After the server fans the event out, a "nexus:announced" browser event carries the suggestions for display.
 */
import { syncPost } from "./api";
import { labelOf, type Announcement, type AnnouncedDetail } from "./announce-core";

export { labelOf, moduleForPath, describeResponse } from "./announce-core";
export type { Announcement, AnnouncedDetail, NexusModule } from "./announce-core";

const recent = new Map<string, number>();

export function announceRecord(a: Announcement): void {
  try {
    if (typeof window === "undefined") return;
    const key = `${a.module}:${a.entityType}:${a.entityId}:${a.action}:${a.stamp ?? ""}`;
    const now = Date.now();
    for (const [k, t] of recent) if (now - t > 10_000) recent.delete(k);
    if (recent.has(key)) return;
    recent.set(key, now);
    const body = {
      eventType: `RECORD_${a.action.toUpperCase()}`,
      sourceModule: a.module,
      entityType: a.entityType,
      entityId: String(a.entityId),
      idempotencyKey: `${key}:${a.stamp ? "" : Math.floor(now / 60_000)}`,
      payload: {
        title: `${labelOf(a.module)}: ${a.entityType} ${a.action} - ${a.title}`.slice(0, 280),
        category: labelOf(a.module),
        description: (a.description || `${a.entityType} "${a.title}" was ${a.action} in ${labelOf(a.module)}.`).slice(0, 1000),
        amountMinor: a.amountMinor && Number.isFinite(a.amountMinor) ? Math.round(a.amountMinor) : undefined,
      },
    };
    void syncPost<{ event?: unknown; recommendations?: Array<{ target: string; text: string }> }>("/events", body)
      .then((res) => {
        window.dispatchEvent(new CustomEvent<AnnouncedDetail>("nexus:announced", { detail: { title: a.title, source: a.module, recommendations: res.recommendations ?? [] } }));
      })
      .catch(() => {
        /* sync is best-effort from the browser; the user's own save has already succeeded */
      });
  } catch {
    /* never throw into a save path */
  }
}

