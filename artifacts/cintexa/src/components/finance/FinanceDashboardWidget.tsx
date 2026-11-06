import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Landmark, ArrowRight } from "lucide-react";
import { finGet, formatCurrency } from "@/lib/finance/api";
import { useRatios, fmtRatio } from "@/components/finance/RatioPanel";


export function FinanceDashboardWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["fin", "widget"],
    queryFn: () => finGet<any>("/dashboard"),
    staleTime: 60_000,
    retry: false,
  });

  const ratios = useRatios();
  const key = ["current_ratio", "net_margin", "cac", "ltv_cac"].map((id) => ratios.data?.ratios.find((r) => r.id === id)).filter(Boolean) as NonNullable<typeof ratios.data>["ratios"];

  return (
    <Card className="border-primary/20">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Landmark className="h-5 w-5 text-primary" />
            CINTEXA Finance
          </CardTitle>
          <CardDescription className="mt-1.5">Double-entry · posted journals only</CardDescription>
        </div>
        <Link href="/finance">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium px-3 py-2 cursor-pointer">
            Open <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-14" /> : isError || !data ? (
          <p className="text-sm text-muted-foreground">Finance API offline. Deploy /api/finance.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ["Revenue", formatCurrency(data.revenue, data.currency || "GHS")],
              ["Net profit", formatCurrency(data.netProfit, data.currency || "GHS")],
              ["Cash", formatCurrency(data.cash, data.currency || "GHS")],
              ["AR", formatCurrency(data.accountsReceivable, data.currency || "GHS")],
            ].map(([l, v]) => (
              <div key={l as string} className="rounded-lg border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">{l}</p>
                <p className="text-sm font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </div>
        )}
        {key.length > 0 && (
          <div className="mt-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {key.map((r) => (
                <div key={r.id} className="rounded-lg border p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">{r.name}</p>
                  <p className={`text-sm font-semibold tabular-nums ${r.reading === "watch" ? "text-amber-600" : ""}`}>{fmtRatio(r.value, r.unit)}</p>
                </div>
              ))}
            </div>
            <Link href="/finance/ratios"><span className="mt-2 inline-block text-xs text-primary cursor-pointer">All financial ratios and what they mean</span></Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
