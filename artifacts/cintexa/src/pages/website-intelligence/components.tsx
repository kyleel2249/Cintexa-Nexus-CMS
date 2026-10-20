import type { ReactNode } from "react";
import { Link } from "wouter";
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, PolarRadiusAxis, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, Cell, CartesianGrid } from "recharts";
import type { AuditStatus, AuditSummary, Severity, TestStatus } from "@workspace/wi-core";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const WI = "/website-intelligence";

export const SEVERITY_CLASS: Record<Severity, string> = {
  critical: "bg-red-500/15 text-red-400 border-red-500/30",
  high: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  low: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  info: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};
export const SEVERITY_HEX: Record<Severity, string> = { critical: "#dc2626", high: "#ea580c", medium: "#d97706", low: "#0284c7", info: "#64748b" };

export const STATUS_CLASS: Record<TestStatus, string> = {
  passed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
  warning: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  informational: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  not_applicable: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  not_tested: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  blocked: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  inconclusive: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30",
};

export const AUDIT_STATUS_CLASS: Record<AuditStatus, string> = {
  queued: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  running: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  partial: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
  cancelled: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

export const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function Pill({ className, children }: { className?: string; children: ReactNode }) {
  return <Badge variant="outline" className={cn("capitalize font-medium", className)}>{children}</Badge>;
}
export const SeverityBadge = ({ s }: { s: Severity }) => <Pill className={SEVERITY_CLASS[s]}>{s}</Pill>;
export const StatusBadge = ({ s }: { s: TestStatus }) => <Pill className={STATUS_CLASS[s]}>{label(s)}</Pill>;
export const AuditStatusBadge = ({ s }: { s: AuditStatus }) => <Pill className={AUDIT_STATUS_CLASS[s]}>{s}</Pill>;

export function scoreColor(score: number | null | undefined): string {
  if (score == null) return "#64748b";
  if (score >= 90) return "#16a34a";
  if (score >= 70) return "#65a30d";
  if (score >= 50) return "#d97706";
  return "#dc2626";
}

export function ScoreRing({ score, size = 120, caption, provisional }: { score: number | null; size?: number; caption?: string; provisional?: boolean | null }) {
  const r = size / 2 - 9;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="inline-flex flex-col items-center" role="img" aria-label={`${caption ?? "Score"}: ${score == null ? "not available" : `${Math.round(score)} out of 100`}${provisional ? ", provisional" : ""}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={9} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={scoreColor(score)} strokeWidth={9} strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} strokeDashoffset={provisional ? 0 : 0} opacity={provisional ? 0.75 : 1} />
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-foreground" style={{ fontSize: size * 0.3, fontWeight: 700 }}>{score == null ? "n/a" : Math.round(score)}</text>
      </svg>
      {caption && <span className="text-xs text-muted-foreground mt-1">{caption}{provisional ? " (provisional)" : ""}</span>}
    </div>
  );
}

export function Stat({ title, value, hint, tone }: { title: string; value: ReactNode; hint?: ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Panel({ title, description, actions, children, className }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3">
          <div>{title && <h3 className="text-sm font-semibold">{title}</h3>}{description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}</div>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center">
      <h3 className="font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  const backendDown = /unreachable|API backend|API_ORIGIN|not configured/i.test(message) && /api|backend/i.test(message);
  return (
    <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      {message}
      {backendDown && (
        <div className="mt-2 text-xs text-red-200/90">
          Website Intelligence needs the CINTEXA API server, which runs the audits and stores their history. Deploy it (the repository includes a Dockerfile and render.yaml), then set <code>API_ORIGIN</code> in Cloudflare Pages to its address without <code>/api</code> and redeploy. Step by step: <code>docs/website-intelligence/api-host-setup.md</code>.
        </div>
      )}
    </div>
  );
}

export function Loading({ text = "Loading" }: { text?: string }) {
  return <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status"><span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />{text}</div>;
}

export const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "n/a");
export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const auditLink = (a: Pick<AuditSummary, "id">, sub = "") => `${WI}/audits/${a.id}${sub}`;

export function ScoreLink({ a }: { a: AuditSummary }) {
  return <Link href={auditLink(a)} className="font-medium hover:underline">{a.config.name || a.hostname}</Link>;
}

// ------------------------------------------------------------------------------------------------ charts (real data only)

export interface CategoryDatum { id: string; label: string; score: number | null; coverage: number }

export function CategoryRadar({ data, onSelect }: { data: CategoryDatum[]; onSelect?: (id: string) => void }) {
  const plotted = data.map((d) => ({ ...d, value: d.score ?? 0 }));
  return (
    <div>
      <div className="h-72" aria-hidden="true">
        <ResponsiveContainer>
          <RadarChart data={plotted} outerRadius="72%">
            <PolarGrid strokeOpacity={0.25} />
            <PolarAngleAxis dataKey="label" tick={{ fontSize: 11, fill: "currentColor" }} />
            <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9 }} axisLine={false} />
            <Radar dataKey="value" stroke="#b08612" fill="#b08612" fillOpacity={0.25} onClick={(d: unknown) => { const id = (d as { id?: string } | null)?.id; if (id) onSelect?.(id); }} />
            <Tooltip formatter={(v: number, _n, item) => [(item?.payload as CategoryDatum).score == null ? "not scored" : Math.round(v), "Score"]} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only"><caption>Category scores</caption><tbody>{data.map((d) => <tr key={d.id}><th scope="row">{d.label}</th><td>{d.score == null ? "not scored" : Math.round(d.score)}</td></tr>)}</tbody></table>
    </div>
  );
}

export function CategoryBars({ data, onSelect, active }: { data: CategoryDatum[]; onSelect?: (id: string) => void; active?: string | null }) {
  return (
    <ul className="space-y-1.5" aria-label="Category scores">
      {data.map((d) => (
        <li key={d.id}>
          <button type="button" onClick={() => onSelect?.(d.id)} aria-pressed={active === d.id} className={cn("group w-full rounded-md px-2 py-1.5 text-left hover:bg-secondary", active === d.id && "bg-secondary")}>
            <div className="flex items-center justify-between text-xs"><span className="font-medium">{d.label}</span><span className="tabular-nums text-muted-foreground">{d.score == null ? "not scored" : `${Math.round(d.score)} / 100`} <span className="opacity-70">({pct(d.coverage)} coverage)</span></span></div>
            <div className="mt-1 h-2 overflow-hidden rounded bg-muted"><div className="h-full rounded" style={{ width: `${d.score ?? 0}%`, background: scoreColor(d.score) }} /></div>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function SeverityChart({ counts, onSelect, active }: { counts: Record<Severity, number>; onSelect?: (s: Severity) => void; active?: Severity | null }) {
  const data = (["critical", "high", "medium", "low", "info"] as Severity[]).map((s) => ({ severity: s, count: counts[s] ?? 0 }));
  return (
    <div>
      <div className="h-44" aria-hidden="true">
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid horizontal={false} strokeOpacity={0.15} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="severity" tick={{ fontSize: 11 }} width={60} />
            <Tooltip />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} onClick={(d: { severity?: Severity }) => d?.severity && onSelect?.(d.severity)} cursor={onSelect ? "pointer" : undefined}>
              {data.map((d) => <Cell key={d.severity} fill={SEVERITY_HEX[d.severity]} opacity={active && active !== d.severity ? 0.35 : 1} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-2 text-xs">
        {data.map((d) => <li key={d.severity}><button type="button" className={cn("rounded-md border px-2 py-0.5", SEVERITY_CLASS[d.severity], active === d.severity && "ring-1 ring-current")} onClick={() => onSelect?.(d.severity)} aria-pressed={active === d.severity}>{d.severity}: {d.count}</button></li>)}
      </ul>
    </div>
  );
}
