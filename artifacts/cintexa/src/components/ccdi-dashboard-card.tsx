/**
 * CINTEXA CCDI — Dashboard overview card
 * Links to /ccdi and shows live health phase when available.
 */
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Shield, ArrowRight, Activity, AlertTriangle, Server } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function CcdiDashboardCard() {
  const health = useQuery({
    queryKey: ["ccdi", "health", "dashboard"],
    queryFn: () =>
      fetchJson<{ phase: number; status: string; killSwitchActive?: boolean; message?: string }>("/ccdi/health"),
    retry: false,
    staleTime: 30_000,
  });

  const summary = useQuery({
    queryKey: ["ccdi", "command-centre", "dashboard"],
    queryFn: () =>
      fetchJson<{
        summary: {
          assets?: { total?: number; high_risk?: number };
          findings?: { open?: number; critical?: number; high?: number };
          jobs?: { running?: number; queued?: number };
          killSwitchActive?: boolean;
        };
      }>("/ccdi/command-centre"),
    retry: false,
    staleTime: 30_000,
  });

  const s = summary.data?.summary;
  const phase = health.data?.phase;
  const kill = health.data?.killSwitchActive ?? s?.killSwitchActive;

  return (
    <Card className="border-cyan-500/20 bg-gradient-to-br from-slate-950/80 via-card to-card overflow-hidden relative">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,rgba(6,182,212,0.08),transparent_55%)]" />
      <CardHeader className="flex flex-row items-start justify-between gap-3 relative">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/15 ring-1 ring-cyan-400/30">
              <Shield className="h-4 w-4 text-cyan-400" />
            </span>
            Cyber Defense (CCDI)
          </CardTitle>
          <CardDescription className="mt-1.5">
            Advanced Cyber Defense & Security Intelligence — authorised assessments, findings, and reporting.
          </CardDescription>
        </div>
        <Link href="/ccdi">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-cyan-500 text-slate-950 text-sm font-medium px-3 py-2 cursor-pointer hover:bg-cyan-400 transition-colors">
            Open Command Centre <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      </CardHeader>
      <CardContent className="relative space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {phase != null && (
            <span className="rounded-full bg-cyan-500/15 text-cyan-300 px-2.5 py-0.5 font-medium ring-1 ring-cyan-500/20">
              Phase {phase}
            </span>
          )}
          {health.data?.status && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-muted-foreground ring-1 ring-border">
              {health.data.status}
            </span>
          )}
          {kill && (
            <span className="rounded-full bg-rose-500/15 text-rose-300 px-2.5 py-0.5 font-medium ring-1 ring-rose-500/30">
              Emergency stop active
            </span>
          )}
          {health.isError && (
            <span className="text-muted-foreground">API not reachable yet — open Command Centre after bootstrap.</span>
          )}
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <MiniStat
            icon={<Server className="h-3.5 w-3.5 text-cyan-400" />}
            label="Assets"
            value={s?.assets?.total ?? "—"}
            hint={s?.assets?.high_risk != null ? `${s.assets.high_risk} high risk` : "inventory"}
          />
          <MiniStat
            icon={<AlertTriangle className="h-3.5 w-3.5 text-rose-400" />}
            label="Open findings"
            value={s?.findings?.open ?? "—"}
            hint={
              s?.findings
                ? `${s.findings.critical ?? 0} critical · ${s.findings.high ?? 0} high`
                : "evidence-backed"
            }
          />
          <MiniStat
            icon={<Activity className="h-3.5 w-3.5 text-amber-400" />}
            label="Jobs"
            value={
              s?.jobs
                ? (s.jobs.running ?? 0) + (s.jobs.queued ?? 0)
                : "—"
            }
            hint={
              s?.jobs
                ? `${s.jobs.running ?? 0} running · ${s.jobs.queued ?? 0} queued`
                : "orchestration"
            }
          />
        </div>

        <p className="text-[11px] text-muted-foreground">
          All assessment jobs require an approved scope and human approval. Metrics are evidence-backed only.
        </p>
      </CardContent>
    </Card>
  );
}

function MiniStat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/50 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>
    </div>
  );
}
