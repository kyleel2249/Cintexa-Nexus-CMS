import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Landmark, ArrowRight } from "lucide-react";
import { fin, fmtMoney, getFinanceOrg } from "@/lib/finance/api";

interface Kpi { value: string; formula: string }
interface Dash {
  currency: string;
  as_of: string;
  has_postings: boolean;
  kpis: Record<string, Kpi | null>;
}

export function FiDashboardWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["fi", "dashboard-widget", getFinanceOrg()],
    queryFn: async () => {
      try {
        return await fin.get<Dash>("/dashboard");
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  const money = (k: Kpi | null | undefined) => (k ? fmtMoney(k.value, data?.currency ?? "GHS") : "—");

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Landmark className="h-5 w-5 text-primary" />
            Financial Intelligence
          </CardTitle>
          <CardDescription className="mt-1.5">
            Live indicators from posted Finance ledger data. Click through for analysis.
          </CardDescription>
        </div>
        <Link href="/financial-intelligence">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium px-3 py-2 cursor-pointer hover:opacity-90">
            Open <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
          </div>
        ) : isError || !data ? (
          <p className="text-sm text-muted-foreground">
            Finance data is not available yet. Set up CINTEXA Finance or check your permissions.{" "}
            <Link href="/financial-intelligence"><span className="text-primary underline cursor-pointer">Open module</span></Link>
          </p>
        ) : !data.has_postings ? (
          <p className="text-sm text-muted-foreground">
            No posted transactions yet — figures will appear after journals are posted. Nothing here is sample data.{" "}
            <Link href="/financial-intelligence"><span className="text-primary underline cursor-pointer">Open Financial Intelligence</span></Link>
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Revenue", href: "/financial-intelligence/revenue", value: money(data.kpis.revenue) },
              { label: "Net profit", href: "/financial-intelligence/profit-loss", value: money(data.kpis.net_profit) },
              { label: "Cash & bank", href: "/financial-intelligence/cashflow", value: money(data.kpis.cash_and_bank) },
              { label: "Net margin", href: "/financial-intelligence/ratios", value: data.kpis.net_margin_pct ? `${data.kpis.net_margin_pct.value}%` : "—" },
            ].map((x) => (
              <Link key={x.label} href={x.href}>
                <div className="rounded-xl border bg-background/60 p-3 cursor-pointer hover:border-primary/40 transition">
                  <div className="text-xs text-muted-foreground">{x.label}</div>
                  <div className="text-lg font-semibold mt-1 tabular-nums">{x.value}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
