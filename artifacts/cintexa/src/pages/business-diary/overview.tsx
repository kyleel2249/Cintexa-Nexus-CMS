import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { bdGet, bdPost } from "@/lib/business-diary/api";
import { publishNexusEvent } from "@/lib/nexus-sync/api";
import { BD_NAV } from "@/lib/business-diary/nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function BdOverview() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["bd", "dashboard"], queryFn: () => bdGet<any>("/dashboard") });
  const seed = useMutation({
    mutationFn: async () => {
      const r = await bdPost("/seed-demo", {});
      try {
        await publishNexusEvent({
          eventType: "DIARY_ENTRY_CREATED",
          sourceModule: "business-diary",
          entityType: "diary_seed",
          entityId: "demo",
          idempotencyKey: "diary-demo-seed",
          payload: { title: "Demo diary data loaded" },
        });
      } catch { /* sync optional */ }
      return r;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bd"] }),
  });

  if (q.isLoading) {
    return <div className="p-6 grid gap-3 sm:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>;
  }
  if (q.isError || !q.data) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Business Diary unavailable</CardTitle>
            <CardDescription>Deploy Pages Function at /api/diary. No API keys required.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }
  const t = q.data.totals;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">CINTEXA Business Diary</h1>
          <p className="text-sm text-muted-foreground">Institutional memory · native intelligence · zero API keys ({q.data.engine})</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => seed.mutate()} disabled={seed.isPending}>
            {seed.isPending ? "Loading…" : "Load demo data"}
          </Button>
          <Link href="/business-diary/entries"><Button size="sm">New entry</Button></Link>
        </div>
      </div>

      <Card className="border-emerald-500/20 bg-emerald-500/5">
        <CardContent className="py-3 text-xs text-muted-foreground">
          No third-party AI or analytics keys. Insights use rule-based analysis over your stored diary records.
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Entries", t.entries, "/business-diary/entries"],
          ["Today", t.today, "/business-diary/entries"],
          ["This week", t.week, "/business-diary/entries"],
          ["Follow-ups", t.pendingFollowUps, "/business-diary/follow-ups"],
          ["Pitches", t.pitches, "/business-diary/pitches"],
          ["Pitch conversion %", t.pitchConversionPct ?? "—", "/business-diary/pitches"],
          ["Feedback", t.feedback, "/business-diary/feedback"],
          ["Decisions", t.decisions, "/business-diary/decisions"],
        ].map(([label, value, href]) => (
          <Link key={label as string} href={href as string}>
            <Card className="h-full cursor-pointer transition hover:border-primary/40">
              <CardContent className="pt-4">
                <p className="text-[11px] uppercase text-muted-foreground">{label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Recent activities</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(q.data.recent || []).length === 0 && <p className="text-muted-foreground">No entries yet.</p>}
            {(q.data.recent || []).map((e: any) => (
              <div key={e.id} className="rounded border px-3 py-2">
                <p className="font-medium">{e.title}</p>
                <p className="text-xs text-muted-foreground">{e.activityDate} · {e.category}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Upcoming follow-ups</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(q.data.upcomingFollowUps || []).length === 0 && <p className="text-muted-foreground">None pending.</p>}
            {(q.data.upcomingFollowUps || []).map((f: any) => (
              <div key={f.id} className="rounded border px-3 py-2">
                <p className="font-medium">{f.title}</p>
                <p className="text-xs text-muted-foreground">Due {f.dueDate || "—"} · {f.status}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {BD_NAV.filter((i) => i.key !== "overview").map((i) => (
          <Link key={i.key} href={i.href}>
            <Card className="cursor-pointer hover:border-primary/40">
              <CardContent className="py-3 text-sm font-medium">{i.label}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
