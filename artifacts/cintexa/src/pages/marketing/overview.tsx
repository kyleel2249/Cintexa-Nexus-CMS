import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Gauge, Send, CalendarDays, DollarSign, Users, TrendingUp, Plus } from "lucide-react";
import { marketingApi } from "@/lib/marketing/api";

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
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["marketing", "overview"],
    queryFn: async () => {
      return marketingApi.overview() as Promise<OverviewData>;
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
