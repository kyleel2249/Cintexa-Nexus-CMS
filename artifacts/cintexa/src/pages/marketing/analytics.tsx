import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { marketingApi, marketingIntel } from "@/lib/marketing/api";

function Metric({ label, value, provenance }: { label: string; value: string | number; provenance: string }) {
  return (
    <Card>
      <CardContent className="pt-4 space-y-1">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
        <Badge variant="outline" className="text-[10px]">{provenance}</Badge>
      </CardContent>
    </Card>
  );
}

export default function MarketingAnalyticsPage() {
  useEffect(() => { marketingIntel.ensureSeed(); }, []);

  const overview = useQuery({ queryKey: ["marketing", "overview"], queryFn: () => marketingApi.overview() });
  const objectives = useQuery({ queryKey: ["mkt", "objectives"], queryFn: () => marketingIntel.listObjectives() });
  const funnels = useQuery({ queryKey: ["mkt", "funnels"], queryFn: () => marketingIntel.listFunnels() });
  const k = overview.data?.kpis;

  const exportCsv = () => {
    const rows = (overview.data?.recentCampaigns || []).map((c) => ({
      id: c.id, name: c.name, status: c.status, number: (c as any).number,
    }));
    const csv = marketingIntel.toCsv(rows as any);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "marketing-campaigns.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Marketing Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Metrics from local marketing records only. No fabricated traffic, opens or ad impressions.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={exportCsv}>Export campaigns CSV</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Active campaigns" value={k?.activeCampaigns ?? "—"} provenance="CALCULATED" />
        <Metric label="Leads generated" value={k?.leadsGenerated ?? "—"} provenance="MEASURED" />
        <Metric label="Qualified leads" value={k?.qualifiedLeads ?? "—"} provenance="MEASURED" />
        <Metric label="Budget utilisation" value={k ? `${k.budgetUtilization}%` : "—"} provenance="CALCULATED" />
        <Metric label="Content items" value={k?.contentItems ?? "—"} provenance="MEASURED" />
        <Metric label="Email campaigns" value={k?.emailCampaigns ?? "—"} provenance="MEASURED" />
        <Metric label="Objectives" value={objectives.data?.items.length ?? "—"} provenance="MEASURED" />
        <Metric label="Funnels" value={funnels.data?.items.length ?? "—"} provenance="MEASURED" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Provenance legend</CardTitle>
          <CardDescription>
            MEASURED = stored records · CALCULATED = derived · MANUAL = user entered · UNAVAILABLE = missing data.
            External channel metrics are intentionally not invented.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
