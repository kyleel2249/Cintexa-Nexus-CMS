import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { csiGet, formatCurrency } from "@/lib/csi/api";
import { CSI_NAV } from "@/lib/csi/nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiCard } from "@/components/ui/kpi-card";
import { exportCsiOverviewPdf } from "@/lib/csi/pdf";
import { Button } from "@/components/ui/button";

export default function CsiOverview() {
  const q = useQuery({
    queryKey: ["csi", "dashboard"],
    queryFn: () => csiGet<any>("/dashboard"),
    staleTime: 15_000,
  });
  const bva = useQuery({
    queryKey: ["csi", "bva"],
    queryFn: () => csiGet<any>("/budget-vs-actual"),
    staleTime: 30_000,
    retry: false,
  });

  if (q.isLoading) {
    return (
      <div className="p-6 grid gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Corporate Strategy &amp; Intelligence unavailable</CardTitle>
            <CardDescription>
              Could not reach /api/csi. Deploy <code className="text-xs">functions/api/csi/[[path]].ts</code>. No API keys required.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const d = q.data;
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Corporate Strategy &amp; Intelligence</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {d.profile?.legalName || "CINTEXA"} · management planning, products, budgets and risks
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!q.data}
            onClick={() =>
              exportCsiOverviewPdf({
                profile: q.data?.profile,
                dashboard: q.data,
                budgetVsActual: bva.data,
              })
            }
          >
            Export PDF
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Active objectives" value={String(d.objectivesActive ?? 0)} tone="gold" href="/corporate-strategy/objectives" />
        <KpiCard
          label="Avg objective progress"
          value={d.objectivesAvgProgress != null ? `${d.objectivesAvgProgress}%` : "—"}
          tone={d.objectivesAvgProgress != null && d.objectivesAvgProgress >= 60 ? "positive" : "caution"}
          href="/corporate-strategy/objectives"
        />
        <KpiCard label="Active products" value={`${d.productsActive ?? 0}/${d.productsTotal ?? 0}`} href="/corporate-strategy/products" />
        <KpiCard
          label="Open risks"
          value={String(d.openRisks ?? 0)}
          tone={(d.openRisks ?? 0) > 0 ? "caution" : "positive"}
          href="/corporate-strategy/risks"
        />
      </div>

      {(d.insights || []).length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Decision intelligence</CardTitle>
            <CardDescription>Deterministic insights from CSI records</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {d.insights.map((i: any) => (
              <div key={i.id} className="rounded-md border px-3 py-2 text-sm">
                <span className="text-[10px] uppercase text-muted-foreground">{i.severity}</span>
                <p className="font-medium">{i.title}</p>
                <p className="text-xs text-muted-foreground">{i.detail}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Source: {i.source}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {CSI_NAV.filter((i) => i.key !== "overview").map((i) => (
          <Link key={i.key} href={i.href}>
            <Card className="cursor-pointer hover:border-primary/40 h-full">
              <CardContent className="py-3">
                <p className="text-[11px] uppercase text-muted-foreground">{i.section}</p>
                <p className="text-sm font-medium">{i.label}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
