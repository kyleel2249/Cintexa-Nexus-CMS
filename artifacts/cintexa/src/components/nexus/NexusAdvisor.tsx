import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Lightbulb, X } from "lucide-react";
import { syncGet } from "@/lib/nexus-sync/api";
import type { AnnouncedDetail } from "@/lib/nexus-sync/announce";

const TOOL_LABEL: Record<string, string> = {
  sales: "Sales", marketing: "Marketing", "corporate-strategy": "Corporate Strategy", "business-diary": "Business Diary",
  "financial-intelligence": "Financial Intelligence", finance: "Finance", dashboard: "Dashboard",
};

/** Listens for records entered anywhere, refreshes every tool's data, and shows the suggestions that came back. Mounted once in the app layout. */
export function AnnouncementToast() {
  const qc = useQueryClient();
  const [detail, setDetail] = useState<AnnouncedDetail | null>(null);
  useEffect(() => {
    let hide: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      const d = (e as CustomEvent<AnnouncedDetail>).detail;
      qc.invalidateQueries({ predicate: (q) => ["sync", "bd", "fi", "fin", "csi", "sales", "marketing"].includes(String(q.queryKey[0])) });
      if (d?.recommendations?.length) {
        setDetail(d);
        if (hide) clearTimeout(hide);
        hide = setTimeout(() => setDetail(null), 12_000);
      }
    };
    window.addEventListener("nexus:announced", on);
    return () => { window.removeEventListener("nexus:announced", on); if (hide) clearTimeout(hide); };
  }, [qc]);
  if (!detail) return null;
  const top = detail.recommendations.slice(0, 4);
  return (
    <div role="status" aria-live="polite" className="fixed bottom-4 right-4 z-50 w-[min(92vw,22rem)] rounded-lg border bg-background p-3 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium"><Lightbulb className="h-4 w-4 text-amber-500" />Synced to every tool</p>
        <button type="button" aria-label="Dismiss" onClick={() => setDetail(null)}><X className="h-4 w-4" /></button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground truncate">{detail.title}</p>
      <ul className="mt-2 space-y-1 text-xs">
        {top.map((r, i) => (<li key={i}><span className="font-medium">{TOOL_LABEL[r.target] ?? r.target}:</span> {r.text}</li>))}
      </ul>
    </div>
  );
}

interface RecItem { eventId: string; title: string; sourceModule: string; createdAt: string; recommendations: Array<{ target: string; text: string }> }

/** Dashboard card: suggestions for the latest records entered in any tool. */
export function RecommendationsWidget({ module }: { module?: string }) {
  const q = useQuery({ queryKey: ["sync", "recommendations", module ?? "all"], queryFn: () => syncGet<{ items: RecItem[] }>(`/recommendations?limit=8${module ? `&module=${module}` : ""}`), retry: false, refetchInterval: 30_000 });
  return (
    <Card className="border-amber-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg"><Lightbulb className="h-5 w-5 text-amber-500" />Recommendations</CardTitle>
        <CardDescription>Suggestions for the latest data entered in any tool. Rules-based; check each against your situation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isLoading ? <Skeleton className="h-20 w-full" /> : q.isError ? <p className="text-sm text-muted-foreground">Recommendations are unavailable. Bind a D1 database (NEXUS_DB or FIN_DB).</p> : (q.data?.items.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">Nothing yet. Enter data in any tool and suggestions appear here.</p> : q.data!.items.map((it) => (
          <div key={it.eventId} className="rounded border p-2 text-xs">
            <p className="font-medium">{it.title} <span className="text-muted-foreground">({TOOL_LABEL[it.sourceModule] ?? it.sourceModule})</span></p>
            <ul className="mt-1 space-y-0.5">
              {it.recommendations.filter((r) => r.target !== "dashboard").slice(0, 4).map((r, i) => (<li key={i}><span className="font-medium">{TOOL_LABEL[r.target] ?? r.target}:</span> <span className="text-muted-foreground">{r.text}</span></li>))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
