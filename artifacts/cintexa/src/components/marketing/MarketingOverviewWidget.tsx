import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Send, ArrowRight } from "lucide-react";
import { marketingApi } from "@/lib/marketing/api";
import { useMarketingSubscription } from "@/lib/marketing/useMarketingSubscription";

type Overview = {
  kpis: {
    activeCampaigns: number;
    draftCampaigns: number;
    totalBudget: number;
    totalSpent: number;
    budgetUtilization: number;
    contentItems?: number;
  };
  recentCampaigns: {
    id: number;
    name: string;
    status: string;
    number?: string;
    metadata?: {
      strategy_id?: number | null;
      objective_id?: number | null;
      persona_id?: number | null;
      funnel_id?: number | null;
      brand_id?: number | null;
    };
  }[];
};

function linkScore(m?: Overview["recentCampaigns"][0]["metadata"]) {
  if (!m) return 0;
  return [m.strategy_id, m.objective_id, m.persona_id, m.funnel_id, m.brand_id].filter((x) => x != null).length;
}

export function MarketingOverviewWidget({ compact }: { compact?: boolean }) {
  useMarketingSubscription();
  const { data, isLoading, error } = useQuery({
    queryKey: ["marketing", "overview", "widget"],
    queryFn: () => marketingApi.overview() as Promise<Overview>,
    staleTime: 30_000,
    retry: 1,
  });

  const k = data?.kpis;
  const recent = data?.recentCampaigns || [];
  const avgLink =
    recent.length > 0
      ? recent.reduce((s, c) => s + linkScore(c.metadata), 0) / recent.length
      : null;

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm h-full">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" />
          Marketing
        </CardTitle>
        <Link href="/marketing" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
          Open <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <p className="text-xs text-muted-foreground">Marketing module unavailable.</p>
        )}
        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {k && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md bg-muted/50 px-2 py-2">
              <p className="text-lg font-semibold tabular-nums">{k.activeCampaigns}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Active</p>
            </div>
            <div className="rounded-md bg-muted/50 px-2 py-2">
              <p className="text-lg font-semibold tabular-nums">{k.draftCampaigns}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Draft</p>
            </div>
            <div className="rounded-md bg-muted/50 px-2 py-2">
              <p className="text-lg font-semibold tabular-nums">
                {avgLink != null ? avgLink.toFixed(1) : "—"}
                <span className="text-xs font-normal">/5</span>
              </p>
              <p className="text-[10px] text-muted-foreground uppercase">Linked</p>
            </div>
          </div>
        )}
        {!compact &&
          recent.slice(0, 3).map((c) => (
            <Link key={c.id} href={`/marketing/campaigns/${c.id}`}>
              <div className="flex items-center justify-between rounded-md border px-2 py-1.5 hover:bg-muted/40 text-sm gap-2">
                <span className="truncate">{c.name}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <Badge variant="outline" className="text-[9px]">{linkScore(c.metadata)}/5</Badge>
                  <Badge variant="secondary" className="text-[10px]">{c.status}</Badge>
                </div>
              </div>
            </Link>
          ))}
        {!isLoading && !error && !recent.length && (
          <p className="text-xs text-muted-foreground text-center py-2">
            No campaigns yet.{" "}
            <Link href="/marketing/campaigns" className="underline">Create one</Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
