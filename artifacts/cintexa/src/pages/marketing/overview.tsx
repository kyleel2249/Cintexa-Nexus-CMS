import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Gauge, Send, CalendarDays, DollarSign, Users, TrendingUp, Plus } from "lucide-react";
import { marketingApi, marketingIntel, marketingExtended } from "@/lib/marketing/api";
import { useMarketingSubscription } from "@/lib/marketing/useMarketingSubscription";

type OverviewData = {
  kpis: {
    activeCampaigns: number;
    draftCampaigns: number;
    scheduledCampaigns: number;
    completedCampaigns: number;
    totalBudget: number;
    totalSpent: number;
    budgetUtilization: number;
    leadsGenerated: number;
    qualifiedLeads: number;
    conversionRate: number | null;
  };
  recentCampaigns: any[];
  upcoming: any[];
};

function money(n: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
}

export default function MarketingOverview() {
  useMarketingSubscription();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["marketing", "overview"],
    queryFn: async () => {
      return marketingApi.overview() as Promise<OverviewData>;
    },
  });
  const activity = useQuery({
    queryKey: ["mkt", "activity"],
    queryFn: () => marketingIntel.listActivity(30),
  });
  const budgetAlerts = useQuery({
    queryKey: ["mkt", "budget-alerts"],
    queryFn: async () => {
      const c = await marketingApi.listCampaigns();
      return marketingExtended.computeBudgetAlerts(c.items as any);
    },
  });

  const k = data?.kpis;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Marketing Overview</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Native campaign intelligence shared across Nexus. All metrics are calculated from stored records.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>Refresh</Button>
          <Link href="/marketing/campaigns">
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New Campaign</Button>
          </Link>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="pt-4 text-sm text-destructive">
            Unable to load marketing overview.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Send} label="Active campaigns" value={isLoading ? "—" : String(k?.activeCampaigns ?? 0)} />
        <KpiCard icon={Gauge} label="Draft / Planned" value={isLoading ? "—" : `${k?.draftCampaigns ?? 0} / ${k?.scheduledCampaigns ?? 0}`} />
        <KpiCard icon={DollarSign} label="Budget utilisation" value={isLoading ? "—" : `${k?.budgetUtilization ?? 0}%`} sub={k ? `${money(k.totalSpent)} of ${money(k.totalBudget)}` : undefined} />
        <KpiCard icon={Users} label="Leads generated" value={isLoading ? "—" : String(k?.leadsGenerated ?? 0)} sub="From shared lead records when available" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent campaigns</CardTitle>
            <CardDescription>Latest activity across the marketing pipeline</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data?.recentCampaigns || []).length === 0 && !isLoading && (
              <p className="text-sm text-muted-foreground py-6 text-center">No campaigns yet. Create your first campaign to get started.</p>
            )}
            {(data?.recentCampaigns || []).map((c) => (
              <Link key={c.id} href={`/marketing/campaigns/${c.id}`}>
                <div className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-muted/50 transition-colors cursor-pointer">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.number}</p>
                  </div>
                  <Badge variant="secondary" className="shrink-0 ml-2">{c.status}</Badge>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Budget alerts</CardTitle>
            <CardDescription>Thresholds from Settings · recorded spend only</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {(budgetAlerts.data || []).slice(0, 5).map((a) => (
              <Link key={a.campaign_id} href={`/marketing/campaigns/${a.campaign_id}`}>
                <div className="flex justify-between gap-2 border-b border-border/40 py-1 hover:bg-muted/30">
                  <span className="truncate">{a.campaign_name}</span>
                  <span className="text-xs tabular-nums shrink-0">{a.pct}% (≥{a.threshold}%)</span>
                </div>
              </Link>
            ))}
            {!(budgetAlerts.data || []).length && (
              <p className="text-xs text-muted-foreground">No campaigns at alert thresholds.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Integration health</CardTitle>
            <CardDescription>Share of campaigns with strategy/OKR/persona/funnel/brand links</CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {(() => {
              const list = data?.recentCampaigns || [];
              if (!list.length) return <p className="text-xs text-muted-foreground">No campaigns yet.</p>;
              const scores = list.map((c: any) => {
                const m = c.metadata || {};
                return [m.strategy_id, m.objective_id, m.persona_id, m.funnel_id, m.brand_id].filter((x) => x != null).length;
              });
              const avg = scores.reduce((a: number, b: number) => a + b, 0) / scores.length;
              const full = scores.filter((s: number) => s >= 4).length;
              return (
                <>
                  <p className="text-2xl font-semibold tabular-nums">{avg.toFixed(1)}<span className="text-sm font-normal text-muted-foreground"> / 5 avg</span></p>
                  <p className="text-xs text-muted-foreground">{full} of {list.length} recent campaigns highly linked (4+)</p>
                  <div className="h-1.5 rounded bg-muted overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${(avg / 5) * 100}%` }} />
                  </div>
                  <Badge variant="outline" className="text-[10px]">CALCULATED from local metadata</Badge>
                  {full < list.length && (
                    <p className="text-xs pt-1">
                      <Link href="/marketing/campaigns" className="underline">
                        {list.length - full} recent campaign(s) still need links
                      </Link>
                      {" "}— open a campaign and complete strategy, OKR, persona, funnel, and brand.
                    </p>
                  )}
                </>
              );
            })()}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent activity</CardTitle>
            <CardDescription>Local marketing actions on this device</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 max-h-48 overflow-y-auto">
            {(activity.data || []).map((a: any) => (
              <div key={a.id} className="flex justify-between gap-2 text-xs border-b border-border/40 py-1">
                <span className="min-w-0 truncate">{a.summary}</span>
                <span className="text-muted-foreground shrink-0">{new Date(a.at).toLocaleString()}</span>
              </div>
            ))}
            {!(activity.data || []).length && (
              <p className="text-xs text-muted-foreground text-center py-4">No activity recorded yet.</p>
            )}
            {(activity.data || []).length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => {
                  const rows = (activity.data || []).map((a: any) => ({
                    at: a.at,
                    action: a.action,
                    entity_type: a.entity_type,
                    entity_id: a.entity_id,
                    summary: a.summary,
                  }));
                  const csv = marketingIntel.toCsv(rows);
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
                  a.download = "marketing-activity.csv";
                  a.click();
                }}
              >
                Export activity CSV
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Upcoming</CardTitle>
            <CardDescription>Campaigns with upcoming start dates</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data?.upcoming || []).length === 0 && !isLoading && (
              <p className="text-sm text-muted-foreground py-6 text-center">No upcoming scheduled campaigns.</p>
            )}
            {(data?.upcoming || []).map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" /> {c.start_date || "No date"}
                  </p>
                </div>
                <Badge variant="outline">{c.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Strategic notes</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>• Metrics are derived only from stored campaign and lead records. No fabricated analytics.</p>
          <p>• Social and email publishing remain manual-confirm workflows (no external platform APIs).</p>
          <p>• Campaign changes emit Nexus sync events so the main dashboard and other modules stay consistent.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-semibold mt-1 tabular-nums">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className="rounded-md bg-primary/10 p-2">
            <Icon className="h-4 w-4 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
