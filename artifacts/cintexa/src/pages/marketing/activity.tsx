import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { marketingIntel } from "@/lib/marketing/api";
import { useMarketingSubscription } from "@/lib/marketing/useMarketingSubscription";

export default function MarketingActivityPage() {
  useMarketingSubscription();
  const [q, setQ] = useState("");
  const [entity, setEntity] = useState("all");
  const [action, setAction] = useState("all");

  useEffect(() => {
    marketingIntel.ensureSeed();
  }, []);

  const activity = useQuery({
    queryKey: ["mkt", "activity"],
    queryFn: () => marketingIntel.listActivity(200),
  });

  const filtered = useMemo(() => {
    let list = activity.data || [];
    if (entity !== "all") list = list.filter((a) => a.entity_type === entity);
    if (action !== "all") list = list.filter((a) => a.action === action);
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter((a) => a.summary.toLowerCase().includes(s) || a.entity_type.includes(s));
    }
    return list;
  }, [activity.data, q, entity, action]);

  const entities = Array.from(new Set((activity.data || []).map((a) => a.entity_type))).sort();
  const actions = Array.from(new Set((activity.data || []).map((a) => a.action))).sort();

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Activity Log</h1>
          <p className="text-sm text-muted-foreground mt-1">Local audit trail of marketing mutations on this device.</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const csv = marketingIntel.toCsv((filtered as any[]) || []);
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
            a.download = "marketing-activity.csv";
            a.click();
          }}
        >
          Export CSV
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="all">All entities</option>
          {entities.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="all">All actions</option>
          {actions.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <Badge variant="secondary" className="self-center text-[10px]">{filtered.length} events</Badge>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Timeline</CardTitle>
          <CardDescription>Newest first · max 200 stored</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 max-h-[60vh] overflow-y-auto">
          {filtered.map((a) => (
            <div key={a.id} className="rounded-md border px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px]">{a.action}</Badge>
                <Badge variant="secondary" className="text-[10px]">{a.entity_type}</Badge>
                <span className="text-xs text-muted-foreground ml-auto">{new Date(a.at).toLocaleString()}</span>
              </div>
              <p className="mt-1">{a.summary}</p>
            </div>
          ))}
          {!filtered.length && <p className="text-sm text-muted-foreground text-center py-8">No matching activity.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
