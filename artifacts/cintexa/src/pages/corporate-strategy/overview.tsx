import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { csiGet, formatCurrency } from "@/lib/csi/api";
import { CSI_NAV } from "@/lib/csi/nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedKpiCard } from "@/components/financial-intelligence/AnimatedKpiCard";
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
  const perf = useQuery({
    queryKey: ["csi", "prod-perf"],
    queryFn: () => csiGet<any>("/product-performance"),
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
  const fin = d.financeLive;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Corporate Strategy &amp; Intelligence</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {d.profile?.legalName || "CINTEXA"} · management planning, products, budgets and risks · connected to live Finance when available
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
                productPerformance: perf.data,
              })
            }
          >
            Export PDF
          </Button>
          <Link href="/finance">
            <span className="inline-flex rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary cursor-pointer">
              Open Finance →
            </span>
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AnimatedKpiCard label="Active objectives" value={String(d.objectivesActive ?? 0)} tone="gold" href="/corporate-strategy/objectives" />
        <AnimatedKpiCard
          label="Avg objective progress"
          value={d.objectivesAvgProgress != null ? `${d.objectivesAvgProgress}%` : "—"}
          tone={d.objectivesAvgProgress != null && d.objectivesAvgProgress >= 60 ? "positive" : "caution"}
          href="/corporate-strategy/objectives"
        />
        <AnimatedKpiCard label="Active products" value={`${d.productsActive ?? 0}/${d.productsTotal ?? 0}`} href="/corporate-strategy/products" />
        <AnimatedKpiCard
          label="Open risks"
          value={String(d.openRisks ?? 0)}
          tone={(d.openRisks ?? 0) > 0 ? "caution" : "positive"}
          href="/corporate-strategy/risks"
        />
      </div>

      <Card className="border-primary/20">
        <CardHeader className="py-3">
          <CardTitle className="text-base">Live Finance snapshot</CardTitle>
          <CardDescription>
            Authoritative balances from CINTEXA Finance — not CSI-calculated. Empty if Finance API is offline.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {fin ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <AnimatedKpiCard label="Revenue" value={formatCurrency(fin.revenue ?? 0, fin.currency || "GHS")} tone="positive" href="/finance" />
              <AnimatedKpiCard label="Net profit" value={formatCurrency(fin.netProfit ?? 0, fin.currency || "GHS")} href="/finance" />
              <AnimatedKpiCard label="Cash" value={formatCurrency(fin.cash ?? 0, fin.currency || "GHS")} tone="gold" href="/finance" />
              <AnimatedKpiCard label="Receivables" value={formatCurrency(fin.accountsReceivable ?? 0, fin.currency || "GHS")} href="/finance/invoices" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Finance dashboard not reachable from this origin. CSI still operates for strategy records.</p>
          )}
        </CardContent>
      </Card>

      {(d.insights || []).length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Decision intelligence</CardTitle>
            <CardDescription>Deterministic insights from CSI records and optional Finance data</CardDescription>
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
