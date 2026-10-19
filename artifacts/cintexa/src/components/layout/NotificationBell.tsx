import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSalesOptional } from "@/context/SalesContext";
import { sales as api } from "@/lib/sales/api";
import { invalidateSales, useSalesQuery } from "@/lib/sales/hooks";
import { relative } from "@/lib/sales/format";

interface Note { id: number; kind: string; title: string; body: string | null; link: string | null; severity: "info" | "warning" | "critical" | string; read_at: string | null; created_at: string }

const DOT: Record<string, string> = { info: "bg-sky-500", warning: "bg-amber-500", critical: "bg-rose-500" };

/** In-app Sales notifications (assignments, overdue follow-ups, approvals, customer quotation activity). Refreshes every minute while the tab is visible. */
export function NotificationBell() {
  const s = useSalesOptional();
  const ready = s?.access === "ready";
  const [, nav] = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const q = useSalesQuery<{ items: Note[]; unread: number }>(ready ? "/notifications" : null);

  useEffect(() => {
    if (!ready) return undefined;
    const t = setInterval(() => { if (document.visibilityState === "visible") invalidateSales("/notifications"); }, 60_000);
    return () => clearInterval(t);
  }, [ready]);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const unread = q.data?.unread ?? 0;
  const markRead = async (ids?: number[]) => {
    try { await api.post("/notifications/read", ids ? { ids } : {}); } finally { invalidateSales("/notifications"); invalidateSales("/me"); }
  };
  const openNote = (n: Note) => {
    setOpen(false);
    if (!n.read_at) void markRead([n.id]);
    if (n.link) nav(n.link);
  };

  return (
    <div className="relative" ref={ref}>
      <Button variant="ghost" size="icon" className="relative h-9 w-9" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Bell className="h-4 w-4 text-muted-foreground" />
        {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">{unread > 99 ? "99+" : unread}</span>}
      </Button>
      {open && (
        <div role="region" aria-label="Notifications" className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border bg-popover shadow-xl">
          <div className="flex items-center justify-between border-b px-3 py-2"><p className="text-sm font-semibold">Notifications</p>{unread > 0 && <button type="button" className="flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => void markRead()}><CheckCheck className="h-3.5 w-3.5" />Mark all read</button>}</div>
          <ul className="max-h-96 overflow-y-auto">
            {!ready && <li className="px-3 py-8 text-center text-sm text-muted-foreground">Sales notifications appear here once you are set up as a sales member.</li>}
            {ready && q.loading && <li className="px-3 py-8 text-center text-sm text-muted-foreground">Loading…</li>}
            {ready && q.error && <li role="alert" className="px-3 py-6 text-center text-sm text-rose-500">{q.error.message}</li>}
            {ready && q.data?.items.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">You're all caught up.</li>}
            {q.data?.items.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => openNote(n)} className={cn("flex w-full items-start gap-2 border-b px-3 py-2.5 text-left last:border-0 hover:bg-secondary", !n.read_at && "bg-primary/5")}>
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : DOT[n.severity] ?? DOT.info)} aria-hidden />
                  <span className="min-w-0 flex-1"><span className={cn("block text-sm", !n.read_at && "font-medium")}>{n.title}</span>{n.body && <span className="block truncate text-xs text-muted-foreground">{n.body}</span>}<span className="block text-[11px] text-muted-foreground">{relative(n.created_at)}</span></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
