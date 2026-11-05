import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Target, Palette, ArrowRight } from "lucide-react";
import { marketingIntel } from "@/lib/marketing/api";
import { useMarketingSubscription } from "@/lib/marketing/useMarketingSubscription";

export function StrategyOkrWidget() {
  useMarketingSubscription();
  useEffect(() => { marketingIntel.ensureSeed(); }, []);
  const strategies = useQuery({ queryKey: ["mkt", "strategies", "widget"], queryFn: () => marketingIntel.listStrategies() });
  const objectives = useQuery({ queryKey: ["mkt", "objectives", "widget"], queryFn: () => marketingIntel.listObjectives() });

  const active = (strategies.data?.items || []).filter((s) => s.status === "ACTIVE");
  const objs = objectives.data?.items || [];

  return (
    <Card className="border-border/50 bg-card/50 h-full">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" /> Strategy & OKRs
        </CardTitle>
        <Link href="/marketing/strategy" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
          Open <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-md bg-muted/50 px-2 py-2">
            <p className="text-lg font-semibold tabular-nums">{active.length}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Active strategies</p>
          </div>
          <div className="rounded-md bg-muted/50 px-2 py-2">
            <p className="text-lg font-semibold tabular-nums">{objs.length}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Objectives</p>
          </div>
        </div>
        {objs.slice(0, 3).map((o) => {
          const pct = marketingIntel.objectiveProgress(o);
          return (
            <div key={o.id} className="space-y-1">
              <div className="flex justify-between text-xs gap-2">
                <span className="truncate font-medium">{o.name}</span>
                <span className="tabular-nums text-muted-foreground">{pct}%</span>
              </div>
              <Progress value={pct} className="h-1.5" />
            </div>
          );
        })}
        {!objs.length && <p className="text-xs text-muted-foreground text-center">No objectives yet.</p>}
      </CardContent>
    </Card>
  );
}

export function BrandStatusWidget() {
  useMarketingSubscription();
  useEffect(() => { marketingIntel.ensureSeed(); }, []);
  const brands = useQuery({ queryKey: ["mkt", "brands", "widget"], queryFn: () => marketingIntel.listBrands() });
  const claims = useQuery({
    queryKey: ["mkt", "claims", "widget"],
    queryFn: async () => {
      const b = await marketingIntel.getDefaultBrand();
      return marketingIntel.listClaims(b?.id);
    },
  });
  const brand = brands.data?.items?.find((b) => b.is_default) || brands.data?.items?.[0];
  const approved = (claims.data?.items || []).filter((c) => c.status === "approved").length;

  return (
    <Card className="border-border/50 bg-card/50 h-full">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary" /> Brand
        </CardTitle>
        <Link href="/marketing/brand" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
          Open <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {brand ? (
          <>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-md border shadow-inner" style={{ background: brand.primary_color }} />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{brand.name}</p>
                <p className="text-xs text-muted-foreground truncate">{brand.positioning || brand.mission}</p>
              </div>
            </div>
            <div className="flex gap-1 flex-wrap">
              {brand.tone.slice(0, 4).map((t) => (
                <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{approved} approved claims</p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No brand profile.</p>
        )}
      </CardContent>
    </Card>
  );
}
