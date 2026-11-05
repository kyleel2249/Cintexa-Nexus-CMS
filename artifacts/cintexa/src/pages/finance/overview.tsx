import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { finGet, formatCurrency, formatMinor } from "@/lib/finance/api";

import { FINANCE_NAV } from "@/lib/finance/nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";

export default function FinanceOverview() {
  const health = useQuery({
    queryKey: ["fin", "health"],
    queryFn: () => finGet<any>("/health"),
    retry: 1,
    staleTime: 30_000,
  });
  const q = useQuery({
    queryKey: ["fin", "dash"],
    queryFn: () => finGet<any>("/dashboard"),
    retry: 2,
    staleTime: 15_000,
  });

  if (q.isLoading) {
    return (
      <div className="p-6 grid gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }

  if (q.isError || !q.data) {
    const err = q.error as ApiError | Error | undefined;
    const msg = err instanceof ApiError ? err.message : err?.message || "Request failed";
    const status = err instanceof ApiError ? err.status : 0;
    const h = health.data;
    return (
      <div className="p-6 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>CINTEXA Finance unavailable</CardTitle>
            <CardDescription>
              Could not load /api/finance/dashboard. No third-party API keys are required.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Error:</span> {msg}
              {status ? ` (HTTP ${status})` : ""}
            </p>
            {h && (
              <p>
                Health: API {h.api || "unknown"} · D1 configured={String(h.database?.configured)} ·
                connected={String(h.database?.connected)} · schema={h.database?.schema}
              </p>
            )}
            <ul className="list-disc pl-5 space-y-1">
              <li>Confirm Cloudflare Pages deploys <code className="text-xs">functions/api/finance/[[path]].ts</code></li>
              <li>
                Bind D1 as <code className="text-xs">FIN_DB</code> (database{" "}
                <code className="text-xs">cintexa-finance-db</code>)
              </li>
              <li>
                Schema auto-bootstraps on first request; optional:{" "}
                <code className="text-xs">npx wrangler d1 migrations apply cintexa-finance-db --remote</code>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    );
  }

  const d = q.data;
  const currency = d.currency || "GHS";
  // KPI cards use formatCurrency (symbol + forced two decimals + grouping).
  // formatMinor remains available for dense tables and remains correct after the engine fix.
  const m = (n: number) => formatCurrency(Number(n) || 0, currency);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">CINTEXA Finance</h1>
          <p className="text-sm text-muted-foreground">
            Double-entry · {d.engine} · storage: {d.storage}
            {d.d1Configured === false ? " (bind FIN_DB)" : ""} · API keys: none
          </p>
        </div>
        <Link href="/financial-intelligence">
          <span className="inline-flex items-center rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20 cursor-pointer">
            Financial Intelligence →
          </span>
        </Link>
      </div>

      {d.schemaError && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-3 text-xs text-muted-foreground">
            D1 schema warning: {d.schemaError}. Serving temporary in-memory COA for this request.
          </CardContent>
        </Card>
      )}
      {(d.storage === "isolate-memory" || d.storage === "isolate-memory-dev") && !d.schemaError && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-3 text-xs text-muted-foreground">
            Authoritative store is Cloudflare D1 (FIN_DB). Bind FIN_DB in Pages settings so data survives
            redeploys. Schema is created automatically when D1 is bound.
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
          ["Trial balance", d.trialBalanceBalanced ? "Balanced" : "Out of balance"],
        ].map(([l, v]) => (
          <Card key={l as string}>
            <CardContent className="pt-4">
              <p className="text-[11px] uppercase text-muted-foreground">{l}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight">{v}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Metrics from posted journals only. Empty books show zeros — no fabricated demo balances.
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {FINANCE_NAV.filter((i) => i.key !== "overview").map((i) => (
          <Link key={i.key} href={i.href}>
            <Card className="cursor-pointer hover:border-primary/40">
              <CardContent className="py-3 text-sm font-medium">{i.label}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
