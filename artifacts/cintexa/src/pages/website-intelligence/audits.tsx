import { useState } from "react";
import { Link } from "wouter";
import { FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAudits } from "@/lib/website-intelligence/api";
import { AuditStatusBadge, EmptyState, ErrorNote, Loading, ScoreRing, WI, auditLink, fmtDate, label } from "./components";

export default function AuditList() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const q = useAudits({ search: search.trim(), status, kind, limit: 100 });
  return (
    <div className="space-y-4">
      <div className="wi-no-print flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Search by site name or host" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search audits" />
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">Any status</option>{["queued", "running", "completed", "partial", "failed", "cancelled"].map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filter by type">
          <option value="">All types</option><option value="audit">Audits</option><option value="retest">Retests</option><option value="benchmark">Benchmarks</option>
        </select>
        <Link href={`${WI}/new`} className="ml-auto"><Button size="sm"><FilePlus2 className="mr-2 h-4 w-4" />New audit</Button></Link>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : !q.data?.items.length ? (
        <EmptyState title="No audits match" body={search || status || kind ? "Clear the filters to see all audits." : "Audit history appears here once you run an audit."} />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">Website</th><th className="p-3">Score</th><th className="p-3">Status</th><th className="p-3">Readiness</th><th className="p-3">Pages</th><th className="p-3">Started</th></tr></thead>
            <tbody className="divide-y">
              {q.data.items.map((a) => (
                <tr key={a.id} className="hover:bg-muted/30">
                  <td className="p-3"><Link href={auditLink(a)} className="font-medium hover:underline">{a.config.name || a.hostname}</Link><div className="text-xs text-muted-foreground">{a.hostname}{a.kind !== "audit" ? ` - ${a.kind}` : ""} - {a.profile}</div></td>
                  <td className="p-3"><ScoreRing score={a.scores?.overall ?? null} size={44} provisional={a.scores?.provisional} /></td>
                  <td className="p-3"><AuditStatusBadge s={a.status} />{a.status === "running" && <div className="mt-1 text-xs text-muted-foreground">{a.stage ? label(a.stage) : "starting"}</div>}</td>
                  <td className="p-3 text-xs">{a.scores ? a.scores.readiness.label : "n/a"}</td>
                  <td className="p-3 tabular-nums">{a.progress.inspected}</td>
                  <td className="p-3 text-xs text-muted-foreground">{fmtDate(a.startedAt ?? a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.data && <p className="text-xs text-muted-foreground">{q.data.total} audit(s) in total.</p>}
    </div>
  );
}
