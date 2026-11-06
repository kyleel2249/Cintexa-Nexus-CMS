import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Network, ArrowRight } from "lucide-react";
import { SyncSphere3D, type SphereNode } from "@/components/nexus/SyncSphere3D";
import { syncGet } from "@/lib/nexus-sync/api";
import { finGet, formatCurrency } from "@/lib/finance/api";
import { forecastSeries } from "@/lib/nexus/forecast";

const LABELS: Record<string, [string, string]> = {
  sales: ["Sales", "#2563eb"], marketing: ["Marketing", "#db2777"], finance: ["Finance", "#059669"],
  "financial-intelligence": ["Fin. Intel.", "#7c3aed"], "corporate-strategy": ["Strategy", "#0891b2"],
  "business-diary": ["Diary", "#d97706"], dashboard: ["Dashboard", "#64748b"],
};

export function NexusSynchronyWidget() {
  const activity = useQuery({ queryKey: ["sync", "activity"], queryFn: () => syncGet<any>("/activity"), retry: false, refetchInterval: 30_000 });
  const series = useQuery({ queryKey: ["fin", "series"], queryFn: () => finGet<any>("/analytics/series"), retry: false, refetchInterval: 60_000 });
  const nodes: SphereNode[] = useMemo(() => Object.entries(LABELS).map(([id, [label, color]]) => ({ id, label, color, weight: 0 })), []);
  const links = useMemo(() => ((activity.data?.flows ?? []) as Array<{ source: string; target: string; n: number }>), [activity.data]);
  const net = useMemo(() => forecastSeries(((series.data?.items ?? []) as Array<{ net: number }>).map((m) => m.net)), [series.data]);

  return (
    <Card className="border-primary/20">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg"><Network className="h-5 w-5 text-primary" />Nexus Synchrony</CardTitle>
          <CardDescription className="mt-1.5">3D map of data flowing between tools, with forecasts</CardDescription>
        </div>
        <Link href="/nexus-synchrony"><span className="inline-flex items-center gap-1.5 text-sm text-primary cursor-pointer">Open <ArrowRight className="h-3.5 w-3.5" /></span></Link>
      </CardHeader>
      <CardContent className="space-y-2">
        {activity.isLoading ? <Skeleton className="h-[220px] w-full" /> : <SyncSphere3D nodes={nodes} links={links} height={220} />}
        <p className="text-xs text-muted-foreground">
          {net.method === "holt-linear"
            ? `Net profit forecast next period: ${formatCurrency(net.points[0]!)} (${net.trend}, confidence ${net.confidence}).`
            : "Forecasts appear after three months of posted journals."}
        </p>
      </CardContent>
    </Card>
  );
}
