import { Link } from "wouter";
import { ArrowRight, Radar } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useStats } from "@/lib/website-intelligence/api";

/** Dashboard entry for the Website Intelligence Engine. Shows live figures when the API answers; always shows the call to action. */
export function WebsiteIntelligenceCard() {
  const stats = useStats();
  const s = stats.data;
  const tiles = [
    { label: "Audits run", value: s ? String(s.total) : "-" },
    { label: "Running now", value: s ? String(s.running) : "-" },
    { label: "Average score", value: s?.averageScore != null ? String(Math.round(s.averageScore)) : "-" },
  ];
  const latest = s?.sites?.[0];
  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg"><Radar className="h-5 w-5 text-primary" />Website Intelligence</CardTitle>
          <CardDescription className="mt-1.5">Crawl and inspect any site, get evidence-based scores, a prioritised fix list and a PDF report.</CardDescription>
        </div>
        <Link href="/website-intelligence/new">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground cursor-pointer hover:opacity-90">New audit <ArrowRight className="h-3.5 w-3.5" /></span>
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl border bg-background/60 p-3">
              <div className="text-xl font-semibold">{t.value}</div>
              <div className="text-xs text-muted-foreground">{t.label}</div>
            </div>
          ))}
        </div>
        {latest && <p className="text-xs text-muted-foreground">Latest: <b>{latest.hostname}</b>{latest.latest.overall != null ? ` scored ${Math.round(latest.latest.overall)}${latest.latest.provisional ? " (provisional)" : ""}` : " has no score yet"}. <Link href="/website-intelligence/audits"><span className="cursor-pointer text-primary hover:underline">All audits</span></Link></p>}
        {stats.isError && <p className="text-xs text-muted-foreground">Live figures are unavailable right now; you can still start an audit.</p>}
      </CardContent>
    </Card>
  );
}
