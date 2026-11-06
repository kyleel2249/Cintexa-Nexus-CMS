import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SyncSphere3D, type SphereLink, type SphereNode } from "@/components/nexus/SyncSphere3D";
import { syncGet } from "@/lib/nexus-sync/api";
import { finGet, formatCurrency } from "@/lib/finance/api";
import { forecastSeries, type Forecast } from "@/lib/nexus/forecast";

type Registry = { modules: Array<{ id: string; name: string }>; routing: Record<string, string[]> };
type Activity = { published: Array<{ module: string; day: string; n: number }>; received: Array<{ module: string; day: string; n: number }>; flows: Array<{ source: string; target: string; n: number }> };
type Series = { items: Array<{ periodYm: string; revenue: number; expense: number; net: number; cash: number; entries: number }> };

const COLORS: Record<string, string> = {
  sales: "#2563eb", finance: "#059669", "financial-intelligence": "#7c3aed", "business-diary": "#d97706",
  marketing: "#db2777", "corporate-strategy": "#0891b2", dashboard: "#64748b", cms: "#475569",
};
const TOOLS: Array<{ id: string; label: string; href: string }> = [
  { id: "sales", label: "Sales Management", href: "/sales" },
  { id: "marketing", label: "Marketing Management", href: "/marketing" },
  { id: "finance", label: "CINTEXA Finance", href: "/finance" },
  { id: "financial-intelligence", label: "Financial Intelligence", href: "/financial-intelligence" },
  { id: "corporate-strategy", label: "Corporate Strategy", href: "/corporate-strategy" },
  { id: "business-diary", label: "Business Diary", href: "/business-diary" },
  { id: "dashboard", label: "Main Dashboard", href: "/" },
];

/** Weekly totals over the last 8 weeks for one module (events it published plus events delivered to it). */
function weekly(a: Activity | undefined, module: string): number[] {
  const weeks = new Array(8).fill(0) as number[];
  if (!a) return weeks;
  const now = Date.now();
  for (const r of [...a.published, ...a.received]) {
    if (r.module !== module) continue;
    const age = Math.floor((now - new Date(`${r.day}T12:00:00Z`).getTime()) / (7 * 86_400_000));
    if (age >= 0 && age < 8) weeks[7 - age]! += r.n;
  }
  return weeks;
}

