import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { finGet, formatMinor } from "@/lib/finance/api";
import { FINANCE_NAV } from "@/lib/finance/nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function FinanceOverview() {
  const q = useQuery({ queryKey: ["fin", "dash"], queryFn: () => finGet<any>("/dashboard") });

  if (q.isLoading) return <div className="p-6 grid gap-3 sm:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>;
  if (q.isError || !q.data) {
    return (
      <div className="p-6">
        <Card><CardHeader><CardTitle>CINTEXA Finance unavailable</CardTitle>
          <CardDescription>Deploy Pages Function at /api/finance. No API keys required. Bind FIN_DB for D1 persistence.</CardDescription>
        </CardHeader></Card>
      </div>
    );
  }
  const d = q.data;
  const m = (n: number) => formatMinor(n, d.currency || "GHS");

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">CINTEXA Finance</h1>
        <p className="text-sm text-muted-foreground">
          Double-entry · {d.engine} · storage: {d.storage}{d.d1Configured === false ? " (bind FIN_DB)" : ""} · API keys: none
        </p>
      </div>
      {d.storage === "isolate-memory" && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-3 text-xs text-muted-foreground">
            Authoritative store is Cloudflare D1 (FIN_DB). If storage is not d1, bind FIN_DB and run: npx wrangler d1 migrations apply cintexa-finance-db --remote
          </CardContent>
        </Card>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Gross / net revenue", m(d.grossRevenue ?? d.revenue)],
          ["Discount Allowed", m(d.discountAllowed || 0)],
          ["Expenses (posted)", m(d.expense)],
          ["Net profit", m(d.netProfit)],
          ["Cash + bank", m(d.cash)],
          ["Accounts receivable", m(d.accountsReceivable)],
          ["Assets", m(d.assets)],
          ["Liabilities", m(d.liabilities)],
          ["Trial balance", d.trialBalanceBalanced ? "Balanced" : "Out of balance"],
        ].map(([l, v]) => (
          <Card key={l as string}><CardContent className="pt-4">
            <p className="text-[11px] uppercase text-muted-foreground">{l}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{v}</p>
          </CardContent></Card>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Metrics from posted journals only. Empty books show zeros — no fabricated demo balances.</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {FINANCE_NAV.filter((i) => i.key !== "overview").map((i) => (
          <Link key={i.key} href={i.href}>
            <Card className="cursor-pointer hover:border-primary/40"><CardContent className="py-3 text-sm font-medium">{i.label}</CardContent></Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
