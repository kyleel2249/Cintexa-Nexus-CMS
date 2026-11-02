/**
 * CINTEXA CCDI — Command Centre (Phase 8 UI)
 * Displays only real data returned by the API. No fabricated statistics.
 */
import { useQuery } from "@tanstack/react-query";
import {
  Shield,
  Server,
  Activity,
  AlertTriangle,
  Building2,
  Bug,
  ListTodo,
  OctagonX,
} from "lucide-react";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  }
  return res.json();
}

type CommandSummary = {
  summary: {
    assets: { total: number; approved: number; high_risk: number };
    jobs?: { total: number; running: number; queued: number; pending_approval: number };
    findings?: { total: number; open: number; critical: number; high: number; medium: number; low: number };
    recentAuditEvents: number;
    killSwitchActive?: boolean;
    phase: number;
    note: string;
  };
};

export default function CcdiCommandCentre() {
  const health = useQuery({
    queryKey: ["ccdi", "health"],
    queryFn: () =>
      fetchJson<{
        module: string;
        phase: number;
        status: string;
        message: string;
        killSwitchActive?: boolean;
      }>("/ccdi/health"),
    refetchInterval: 30_000,
  });

  const summary = useQuery({
    queryKey: ["ccdi", "command-centre"],
    queryFn: () => fetchJson<CommandSummary>("/ccdi/command-centre"),
    refetchInterval: 30_000,
  });

  const orgs = useQuery({
    queryKey: ["ccdi", "organizations"],
    queryFn: () =>
      fetchJson<{ organizations: Array<{ id: string; name: string; slug: string; status: string }> }>(
        "/ccdi/organizations",
      ),
  });

  const s = summary.data?.summary;
  const phase = health.data?.phase ?? s?.phase ?? 8;
  const killActive = health.data?.killSwitchActive ?? s?.killSwitchActive ?? false;

  return (
    <div className="flex-1 overflow-auto">
      <div className="border-b border-border/60 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 px-6 py-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/15 ring-1 ring-cyan-400/30">
                <Shield className="h-6 w-6 text-cyan-400" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">
                  CINTEXA Advanced Cyber Defense
                </h1>
                <p className="text-sm text-slate-400">
                  Security Intelligence Platform — Phase {phase}
                </p>
              </div>
            </div>
            {killActive && (
              <div className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-sm text-rose-200">
                <OctagonX className="h-4 w-4" />
                Emergency stop ACTIVE
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-6 p-6">
        {health.isError && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            CCDI API is not reachable yet. Ensure the API server is running and the database has been
            bootstrapped.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<Server className="h-5 w-5 text-cyan-400" />}
            label="Assets"
            value={s?.assets.total ?? "—"}
            sub={`${s?.assets.approved ?? 0} approved · ${s?.assets.high_risk ?? 0} high risk`}
            loading={summary.isLoading}
          />
          <StatCard
            icon={<Bug className="h-5 w-5 text-rose-400" />}
            label="Open Findings"
            value={s?.findings?.open ?? s?.findings?.total ?? "—"}
            sub={
              s?.findings
                ? `${s.findings.critical ?? 0} critical · ${s.findings.high ?? 0} high`
                : "from findings engine"
            }
            loading={summary.isLoading}
          />
          <StatCard
            icon={<ListTodo className="h-5 w-5 text-amber-400" />}
            label="Jobs"
            value={s?.jobs?.total ?? "—"}
            sub={
              s?.jobs
                ? `${s.jobs.running ?? 0} running · ${s.jobs.queued ?? 0} queued · ${s.jobs.pending_approval ?? 0} pending`
                : "orchestration"
            }
            loading={summary.isLoading}
          />
          <StatCard
            icon={<Activity className="h-5 w-5 text-emerald-400" />}
            label="Audit Events (7d)"
            value={s?.recentAuditEvents ?? "—"}
            sub="real records only"
            loading={summary.isLoading}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border/60 bg-card/40 p-5">
            <h2 className="text-sm font-medium text-muted-foreground">Platform status</h2>
            <p className="mt-2 text-sm text-foreground/90">
              {health.data?.message ??
                "CCDI is initialising. Secure execution requires approved scopes and human approval."}
            </p>
            {s?.note && <p className="mt-3 text-xs text-muted-foreground">{s.note}</p>}
            <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-muted-foreground">Module</dt>
                <dd className="font-medium">{health.data?.module ?? "ccdi"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd className="font-medium">{health.data?.status ?? "—"}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-border/60 bg-card/40 p-5">
            <div className="mb-3 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-violet-400" />
              <h2 className="text-sm font-medium text-muted-foreground">Organisations</h2>
            </div>
            {orgs.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {orgs.data?.organizations.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No organisations yet. Create one via the API.
              </p>
            )}
            <ul className="space-y-2">
              {orgs.data?.organizations.map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2 text-sm"
                >
                  <span className="font-medium">{o.name}</span>
                  <span className="text-xs text-muted-foreground">{o.status}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="rounded-xl border border-dashed border-border/50 bg-card/20 p-4 text-xs text-muted-foreground">
          <p className="font-medium text-foreground/80">Operational notes</p>
          <ul className="mt-2 list-inside list-disc space-y-1">
            <li>All assessment jobs require an approved scope and human approval.</li>
            <li>AI agents are advisory only — no autonomous exploitation.</li>
            <li>Worker claim/heartbeat/complete APIs are available for isolated executors.</li>
            <li>Metrics above are evidence-backed database counts only.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">
        {loading ? "…" : value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