function Spark({ values, projected, color }: { values: number[]; projected: number[]; color: string }) {
  const all = [...values, ...projected];
  const max = Math.max(1, ...all), min = Math.min(0, ...all);
  const w = 160, h = 40, step = w / Math.max(1, all.length - 1);
  const y = (v: number) => h - 3 - ((v - min) / (max - min || 1)) * (h - 6);
  const path = (arr: number[], offset: number) => arr.map((v, i) => `${i === 0 ? "M" : "L"}${((i + offset) * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const joinTo = values.length ? values[values.length - 1]! : 0;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10" role="img" aria-label="History and forecast">
      <path d={path(values, 0)} fill="none" stroke={color} strokeWidth="2" />
      {projected.length > 0 && <path d={path([joinTo, ...projected], values.length - 1)} fill="none" stroke={color} strokeWidth="2" strokeDasharray="4 3" opacity="0.7" />}
    </svg>
  );
}

function ForecastLine({ f, fmt }: { f: Forecast; fmt: (n: number) => string }) {
  if (f.method === "insufficient-data") return <p className="text-xs text-muted-foreground">{f.note}</p>;
  const arrow = f.trend === "up" ? "rising" : f.trend === "down" ? "falling" : "steady";
  return (
    <p className="text-xs text-muted-foreground">
      Trend {arrow} ({f.slopePct > 0 ? "+" : ""}{f.slopePct}% per period). Next: <strong className="text-foreground">{f.points.map(fmt).join(" → ")}</strong>.
      {" "}Confidence {f.confidence} ({f.n} periods).
    </p>
  );
}

export default function NexusSynchrony() {
  const registry = useQuery({ queryKey: ["sync", "registry"], queryFn: () => syncGet<Registry>("/registry"), retry: false, staleTime: 60_000 });
  const activity = useQuery({ queryKey: ["sync", "activity"], queryFn: () => syncGet<Activity>("/activity"), retry: false, refetchInterval: 30_000 });
  const series = useQuery({ queryKey: ["fin", "series"], queryFn: () => finGet<Series>("/analytics/series"), retry: false, refetchInterval: 60_000 });

  const nodes: SphereNode[] = useMemo(() => {
    const names = new Map<string, string>();
    for (const t of TOOLS) names.set(t.id, t.label);
    for (const m of registry.data?.modules ?? []) if (!names.has(m.id)) names.set(m.id, m.name);
    return [...names.entries()].map(([id, label]) => ({
      id, label, color: COLORS[id] ?? "#94a3b8",
      weight: weekly(activity.data, id).reduce((a, b) => a + b, 0),
    }));
  }, [registry.data, activity.data]);

  const links: SphereLink[] = useMemo(() => (activity.data?.flows ?? []).map((f) => ({ source: f.source, target: f.target, n: f.n })), [activity.data]);

  const fin = series.data?.items ?? [];
  const finForecasts = useMemo(() => ({
    revenue: forecastSeries(fin.map((m) => m.revenue)),
    expense: forecastSeries(fin.map((m) => m.expense)),
    net: forecastSeries(fin.map((m) => m.net)),
    cash: forecastSeries(fin.map((m) => m.cash)),
  }), [fin]);

  const brief = useMemo(() => {
    const out: string[] = [];
    const n = finForecasts.net;
    if (n.method === "holt-linear") out.push(`Net profit is ${n.trend === "up" ? "improving" : n.trend === "down" ? "weakening" : "steady"}; the next period is projected near ${formatCurrency(n.points[0]!)} (range ${formatCurrency(n.lower[0]!)} to ${formatCurrency(n.upper[0]!)}).`);
    const c = finForecasts.cash;
    if (c.method === "holt-linear" && c.points[0]! < 0) out.push("Cash movement is projected negative next period: review receivables and upcoming payments.");
    const e = finForecasts.expense, r = finForecasts.revenue;
    if (e.method === "holt-linear" && r.method === "holt-linear" && e.slopePct > r.slopePct + 3) out.push("Expenses are growing faster than revenue.");
    const quiet = nodes.filter((x) => (x.weight ?? 0) === 0 && x.id !== "dashboard" && x.id !== "cms").map((x) => x.label);
    if (activity.data && quiet.length) out.push(`No data exchanged in the last 8 weeks with: ${quiet.join(", ")}. Their figures may not yet reflect Finance.`);
    if (!out.length) out.push("Not enough recorded history yet. Post journals and sync events to build forecasts.");
    return out;
  }, [finForecasts, nodes, activity.data]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Nexus Synchrony</h1>
        <p className="text-sm text-muted-foreground">How every tool exchanges data, with forecasts from your own records. Forecasts extrapolate history and cannot know about future events.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">3D synchrony map</CardTitle>
          <CardDescription>Each dot is a tool; line thickness is the number of synced events between two tools. Drag to rotate.</CardDescription>
        </CardHeader>
        <CardContent>
          {registry.isLoading || activity.isLoading ? <Skeleton className="h-[360px] w-full" /> : (
            <>
              <SyncSphere3D nodes={nodes} links={links} />
              {activity.isError && <p className="text-xs text-muted-foreground mt-2">Sync activity is unavailable. Bind a D1 database (NEXUS_DB or FIN_DB) to see live flows.</p>}
              {activity.data && links.length === 0 && <p className="text-xs text-muted-foreground mt-2">No events have been exchanged yet. Post a journal, invoice or payment and lines will appear here.</p>}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-primary/20">
        <CardHeader><CardTitle className="text-base">Decision brief</CardTitle></CardHeader>
        <CardContent><ul className="list-disc pl-5 text-sm space-y-1">{brief.map((b) => <li key={b}>{b}</li>)}</ul></CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {([["Revenue", "revenue", "#059669"], ["Expenses", "expense", "#dc2626"], ["Net profit", "net", "#7c3aed"], ["Cash movement", "cash", "#2563eb"]] as const).map(([label, key, color]) => (
          <Card key={key}>
            <CardHeader className="pb-2"><CardTitle className="text-sm">{label} (monthly, from posted journals)</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {series.isLoading ? <Skeleton className="h-10 w-full" /> : series.isError ? <p className="text-xs text-muted-foreground">Finance data is unavailable.</p> : (
                <>
                  <Spark values={fin.map((m) => m[key])} projected={finForecasts[key].points} color={color} />
                  <ForecastLine f={finForecasts[key]} fmt={(n) => formatCurrency(n)} />
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {TOOLS.map((t) => {
          const vals = weekly(activity.data, t.id);
          const f = forecastSeries(vals);
          return (
            <Card key={t.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm"><Link href={t.href}><span className="cursor-pointer hover:underline">{t.label}</span></Link></CardTitle>
                <CardDescription>Synced events per week (8 weeks)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Spark values={vals} projected={f.points.map((p) => Math.max(0, p))} color={COLORS[t.id] ?? "#64748b"} />
                <ForecastLine f={f} fmt={(n) => String(Math.max(0, n))} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
