import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Target, ArrowRight } from "lucide-react";
import { csiGet, formatCurrency } from "@/lib/csi/api";

export function CsiDashboardWidget() {
  const dash = useQuery({
    queryKey: ["csi", "widget"],
    queryFn: () => csiGet<any>("/dashboard"),
    staleTime: 60_000,
    retry: false,
  });
  const bva = useQuery({
    queryKey: ["csi", "widget-bva"],
    queryFn: () => csiGet<any>("/budget-vs-actual"),
    staleTime: 60_000,
    retry: false,
  });

  const d = dash.data;
  const tot = bva.data?.totals;

  return (
    <Card className="border-primary/20">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target className="h-5 w-5 text-primary" />
            Corporate Strategy &amp; Intelligence
          </CardTitle>
          <CardDescription className="mt-1.5">
            Objectives · budgets vs Finance actuals · risks
          </CardDescription>
        </div>
        <Link href="/corporate-strategy">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium px-3 py-2 cursor-pointer">
            Open <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      </CardHeader>
      <CardContent>
        {dash.isLoading ? (
          <Skeleton className="h-14" />
        ) : dash.isError || !d ? (
          <p className="text-sm text-muted-foreground">CSI API offline. Deploy /api/csi and bind CSI_DB when ready.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Link href="/corporate-strategy/objectives">
                <div className="rounded-lg border p-3 cursor-pointer hover:border-primary/40">
                  <p className="text-[11px] uppercase text-muted-foreground">Objectives</p>
                  <p className="text-sm font-semibold tabular-nums">{d.objectivesActive ?? 0} active</p>
                  <p className="text-[11px] text-muted-foreground">
                    {d.objectivesAvgProgress != null ? `${d.objectivesAvgProgress}% avg progress` : "No progress yet"}
                  </p>
                </div>
              </Link>
              <Link href="/corporate-strategy/budgets">
                <div className="rounded-lg border p-3 cursor-pointer hover:border-primary/40">
                  <p className="text-[11px] uppercase text-muted-foreground">Budget util.</p>
                  <p className="text-sm font-semibold tabular-nums">
                    {tot?.utilisationPct != null ? `${tot.utilisationPct}%` : d.budgetUtilisationPct != null ? `${d.budgetUtilisationPct}%` : "—"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {tot ? `${formatCurrency(tot.actualMinor)} / ${formatCurrency(tot.plannedMinor)}` : "Map categories to Finance"}
                  </p>
                </div>
              </Link>
              <Link href="/corporate-strategy/risks">
                <div className="rounded-lg border p-3 cursor-pointer hover:border-primary/40">
                  <p className="text-[11px] uppercase text-muted-foreground">Open risks</p>
                  <p className="text-sm font-semibold tabular-nums">{d.openRisks ?? 0}</p>
                </div>
              </Link>
              <Link href="/corporate-strategy/products">
                <div className="rounded-lg border p-3 cursor-pointer hover:border-primary/40">
                  <p className="text-[11px] uppercase text-muted-foreground">Products</p>
                  <p className="text-sm font-semibold tabular-nums">
                    {d.productsActive ?? 0}/{d.productsTotal ?? 0}
                  </p>
                </div>
              </Link>
            </div>
            {(d.insights || []).slice(0, 2).map((i: any) => (
              <p key={i.id} className="text-xs text-muted-foreground border-l-2 border-primary/40 pl-2">
                <span className="font-medium text-foreground">{i.title}</span> — {i.detail}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
