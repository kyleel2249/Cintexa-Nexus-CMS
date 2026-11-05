import { useEffect, useMemo, useState } from "react";
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

type RangeKey = "all" | "7" | "30" | "90" | "month";

function inRange(iso: string | undefined, range: RangeKey): boolean {
  if (range === "all" || !iso) return range === "all";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const now = Date.now();
  if (range === "7") return t >= now - 7 * 864e5;
  if (range === "30") return t >= now - 30 * 864e5;
  if (range === "90") return t >= now - 90 * 864e5;
  if (range === "month") {
    const d = new Date();
    return new Date(iso).getMonth() === d.getMonth() && new Date(iso).getFullYear() === d.getFullYear();
  }
  return true;
}

export default function MarketingAnalyticsPage() {
  const [range, setRange] = useState<RangeKey>("all");
  const [campaignId, setCampaignId] = useState<string>("all");

  useEffect(() => {
    marketingIntel.ensureSeed();
  }, []);

  const overview = useQuery({ queryKey: ["marketing", "overview"], queryFn: () => marketingApi.overview() });
  const campaigns = useQuery({ queryKey: ["marketing", "campaigns"], queryFn: () => marketingApi.listCampaigns() });
  const objectives = useQuery({ queryKey: ["mkt", "objectives"], queryFn: () => marketingIntel.listObjectives() });
  const funnels = useQuery({ queryKey: ["mkt", "funnels"], queryFn: () => marketingIntel.listFunnels() });

  const filteredCampaigns = useMemo(() => {
    let list = campaigns.data?.items || [];
    if (campaignId !== "all") list = list.filter((c) => String(c.id) === campaignId);
    list = list.filter((c) => inRange(c.updated_at || c.created_at, range));
    return list;
  }, [campaigns.data, campaignId, range]);

  const k = overview.data?.kpis;
  const active = filteredCampaigns.filter((c) => c.status === "ACTIVE").length;
  const budget = filteredCampaigns.reduce((s, c) => s + Number(c.budget || 0), 0);
  const spent = filteredCampaigns.reduce((s, c) => s + Number(c.spent || 0), 0);
  const util = budget > 0 ? Math.round((spent / budget) * 1000) / 10 : 0;

  const exportCsv = () => {
    const rows = filteredCampaigns.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      number: (c as any).number,
      budget: c.budget,
      spent: c.spent,
    }));
    const csv = marketingIntel.toCsv(rows as any);
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "marketing-campaigns-filtered.csv";
    a.click();
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Marketing Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Local records only. Filters use campaign updated/created timestamps when present.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={exportCsv}>Export filtered CSV</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={range} onChange={(e) => setRange(e.target.value as RangeKey)}>
          <option value="all">All time</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="month">This month</option>
        </select>
        <select className="h-9 rounded-md border bg-background px-2 text-sm min-w-[160px]" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
          <option value="all">All campaigns</option>
          {(campaigns.data?.items || []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <Badge variant="secondary" className="self-center text-[10px]">{filteredCampaigns.length} campaigns in filter</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Campaigns in filter" value={filteredCampaigns.length} provenance="CALCULATED" />
        <Metric label="Active (filtered)" value={active} provenance="CALCULATED" />
        <Metric label="Budget (filtered)" value={budget} provenance="CALCULATED" />
        <Metric label="Utilisation" value={`${util}%`} provenance="CALCULATED" />
        <Metric label="Leads (all local)" value={k?.leadsGenerated ?? "—"} provenance="MEASURED" />
        <Metric label="Qualified leads" value={k?.qualifiedLeads ?? "—"} provenance="MEASURED" />
        <Metric label="Objectives" value={objectives.data?.items.length ?? "—"} provenance="MEASURED" />
        <Metric label="Funnels" value={funnels.data?.items.length ?? "—"} provenance="MEASURED" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Campaign drill-down</CardTitle>
          <CardDescription>Spend and status from stored campaign records. ROI requires revenue — not invented.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {filteredCampaigns.map((c) => {
            const b = Number(c.budget || 0);
            const s = Number(c.spent || 0);
            const u = b > 0 ? Math.round((s / b) * 1000) / 10 : null;
            return (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.status} · budget {b} · spent {s}</p>
                </div>
                <div className="text-xs text-right">
                  <p>Util {u != null ? `${u}%` : "—"}</p>
                  <p className="text-muted-foreground">ROI: INSUFFICIENT DATA</p>
                </div>
              </div>
            );
          })}
          {!filteredCampaigns.length && <p className="text-sm text-muted-foreground text-center py-6">No campaigns in this filter.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Reports</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv}>Campaigns CSV</Button>
          <Button size="sm" variant="outline" onClick={async () => {
            const json = await marketingIntel.exportJson();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
            a.download = "marketing-full-report.json";
            a.click();
          }}>Full JSON</Button>
        </CardContent>
      </Card>
    </div>
  );
}
