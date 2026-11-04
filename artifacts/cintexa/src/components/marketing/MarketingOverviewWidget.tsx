import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Send, ArrowRight } from "lucide-react";
import { marketingApi } from "@/lib/marketing/api";

type Overview = {
  kpis: {
    activeCampaigns: number;
    draftCampaigns: number;
    totalBudget: number;
    totalSpent: number;
    budgetUtilization: number;
    contentItems?: number;
  };
  recentCampaigns: { id: number; name: string; status: string; number?: string }[];
};

export function MarketingOverviewWidget({ compact }: { compact?: boolean }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["marketing", "overview", "widget"],
    queryFn: () => marketingApi.overview() as Promise<Overview>,
    staleTime: 30_000,
    retry: 1,
  });

  const k = data?.kpis;

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
              <p className="text-lg font-semibold tabular-nums">{k.budgetUtilization}%</p>
              <p className="text-[10px] text-muted-foreground uppercase">Budget</p>
            </div>
          </div>
        )}
        {!compact && (data?.recentCampaigns || []).slice(0, 3).map((c) => (
          <Link key={c.id} href={`/marketing/campaigns/${c.id}`}>
            <div className="flex items-center justify-between rounded-md border px-2 py-1.5 hover:bg-muted/40 text-sm">
              <span className="truncate">{c.name}</span>
              <Badge variant="secondary" className="shrink-0 ml-2 text-[10px]">{c.status}</Badge>
            </div>
          </Link>
        ))}
        {!isLoading && !error && !(data?.recentCampaigns || []).length && (
          <p className="text-xs text-muted-foreground text-center py-2">
            No campaigns yet.{" "}
            <Link href="/marketing/campaigns" className="underline">Create one</Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
