import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fiGet, fiPost, formatCurrency, formatMinor } from "@/lib/financial-intelligence/api";
import { generateFinancialClues, type FinancialClue } from "@/lib/financial-intelligence/engine";

import { publishNexusEvent } from "@/lib/nexus-sync/api";
import { FI_NAV, FI_SECTIONS } from "@/lib/financial-intelligence/nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Dash {
  currency: string;
  asOf: string;
  hasPostings: boolean;
  pnl: {
    revenue: number; expenses?: number; operatingExpenses: number; netProfit: number;
    grossProfit: number; netMarginPct: number | null;
  };
  balanceSheet: { assets: number; liabilities: number; equity: number; balanced: boolean };
  health: { score: number | null; insufficientData: boolean };
  alerts: { id: string; level: string; title: string; evidence: string }[];
  engine: string;
}

export default function FiOverview() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["fi", "dashboard"],
    queryFn: () => fiGet<Dash>("/dashboard"),
  });
  const seed = useMutation({
    mutationFn: async () => {
      const r = await fiPost<{ message: string }>("/seed-demo", {});
      try {
        await publishNexusEvent({
          eventType: "FI_ENTRY_POSTED",
          sourceModule: "financial-intelligence",
          entityType: "fi_seed",
          entityId: "demo",
          idempotencyKey: "fi-demo-seed",
          payload: { title: "Demo FI journals posted" },
        });
      } catch { /* sync optional */ }
      return r;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fi"] }),
  });

  if (q.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Financial Intelligence unavailable</CardTitle>
            <CardDescription>
              Could not reach /api/fi. Ensure Cloudflare Pages Functions are deployed (functions/api/fi). No third-party API keys are required.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const d = q.data;
  const money = (n: number) => formatCurrency(n, d.currency || "GHS");
  const clues: FinancialClue[] = generateFinancialClues({
    currency: d.currency || "GHS",
    periodLabel: d.asOf || "current period",
    revenue: d.pnl?.revenue ?? 0,
    expense: d.pnl?.operatingExpenses ?? d.pnl?.expenses ?? 0,
    netProfit: d.pnl?.netProfit ?? 0,
    cash: 0, // cash is not always on the FI dashboard payload; AR/assets used as proxies where needed
    accountsReceivable: 0,
    assets: d.balanceSheet?.assets,
    liabilities: d.balanceSheet?.liabilities,
    equity: d.balanceSheet?.equity,
    trialBalanceBalanced: d.balanceSheet?.balanced,
  });


  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">CINTEXA Finance — Financial Intelligence</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Native engine ({d.engine}). As of {d.asOf}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={seed.isPending} onClick={() => seed.mutate()}>
            {seed.isPending ? "Seeding…" : "Load demo journals"}
          </Button>
          <Link href="/financial-intelligence/entries"><Button size="sm">Journal entries</Button></Link>
        </div>
      </div>

      <Card className="border-emerald-500/20 bg-emerald-500/5">
        <CardContent className="py-3 text-xs text-muted-foreground">
          Zero external AI/finance API keys. Calculations use posted journals only. Demo seed is labelled DEMO_SEED and is not live market data.
        </CardContent>
      </Card>

      {!d.hasPostings && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No posted activity</CardTitle>
            <CardDescription>
              Post balanced journal entries or load the demo pack. Metrics stay empty until real postings exist — nothing is invented.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Revenue", money(d.pnl.revenue), "/financial-intelligence/profit-loss"],
          ["Operating expenses", money(d.pnl.operatingExpenses), "/financial-intelligence/profit-loss"],
          ["Gross profit", money(d.pnl.grossProfit), "/financial-intelligence/profit-loss"],
          ["Net profit", money(d.pnl.netProfit), "/financial-intelligence/profit-loss"],
          ["Assets", money(d.balanceSheet.assets), "/financial-intelligence/balance-sheet"],
          ["Liabilities", money(d.balanceSheet.liabilities), "/financial-intelligence/balance-sheet"],
          ["Equity", money(d.balanceSheet.equity), "/financial-intelligence/balance-sheet"],
          ["Health score", d.health.score != null ? String(d.health.score) : "—", "/financial-intelligence/health"],
        ].map(([label, value, href]) => (
          <Link key={label as string} href={href as string}>
            <Card className="h-full transition hover:border-primary/40 cursor-pointer">
              <CardContent className="pt-4">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {clues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Intelligent visual clues</CardTitle>
            <CardDescription>
              Deterministic interpretations of posted ledger figures — no external AI, no fabricated metrics.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {clues.map((c) => {
              const tone =
                c.severity === "positive" || c.severity === "opportunity"
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : c.severity === "critical"
                    ? "border-red-500/30 bg-red-500/5"
                    : c.severity === "elevated"
                      ? "border-orange-500/30 bg-orange-500/5"
                      : c.severity === "caution"
                        ? "border-yellow-500/30 bg-yellow-500/5"
                        : "border-sky-500/20 bg-sky-500/5";
              return (
                <div key={c.id} className={`rounded-lg border px-3 py-3 text-sm ${tone}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {c.severity}
                    </span>
                    <span className="text-[10px] text-muted-foreground">· {c.confidence} confidence</span>
                  </div>
                  <p className="mt-1 font-medium">{c.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{c.whatHappened}</p>
                  <p className="mt-1 text-xs"><span className="font-medium">Why it matters:</span> {c.whyItMatters}</p>
                  <p className="mt-1 text-xs"><span className="font-medium">Recommended:</span> {c.recommendedAction}</p>
                  {Object.keys(c.supportingFigures).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {Object.entries(c.supportingFigures).map(([k, v]) => (
                        <span key={k} className="rounded bg-background/60 px-2 py-0.5 text-[11px] tabular-nums">
                          {k}: {v}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {d.alerts?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Alerts</CardTitle>
            <CardDescription>Rule-based signals from posted data</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {d.alerts.map((a) => (
              <div key={a.id} className="rounded-md border px-3 py-2 text-sm">
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">{a.level}</span>
                <p className="font-medium">{a.title}</p>
                <p className="text-xs text-muted-foreground">{a.evidence}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}


      <div className="space-y-4">
        {FI_SECTIONS.filter((s) => s !== "Overview").map((section) => {
          const items = FI_NAV.filter((i) => i.section === section);
          if (!items.length) return null;
          return (
            <div key={section}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{section}</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((i) => (
                  <Link key={i.key} href={i.href}>
                    <Card className="cursor-pointer transition hover:border-primary/40">
                      <CardContent className="py-3 text-sm font-medium">{i.label}</CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
