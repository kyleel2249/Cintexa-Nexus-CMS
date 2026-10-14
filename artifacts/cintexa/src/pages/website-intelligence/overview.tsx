import { Link } from "wouter";
import { ArrowRight, FilePlus2, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIntegrations, useMeta, useStats } from "@/lib/website-intelligence/api";
import { AuditStatusBadge, EmptyState, ErrorNote, Loading, Panel, ScoreRing, Stat, WI, auditLink, fmtDate, label } from "./components";

export default function Overview() {
  const stats = useStats();
  const meta = useMeta();
  const integrations = useIntegrations();
  if (stats.isLoading) return <Loading />;
  if (stats.error) return <ErrorNote error={stats.error} />;
  const s = stats.data!;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat title="Audits" value={s.total} hint={`${s.completed} finished, ${s.failed} failed`} />
        <Stat title="Running now" value={s.running} hint={meta.data ? `${meta.data.totalTests} tests in the catalogue` : undefined} />
        <Stat title="Average score" value={s.averageScore ?? "n/a"} hint={s.averageScore == null ? "No scored audits yet" : "Across your finished audits"} />
        <Stat title="Sites tracked" value={s.sites.length} />
      </div>

      {s.total === 0 ? (
        <EmptyState title="No audits yet" body="Start with a URL you own or are authorised to audit. The engine crawls it, records evidence for every test and computes scores you can defend." action={<Link href={`${WI}/new`}><Button><FilePlus2 className="mr-2 h-4 w-4" />Run your first audit</Button></Link>} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <Panel className="lg:col-span-2" title="Tracked websites" description="Latest finished audit per site, with change since the previous one." actions={<Link href={`${WI}/audits`} className="text-xs underline">All audits</Link>}>
            {s.sites.length === 0 ? <p className="text-sm text-muted-foreground">No finished audits yet.</p> : (
              <ul className="divide-y">
                {s.sites.map((site) => {
                  const delta = site.latest.overall != null && site.previousOverall != null ? Math.round((site.latest.overall - site.previousOverall) * 10) / 10 : null;
                  return (
                    <li key={site.hostname} className="flex items-center gap-4 py-3">
                      <ScoreRing score={site.latest.overall} size={64} provisional={site.latest.provisional} />
                      <div className="min-w-0 flex-1">
                        <Link href={auditLink({ id: site.latest.id })} className="font-medium hover:underline">{site.hostname}</Link>
                        <div className="text-xs text-muted-foreground">{site.audits} audit(s) - last {fmtDate(site.latest.completedAt)}{site.latest.readiness ? ` - ${label(site.latest.readiness)}` : ""}</div>
                      </div>
                      {delta != null && <span className={`flex items-center gap-1 text-sm tabular-nums ${delta >= 0 ? "text-emerald-400" : "text-red-400"}`}>{delta >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}{delta > 0 ? "+" : ""}{delta}</span>}
                      <Link href={auditLink({ id: site.latest.id })} aria-label={`Open ${site.hostname}`}><ArrowRight className="h-4 w-4 text-muted-foreground" /></Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          <Panel title="Recent activity">
            <ul className="space-y-3">
              {s.recent.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link href={auditLink(a)} className="min-w-0 truncate hover:underline">{a.config.name || a.hostname}<span className="ml-1 text-xs text-muted-foreground">{a.kind !== "audit" ? `(${a.kind})` : ""}</span></Link>
                  <AuditStatusBadge s={a.status} />
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      <Panel title="Capabilities available to this workspace" description="Anything not configured is reported as not tested in audits. It is never assumed to pass.">
        {integrations.isLoading ? <Loading /> : (
          <ul className="grid gap-2 md:grid-cols-2">
            {(integrations.data ?? []).map((i) => (
              <li key={i.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{i.name}</span><span className={i.status === "available" ? "text-emerald-400 text-xs" : "text-amber-400 text-xs"}>{i.status === "available" ? "Available" : i.status === "unreachable" ? "Unreachable" : "Not configured"}</span></div>
                <p className="mt-1 text-xs text-muted-foreground">{i.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
