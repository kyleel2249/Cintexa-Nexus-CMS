import { useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { marketingApi } from "@/lib/marketing/api";
import { ArrowLeft } from "lucide-react";

const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PLANNED", "ARCHIVED"],
  PLANNED: ["APPROVED", "DRAFT", "ARCHIVED"],
  APPROVED: ["ACTIVE", "PLANNED", "ARCHIVED"],
  ACTIVE: ["PAUSED", "COMPLETED", "ARCHIVED"],
  PAUSED: ["ACTIVE", "COMPLETED", "ARCHIVED"],
  COMPLETED: ["ARCHIVED"],
  ARCHIVED: [],
};

export default function CampaignDetail() {
  const [, params] = useRoute("/marketing/campaigns/:id");
  const id = params?.id;
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["marketing", "campaign", id],
    enabled: !!id,
    queryFn: () => marketingApi.getCampaign(Number(id)),
  });

  const transition = useMutation({
    mutationFn: (status: string) => marketingApi.transitionCampaign(Number(id), status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["marketing"] }),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading campaign…</div>;
  if (error || !data) return <div className="p-6 text-sm text-destructive">Campaign not found.</div>;

  const next = TRANSITIONS[data.status] || [];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/marketing/campaigns">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold truncate">{data.name}</h1>
            <Badge>{data.status}</Badge>
            <Badge variant="outline">{data.priority}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">{data.number}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {next.map((s) => (
          <Button key={s} size="sm" variant={s === "ARCHIVED" ? "destructive" : "secondary"}
            disabled={transition.isPending}
            onClick={() => transition.mutate(s)}>
            Move to {s}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Details</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            <Row label="Objective" value={data.objective || "—"} />
            <Row label="Budget" value={String(data.budget ?? 0)} />
            <Row label="Spent" value={String(data.spent ?? 0)} />
            <Row label="Start" value={data.start_date || "—"} />
            <Row label="End" value={data.end_date || "—"} />
            <Row label="Channels" value={(data.channels || []).join(", ") || "—"} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Activity</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-64 overflow-auto">
            {(data.activities || []).slice().reverse().map((a: any, i: number) => (
              <div key={i} className="text-xs border-b last:border-0 pb-2">
                <p className="font-medium">{a.summary || a.action}</p>
                <p className="text-muted-foreground">{a.at}</p>
              </div>
            ))}
            {!(data.activities || []).length && <p className="text-xs text-muted-foreground">No activity yet.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
