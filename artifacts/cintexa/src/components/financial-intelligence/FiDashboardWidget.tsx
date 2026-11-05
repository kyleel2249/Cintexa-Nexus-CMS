import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Landmark, ArrowRight } from "lucide-react";
import { fiGet, formatCurrency } from "@/lib/financial-intelligence/api";


export function FiDashboardWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["fi", "widget"],
    queryFn: () => fiGet<any>("/dashboard"),
    staleTime: 60_000,
    retry: false,
  });

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Landmark className="h-5 w-5 text-primary" />
            Financial Intelligence
          </CardTitle>
          <CardDescription className="mt-1.5">Native ledger analytics · no API keys</CardDescription>
        </div>
        <Link href="/financial-intelligence">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium px-3 py-2 cursor-pointer hover:opacity-90">
            Open <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : isError || !data ? (
          <p className="text-sm text-muted-foreground">
            FI API not reachable. Deploy Pages Functions under <code className="text-xs">/api/fi</code>.{" "}
            <Link href="/financial-intelligence"><span className="text-primary underline cursor-pointer">Open module</span></Link>
          </p>
        ) : !data.hasPostings ? (
          <p className="text-sm text-muted-foreground">
            No posted journals yet.{" "}
            <Link href="/financial-intelligence"><span className="text-primary underline cursor-pointer">Add data</span></Link>
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ["Revenue", formatCurrency(data.pnl?.revenue ?? 0, data.currency || "GHS")],
              ["Net profit", formatCurrency(data.pnl?.netProfit ?? 0, data.currency || "GHS")],
              ["Cash/assets", formatCurrency(data.balanceSheet?.assets ?? 0, data.currency || "GHS")],
              ["Health", data.health?.score ?? "—"],
            ].map(([l, v]) => (
              <div key={l as string} className="rounded-lg border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">{l}</p>
                <p className="text-sm font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
