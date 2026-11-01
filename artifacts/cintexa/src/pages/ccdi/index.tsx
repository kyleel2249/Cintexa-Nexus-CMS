/**
 * CINTEXA CCDI — Phase 2 Command Centre foundation.
 * Displays only real data returned by the API. No fabricated statistics.
 */
import { useQuery } from "@tanstack/react-query";
import { Shield, Server, Activity, AlertTriangle, Building2 } from "lucide-react";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export default function CcdiCommandCentre() {
  const health = useQuery({
    queryKey: ["ccdi", "health"],
    queryFn: () => fetchJson<{ module: string; phase: number; status: string; message: string }>("/ccdi/health"),
  });

  const summary = useQuery({
    queryKey: ["ccdi", "command-centre"],
    queryFn: () =>
      fetchJson<{
        summary: {
          assets: { total: number; approved: number; high_risk: number };
          recentAuditEvents: number;
          phase: number;
          note: string;
        };
      }>("/ccdi/command-centre"),
  });

  const orgs = useQuery({
    queryKey: ["ccdi", "organizations"],
    queryFn: () => fetchJson<{ organizations: Array<{ id: string; name: string; slug: string; status: string }> }>("/ccdi/organizations"),
  });

  return (
    <div className="flex-1 overflow-auto">
      <div className="border-b border-border/60 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 px-6 py-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/15 ring-1 ring-cyan-400/30">
              <Shield className="h-6 w-6 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white">
                CINTEXA Advanced Cyber Defense
              </h1>
              <p className="text-sm text-slate-400">
                Security Intelligence Platform — Phase {health.data?.phase ?? 2} Foundation
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-6 p-6">
        {health.isError && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            CCDI API is not reachable yet. Ensure the API server is running and the database has been bootstrapped.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<Server className="h-5 w-5 text-cyan-400" />}
            label="Assets"
            value={summary.data?.summary.assets.total ?? "—"}
            sub={`${summary.data?.summary.assets.approved ?? 0} approved`}
            loading={summary.isLoading}
          />
          <StatCard
            icon={<AlertTriangle className="h-5 w-5 text-rose-400" />}
            label="High / Critical Risk"
            value={summary.data?.summary.assets.high_risk ?? "—"}
            sub="from inventory"
            loading={summary.isLoading}
          />
          <StatCard
            icon={<Activity className="h-5 w-5 text-emerald-400" />}
            label="Audit Events (7d)"
            value={summary.data?.summary.recentAuditEvents ?? "—"}
            sub="real records only"
            loading={summary.isLoading}
          />
          <StatCard
            icon={<Building2 className="h-5 w-5 text-violet-400" />}
            label="Organisations"
            value={orgs.data?.organizations.length ?? "—"}
            sub="tenants"
            loading={orgs.isLoading}
          />
        </div>

        <div className="rounded-xl border border-border/60 bg-card/40 p-5">
          <h2 className="text-sm font-medium text-muted-foreground">Platform status</h2>
          <p className="mt-2 text-sm text-foreground/90">
            {health.data?.message ??
              "CCDI Platform Foundation is being initialised. Secure execution, scanners and AI agents are introduced in later phases."}
          </p>
          {summary.data?.summary.note && (
            <p className="mt-3 text-xs text-muted-foreground">{summary.data.summary.note}</p>
          )}
        </div>

        <div className="rounded-xl border border-border/60 bg-card/40 p-5">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Organisations</h2>
          {orgs.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {orgs.data?.organizations.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No organisations yet. Create one via the API or forthcoming admin UI.
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
